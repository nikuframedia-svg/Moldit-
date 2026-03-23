# EDD Warm-Start — heuristic seed for CP-SAT
# Earliest Due Date with tool grouping per machine.
# Produces a feasible schedule used as AddHint() seed for faster CP-SAT convergence.
#
# Twin co-production: twin pairs share a single machine time slot.
# When twin A is scheduled, twin B gets the same start/end with zero extra time.

from __future__ import annotations

from collections import defaultdict

from ortools.sat.python import cp_model

from .schemas import JobInput, ScheduledOp, SolverRequest


def _is_flexible_job(job: JobInput) -> bool:
    """Detect flexible job shop jobs (primary _P + alt _A)."""
    if len(job.operations) != 2:
        return False
    return job.operations[0].id.endswith("_P") and job.operations[1].id.endswith("_A")


def _build_twin_map(request: SolverRequest) -> dict[str, str]:
    """Build bidirectional twin partner lookup: job_id → partner_job_id."""
    twin_partner: dict[str, str] = {}
    for pair in request.twin_pairs:
        twin_partner[pair.op_id_a] = pair.op_id_b
        twin_partner[pair.op_id_b] = pair.op_id_a
    return twin_partner


def _schedule_machine_ops(
    machine_ops: dict[str, list[dict]],
    twin_partner: dict[str, str],
) -> list[ScheduledOp]:
    """Schedule ops per machine with twin co-production.

    When a twin partner is already scheduled on the same machine,
    co-produce: same start/end, zero extra machine time.
    """
    machine_time: dict[str, int] = defaultdict(int)
    machine_last_tool: dict[str, str | None] = defaultdict(lambda: None)
    job_ready: dict[str, int] = {}
    schedule: list[ScheduledOp] = []

    # Track twin slots: job_id → (start, end, setup_min, machine_id)
    twin_scheduled: dict[str, tuple[int, int, int, str]] = {}

    for mid, m_ops in machine_ops.items():
        for oc in m_ops:
            op = oc["op"]
            job = oc["job"]
            op_idx = oc.get("op_idx", 0)
            is_last = oc.get("is_last", True)

            # Check if twin partner already scheduled on this machine
            partner_id = twin_partner.get(job.id)
            if partner_id and partner_id in twin_scheduled:
                p_start, p_end, _p_setup, p_mid = twin_scheduled[partner_id]
                if p_mid == mid:
                    # Co-produce: same slot, no extra machine time
                    tardiness = max(0, p_end - job.due_date_min) if is_last else 0
                    schedule.append(
                        ScheduledOp(
                            op_id=op.id,
                            job_id=job.id,
                            machine_id=mid,
                            tool_id=op.tool_id,
                            start_min=p_start,
                            end_min=p_end,
                            setup_min=0,
                            is_tardy=tardiness > 0,
                            tardiness_min=tardiness,
                            is_twin_production=True,
                            twin_partner_op_id=partner_id,
                        )
                    )
                    job_ready[f"{job.id}_{op_idx}"] = p_end
                    continue

            # Normal scheduling
            earliest = machine_time[mid]
            if op_idx > 0:
                pred_key = f"{job.id}_{op_idx - 1}"
                earliest = max(earliest, job_ready.get(pred_key, 0))

            last_tool = machine_last_tool[mid]
            setup_time = 0 if last_tool == op.tool_id else op.setup_min

            start = earliest + setup_time
            end = start + op.duration_min
            tardiness = max(0, end - job.due_date_min) if is_last else 0

            is_twin = partner_id is not None
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
                    is_twin_production=is_twin,
                    twin_partner_op_id=partner_id if is_twin else None,
                )
            )

            machine_time[mid] = end
            machine_last_tool[mid] = op.tool_id
            job_ready[f"{job.id}_{op_idx}"] = end

            # Record twin slot for partner to co-produce later
            if partner_id:
                twin_scheduled[job.id] = (start, end, setup_time, mid)

    return schedule


