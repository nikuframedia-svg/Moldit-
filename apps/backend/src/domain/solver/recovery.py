# Cascading Recovery (S-04)
# 4-level escalation: hard deadlines → alt machines → overtime → soft deadlines
# Each level tries to find a feasible solution before escalating.

from __future__ import annotations

from .cpsat_solver import CpsatSolver
from .late_report import build_late_report
from .schemas import (
    MachineInput,
    SolverRequest,
    SolverResult,
)


def cascading_recovery(
    request: SolverRequest,
    frozen_ops: list[str] | None = None,
    alt_machines: dict[str, list[str]] | None = None,
) -> SolverResult:
    """Try 4 escalation levels to recover from infeasibility or high tardiness.

    Level 1: Hard deadlines (original request, strict)
    Level 2: Add alternative machines for bottleneck ops
    Level 3: Extend capacity (overtime — increase horizon)
    Level 4: Soft deadlines (relax weights, accept some tardiness)

    Args:
        request: Original solver request
        frozen_ops: Op IDs that cannot be moved (already started)
        alt_machines: Map of machine_id → list of alternative machine_ids

    Returns:
        Best SolverResult found across levels, with recovery metadata.
    """
    solver = CpsatSolver()
    best_result: SolverResult | None = None
    recovery_level = 0

    # Level 1: Try as-is with hard deadlines
    result = solver.solve(request)
    if _is_acceptable(result):
        result.phase_values["recovery_level"] = 1
        return _attach_late_report(result, request)
    best_result = result
    recovery_level = 1

    # Level 2: Add alternative machines
    if alt_machines:
        expanded_request = _expand_alt_machines(request, alt_machines)
        result = solver.solve(expanded_request)
        if _is_better(result, best_result):
            best_result = result
            recovery_level = 2
        if _is_acceptable(result):
            result.phase_values["recovery_level"] = 2
            return _attach_late_report(result, request)

    # Level 3: Overtime — extend capacity by 50%
    overtime_request = _apply_overtime(request, factor=1.5)
    result = solver.solve(overtime_request)
    if _is_better(result, best_result):
        best_result = result
        recovery_level = 3
    if _is_acceptable(result):
        result.phase_values["recovery_level"] = 3
        return _attach_late_report(result, request)

    # Level 4: Soft deadlines — reduce weights on non-critical jobs
    soft_request = _soften_deadlines(request)
    result = solver.solve(soft_request)
    if _is_better(result, best_result):
        best_result = result
        recovery_level = 4

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


def _expand_alt_machines(
    request: SolverRequest,
    alt_machines: dict[str, list[str]],
) -> SolverRequest:
    """Duplicate bottleneck ops onto alternative machines.

    For each op on a bottleneck machine, create a copy on each alt machine.
    The solver picks the best assignment via circuit.
    """
    req = request.model_copy(deep=True)

    # Add any new machines not already in the request
    existing_machines = {m.id for m in req.machines}
    for alts in alt_machines.values():
        for alt_id in alts:
            if alt_id not in existing_machines:
                req.machines.append(MachineInput(id=alt_id))
                existing_machines.add(alt_id)

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
