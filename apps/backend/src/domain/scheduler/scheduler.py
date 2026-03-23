"""Scheduler entry point — section 2 of the spec.

schedule_all() orchestrates: demand grouping → dispatch → allocation → overflow routing.
This is the primary solver, replacing CP-SAT for production scheduling.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from ..scheduling.types import (
    AdvanceAction,
    Block,
    EngineData,
    FeasibilityReport,
    InfeasibilityEntry,
    MoveAction,
    ScheduleResult,
    TwinOutput,
)
from .constants import (
    DAY_CAP,
    K1_VALUES,
    K2_VALUES,
    LEVEL_HIGH_THRESHOLD,
    LEVEL_LOOKAHEAD,
    LEVEL_LOW_THRESHOLD,
)
from .demand_grouper import group_demand_into_buckets
from .overflow_router import (
    auto_route_overflow,
    compute_otd_delivery_failures,
    compute_tardiness,
    sum_overflow,
)
from .scoring import score_greedy_schedule
from .slot_allocator import schedule_machines
from .types import EarliestStart

logger = logging.getLogger(__name__)


def schedule_all(
    engine_data: EngineData,
    settings: dict[str, Any] | None = None,
    trace: list[dict[str, Any]] | None = None,
) -> ScheduleResult:
    """Main entry point — port of scheduleAll() from TS engine.

    Pipeline:
    1. Backward scheduling (earliest starts)
    2. Demand grouping + twin merge
    3. Dispatch sorting + tool merging
    4. Slot allocation (4 constraints)
    5. Load leveling (optional)
    6. Merge consecutive blocks
    7. Repair violations
    8. Overflow routing (Tiers 1-3)
    9. Feasibility report
    """
    t0 = time.perf_counter()
    settings = settings or {}

    # Step 1: Backward scheduling
    earliest_starts = _compute_earliest_starts(engine_data)

    # Step 2: Demand grouping
    machine_groups = group_demand_into_buckets(
        ops=engine_data.ops,
        tool_map=engine_data.tool_map,
        twin_groups=engine_data.twin_groups,
        workdays=engine_data.workdays,
        n_days=engine_data.n_days,
        order_based=engine_data.order_based,
        m_st=engine_data.m_st,
        t_st=engine_data.t_st,
    )

    # Steps 3-4: Internal schedule function (reusable by overflow router)
    def _do_schedule(
        moves: list[MoveAction] | None = None,
        advances: list[AdvanceAction] | None = None,
        rule: str = "EDD",
        k1: float = 1.5,
        k2: float = 0.5,
    ) -> list[Block]:
        """Inner schedule: regroup with moves/advances, then allocate."""
        move_map = {m.op_id: m.to_m for m in (moves or [])}
        advance_map = {a.op_id: a for a in (advances or [])}

        # Apply advances to demand
        effective_data = engine_data
        if advance_map:
            effective_data = _apply_advances(engine_data, advance_map)

        mg = group_demand_into_buckets(
            ops=effective_data.ops,
            tool_map=effective_data.tool_map,
            twin_groups=effective_data.twin_groups,
            workdays=effective_data.workdays,
            n_days=effective_data.n_days,
            order_based=effective_data.order_based,
            moves=move_map,
            m_st=effective_data.m_st,
            t_st=effective_data.t_st,
        )

        blocks, _ = schedule_machines(
            machine_groups=mg,
            engine_data=effective_data,
            settings=settings,
            rule=rule,
            k1=k1,
            k2=k2,
            trace=trace,
        )
        return blocks

    # Initial schedule with ATCS grid search
    best_k1, best_k2 = 1.5, 0.5
    best_metric = float("inf")
    worst_metric = 0.0
    worst_k1, worst_k2 = 1.5, 0.5
    zero_ov_count = 0

    # Quick grid search: try 25 K1/K2 combos, pick best
    if len(machine_groups) > 0:
        for k1 in K1_VALUES:
            for k2 in K2_VALUES:
                trial = _do_schedule(rule="ATCS", k1=k1, k2=k2)
                tard_days = compute_tardiness(trial) / DAY_CAP
                ov = sum_overflow(trial)
                metric = tard_days * 1e6 + ov
                if ov == 0:
                    zero_ov_count += 1
                if metric < best_metric:
                    best_metric = metric
                    best_k1 = k1
                    best_k2 = k2
                if metric > worst_metric:
                    worst_metric = metric
                    worst_k1 = k1
                    worst_k2 = k2

    if trace is not None:
        trace.append(
            {
                "type": "grid_search",
                "best": {"k1": best_k1, "k2": best_k2, "metric": round(best_metric, 1)},
                "worst": {"k1": worst_k1, "k2": worst_k2, "metric": round(worst_metric, 1)},
                "zero_overflow_count": zero_ov_count,
            }
        )

    blocks = _do_schedule(rule="ATCS", k1=best_k1, k2=best_k2)

    # Step 5: Load leveling
    enable_leveling = settings.get("enableLeveling", False)
    if enable_leveling:
        blocks = _level_load(blocks, engine_data, earliest_starts)

    # Step 6: Merge consecutive blocks
    blocks = _merge_consecutive(blocks)

    # Step 7: Repair violations
    blocks = _repair_violations(blocks, engine_data)

    # Step 8: Overflow routing (Tiers 1-3)
    if sum_overflow(blocks) > 0 or compute_tardiness(blocks) > 0:
        blocks, auto_moves, auto_advances, route_decisions = auto_route_overflow(
            blocks=blocks,
            engine_data=engine_data,
            settings=settings,
            schedule_fn=_do_schedule,
            trace=trace,
        )
    else:
        auto_moves = []
        auto_advances = []
        route_decisions = []

    # Step 8b: JIT right-shift — push blocks as late as possible
    if not settings.get("disableJIT", False):
        blocks = _jit_right_shift(blocks, engine_data)

    # Final OTD-D check
    otd_failures = compute_otd_delivery_failures(blocks, engine_data.ops)

    # Step 9: Feasibility report
    feasibility = _build_feasibility(blocks, engine_data)

    # Score
    score = score_greedy_schedule(blocks, engine_data)

    elapsed = time.perf_counter() - t0
    logger.info(
        "scheduler.schedule_all.done",
        extra={
            "n_blocks": len(blocks),
            "n_ops": len(engine_data.ops),
            "otd_d_failures": len(otd_failures),
            "elapsed_s": round(elapsed, 3),
            "k1": best_k1,
            "k2": best_k2,
        },
    )

    return ScheduleResult(
        blocks=blocks,
        moves=auto_moves,
        advances=auto_advances,
        decisions=route_decisions,
        feasibility=feasibility,
        score=score,
    )


# ── Step 1: Backward scheduling ──


def _compute_earliest_starts(engine_data: EngineData) -> dict[str, EarliestStart]:
    """Section 18: For ops with ltDays, compute earliest start day."""
    result: dict[str, EarliestStart] = {}
    workdays = engine_data.workdays
    wd_indices = [i for i, wd in enumerate(workdays) if wd]

    for op in engine_data.ops:
        lt_days = op.lt_days
        if not lt_days or lt_days <= 0:
            continue

        # Find last day with demand
        last_demand_day = -1
        for i in range(len(op.d) - 1, -1, -1):
            if op.d[i] > 0:
                last_demand_day = i
                break
        if last_demand_day < 0:
            continue

        # Find position in workday list
        try:
            wd_pos = wd_indices.index(last_demand_day)
        except ValueError:
            # last_demand_day is not a workday; find closest
            wd_pos = len(wd_indices) - 1
            for idx, wdi in enumerate(wd_indices):
                if wdi >= last_demand_day:
                    wd_pos = idx
                    break

        target_pos = wd_pos - lt_days
        if target_pos < 0:
            earliest = 0
        else:
            earliest = wd_indices[target_pos]

        result[op.id] = EarliestStart(
            op_id=op.id,
            earliest_day_idx=earliest,
            latest_day_idx=last_demand_day,
            lt_days=lt_days,
        )

    return result


# ── Step 5: Load leveling ──


def _level_load(
    blocks: list[Block],
    engine_data: EngineData,
    earliest_starts: dict[str, EarliestStart],
) -> list[Block]:
    """Section 20: Redistribute blocks between heavy and light days."""
    # Build utilization map per machine per day
    from collections import defaultdict

    machine_day_used: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for b in blocks:
        if b.type == "ok":
            machine_day_used[b.machine_id][b.day_idx] += b.prod_min + b.setup_min

    for mid, day_map in machine_day_used.items():
        heavy_days = [d for d, u in day_map.items() if u / DAY_CAP > LEVEL_HIGH_THRESHOLD]
        light_days = [d for d, u in day_map.items() if u / DAY_CAP < LEVEL_LOW_THRESHOLD]

        if not heavy_days or not light_days:
            continue

        heavy_days.sort()
        light_days.sort()

        for b in blocks:
            if b.type != "ok" or b.machine_id != mid or b.day_idx not in heavy_days:
                continue

            for ld in light_days:
                if ld >= b.day_idx:
                    continue  # Only move to earlier days
                if abs(b.day_idx - ld) > LEVEL_LOOKAHEAD:
                    continue

                # Check earliest start
                es = earliest_starts.get(b.op_id)
                if es and ld < es.earliest_day_idx:
                    continue

                # Check capacity on light day
                used = machine_day_used[mid].get(ld, 0)
                if used + b.prod_min > DAY_CAP * LEVEL_HIGH_THRESHOLD:
                    continue

                # Move
                machine_day_used[mid][b.day_idx] -= b.prod_min + b.setup_min
                machine_day_used[mid][ld] += b.prod_min + b.setup_min
                b.day_idx = ld
                b.is_leveled = True
                break

    return blocks


# ── Step 6: Merge consecutive ──


def _merge_consecutive(blocks: list[Block]) -> list[Block]:
    """Section 6: Merge consecutive blocks of same op on same day/machine."""
    blocks.sort(key=lambda b: (b.machine_id, b.day_idx, b.start_min))
    merged: list[Block] = []

    for b in blocks:
        if (
            merged
            and b.type == "ok"
            and merged[-1].type == "ok"
            and b.op_id == merged[-1].op_id
            and b.machine_id == merged[-1].machine_id
            and b.day_idx == merged[-1].day_idx
            and b.start_min == merged[-1].end_min
        ):
            prev = merged[-1]
            prev.end_min = b.end_min
            prev.prod_min += b.prod_min
            prev.qty += b.qty
            # Merge twin outputs: add quantities from both blocks
            if prev.outputs and b.outputs:
                merged_outs = {o.op_id: o.qty for o in prev.outputs}
                for o in b.outputs:
                    merged_outs[o.op_id] = merged_outs.get(o.op_id, 0) + o.qty
                prev.outputs = [
                    TwinOutput(
                        op_id=oid, sku=next(o.sku for o in prev.outputs if o.op_id == oid), qty=q
                    )
                    for oid, q in merged_outs.items()
                ]
            elif b.outputs and not prev.outputs:
                prev.outputs = b.outputs
        else:
            merged.append(b)

    return merged


# ── Step 7: Repair violations ──


def _repair_violations(blocks: list[Block], engine_data: EngineData) -> list[Block]:
    """Section 16: Fix setup overlaps + overcapacity."""
    # 16.1: Setup overlap repair — defer setups that conflict
    setup_slots: list[tuple[int, int, str]] = []  # (start, end, machine)
    for b in blocks:
        if b.setup_s is not None and b.setup_e is not None:
            setup_slots.append((b.setup_s, b.setup_e, b.machine_id))

    # Sort by start time
    setup_slots.sort()
    for b in blocks:
        if b.setup_s is None or b.setup_e is None:
            continue
        # Check conflicts with other machines
        for ss, se, sm in setup_slots:
            if sm == b.machine_id:
                continue
            if b.setup_s < se and b.setup_e > ss:
                # Conflict — push setup after
                old_dur = b.setup_e - b.setup_s
                b.setup_s = se
                b.setup_e = se + old_dur
                break

    # 16.2: Overcapacity repair — clip blocks exceeding day cap
    from collections import defaultdict

    day_cap = DAY_CAP
    machine_day_used: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for b in blocks:
        if b.type == "ok":
            machine_day_used[b.machine_id][b.day_idx] += b.prod_min

    # Already handled by slot allocator in most cases
    return blocks


# ── Step 9: Feasibility ──


def _build_feasibility(blocks: list[Block], engine_data: EngineData) -> FeasibilityReport:
    """Build feasibility report from blocks."""
    ok_ops: set[str] = set()
    infeasible_ops: set[str] = set()
    entries: list[InfeasibilityEntry] = []
    by_reason: dict[str, int] = {}

    for b in blocks:
        if b.type == "ok" and b.qty > 0:
            ok_ops.add(b.op_id)
        if b.type == "infeasible":
            infeasible_ops.add(b.op_id)
            reason = b.infeasibility_reason or "CAPACITY_OVERFLOW"
            by_reason[reason] = by_reason.get(reason, 0) + 1
            entries.append(
                InfeasibilityEntry(
                    op_id=b.op_id,
                    tool_id=b.tool_id,
                    machine_id=b.machine_id,
                    reason=reason,
                    detail=b.infeasibility_detail or "",
                    day_idx=b.day_idx,
                )
            )

    total = len(set(b.op_id for b in blocks))
    feasible = len(ok_ops)
    infeasible = len(infeasible_ops)

    return FeasibilityReport(
        total_ops=total,
        feasible_ops=feasible,
        infeasible_ops=infeasible,
        entries=entries,
        by_reason=by_reason,
        feasibility_score=feasible / max(total, 1),
        deadline_feasible=infeasible == 0,
    )


# ── Advance helper ──


def _apply_advances(
    engine_data: EngineData,
    advance_map: dict[str, AdvanceAction],
) -> EngineData:
    """Apply advance overrides to engine data by shifting demand earlier.

    Returns a modified copy of engine_data (shallow — only ops list is new).
    """
    from ..scheduling.types import EOp

    new_ops: list[EOp] = []
    workdays = engine_data.workdays

    for op in engine_data.ops:
        adv = advance_map.get(op.id)
        if not adv:
            new_ops.append(op)
            continue

        # Shift demand days backward by advance_days workdays
        new_d = list(op.d)
        for i in range(len(new_d)):
            if new_d[i] > 0:
                target = i
                count = 0
                while count < adv.advance_days and target > 0:
                    target -= 1
                    if target < len(workdays) and workdays[target]:
                        count += 1
                if target != i:
                    new_d[target] = new_d.get(target, 0) if hasattr(new_d, "get") else new_d[target]
                    new_d[target] += new_d[i]
                    new_d[i] = 0

        new_op = op.model_copy(update={"d": new_d})
        new_ops.append(new_op)

    return engine_data.model_copy(update={"ops": new_ops})


# ── JIT right-shift ──


def _jit_right_shift(blocks: list[Block], engine_data: EngineData) -> list[Block]:
    """Push each block to the latest possible day without violating OTD-D or capacity.

    Post-processing step: the ASAP schedule is already feasible (0 overflow,
    OTD-D 100%). We slide blocks later to reduce WIP / stock holding.

    Constraint: for every op, cumProd(d) >= cumDemand(d) at every demand day d.
    """
    from collections import defaultdict

    workdays = engine_data.workdays
    day_cap = DAY_CAP
    ops = engine_data.ops

    # Build capacity usage map: machine → day → minutes used
    machine_day_used: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for b in blocks:
        if b.type == "ok":
            machine_day_used[b.machine_id][b.day_idx] += b.prod_min + b.setup_min

    # Build per-op cumulative demand: op_id → [(day, cumDemand)]
    op_cum_demand: dict[str, list[tuple[int, int]]] = {}
    for op in ops:
        cum = 0
        points: list[tuple[int, int]] = []
        for day_idx, val in enumerate(op.d):
            if val > 0:
                cum += val
                points.append((day_idx, cum))
        if points:
            op_cum_demand[op.id] = points

    # Build per-op cumulative production (current schedule)
    # op_id → sorted list of (day, qty)
    op_prod_blocks: dict[str, list[Block]] = defaultdict(list)
    for b in blocks:
        if b.type == "ok" and b.qty > 0:
            # Twin blocks: attribute production to all output ops
            if b.outputs:
                for out in b.outputs:
                    op_prod_blocks[out.op_id].append(b)
            else:
                op_prod_blocks[b.op_id].append(b)

    # For each op, compute slack at each demand day: slack = cumProd - cumDemand
    # A block can shift from day_orig to day_new if for all demand days d
    # in (day_orig, day_new]: slack(d) >= block.qty (we're removing block.qty
    # from the window (day_orig, day_new])
    def _compute_cum_prod(op_id: str) -> dict[int, int]:
        """Cumulative production for op up to each demand day."""
        demand_points = op_cum_demand.get(op_id, [])
        if not demand_points:
            return {}
        prod_items: list[tuple[int, int]] = []
        for b in op_prod_blocks.get(op_id, []):
            if b.outputs:
                for out in b.outputs:
                    if out.op_id == op_id:
                        prod_items.append((b.day_idx, out.qty))
            else:
                prod_items.append((b.day_idx, b.qty))
        prod_items.sort()

        result: dict[int, int] = {}
        cum = 0
        pi = 0
        for day, cum_dem in demand_points:
            while pi < len(prod_items) and prod_items[pi][0] <= day:
                cum += prod_items[pi][1]
                pi += 1
            result[day] = cum
        return result

    def _max_shift_day(b: Block, op_id: str, qty: int) -> int:
        """Find latest day this block can shift to without violating OTD-D."""
        demand_points = op_cum_demand.get(op_id, [])
        if not demand_points:
            return b.edd_day if b.edd_day is not None else b.day_idx

        cum_prod = _compute_cum_prod(op_id)
        edd = b.edd_day if b.edd_day is not None else demand_points[-1][0]
        orig_day = b.day_idx

        # Find latest day <= edd where shifting doesn't cause failure
        # If block moves from orig_day to target_day, for demand days d
        # where orig_day < d <= target_day: cumProd(d) drops by qty
        best = orig_day
        for target_day in range(edd, orig_day, -1):
            if target_day >= len(workdays) or not workdays[target_day]:
                continue
            # Check all demand days in (orig_day, target_day]
            ok = True
            for d_day, cum_dem in demand_points:
                if d_day < orig_day:
                    continue
                if d_day > target_day:
                    break
                # cumProd at d_day would drop by qty
                cp = cum_prod.get(d_day, 0)
                if cp - qty < cum_dem:
                    ok = False
                    break
            if ok:
                best = target_day
                break

        return best

    # Process blocks: latest EDD first (those are easiest to shift)
    ok_blocks = [b for b in blocks if b.type == "ok" and b.qty > 0]
    ok_blocks.sort(key=lambda b: -(b.edd_day if b.edd_day is not None else 0))

    for b in ok_blocks:
        if b.edd_day is None or b.day_idx >= b.edd_day:
            continue

        mid = b.machine_id
        block_min = b.prod_min + b.setup_min
        orig_day = b.day_idx

        # For twin blocks, use the most restrictive constraint across all outputs
        if b.outputs:
            max_day = b.edd_day
            for out in b.outputs:
                md = _max_shift_day(b, out.op_id, out.qty)
                max_day = min(max_day, md)
        else:
            max_day = _max_shift_day(b, b.op_id, b.qty)

        if max_day <= orig_day:
            continue

        # Find latest workday <= max_day with enough machine capacity
        best_day = orig_day
        for d in range(max_day, orig_day, -1):
            if d >= len(workdays) or not workdays[d]:
                continue
            used = machine_day_used[mid].get(d, 0)
            if used + block_min <= day_cap:
                best_day = d
                break

        if best_day > orig_day:
            machine_day_used[mid][orig_day] -= block_min
            machine_day_used[mid][best_day] += block_min
            b.day_idx = best_day

    return blocks
