# EDD Warm-Start — heuristic seed for CP-SAT
# Earliest Due Date with tool grouping per machine.
# Produces a feasible schedule used as AddHint() seed for faster CP-SAT convergence.

from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model

from .schemas import ScheduledOp, SolverRequest


def edd_dispatch(request: SolverRequest) -> list[ScheduledOp]:
    """Earliest Due Date dispatch — simple but effective warm-start seed.

    Assigns ops to machines in due-date order, with zero setup for same-tool
    consecutive ops (matching circuit mode behavior).

    Returns a list of ScheduledOp with start/end times.
    """
    if not request.jobs:
        return []

    # Flatten all ops with job context
    all_ops: list[dict] = []
    for job in request.jobs:
        for i, op in enumerate(job.operations):
            all_ops.append(
                {
                    "op": op,
                    "job": job,
                    "op_idx": i,
                    "is_last": i == len(job.operations) - 1,
                }
            )

    # Group by machine
    machine_ops: dict[str, list[dict]] = defaultdict(list)
    for oc in all_ops:
        machine_ops[oc["op"].machine_id].append(oc)

    # Sort each machine's ops by due date (EDD)
    for mid in machine_ops:
        machine_ops[mid].sort(key=lambda oc: oc["job"].due_date_min)

    # Schedule
    machine_time: dict[str, int] = defaultdict(int)
    machine_last_tool: dict[str, str | None] = defaultdict(lambda: None)
    job_ready: dict[str, int] = {}  # "job_id_opIdx" → end time
    schedule: list[ScheduledOp] = []

    for mid, m_ops in machine_ops.items():
        for oc in m_ops:
            op = oc["op"]
            job = oc["job"]
            op_idx = oc["op_idx"]

            # Earliest start: max(machine available, predecessor done)
            earliest = machine_time[mid]
            if op_idx > 0:
                pred_key = f"{job.id}_{op_idx - 1}"
                earliest = max(earliest, job_ready.get(pred_key, 0))

            # Setup: zero if same tool, else op's setup_min
            last_tool = machine_last_tool[mid]
            setup_time = 0 if last_tool == op.tool_id else op.setup_min

            start = earliest + setup_time
            end = start + op.duration_min
            tardiness = max(0, end - job.due_date_min) if oc["is_last"] else 0

            schedule.append(
                ScheduledOp(
                    op_id=op.id,
                    job_id=job.id,
                    machine_id=mid,
                    tool_id=op.tool_id,
                    start_min=start,
                    end_min=end,
                    setup_min=setup_time,
                    is_tardy=tardiness > 0,
                    tardiness_min=tardiness,
                )
            )

            machine_time[mid] = end
            machine_last_tool[mid] = op.tool_id
            job_ready[f"{job.id}_{op_idx}"] = end

    return schedule


def tool_grouped_edd(request: SolverRequest) -> list[ScheduledOp]:
    """EDD with tool grouping — groups same-tool ops before sorting by deadline.

    Within each machine, groups ops by tool_id, then sorts groups by earliest
    deadline within group. Reduces setups compared to pure EDD.
    """
    if not request.jobs:
        return []

    # Flatten all ops
    all_ops: list[dict] = []
    for job in request.jobs:
        for i, op in enumerate(job.operations):
            all_ops.append(
                {
                    "op": op,
                    "job": job,
                    "op_idx": i,
                    "is_last": i == len(job.operations) - 1,
                }
            )

    # Group by machine, then by tool
    machine_tool_ops: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for oc in all_ops:
        mid = oc["op"].machine_id
        tid = oc["op"].tool_id
        machine_tool_ops[mid][tid].append(oc)

    # Build ordered list per machine: sort tool groups by earliest deadline,
    # within each group sort by deadline
    machine_ordered: dict[str, list[dict]] = {}
    for mid, tool_groups in machine_tool_ops.items():
        groups_with_min_dd = []
        for tid, ops in tool_groups.items():
            ops.sort(key=lambda oc: oc["job"].due_date_min)
            min_dd = min(oc["job"].due_date_min for oc in ops)
            groups_with_min_dd.append((min_dd, ops))
        groups_with_min_dd.sort(key=lambda x: x[0])
        machine_ordered[mid] = [oc for _, ops in groups_with_min_dd for oc in ops]

    # Schedule
    machine_time: dict[str, int] = defaultdict(int)
    machine_last_tool: dict[str, str | None] = defaultdict(lambda: None)
    job_ready: dict[str, int] = {}
    schedule: list[ScheduledOp] = []

    for mid, m_ops in machine_ordered.items():
        for oc in m_ops:
            op = oc["op"]
            job = oc["job"]
            op_idx = oc["op_idx"]

            earliest = machine_time[mid]
            if op_idx > 0:
                pred_key = f"{job.id}_{op_idx - 1}"
                earliest = max(earliest, job_ready.get(pred_key, 0))

            last_tool = machine_last_tool[mid]
            setup_time = 0 if last_tool == op.tool_id else op.setup_min

            start = earliest + setup_time
            end = start + op.duration_min
            tardiness = max(0, end - job.due_date_min) if oc["is_last"] else 0

            schedule.append(
                ScheduledOp(
                    op_id=op.id,
                    job_id=job.id,
                    machine_id=mid,
                    tool_id=op.tool_id,
                    start_min=start,
                    end_min=end,
                    setup_min=setup_time,
                    is_tardy=tardiness > 0,
                    tardiness_min=tardiness,
                )
            )

            machine_time[mid] = end
            machine_last_tool[mid] = op.tool_id
            job_ready[f"{job.id}_{op_idx}"] = end

    return schedule


def add_edd_hints(
    model: cp_model.CpModel,
    heuristic_schedule: list[ScheduledOp],
    op_vars: dict[str, tuple],
) -> int:
    """Add warm-start hints from heuristic schedule to CP-SAT model.

    op_vars: op_id → (start_var, end_var, setup_iv, prod_iv, full_iv, job, op)

    Returns number of hints added.
    """
    hints_added = 0
    for sop in heuristic_schedule:
        if sop.op_id not in op_vars:
            continue
        start_var, end_var, _, _, _, _, _ = op_vars[sop.op_id]
        model.AddHint(start_var, sop.start_min)
        model.AddHint(end_var, sop.end_min)
        hints_added += 2
    return hints_added


def pick_best_heuristic(request: SolverRequest) -> list[ScheduledOp]:
    """Run both EDD variants and return the one with lower weighted tardiness."""
    edd = edd_dispatch(request)
    grouped = tool_grouped_edd(request)

    def _weighted_tardiness(schedule: list[ScheduledOp]) -> float:
        job_weights = {j.id: j.weight for j in request.jobs}
        return sum(
            job_weights.get(s.job_id, 1.0) * s.tardiness_min
            for s in schedule
            if s.tardiness_min > 0
        )

    wt_edd = _weighted_tardiness(edd)
    wt_grouped = _weighted_tardiness(grouped)

    return grouped if wt_grouped <= wt_edd else edd
