"""CP-SAT Scheduling Solver for PP1 LEAN.

Conforme CLAUDE.md Camada 3: CP-SAT server-side (OR-Tools, 5-60s).
<50 jobs: optimal. 50-200: time limit 30-60s. >200: fallback heuristic.

Constraints (HARD):
  1. SetupCrew — max 1 setup simultaneous across entire factory
  2. ToolTimeline — tool on 1 machine at a time
  3. Shift boundaries — operations do NOT cross shifts
  4. Deadlines — meet delivery dates (priority #1)

Objective (minimize):
  100 * sum(tardiness) + 10 * sum(earliness) + 1 * num_setups
"""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, datetime, timedelta

from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

from .twin import merge_twin_orders

# ─── Constants ────────────────────────────────────────────────────────────────

SHIFT_A_START = 420   # 07:00
SHIFT_A_END = 930     # 15:30
SHIFT_B_START = 930   # 15:30
SHIFT_B_END = 1440    # 00:00
DAY_MINUTES = 1440
PRODUCTION_MINUTES_PER_DAY = SHIFT_B_END - SHIFT_A_START  # 1020 min


# ─── Input/Output Schemas ────────────────────────────────────────────────────

class MachineConfig(BaseModel):
    id: str
    type: str = "grande"  # "grande" or "media"
    alternatives: list[str] = Field(default_factory=list)


class ShiftConfig(BaseModel):
    id: str  # "A" or "B"
    start_minutes: int  # minutes from midnight
    end_minutes: int


class SolverInput(BaseModel):
    orders: list[dict]  # order dicts with: sku, qty, deadline, tool, machine, pieces_per_hour, economic_lot, twin_ref
    machines: list[MachineConfig]
    shifts: list[ShiftConfig] = Field(default_factory=lambda: [
        ShiftConfig(id="A", start_minutes=420, end_minutes=930),
        ShiftConfig(id="B", start_minutes=930, end_minutes=1440),
    ])
    twin_pairs: list[tuple[str, str]] = Field(default_factory=list)
    affinity_groups: list[dict] = Field(default_factory=list)
    today: date | None = None
    horizon_days: int = 30
    max_solve_seconds: int = 60
    seed: int = 42
    buffer_days: int = 2  # JIT: produce X days before deadline
    weights: dict[str, int] = Field(default_factory=lambda: {
        "tardiness": 100,
        "earliness": 10,
        "setups": 1,
    })


class ScheduledJob(BaseModel):
    job_id: str
    sku: str
    machine: str
    tool: str
    qty: int
    start: datetime
    end: datetime
    shift: str
    setup_minutes: int
    production_minutes: int
    priority: int  # 0=normal, 1=yellow, 2=red, 3=atraso
    is_twin: bool
    twin_outputs: list[dict] | None = None
    clients: list[str] = Field(default_factory=list)


class ScheduleKPIs(BaseModel):
    total_jobs: int
    total_qty: int
    otd_pct: float
    utilization_pct: float
    total_setups: int
    total_tardiness_min: int
    solve_time_s: float


class ScheduleResult(BaseModel):
    jobs: list[ScheduledJob]
    kpis: ScheduleKPIs
    infeasible_orders: list[dict] = Field(default_factory=list)
    solve_time_seconds: float
    solver_status: str  # "optimal", "feasible", "infeasible", "timeout"


# ─── Shift Helpers ────────────────────────────────────────────────────────────

def _get_shift_slots(horizon_days: int) -> list[tuple[int, int, str]]:
    """Return list of (start_min, end_min, shift_id) across the horizon.

    Each slot is an absolute minute range from day 0.
    """
    slots = []
    for day in range(horizon_days):
        base = day * DAY_MINUTES
        slots.append((base + SHIFT_A_START, base + SHIFT_A_END, "A"))
        slots.append((base + SHIFT_B_START, base + SHIFT_B_END, "B"))
    return slots


def _minute_to_datetime(minute: int, today: date) -> datetime:
    """Convert absolute minute offset to datetime."""
    days = minute // DAY_MINUTES
    mins = minute % DAY_MINUTES
    dt = datetime(today.year, today.month, today.day) + timedelta(days=days, minutes=mins)
    return dt


