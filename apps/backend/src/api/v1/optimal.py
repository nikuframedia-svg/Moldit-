# Optimal Pipeline — CP-SAT → Recovery → Monte Carlo (OPT-02)
# Unified endpoint that orchestrates the full solver pipeline.

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ...domain.copilot.state import copilot_state
from ...domain.solver.montecarlo import monte_carlo_otd
from ...domain.solver.recovery import cascading_recovery
from ...domain.solver.router_logic import SolverRouter
from ...domain.solver.schemas import SolverRequest, SolverResult

logger = logging.getLogger(__name__)

optimal_router = APIRouter(prefix="/optimal", tags=["optimal"])

_router = SolverRouter()


class OptimalRequest(BaseModel):
    """Request for the optimal pipeline."""

    solver_request: SolverRequest
    frozen_ops: list[str] = Field(default_factory=list)
    alt_machines: dict[str, list[str]] | None = None
    run_monte_carlo: bool = Field(True, description="Run robustness analysis after solving")
    n_scenarios: int = Field(200, ge=10, le=5000)


class OptimalResult(BaseModel):
    """Result from the optimal pipeline: solver + recovery + robustness."""

    solver_result: SolverResult
    recovery_used: bool = False
    recovery_level: int = 0
    robustness: dict | None = None


@optimal_router.post("/solve", response_model=OptimalResult)
async def optimal_solve(request: OptimalRequest):
    """
    Pipeline óptimo unificado:
    1. CP-SAT solve (via router — routes by problem size)
    2. Se tardiness > 0 → cascading_recovery (4 níveis)
    3. Se feasible → monte_carlo_otd (200 cenários)

    Retorna SolverResult + robustness info.
    """
    # Step 1: CP-SAT solve
    logger.info("Optimal pipeline: solving %d jobs", len(request.solver_request.jobs))
    result = _router.solve(request.solver_request)
    recovery_used = False
    recovery_level = 0

    # Step 2: Recovery if tardiness > 0
    if result.total_tardiness_min > 0 and result.status in ("optimal", "feasible", "timeout"):
        logger.info(
            "Tardiness %d min — triggering cascading recovery",
            result.total_tardiness_min,
        )
        recovered = cascading_recovery(
            request=request.solver_request,
            frozen_ops=request.frozen_ops or None,
            alt_machines=request.alt_machines,
        )
        if recovered.weighted_tardiness < result.weighted_tardiness:
            result = recovered
            recovery_used = True
            recovery_level = int(recovered.phase_values.get("recovery_level", 0))
            logger.info("Recovery improved result (level %d)", recovery_level)

    # Step 3: Monte Carlo robustness (only if feasible solution found)
    robustness = None
    if request.run_monte_carlo and result.status in ("optimal", "feasible"):
        logger.info("Running Monte Carlo robustness (%d scenarios)", request.n_scenarios)
        robustness = monte_carlo_otd(
            request=request.solver_request,
            n_scenarios=request.n_scenarios,
        )
        logger.info("Robustness: P(OTD=100%%)=%.1f%%", robustness.get("p_otd_100", 0))

    # OPT-05: Wire copilot state with solver result + robustness
    copilot_state.solver_result = {
        "status": result.status,
        "tardiness": result.total_tardiness_min,
        "solver_used": result.solver_used,
        "solve_time_s": result.solve_time_s,
        "recovery_used": recovery_used,
        "recovery_level": recovery_level,
        "robustness": robustness,
    }

    return OptimalResult(
        solver_result=result,
        recovery_used=recovery_used,
        recovery_level=recovery_level,
        robustness=robustness,
    )
