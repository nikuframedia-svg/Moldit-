"""Scheduling API — POST /v1/scheduling/run

Runs the Python-ported ATCS scheduling pipeline (heuristic, <2s).
Accepts EngineData JSON, returns blocks + decisions + feasibility.
"""

from __future__ import annotations

import time

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ...core.logging import get_logger
from ...domain.scheduling.overflow.auto_route_overflow import auto_route_overflow
from ...domain.scheduling.types import (
    Block,
    DecisionEntry,
    EngineData,
    FeasibilityReport,
)

logger = get_logger(__name__)

scheduling_router = APIRouter(prefix="/scheduling", tags=["scheduling"])


# ── Request / Response ──────────────────────────────────────────────────────


class SchedulingRunRequest(BaseModel):
    """Scheduling run request — accepts full EngineData."""

    engine_data: EngineData
    rule: str = "EDD"
    third_shift: bool = False
    max_tier: int = 4

    model_config = {"arbitrary_types_allowed": True}


class SchedulingRunResponse(BaseModel):
    """Scheduling run response."""

    blocks: list[Block] = Field(default_factory=list)
    auto_moves: list[dict] = Field(default_factory=list)
    auto_advances: list[dict] = Field(default_factory=list)
    decisions: list[DecisionEntry] = Field(default_factory=list)
    feasibility_report: FeasibilityReport | None = None
    solve_time_s: float = 0.0
    solver_used: str = "atcs_python"
    n_blocks: int = 0
    n_ops: int = 0

    model_config = {"arbitrary_types_allowed": True}


# ── Endpoint ────────────────────────────────────────────────────────────────


@scheduling_router.post("/run", response_model=SchedulingRunResponse)
async def run_scheduling(request: SchedulingRunRequest) -> SchedulingRunResponse:
    """Run the ATCS scheduling pipeline (Python port).

    Accepts EngineData and returns scheduled blocks with overflow resolution.
    This is the Python equivalent of the TypeScript autoRouteOverflow pipeline.
    """
    ed = request.engine_data
    t0 = time.perf_counter()

    logger.info(
        "scheduling.run",
        n_ops=len(ed.ops),
        n_machines=len(ed.machines),
        n_days=ed.n_days,
        rule=request.rule,
    )

    try:
        result = auto_route_overflow(
            ops=ed.ops,
            m_st=ed.m_st,
            t_st=ed.t_st,
            user_moves=[],
            machines=ed.machines,
            tool_map=ed.tool_map,
            workdays=ed.workdays,
            n_days=ed.n_days,
            workforce_config=ed.workforce_config,
            rule=request.rule,
            third_shift=request.third_shift or ed.third_shift,
            twin_validation_report=ed.twin_validation_report,
            order_based=ed.order_based,
            max_tier=request.max_tier,
        )

        elapsed = time.perf_counter() - t0

        blocks = result.get("blocks", [])
        decisions = result.get("decisions", [])
        feasibility = result.get("feasibility_report")
        auto_moves = result.get("auto_moves", [])
        auto_advances = result.get("auto_advances", [])

        # Serialize moves/advances as dicts for JSON response
        moves_dicts = [m.dict() if hasattr(m, "dict") else m for m in auto_moves]
        advances_dicts = [a.dict() if hasattr(a, "dict") else a for a in auto_advances]

        logger.info(
            "scheduling.run.done",
            n_blocks=len(blocks),
            solve_time_s=round(elapsed, 3),
        )

        return SchedulingRunResponse(
            blocks=blocks,
            auto_moves=moves_dicts,
            auto_advances=advances_dicts,
            decisions=decisions,
            feasibility_report=feasibility,
            solve_time_s=round(elapsed, 3),
            n_blocks=len(blocks),
            n_ops=len(ed.ops),
        )

    except Exception as e:
        elapsed = time.perf_counter() - t0
        logger.error("scheduling.run.error", error=str(e), solve_time_s=round(elapsed, 3))
        raise