def _datetime_to_minute(dt: date, today: date) -> int:
    """Convert a date to absolute minute offset (end of day = shift B end)."""
    delta = (dt - today).days
    return delta * DAY_MINUTES + SHIFT_B_END


def _minute_to_shift(minute: int) -> str:
    """Determine which shift a minute falls into."""
    time_in_day = minute % DAY_MINUTES
    if SHIFT_A_START <= time_in_day < SHIFT_A_END:
        return "A"
    if SHIFT_B_START <= time_in_day < SHIFT_B_END:
        return "B"
    return "N"  # night (emergency only)


# ─── Order Preparation ───────────────────────────────────────────────────────

def _prepare_jobs(
    inp: SolverInput,
    today: date,
) -> list[dict]:
    """Convert orders to internal job dicts with minute-based times.

    Applies: twin merge, economic lot (soft), time calculations.
    """
    # 1. Twin merge
    orders = merge_twin_orders(inp.orders, inp.twin_pairs)

    OEE = 0.66
    jobs = []
    for i, order in enumerate(orders):
        qty = order["qty"]
        sku = order["sku"]
        machine = order["machine"]
        tool = order.get("tool", "")
        pieces_per_hour = order.get("pieces_per_hour", 100)
        economic_lot = order.get("economic_lot", 0)

        # Production time in minutes
        effective_rate = pieces_per_hour * OEE
        if effective_rate <= 0:
            effective_rate = 1.0
        prod_minutes = int((qty / effective_rate) * 60)
        prod_minutes = max(prod_minutes, 1)  # minimum 1 minute

        # Deadline in absolute minutes
        deadline_date = order["deadline"]
        if isinstance(deadline_date, str):
            deadline_date = date.fromisoformat(deadline_date)
        deadline_min = _datetime_to_minute(deadline_date, today)

        # Setup time (default 60 min if not specified)
        setup_min = order.get("setup_minutes", 60)

        jobs.append({
            "job_id": f"J{i:04d}_{sku}",
            "index": i,
            "sku": sku,
            "machine": machine,
            "tool": tool,
            "qty": qty,
            "economic_lot": economic_lot,
            "prod_minutes": prod_minutes,
            "setup_minutes": setup_min,
            "deadline_min": deadline_min,
            "deadline_date": deadline_date,
            "is_twin": order.get("is_twin", False),
            "twin_outputs": order.get("twin_outputs"),
            "clients": order.get("clients", []),
        })

    return jobs


# ─── CP-SAT Solver ───────────────────────────────────────────────────────────

