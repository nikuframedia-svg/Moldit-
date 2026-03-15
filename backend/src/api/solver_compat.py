"""Solver compat endpoint — mirrors the frontend's SolverRequest/SolverResult format.

The existing frontend (solverApi.ts) sends POST /v1/solver/schedule with
pre-calculated durations in minutes. This endpoint accepts that format,
runs CP-SAT, and returns the result in the format solverResultToBlocks() expects.
"""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import APIRouter
from ortools.sat.python import cp_model
from pydantic import BaseModel, Field

router = APIRouter(tags=["solver-compat"])

# ─── Constants (same as solver.py) ───────────────────────────────────────────

DAY_MINUTES = 1440
SHIFT_A_START = 420   # 07:00
SHIFT_A_END = 930     # 15:30
SHIFT_B_START = 930   # 15:30
SHIFT_B_END = 1440    # 00:00
DAY_CAP = 1020        # production minutes per day


# ─── Request schemas (mirror solverApi.ts) ───────────────────────────────────


class OperationInput(BaseModel):
    id: str
    machine_id: str
    tool_id: str
    duration_min: int
    setup_min: int = 0
    operators: int = 1
    calco_code: str | None = None


class JobInput(BaseModel):
    id: str
    sku: str
    due_date_min: int
    weight: float = 1.0
    operations: list[OperationInput]


class MachineInput(BaseModel):
    id: str
    capacity_min: int = DAY_CAP


class TwinPairInput(BaseModel):
    op_id_a: str
    op_id_b: str
    machine_id: str
    tool_id: str


class ConstraintConfigInput(BaseModel):
    setup_crew: bool = True
    tool_timeline: bool = True
    calco_timeline: bool = True
    operator_pool: bool = False


class SolverConfig(BaseModel):
    time_limit_s: int = 60
    objective: str = "weighted_tardiness"
    num_workers: int = 4


class SolverCompatRequest(BaseModel):
    jobs: list[JobInput]
    machines: list[MachineInput] = Field(default_factory=list)
    config: SolverConfig = Field(default_factory=SolverConfig)
    twin_pairs: list[TwinPairInput] = Field(default_factory=list)
    constraints: ConstraintConfigInput = Field(default_factory=ConstraintConfigInput)


# ─── Response schemas (mirror solverApi.ts) ──────────────────────────────────


class ScheduledOp(BaseModel):
    op_id: str
    job_id: str
    machine_id: str
    tool_id: str
    start_min: int
    end_min: int
    setup_min: int
    is_tardy: bool
    tardiness_min: int
    is_twin_production: bool = False
    twin_partner_op_id: str | None = None


class SolverCompatResult(BaseModel):
    schedule: list[ScheduledOp]
    makespan_min: int = 0
    total_tardiness_min: int = 0
    weighted_tardiness: float = 0.0
    solver_used: str = "cpsat"
    solve_time_s: float = 0.0
    status: str = "optimal"
    objective_value: float = 0.0
    n_ops: int = 0
    operator_warnings: list[dict] = Field(default_factory=list)


# ─── Endpoint ────────────────────────────────────────────────────────────────


@router.post("/v1/solver/schedule")
def solve_compat(request: SolverCompatRequest) -> SolverCompatResult:
    """Solve scheduling using CP-SAT, accepting frontend's format."""
    t0 = time.monotonic()

    # Flatten jobs → operations (each job has 1 operation in our format)
    ops = []
    for job in request.jobs:
        for op in job.operations:
            ops.append({
                "op_id": op.id,
                "job_id": job.id,
                "sku": job.sku,
                "machine_id": op.machine_id,
                "tool_id": op.tool_id,
                "duration_min": op.duration_min,
                "setup_min": op.setup_min,
                "due_date_min": job.due_date_min,
                "weight": job.weight,
            })

    if not ops:
        return SolverCompatResult(solve_time_s=0.0, status="optimal")

    # Too many ops → heuristic fallback (simple EDD sort)
    if len(ops) > 200:
        return _heuristic_fallback(ops, request, t0)

    return _cpsat_solve(ops, request, t0)