def _flatten_ops(request: SolverRequest) -> list[dict]:
    """Flatten jobs into ops list, skipping _A alt ops for flexible jobs."""
    all_ops: list[dict] = []
    for job in request.jobs:
        is_flexible = _is_flexible_job(job)
        for i, op in enumerate(job.operations):
            if is_flexible and op.id.endswith("_A"):
                continue
            all_ops.append(
                {
                    "op": op,
                    "job": job,
                    "op_idx": i,
                    "is_last": True if is_flexible else i == len(job.operations) - 1,
                }
            )
    return all_ops


def edd_dispatch(request: SolverRequest) -> list[ScheduledOp]:
    """Earliest Due Date dispatch — simple but effective warm-start seed.

    Assigns ops to machines in due-date order, with zero setup for same-tool
    consecutive ops. Twin pairs co-produce in a single time slot.
    """
    if not request.jobs:
        return []

    all_ops = _flatten_ops(request)
    twin_partner = _build_twin_map(request)

    # Group by machine, sort by EDD
    machine_ops: dict[str, list[dict]] = defaultdict(list)
    for oc in all_ops:
        machine_ops[oc["op"].machine_id].append(oc)
    for mid in machine_ops:
        machine_ops[mid].sort(key=lambda oc: oc["job"].due_date_min)

    return _schedule_machine_ops(machine_ops, twin_partner)


def tool_grouped_edd(request: SolverRequest) -> list[ScheduledOp]:
    """EDD with tool grouping — groups same-tool ops before sorting by deadline.

    Within each machine, groups ops by tool_id, then sorts groups by earliest
    deadline within group. Reduces setups compared to pure EDD.
    Twin pairs co-produce in a single time slot.
    """
    if not request.jobs:
        return []

    all_ops = _flatten_ops(request)
    twin_partner = _build_twin_map(request)

    # Group by machine, then by tool
    machine_tool_ops: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for oc in all_ops:
        mid = oc["op"].machine_id
        tid = oc["op"].tool_id
        machine_tool_ops[mid][tid].append(oc)

    # Build ordered list per machine: sort tool groups by earliest deadline
    machine_ops: dict[str, list[dict]] = {}
    for mid, tool_groups in machine_tool_ops.items():
        groups_with_min_dd = []
        for tid, ops in tool_groups.items():
            ops.sort(key=lambda oc: oc["job"].due_date_min)
            min_dd = min(oc["job"].due_date_min for oc in ops)
            groups_with_min_dd.append((min_dd, ops))
        groups_with_min_dd.sort(key=lambda x: x[0])
        machine_ops[mid] = [oc for _, ops in groups_with_min_dd for oc in ops]

    return _schedule_machine_ops(machine_ops, twin_partner)


