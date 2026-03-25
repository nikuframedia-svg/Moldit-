"""Phase 4 — JIT v3: Backward scheduling for just-in-time production.

Goal: push production as late as possible (2-3 days before delivery).

Strategy:
  1. Assign machines (same load balancing as baseline).
  2. Sort per machine by EDD (pure EDD, no campaign grouping).
  3. Backward-stack gates: last run at max_gate, cascade backward.
  4. Dispatch with EDD sequence + gates.
  5. Safety net: fall back to baseline if tardy worsens.

Campaign grouping is intentionally skipped for JIT — it reorders runs
from pure EDD and causes cascading delays when gates are applied.
The extra setups are negligible given ~50% spare capacity.

Kept: compute_lst() and compute_paced_lst() for reference/tests.
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.scheduler.constants import DAY_CAP, LST_SAFETY_BUFFER
from backend.scheduler.dispatch import (
    assign_machines,
    per_machine_dispatch,
)
from backend.scheduler.scoring import compute_score
from backend.scheduler.types import Lot, Segment, ToolRun
from backend.types import EngineData

logger = logging.getLogger(__name__)

# Minimum slack (days) to consider a run for delay
_MIN_SLACK = 2


def compute_lst(
    run: ToolRun,
    holiday_set: set[int],
    safety_buffer: int = LST_SAFETY_BUFFER,
    config: FactoryConfig | None = None,
) -> int:
    """Compute basic Latest Start Time for a run.

    LST = EDD - days_needed - safety_buffer, skipping holidays.
    """
    day_cap = config.day_capacity_min if config else DAY_CAP
    days_needed = math.ceil(run.total_min / day_cap)
    remaining = days_needed + safety_buffer
    current_day = run.edd

    while remaining > 0 and current_day > 0:
        current_day -= 1
        if current_day not in holiday_set:
            remaining -= 1

    return max(0, current_day)


def compute_paced_lst(
    run: ToolRun,
    holiday_set: set[int],
    safety_buffer: int = LST_SAFETY_BUFFER,
    config: FactoryConfig | None = None,
) -> int:
    """Compute demand-paced LST: tightest constraint from internal lots.

    For each lot in the run, compute: lot.edd - cumulative_days_needed.
    Return min of basic LST and paced LST.
    """
    day_cap = config.day_capacity_min if config else DAY_CAP
    lst_basic = compute_lst(run, holiday_set, safety_buffer, config=config)

    cum_time = run.setup_min
    tightest = run.edd

    for lot in run.lots:
        cum_time += lot.prod_min
        cum_days = math.ceil(cum_time / day_cap)
        latest_for_this = lot.edd - cum_days
        tightest = min(tightest, latest_for_this)

    lst_paced = max(0, tightest)
    return min(lst_basic, lst_paced)


# ─── JIT v3: Backward scheduling ──────────────────────────────────────


def _max_gate(run: ToolRun, holiday_set: set[int], day_cap: int = DAY_CAP) -> int:
    """Latest start day for a run, skipping holidays.

    Counts workdays backwards from EDD: needs ceil(total_min/day_cap) + 1 margin.
    """
    days_needed = math.ceil(run.total_min / day_cap)
    remaining = days_needed
    current = run.edd

    while remaining > 0 and current > 0:
        current -= 1
        if current not in holiday_set:
            remaining -= 1

    return max(0, current)


def _compute_run_timing(
    segments: list[Segment],
) -> tuple[dict[str, int], dict[str, int]]:
    """Extract start/end day per run from baseline segments."""
    run_days: dict[str, list[int]] = defaultdict(list)
    for seg in segments:
        run_days[seg.run_id].append(seg.day_idx)

    run_start: dict[str, int] = {}
    run_end: dict[str, int] = {}
    for run_id, days in run_days.items():
        run_start[run_id] = min(days)
        run_end[run_id] = max(days)

    return run_start, run_end


def _subtract_workdays(from_day: int, workdays: int, holiday_set: set[int]) -> int:
    """Subtract N workdays from a day, skipping holidays."""
    current = from_day
    remaining = workdays
    while remaining > 0 and current > 0:
        current -= 1
        if current not in holiday_set:
            remaining -= 1
    return max(0, current)


def _backward_stack_gates(
    machine_runs: dict[str, list[ToolRun]],
    holiday_set: set[int],
    n_days: int,
    params=None,
    config: FactoryConfig | None = None,
) -> dict[str, float]:
    """Compute per-run gates via backward stacking per machine.

    Uses absolute minutes with a per-run shift-alignment buffer.
    Dispatch starts runs mid-shift, wasting partial days; the buffer
    (half a DAY_CAP + setup time) absorbs this overhead.

    For each machine (runs in EDD-ascending order):
    - Last run: gate = max_gate
    - Each preceding run: gate = min(max_gate, next_start - total - buffer)
    """
    day_cap = config.day_capacity_min if config else DAY_CAP

    gates: dict[str, float] = {}
    for m_id, m_runs in machine_runs.items():
        if not m_runs:
            continue

        next_start_abs: float = float(n_days * day_cap)

        for i in range(len(m_runs) - 1, -1, -1):
            run = m_runs[i]
            mg_abs = float(_max_gate(run, holiday_set, day_cap=day_cap) * day_cap)

            # Buffer: overhead pct of work time + setup absorbs shift-boundary overhead.
            pct = getattr(params, 'backward_buffer_pct', config.jit_buffer_pct if config else 0.05)
            buffer = run.total_min * pct + run.setup_min
            candidate_abs = next_start_abs - run.total_min - buffer
            gate_abs = min(mg_abs, candidate_abs)
            gate_abs = max(0.0, gate_abs)

            # Snap to day boundary, skip holidays
            gate_day = int(gate_abs) // day_cap
            while gate_day in holiday_set and gate_day > 0:
                gate_day -= 1
                gate_abs = float(gate_day * day_cap)

            gates[run.id] = gate_abs
            next_start_abs = gate_abs

    return gates


def jit_dispatch(
    runs: list[ToolRun],
    engine_data: EngineData,
    baseline_segments: list[Segment],
    baseline_lots: list[Lot],
    baseline_score: dict,
    audit_logger: object | None = None,
    params: object | None = None,
    config: FactoryConfig | None = None,
) -> tuple[list[Segment], list[Lot], list[str]]:
    """JIT v3: backward scheduling with EDD-pure sequence.

    1. Assign machines (same load balancing as baseline).
    2. Sort per machine by EDD (no campaign grouping — avoids cascading delays).
    3. Backward-stack gates per machine.
    4. Dispatch with EDD sequence + gates.
    5. Safety net: fall back to baseline if tardy worsens.
    """
    day_cap = config.day_capacity_min if config else DAY_CAP
    target_tardy = baseline_score["tardy_count"]
    target_otd_d = baseline_score.get("otd_d_failures", 0)
    holiday_set = set(getattr(engine_data, "holidays", []))

    # Phase 1: Assign machines (same load balancing)
    jit_machine_runs = assign_machines(runs, engine_data, audit_logger=audit_logger, params=params, config=config)

    # Phase 2: Pure EDD sort per machine (no campaigns)
    for m_id in jit_machine_runs:
        jit_machine_runs[m_id].sort(key=lambda r: r.edd)

    # Phase 3: Backward-stack gates
    current_gate = _backward_stack_gates(jit_machine_runs, holiday_set, engine_data.n_days, params=params, config=config)

    gated_count = sum(1 for g in current_gate.values() if g > 0)
    logger.info(
        "JIT v3: %d/%d runs gated via backward stacking",
        gated_count, len(runs),
    )

    # Log gate decisions
    if audit_logger:
        run_by_id = {r.id: r for r in runs}
        for run_id, gate_abs in current_gate.items():
            if gate_abs > 0 and run_id in run_by_id:
                r = run_by_id[run_id]
                mg = float(_max_gate(r, holiday_set, day_cap=day_cap) * day_cap)
                audit_logger.log_gate(run_id, gate_abs, mg, r.edd, "gate_jit")

    # Phase 4: Dispatch each machine independently (no shared crew contention).
    # Crew utilization is ~7% total, so independent dispatch is safe.
    jit_segs: list[Segment] = []
    jit_lots: list[Lot] = []
    jit_warns: list[str] = []
    for m_id, m_runs in jit_machine_runs.items():
        m_segs, m_lots, m_warns = per_machine_dispatch(
            {m_id: m_runs}, engine_data, lst_gate=current_gate, config=config,
        )
        jit_segs.extend(m_segs)
        jit_lots.extend(m_lots)
        jit_warns.extend(m_warns)
    jit_score = compute_score(jit_segs, jit_lots, engine_data, config=config)

    # Phase 5: Targeted safety net — pull back tardy runs AND predecessors
    # Build machine→run index for predecessor lookup
    run_machine: dict[str, str] = {}
    for m_id, m_runs in jit_machine_runs.items():
        for run in m_runs:
            run_machine[run.id] = m_id

    max_retries = 5
    for attempt in range(max_retries):
        if (jit_score["tardy_count"] <= target_tardy
                and jit_score.get("otd_d_failures", 0) <= target_otd_d):
            break

        # Find tardy machines and pull back all their gated runs by 1 day.
        # Must pull ALL predecessors because chains can span 15+ days.
        _, run_end = _compute_run_timing(jit_segs)
        run_by_id = {r.id: r for r in runs}
        changed = False
        tardy_machines: set[str] = set()
        for rid, end_day in run_end.items():
            if rid in run_by_id and end_day > run_by_id[rid].edd:
                m_id = run_machine.get(rid)
                if m_id:
                    tardy_machines.add(m_id)
        for m_id in tardy_machines:
            for mr_run in jit_machine_runs[m_id]:
                if mr_run.id in current_gate and current_gate[mr_run.id] > 0:
                    current_gate[mr_run.id] = max(
                        0.0, current_gate[mr_run.id] - day_cap,
                    )
                    changed = True

        if not changed:
            return baseline_segments, baseline_lots, [
                f"JIT safety net: tardy {jit_score['tardy_count']} > {target_tardy}"
            ]

        # Re-dispatch with adjusted gates
        jit_segs = []
        jit_lots = []
        jit_warns = []
        for m_id, m_runs in jit_machine_runs.items():
            m_segs, m_lots, m_warns = per_machine_dispatch(
                {m_id: m_runs}, engine_data, lst_gate=current_gate, config=config,
            )
            jit_segs.extend(m_segs)
            jit_lots.extend(m_lots)
            jit_warns.extend(m_warns)
        jit_score = compute_score(jit_segs, jit_lots, engine_data, config=config)
    else:
        if (jit_score["tardy_count"] > target_tardy
                or jit_score.get("otd_d_failures", 0) > target_otd_d):
            return baseline_segments, baseline_lots, [
                f"JIT safety net: tardy {jit_score['tardy_count']} > {target_tardy}"
            ]

    logger.info(
        "JIT v3: earliness %.1f → %.1f days",
        baseline_score.get("earliness_avg_days", 0),
        jit_score.get("earliness_avg_days", 0),
    )

    warnings = [
        f"JIT: {gated_count} runs gated, "
        f"earliness {baseline_score.get('earliness_avg_days', 0):.1f}"
        f" → {jit_score.get('earliness_avg_days', 0):.1f}d",
    ]
    warnings.extend(jit_warns)

    return jit_segs, jit_lots, warnings