# ─── CP-SAT Solver ──────────────────────────────────────────────────────────


def _cpsat_solve(
    ops: list[dict],
    request: SolverCompatRequest,
    t0: float,
) -> SolverCompatResult:
    # Build shift slots for horizon
    max_deadline = max(o["due_date_min"] for o in ops)
    horizon_days = max_deadline // DAY_CAP + 2
    horizon_min = horizon_days * DAY_MINUTES

    shift_slots = []
    for day in range(horizon_days):
        base = day * DAY_MINUTES
        shift_slots.append((base + SHIFT_A_START, base + SHIFT_A_END))
        shift_slots.append((base + SHIFT_B_START, base + SHIFT_B_END))

    # Twin pair lookup
    twin_map: dict[str, str] = {}
    for tp in request.twin_pairs:
        twin_map[tp.op_id_a] = tp.op_id_b
        twin_map[tp.op_id_b] = tp.op_id_a

    model = cp_model.CpModel()

    op_vars: list[dict] = []
    machine_intervals: dict[str, list] = defaultdict(list)
    setup_intervals: list = []
    tool_intervals: dict[str, list] = defaultdict(list)

    for i, op in enumerate(ops):
        total_dur = op["duration_min"] + op["setup_min"]
        if total_dur <= 0:
            total_dur = 1

        start = model.new_int_var(0, horizon_min, f"s_{i}")
        end = model.new_int_var(0, horizon_min, f"e_{i}")
        model.add(end == start + total_dur)

        iv = model.new_interval_var(start, total_dur, end, f"iv_{i}")
        machine_intervals[op["machine_id"]].append(iv)
        tool_intervals[op["tool_id"]].append(iv)

        if op["setup_min"] > 0:
            se = model.new_int_var(0, horizon_min, f"se_{i}")
            model.add(se == start + op["setup_min"])
            siv = model.new_interval_var(
                start, op["setup_min"], se, f"siv_{i}",
            )
            setup_intervals.append(siv)

        # Shift boundary: fit in one shift slot
        slot_bools = []
        for si, (ss, se_val) in enumerate(shift_slots):
            cap = se_val - ss
            if total_dur > cap:
                continue
            b = model.new_bool_var(f"sl_{i}_{si}")
            model.add(start >= ss).only_enforce_if(b)
            model.add(end <= se_val).only_enforce_if(b)
            slot_bools.append(b)

        if slot_bools:
            model.add_exactly_one(slot_bools)

        op_vars.append({**op, "idx": i, "start": start, "end": end})

    # Constraint: NoOverlap per machine
    for intervals in machine_intervals.values():
        if len(intervals) > 1:
            model.add_no_overlap(intervals)

    # Constraint: SetupCrew — max 1 setup at a time
    if request.constraints.setup_crew and len(setup_intervals) > 1:
        model.add_no_overlap(setup_intervals)

    # Constraint: ToolTimeline — tool on 1 machine at a time
    if request.constraints.tool_timeline:
        for ivs in tool_intervals.values():
            if len(ivs) > 1:
                model.add_no_overlap(ivs)

    # Objective: minimize weighted tardiness + earliness
    obj_terms = []
    for ov in op_vars:
        deadline = ov["due_date_min"]
        tardy = model.new_int_var(0, horizon_min, f"t_{ov['idx']}")
        model.add(tardy >= ov["end"] - deadline)
        model.add(tardy >= 0)
        obj_terms.append(100 * tardy)

    if obj_terms:
        model.minimize(sum(obj_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = request.config.time_limit_s
    solver.parameters.num_workers = min(request.config.num_workers, 8)
    solver.parameters.random_seed = 42

    status = solver.solve(model)

    solve_time = round(time.monotonic() - t0, 3)

    status_map = {
        cp_model.OPTIMAL: "optimal",
        cp_model.FEASIBLE: "feasible",
        cp_model.INFEASIBLE: "infeasible",
        cp_model.MODEL_INVALID: "infeasible",
        cp_model.UNKNOWN: "timeout",
    }
    status_str = status_map.get(status, "timeout")

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolverCompatResult(
            status=status_str,
            solver_used="cpsat",
            solve_time_s=solve_time,
            n_ops=len(ops),
        )

    # Extract solution
    scheduled: list[ScheduledOp] = []
    total_tard = 0
    makespan = 0

    for ov in op_vars:
        sv = solver.value(ov["start"])
        ev = solver.value(ov["end"])
        deadline = ov["due_date_min"]
        tard = max(0, ev - deadline)
        total_tard += tard
        makespan = max(makespan, ev)

        twin_partner = twin_map.get(ov["op_id"])

        scheduled.append(ScheduledOp(
            op_id=ov["op_id"],
            job_id=ov["job_id"],
            machine_id=ov["machine_id"],
            tool_id=ov["tool_id"],
            start_min=sv,
            end_min=ev,
            setup_min=ov["setup_min"],
            is_tardy=tard > 0,
            tardiness_min=tard,
            is_twin_production=twin_partner is not None,
            twin_partner_op_id=twin_partner,
        ))

    return SolverCompatResult(
        schedule=scheduled,
        makespan_min=makespan,
        total_tardiness_min=total_tard,
        weighted_tardiness=float(total_tard),
        solver_used="cpsat",
        solve_time_s=solve_time,
        status=status_str,
        objective_value=float(solver.objective_value) if obj_terms else 0.0,
        n_ops=len(ops),
    )


# ─── Heuristic Fallback (>200 ops) ──────────────────────────────────────────


def _heuristic_fallback(
    ops: list[dict],
    request: SolverCompatRequest,
    t0: float,
) -> SolverCompatResult:
    """Simple EDD (Earliest Due Date) heuristic for large problems."""
    # Sort by due date (earliest first)
    sorted_ops = sorted(ops, key=lambda o: o["due_date_min"])

    # Track next available time per machine
    machine_time: dict[str, int] = defaultdict(int)

    # Twin pair lookup
    twin_map: dict[str, str] = {}
    for tp in request.twin_pairs:
        twin_map[tp.op_id_a] = tp.op_id_b
        twin_map[tp.op_id_b] = tp.op_id_a

    scheduled: list[ScheduledOp] = []
    total_tard = 0
    makespan = 0

    for op in sorted_ops:
        m = op["machine_id"]
        total_dur = op["duration_min"] + op["setup_min"]

        # Find next available shift slot
        start = _snap_to_shift(machine_time[m])
        end = start + total_dur

        machine_time[m] = end
        deadline = op["due_date_min"]
        tard = max(0, end - deadline)
        total_tard += tard
        makespan = max(makespan, end)

        twin_partner = twin_map.get(op["op_id"])

        scheduled.append(ScheduledOp(
            op_id=op["op_id"],
            job_id=op["job_id"],
            machine_id=m,
            tool_id=op["tool_id"],
            start_min=start,
            end_min=end,
            setup_min=op["setup_min"],
            is_tardy=tard > 0,
            tardiness_min=tard,
            is_twin_production=twin_partner is not None,
            twin_partner_op_id=twin_partner,
        ))

    return SolverCompatResult(
        schedule=scheduled,
        makespan_min=makespan,
        total_tardiness_min=total_tard,
        weighted_tardiness=float(total_tard),
        solver_used="heuristic",
        solve_time_s=round(time.monotonic() - t0, 3),
        status="feasible",
        n_ops=len(ops),
    )


def _snap_to_shift(minute: int) -> int:
    """Snap a minute to the next valid shift start if outside production."""
    day = minute // DAY_MINUTES
    time_in_day = minute % DAY_MINUTES

    if SHIFT_A_START <= time_in_day < SHIFT_B_END:
        return minute  # already in production hours
    if time_in_day < SHIFT_A_START:
        return day * DAY_MINUTES + SHIFT_A_START
    # After shift B end → next day shift A
    return (day + 1) * DAY_MINUTES + SHIFT_A_START
