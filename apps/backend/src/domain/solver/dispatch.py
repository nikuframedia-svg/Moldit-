# ATCS Dispatch — Phase 1 of the hybrid solver.
# Apparent Tardiness Cost with Setups: constructive heuristic.
# Priority(j) = (w/p) × exp(-max(0,slack) / (K1×p̄)) × exp(-s / (K2×s̄))
# Grid search K1∈{0.5,1,2,3,5} × K2∈{0.5,1,2,3,5} = 25 combos.
# Respects all 4 constraints + twin co-production + flexible _P/_A.

from __future__ import annotations

import logging
import math
from collections import defaultdict

from .schedule_state import ScheduledOperation, ScheduleState
from .schemas import JobInput, OperationInput, SolverRequest

logger = logging.getLogger(__name__)

K_VALUES = [0.5, 1.0, 2.0, 3.0, 5.0]


def atcs_dispatch(request: SolverRequest) -> ScheduleState:
    """Phase 1: ATCS constructive heuristic.

    Runs 25 K1/K2 combos, returns the schedule with lowest weighted tardiness.
    Each combo is a single-pass greedy O(n²). Total <100ms for 500 ops.
    """
    if not request.jobs:
        return ScheduleState.from_request(request)

    p_bar, s_bar = _compute_p_bar_s_bar(request)
    best_state: ScheduleState | None = None
    best_wt = float("inf")

    for k1 in K_VALUES:
        for k2 in K_VALUES:
            state = _build_single_schedule(request, k1, k2, p_bar, s_bar)
            wt = state.weighted_tardiness()
            if wt < best_wt:
                best_wt = wt
                best_state = state
            if wt == 0:
                return state  # Perfect — no need to try more combos

    return best_state  # type: ignore[return-value]


def _compute_p_bar_s_bar(request: SolverRequest) -> tuple[float, float]:
    """Average processing time and average setup time across all ops."""
    total_p = 0
    total_s = 0
    n = 0
    for job in request.jobs:
        for op in job.operations:
            total_p += op.duration_min
            total_s += op.setup_min
            n += 1
    p_bar = total_p / n if n > 0 else 1.0
    s_bar = total_s / n if n > 0 else 1.0
    return max(p_bar, 1.0), max(s_bar, 1.0)


def _atcs_priority(
    weight: float,
    proc_time: int,
    slack: int,
    setup_time: int,
    k1: float,
    k2: float,
    p_bar: float,
    s_bar: float,
) -> float:
    """Compute ATCS priority index for one job-machine pair."""
    wp = weight / max(proc_time, 1)
    slack_term = math.exp(-max(0, slack) / (k1 * p_bar))
    setup_term = math.exp(-setup_time / (k2 * s_bar))
    return wp * slack_term * setup_term


def _is_flexible_job(job: JobInput) -> bool:
    """Detect flexible job shop jobs (primary _P + alt _A)."""
    if len(job.operations) != 2:
        return False
    return job.operations[0].id.endswith("_P") and job.operations[1].id.endswith("_A")


