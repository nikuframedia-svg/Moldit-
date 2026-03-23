# Optimal Pipeline — CP-SAT → Recovery → Monte Carlo (OPT-02)
# Unified endpoint that orchestrates the full solver pipeline.

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ...domain.copilot.state import copilot_state
from ...domain.solver.scheduling_service import SchedulingService
from ...domain.solver.schemas import SolverRequest, SolverResult

logger = logging.getLogger(__name__)

optimal_router = APIRouter(prefix="/optimal", tags=["optimal"])


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
    0. Aplicar regras de fábrica (FINAL-04)
    1. CP-SAT solve (via router — routes by problem size)
    2. Se tardiness > 0 → cascading_recovery (4 níveis)
    3. Se feasible → monte_carlo_otd (200 cenários)

    Retorna SolverResult + robustness info.
    """
    service = SchedulingService()
    raw = service.solve_request(
        request.solver_request,
        run_factory_rules=True,
        run_recovery=True,
        run_monte_carlo=request.run_monte_carlo,
        n_scenarios=request.n_scenarios,
        frozen_ops=request.frozen_ops or None,
        alt_machines=request.alt_machines,
    )

    # FINAL-06: Generate enriched decision trail from solver result
    decisions = raw.rule_decisions + _generate_decisions(raw.solver_result, request.solver_request)
    copilot_state.decisions = decisions

    # OPT-05: Wire copilot state with solver result + robustness
    copilot_state.solver_result = {
        "status": raw.solver_result.status,
        "tardiness": raw.solver_result.total_tardiness_min,
        "solver_used": raw.solver_result.solver_used,
        "solve_time_s": raw.solver_result.solve_time_s,
        "recovery_used": raw.recovery_used,
        "recovery_level": raw.recovery_level,
        "robustness": raw.robustness,
    }

    return OptimalResult(
        solver_result=raw.solver_result,
        recovery_used=raw.recovery_used,
        recovery_level=raw.recovery_level,
        robustness=raw.robustness,
    )


def _generate_decisions(result: SolverResult, request: SolverRequest) -> list[dict]:
    """Generate enriched decision trail from CP-SAT schedule (FINAL-06)."""
    DAY_CAP = 1020
    SHIFT_LEN = 510

    job_map = {j.id: j for j in request.jobs}

    # Build workday mapping for calendar day display
    workdays = request.workdays
    has_workdays = len(workdays) > 0

    decisions: list[dict] = []

    for sop in result.schedule:
        job = job_map.get(sop.job_id)
        if not job:
            continue

        solver_day = sop.start_min // DAY_CAP
        # Map solver day to calendar day if workdays provided
        cal_day = (
            workdays[solver_day] if has_workdays and solver_day < len(workdays) else solver_day
        )
        shift = "X" if (sop.start_min % DAY_CAP) < SHIFT_LEN else "Y"
        tardiness = sop.tardiness_min

        decisions.append(
            {
                "type": "PRODUCTION_START",
                "op_id": sop.op_id,
                "machine_id": sop.machine_id,
                "day_idx": cal_day,
                "shift": shift,
                "detail": f"{job.sku} → {sop.machine_id} dia {cal_day} turno {shift}",
            }
        )

        # FINAL-06: JIT buffer info
        deadline_day = job.due_date_min // DAY_CAP
        end_day = (sop.end_min - 1) // DAY_CAP if sop.end_min > 0 else solver_day
        buffer_days = deadline_day - end_day
        if buffer_days > 0:
            decisions.append(
                {
                    "type": "JIT_BUFFER",
                    "op_id": sop.op_id,
                    "machine_id": sop.machine_id,
                    "day_idx": cal_day,
                    "detail": f"Produzido {buffer_days} dia(s) útil(eis) antes da deadline",
                }
            )

        if tardiness > 0:
            decisions.append(
                {
                    "type": "TARDINESS",
                    "op_id": sop.op_id,
                    "machine_id": sop.machine_id,
                    "day_idx": cal_day,
                    "shift": shift,
                    "detail": (
                        f"{job.sku} atrasado {tardiness} min "
                        f"(deadline={job.due_date_min}, end={sop.end_min})"
                    ),
                }
            )

        if sop.setup_min > 0:
            decisions.append(
                {
                    "type": "SETUP",
                    "op_id": sop.op_id,
                    "machine_id": sop.machine_id,
                    "day_idx": cal_day,
                    "shift": shift,
                    "detail": f"Setup {sop.setup_min}min para {sop.tool_id} em {sop.machine_id}",
                }
            )

        # FINAL-06: Twin co-production info
        if sop.is_twin_production and sop.twin_partner_op_id:
            decisions.append(
                {
                    "type": "TWIN_CO_PRODUCTION",
                    "op_id": sop.op_id,
                    "machine_id": sop.machine_id,
                    "day_idx": cal_day,
                    "detail": (
                        f"Co-produção gémea: {sop.op_id} + {sop.twin_partner_op_id} "
                        f"em {sop.machine_id} (ferramenta partilhada, setup 1×)"
                    ),
                }
            )

    return decisions