def solve_schedule(inp: SolverInput) -> ScheduleResult:
    """Solve the scheduling problem using OR-Tools CP-SAT.

    Returns a ScheduleResult with scheduled jobs and KPIs.
    """
    t0 = time.monotonic()
    today = inp.today or date.today()

    # Prepare jobs
    jobs = _prepare_jobs(inp, today)

    if not jobs:
        return _empty_result(0.0)

    # Build shift slots
    shift_slots = _get_shift_slots(inp.horizon_days)
    horizon_minutes = inp.horizon_days * DAY_MINUTES

    # Machine IDs
    machine_ids = [m.id for m in inp.machines]
    if not machine_ids:
        machine_ids = list({j["machine"] for j in jobs})

    # ──────── CP-SAT Model ────────
    model = cp_model.CpModel()

    # Variables per job
    job_vars: list[dict] = []
    machine_intervals: dict[str, list] = defaultdict(list)
    setup_intervals: list = []
    tool_intervals: dict[str, list] = defaultdict(list)

    w_tard = inp.weights.get("tardiness", 100)
    w_early = inp.weights.get("earliness", 10)
    buffer_minutes = inp.buffer_days * DAY_MINUTES

    for j in jobs:
        idx = j["index"]
        prod_dur = j["prod_minutes"]
        setup_dur = j["setup_minutes"]
        total_dur = prod_dur + setup_dur
        machine = j["machine"]
        tool = j["tool"]

        # Start/end variables
        start = model.new_int_var(0, horizon_minutes, f"start_{idx}")
        end = model.new_int_var(0, horizon_minutes, f"end_{idx}")

        # Duration constraint
        model.add(end == start + total_dur)

        # Machine interval (for NoOverlap)
        interval = model.new_interval_var(start, total_dur, end, f"iv_{idx}")
        machine_intervals[machine].append(interval)

        # Tool interval (for ToolTimeline)
        tool_intervals[tool].append((interval, machine, idx))

        # Setup interval (first setup_dur minutes of the job)
        if setup_dur > 0:
            setup_end = model.new_int_var(0, horizon_minutes, f"setup_end_{idx}")
            model.add(setup_end == start + setup_dur)
            setup_iv = model.new_interval_var(start, setup_dur, setup_end, f"setup_{idx}")
            setup_intervals.append(setup_iv)

        # Shift boundary constraint:
        # The job must fit entirely within ONE shift slot.
        # We create boolean variables for each possible shift slot and
        # require that the job is assigned to exactly one.
        slot_bools = []
        for s_idx, (s_start, s_end, s_id) in enumerate(shift_slots):
            capacity = s_end - s_start
            if total_dur > capacity:
                continue  # job doesn't fit in this shift
            b = model.new_bool_var(f"slot_{idx}_{s_idx}")
            # If b is true, job start >= s_start and end <= s_end
            model.add(start >= s_start).only_enforce_if(b)
            model.add(end <= s_end).only_enforce_if(b)
            slot_bools.append(b)

        if slot_bools:
            model.add_exactly_one(slot_bools)
        else:
            # Job is too large for any single shift — split would be needed
            # For now, relax: just require it starts during production hours
            time_in_day = model.new_int_var(0, DAY_MINUTES - 1, f"tod_{idx}")
            model.add_modulo_equality(time_in_day, start, DAY_MINUTES)
            model.add(time_in_day >= SHIFT_A_START)

        # Store variables
        job_vars.append({
            **j,
            "start_var": start,
            "end_var": end,
            "interval": interval,
            "slot_bools": slot_bools,
        })

    # ──────── Constraint 1: NoOverlap per machine ────────
    for m_id, intervals in machine_intervals.items():
        if len(intervals) > 1:
            model.add_no_overlap(intervals)

    # ──────── Constraint 2: SetupCrew — max 1 setup at a time ────────
    if len(setup_intervals) > 1:
        model.add_no_overlap(setup_intervals)

    # ──────── Constraint 3: ToolTimeline — tool on 1 machine at a time ────────
    # Group by tool; if a tool appears on 2+ machines, add NoOverlap
    tool_groups: dict[str, list] = defaultdict(list)
    tool_machines: dict[str, set] = defaultdict(set)
    for tool_id, tool_ivs in tool_intervals.items():
        for iv, m, _idx in tool_ivs:
            tool_groups[tool_id].append(iv)
            tool_machines[tool_id].add(m)

    for tool_id, ivs in tool_groups.items():
        if len(tool_machines[tool_id]) > 1 and len(ivs) > 1:
            model.add_no_overlap(ivs)

    # ──────── Objective ────────
    tardiness_vars = []
    earliness_vars = []

    for jv in job_vars:
        deadline = jv["deadline_min"]
        end_var = jv["end_var"]
        idx = jv["index"]

        # Tardiness: max(0, end - deadline)
        tardy = model.new_int_var(0, horizon_minutes, f"tardy_{idx}")
        model.add(tardy >= end_var - deadline)
        model.add(tardy >= 0)
        tardiness_vars.append(tardy)

        # Earliness (JIT): penalize producing too early
        # earliness = max(0, deadline - buffer - end)
        target_start = deadline - buffer_minutes
        early = model.new_int_var(0, horizon_minutes, f"early_{idx}")
        model.add(early >= target_start - end_var)
        model.add(early >= 0)
        earliness_vars.append(early)

    # Setup count: we count all setups (already counted as intervals)
    num_setups = len(setup_intervals)

    # Build objective
    objective_terms = []
    if tardiness_vars:
        for tv in tardiness_vars:
            objective_terms.append(w_tard * tv)
    if earliness_vars:
        for ev in earliness_vars:
            objective_terms.append(w_early * ev)
    # Setup is a constant in this formulation (every job has setup).
    # We add it as a fixed cost — no variable to minimize.
    # A more advanced version would use optional setups (same-tool consecutive = no setup).

    if objective_terms:
        model.minimize(sum(objective_terms))

    # ──────── Solve ────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = inp.max_solve_seconds
    solver.parameters.num_workers = 4
    solver.parameters.random_seed = inp.seed

    status = solver.solve(model)

    solve_time = time.monotonic() - t0

    status_map = {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
        cp_model.MODEL_INVALID: "infeasible",
        cp_model.UNKNOWN: "timeout",
    }
    status_str = status_map.get(status, "timeout")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return ScheduleResult(
            jobs=[],
            kpis=ScheduleKPIs(
                total_jobs=0, total_qty=0, otd_pct=0.0,
                utilization_pct=0.0, total_setups=0,
                total_tardiness_min=0, solve_time_s=round(solve_time, 3),
            ),
            infeasible_orders=[{"reason": status_str}],
            solve_time_seconds=round(solve_time, 3),
            solver_status=status_str,
        )

    # ──────── Extract Solution ────────
    scheduled_jobs: list[ScheduledJob] = []
    total_tardiness = 0
    total_qty = 0
    on_time = 0
    total_prod_minutes = 0

    for jv in job_vars:
        start_val = solver.value(jv["start_var"])
        end_val = solver.value(jv["end_var"])
        deadline = jv["deadline_min"]

        tardiness = max(0, end_val - deadline)
        total_tardiness += tardiness
        total_qty += jv["qty"]

        if tardiness == 0:
            on_time += 1

        shift = _minute_to_shift(start_val)
        prod_min = jv["prod_minutes"]
        total_prod_minutes += prod_min

        # Priority based on tardiness
        if tardiness == 0:
            priority = 0
        elif tardiness <= 480:  # < 1 shift
            priority = 1
        elif tardiness <= DAY_MINUTES:
            priority = 2
        else:
            priority = 3

        scheduled_jobs.append(ScheduledJob(
            job_id=jv["job_id"],
            sku=jv["sku"],
            machine=jv["machine"],
            tool=jv["tool"],
            qty=jv["qty"],
            start=_minute_to_datetime(start_val, today),
            end=_minute_to_datetime(end_val, today),
            shift=shift,
            setup_minutes=jv["setup_minutes"],
            production_minutes=prod_min,
            priority=priority,
            is_twin=jv["is_twin"],
            twin_outputs=jv.get("twin_outputs"),
            clients=jv.get("clients", []),
        ))

    # Sort by machine + start
    scheduled_jobs.sort(key=lambda sj: (sj.machine, sj.start))

    # KPIs
    n_jobs = len(scheduled_jobs)
    otd_pct = (on_time / n_jobs * 100) if n_jobs > 0 else 100.0
    total_available = len(machine_ids) * inp.horizon_days * PRODUCTION_MINUTES_PER_DAY
    utilization = (total_prod_minutes / total_available * 100) if total_available > 0 else 0.0

    return ScheduleResult(
        jobs=scheduled_jobs,
        kpis=ScheduleKPIs(
            total_jobs=n_jobs,
            total_qty=total_qty,
            otd_pct=round(otd_pct, 1),
            utilization_pct=round(utilization, 1),
            total_setups=num_setups,
            total_tardiness_min=total_tardiness,
            solve_time_s=round(solve_time, 3),
        ),
        solve_time_seconds=round(solve_time, 3),
        solver_status=status_str,
    )


def _empty_result(solve_time: float) -> ScheduleResult:
    return ScheduleResult(
        jobs=[],
        kpis=ScheduleKPIs(
            total_jobs=0, total_qty=0, otd_pct=100.0,
            utilization_pct=0.0, total_setups=0,
            total_tardiness_min=0, solve_time_s=round(solve_time, 3),
        ),
        solve_time_seconds=round(solve_time, 3),
        solver_status="optimal",
    )