def _load_balance_flex_jobs(
    request: SolverRequest,
    job_options: dict[str, list[tuple[OperationInput, str]]],
    twin_partner: dict[str, str],
) -> None:
    """Pre-step: balance flex jobs across machines.

    1. Identify overloaded machines (>80% effective capacity).
    2. Move their flex jobs to alt machines (latest deadline first).
    3. Block ALL routing TO originally-overloaded machines.
    """
    CAPACITY_THRESHOLD = 0.80  # Setup sequencing adds ~20% overhead
    DAY_CAP = 1020
    n_workdays = len(request.workdays) if request.workdays else 53
    horizon = n_workdays * DAY_CAP
    eff_cap = int(horizon * CAPACITY_THRESHOLD)

    # Compute load per machine (twin counted once)
    machine_load: dict[str, int] = defaultdict(int)
    twin_counted: set[str] = set()
    for job in request.jobs:
        op = job.operations[0]
        mid = op.machine_id
        partner = twin_partner.get(job.id)
        if partner and partner in twin_counted:
            continue
        machine_load[mid] += op.duration_min + op.setup_min
        if partner:
            twin_counted.add(job.id)

    # Identify originally overloaded machines (before any moves)
    overloaded: set[str] = {mid for mid, load in machine_load.items() if load > eff_cap}

    # Move flex jobs OFF each overloaded machine
    for mid in sorted(overloaded):
        overflow = machine_load[mid] - eff_cap

        flex_on_machine: list[tuple[str, str, int, int]] = []
        for job in request.jobs:
            opts = job_options.get(job.id, [])
            if len(opts) != 2:
                continue
            if opts[0][1] != mid:
                continue
            if job.id in twin_partner:
                continue
            alt_mid = opts[1][1]
            load = opts[0][0].duration_min + opts[0][0].setup_min
            flex_on_machine.append((job.id, alt_mid, load, job.due_date_min))

        flex_on_machine.sort(key=lambda x: -x[3])

        for job_id, alt_mid, load, _dd in flex_on_machine:
            if overflow <= 0:
                break
            alt_remaining = eff_cap - machine_load.get(alt_mid, 0)
            if alt_remaining >= load:
                opts = job_options[job_id]
                job_options[job_id] = [opts[1]]
                machine_load[mid] -= load
                machine_load[alt_mid] = machine_load.get(alt_mid, 0) + load
                overflow -= load

    # Block routing TO originally-overloaded machines (prevents ATCS from
    # putting load back onto machines we just offloaded from)
    for job in request.jobs:
        opts = job_options.get(job.id, [])
        if len(opts) != 2:
            continue
        alt_mid = opts[1][1]
        if alt_mid in overloaded:
            job_options[job.id] = [opts[0]]


