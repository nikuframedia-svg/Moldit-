# Cascading Recovery (S-04)
# 4-level escalation: re-solve → tardy-only focus → overtime → soft deadlines
# Each level tries to find a zero-tardiness solution before escalating.
#
# The request already contains flexible _P/_A ops from the bridge.
# Recovery just re-solves with different strategies — no need to add alt ops.

from __future__ import annotations

import logging

from .late_report import build_late_report
from .schemas import (
    SolverRequest,
    SolverResult,
)

logger = logging.getLogger(__name__)


def cascading_recovery(
    request: SolverRequest,
    frozen_ops: list[str] | None = None,
    alt_machines: dict[str, list[str]] | None = None,
) -> SolverResult:
    """Try 4 escalation levels to recover from tardiness.

    Level 1: Re-solve with more time (flexible ops already in request)
    Level 2: Focus solver on tardy jobs (increase their weights)
    Level 3: Overtime — extend capacity by 50%
    Level 4: Soft deadlines (relax weights on non-critical, accept some tardiness)

    The request from the bridge already contains _P/_A flexible ops — Level 1
    re-solves to let CP-SAT explore the full flexible search space.

    Returns:
        Best SolverResult found across levels, with recovery metadata.
    """
    from .router_logic import SolverRouter

    solver = SolverRouter()
    best_result: SolverResult | None = None
    recovery_level = 0

    # Level 1: Re-solve with more time
    req1 = request.model_copy(deep=True)
    req1.config.time_limit_s = max(req1.config.time_limit_s, 60)
    result = solver.solve(req1)
    if _is_acceptable(result):
        result.phase_values["recovery_level"] = 1
        return _attach_late_report(result, request)
    best_result = result
    recovery_level = 1
    logger.info("Recovery L1: %d tardy, %d min", _count_tardy(result), result.total_tardiness_min)

    # Level 2: Focus on tardy jobs — increase their weights
    req2 = _focus_tardy_weights(request, best_result)
    req2.config.time_limit_s = max(req2.config.time_limit_s, 60)
    result = solver.solve(req2)
    if _is_better(result, best_result):
        best_result = result
        recovery_level = 2
    if _is_acceptable(result):
        result.phase_values["recovery_level"] = 2
        return _attach_late_report(result, request)
    logger.info(
        "Recovery L2: %d tardy, %d min", _count_tardy(best_result), best_result.total_tardiness_min
    )

    # Level 3: Overtime — extend capacity by 50%
    overtime_request = _apply_overtime(request, factor=1.5)
    result = solver.solve(overtime_request)
    if _is_better(result, best_result):
        best_result = result
        recovery_level = 3
    if _is_acceptable(result):
        result.phase_values["recovery_level"] = 3
        return _attach_late_report(result, request)
    logger.info(
        "Recovery L3: %d tardy, %d min", _count_tardy(best_result), best_result.total_tardiness_min
    )

    # Level 4: Soft deadlines — reduce weights on non-critical jobs
    soft_request = _soften_deadlines(request)
    result = solver.solve(soft_request)
    if _is_better(result, best_result):
        best_result = result
        recovery_level = 4
    logger.info(
        "Recovery L4: %d tardy, %d min", _count_tardy(best_result), best_result.total_tardiness_min
    )

    best_result.phase_values["recovery_level"] = recovery_level
    return _attach_late_report(best_result, request)


def _is_acceptable(result: SolverResult) -> bool:
    """Check if result is good enough (no tardiness)."""
    return result.status in ("optimal", "feasible") and result.total_tardiness_min == 0


def _is_better(new: SolverResult, current: SolverResult) -> bool:
    """Check if new result is better than current."""
    if new.status not in ("optimal", "feasible"):
        return False
    if current.status not in ("optimal", "feasible"):
        return True
    return new.weighted_tardiness < current.weighted_tardiness


def _count_tardy(result: SolverResult) -> int:
    """Count number of tardy ops in a result."""
    return sum(1 for s in result.schedule if s.tardiness_min > 0)


def _focus_tardy_weights(request: SolverRequest, result: SolverResult) -> SolverRequest:
    """Increase weights on tardy jobs to focus solver attention.

    Jobs that were tardy in the previous solve get 5x weight,
    pushing the solver to prioritize their deadlines.
    """
    req = request.model_copy(deep=True)
    tardy_job_ids = {s.job_id for s in result.schedule if s.tardiness_min > 0}
    for job in req.jobs:
        if job.id in tardy_job_ids:
            job.weight = max(job.weight * 5.0, 5.0)
    return req


def _apply_overtime(request: SolverRequest, factor: float = 1.5) -> SolverRequest:
    """Increase machine capacity and extend deadlines by factor."""
    req = request.model_copy(deep=True)

    # Extend all machine capacities
    for m in req.machines:
        m.capacity_min = int(m.capacity_min * factor)

    # Give solver more time for expanded problem
    req.config.time_limit_s = min(req.config.time_limit_s + 30, 300)

    return req


def _soften_deadlines(request: SolverRequest) -> SolverRequest:
    """Reduce weights on low-priority jobs to let solver trade off."""
    req = request.model_copy(deep=True)

    # Sort jobs by weight, reduce bottom 50% weights
    jobs_by_weight = sorted(req.jobs, key=lambda j: j.weight)
    cutoff = len(jobs_by_weight) // 2

    for i, job in enumerate(jobs_by_weight):
        if i < cutoff:
            job.weight = max(job.weight * 0.1, 0.01)

    return req


def _attach_late_report(result: SolverResult, request: SolverRequest) -> SolverResult:
    """Attach late report to result if any tardiness exists."""
    if result.status not in ("optimal", "feasible"):
        return result

    report = build_late_report(result, request)
    if report:
        result.phase_values["late_report"] = report
    return result