def load_balanced_edd(request: SolverRequest) -> list[ScheduledOp]:
    """EDD with load balancing — offloads flex jobs from overloaded machines.

    1. Compute machine load (with twin co-production: count once, not twice).
    2. Identify overloaded machines (load > horizon).
    3. Move flexible jobs from overloaded → alt machine (latest deadline first).
    4. Schedule the resulting assignment with EDD order.
    Twin pairs co-produce in a single time slot.
    """
    if not request.jobs:
        return []

    DAY_CAP = 1020
    horizon = len(request.workdays) * DAY_CAP if request.workdays else 53 * DAY_CAP
    twin_partner = _build_twin_map(request)

    # Track which twin jobs are already counted (avoid double-counting)
    twin_load_counted: set[str] = set()

    # Build assignment: job_id → chosen operation
    job_assignment: dict[str, tuple] = {}
    machine_load: dict[str, int] = defaultdict(int)
    flex_jobs_by_machine: dict[str, list[tuple]] = defaultdict(list)

    for job in request.jobs:
        is_flexible = _is_flexible_job(job)
        primary_op = job.operations[0]

        # Twin co-production: only count load once per twin pair
        partner_id = twin_partner.get(job.id)
        if partner_id and partner_id in twin_load_counted:
            # Partner already counted this load — skip
            pass
        else:
            machine_load[primary_op.machine_id] += primary_op.duration_min + primary_op.setup_min
            if partner_id:
                twin_load_counted.add(job.id)

        job_assignment[job.id] = (primary_op, job, True)

        if is_flexible:
            flex_jobs_by_machine[primary_op.machine_id].append((job, primary_op, job.operations[1]))

    # Phase 2: offload flex jobs from overloaded machines
    for mid in list(machine_load.keys()):
        overflow = machine_load[mid] - horizon
        if overflow <= 0:
            continue

        flex_jobs = flex_jobs_by_machine.get(mid, [])
        flex_jobs.sort(key=lambda x: -x[0].due_date_min)

        for job, primary_op, alt_op in flex_jobs:
            if overflow <= 0:
                break
            # Don't move twin ops — they must stay on their machine
            if job.id in twin_partner:
                continue
            alt_mid = alt_op.machine_id
            alt_remaining = horizon - machine_load.get(alt_mid, 0)
            job_load = primary_op.duration_min + primary_op.setup_min
            if alt_remaining >= job_load:
                job_assignment[job.id] = (alt_op, job, True)
                machine_load[mid] -= job_load
                machine_load[alt_mid] += job_load
                overflow -= job_load

    # Phase 3: schedule with EDD order per machine
    machine_ops: dict[str, list[dict]] = defaultdict(list)
    for job_id, (op, job, is_last) in job_assignment.items():
        machine_ops[op.machine_id].append(
            {
                "op": op,
                "job": job,
                "op_idx": 0,
                "is_last": is_last,
            }
        )

    for mid in machine_ops:
        machine_ops[mid].sort(key=lambda oc: oc["job"].due_date_min)

    return _schedule_machine_ops(machine_ops, twin_partner)


def add_edd_hints(
    model: cp_model.CpModel,
    heuristic_schedule: list[ScheduledOp],
    op_vars: dict[str, tuple],
    op_presence: dict | None = None,
) -> int:
    """Add warm-start hints from heuristic schedule to CP-SAT model.

    op_vars: op_id → (start_var, end_var, setup_iv, prod_iv, full_iv, job, op)
    op_presence: op_id → presence BoolVar (for flexible job shop ops)

    Returns number of hints added.
    """
    op_presence = op_presence or {}
    scheduled_ids: set[str] = set()
    hints_added = 0

    for sop in heuristic_schedule:
        scheduled_ids.add(sop.op_id)
        if sop.op_id not in op_vars:
            continue
        start_var, end_var, _, _, _, _, _ = op_vars[sop.op_id]
        model.AddHint(start_var, sop.start_min)
        model.AddHint(end_var, sop.end_min)
        hints_added += 2
        # Hint presence for flexible ops — this op IS scheduled
        if sop.op_id in op_presence:
            model.AddHint(op_presence[sop.op_id], 1)
            hints_added += 1

    # Hint non-scheduled flexible ops as not-present
    for op_id, pres_var in op_presence.items():
        if op_id not in scheduled_ids:
            model.AddHint(pres_var, 0)
            hints_added += 1

    return hints_added


def pick_best_heuristic(request: SolverRequest) -> list[ScheduledOp]:
    """Run all EDD variants and return the one with lower weighted tardiness."""
    candidates = [
        edd_dispatch(request),
        tool_grouped_edd(request),
        load_balanced_edd(request),
    ]

    def _weighted_tardiness(schedule: list[ScheduledOp]) -> float:
        job_weights = {j.id: j.weight for j in request.jobs}
        return sum(
            job_weights.get(s.job_id, 1.0) * s.tardiness_min
            for s in schedule
            if s.tardiness_min > 0
        )

    return min(candidates, key=_weighted_tardiness)