def _build_single_schedule(
    request: SolverRequest,
    k1: float,
    k2: float,
    p_bar: float,
    s_bar: float,
) -> ScheduleState:
    """Build one feasible schedule with given K1/K2 parameters.

    Algorithm:
    1. Maintain a pool of unscheduled jobs
    2. At each step, compute ATCS priority for each unscheduled job
       on each eligible machine
    3. Pick highest priority, schedule it (respecting constraints)
    4. Twin co-production: schedule both twins together
    """
    state = ScheduleState.from_request(request)

    # Build twin map: job_id → partner_job_id
    twin_partner: dict[str, str] = dict(state.twin_map)

    # Build per-job info: which machines + ops are available
    job_options: dict[str, list[tuple[OperationInput, str]]] = {}
    for job in request.jobs:
        if _is_flexible_job(job):
            job_options[job.id] = [
                (job.operations[0], job.operations[0].machine_id),  # primary
                (job.operations[1], job.operations[1].machine_id),  # alt
            ]
        else:
            op = job.operations[0]
            job_options[job.id] = [(op, op.machine_id)]

    # Job lookup
    job_map: dict[str, JobInput] = {j.id: j for j in request.jobs}

    # ── Load-balance pre-step: offload flex jobs from overloaded machines ──
    _load_balance_flex_jobs(request, job_options, twin_partner)

    # Track which jobs are scheduled
    scheduled: set[str] = set()
    # Track machine end times and last tools (updated as we schedule)
    # These are tracked inside state.machine_ops, but we keep local caches
    # for fast ATCS priority computation
    machine_end: dict[str, int] = defaultdict(int)
    machine_last_tool: dict[str, str | None] = defaultdict(lambda: None)

    # Twin scheduled slots: job_id → (start, end, setup, machine_id)
    twin_slots: dict[str, tuple[int, int, int, str]] = {}

    n_jobs = len(request.jobs)
    while len(scheduled) < n_jobs:
        best_priority = -1.0
        best_job_id: str | None = None
        best_op: OperationInput | None = None
        best_mid: str | None = None
        best_start: int = 0
        best_setup: int = 0

        for job in request.jobs:
            if job.id in scheduled:
                continue

            # Check if twin partner already scheduled → co-produce
            partner_id = twin_partner.get(job.id)
            if partner_id and partner_id in twin_slots:
                # Will co-produce — evaluate priority based on partner's slot
                p_start, p_end, _, p_mid = twin_slots[partner_id]
                op = job.operations[0]  # Use primary op for co-production
                slack = job.due_date_min - p_end
                prio = _atcs_priority(
                    job.weight,
                    op.duration_min,
                    slack,
                    0,
                    k1,
                    k2,
                    p_bar,
                    s_bar,
                )
                # Boost co-production priority (it's free machine time)
                prio *= 10.0
                if prio > best_priority:
                    best_priority = prio
                    best_job_id = job.id
                    best_op = op
                    best_mid = p_mid
                    best_start = p_start
                    best_setup = 0
                continue

            # Evaluate on each eligible machine
            for op, mid in job_options[job.id]:
                # Quick estimate: machine end + setup
                last_tool = machine_last_tool[mid]
                setup = 0 if last_tool == op.tool_id else op.setup_min
                est_start = machine_end[mid] + setup
                est_end = est_start + op.duration_min
                slack = job.due_date_min - est_end

                prio = _atcs_priority(
                    job.weight,
                    op.duration_min,
                    slack,
                    setup,
                    k1,
                    k2,
                    p_bar,
                    s_bar,
                )
                if prio > best_priority:
                    best_priority = prio
                    best_job_id = job.id
                    best_op = op
                    best_mid = mid
                    best_start = est_start
                    best_setup = setup

        if best_job_id is None:
            break  # No more jobs to schedule

        job = job_map[best_job_id]
        assert best_op is not None
        assert best_mid is not None

        # Check if co-producing with twin partner
        partner_id = twin_partner.get(best_job_id)
        if partner_id and partner_id in twin_slots:
            # Co-produce: same slot as partner
            p_start, p_end, _, p_mid = twin_slots[partner_id]
            tardiness = max(0, p_end - job.due_date_min)
            sop = ScheduledOperation(
                op_id=best_op.id,
                job_id=job.id,
                machine_id=p_mid,
                tool_id=best_op.tool_id,
                calco_code=best_op.calco_code,
                start_min=p_start,
                end_min=p_end,
                setup_min=0,
                duration_min=best_op.duration_min,
                due_date_min=job.due_date_min,
                weight=job.weight,
                is_twin=True,
                twin_partner_op_id=partner_id,
                operators=best_op.operators,
                alt_machine_id=None,
            )
            state.insert_op(sop)
            scheduled.add(best_job_id)
            continue

        # Use local caches for start time (greedy append — no need for full scan)
        actual_setup = best_setup
        prod_start = best_start
        end = prod_start + best_op.duration_min

        # Determine alt_machine_id for flexible jobs
        alt_mid = None
        if _is_flexible_job(job):
            for op, mid in job_options[job.id]:
                if mid != best_mid:
                    alt_mid = mid
                    break

        sop = ScheduledOperation(
            op_id=best_op.id,
            job_id=job.id,
            machine_id=best_mid,
            tool_id=best_op.tool_id,
            calco_code=best_op.calco_code,
            start_min=prod_start,
            end_min=end,
            setup_min=actual_setup,
            duration_min=best_op.duration_min,
            due_date_min=job.due_date_min,
            weight=job.weight,
            is_twin=partner_id is not None,
            twin_partner_op_id=partner_id if partner_id else None,
            operators=best_op.operators,
            alt_machine_id=alt_mid,
        )
        state.insert_op(sop)
        scheduled.add(best_job_id)

        # Update local caches
        machine_end[best_mid] = end
        machine_last_tool[best_mid] = best_op.tool_id

        # Record twin slot for partner
        if partner_id:
            twin_slots[best_job_id] = (prod_start, end, actual_setup, best_mid)

    return state
