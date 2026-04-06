"""Data API — Simulation endpoints (Moldit Planner)."""

from __future__ import annotations

import logging
from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.copilot.state import state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data"])


def _require_data():
    """Raise 503 if no data loaded."""
    if state.engine_data is None:
        raise HTTPException(503, "Sem dados carregados.")


# ═══════════════════════════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════════════════════════


class MutationInput(BaseModel):
    type: str
    params: dict = {}


class SimulateRequest(BaseModel):
    mutations: list[MutationInput]


class CTPRequest(BaseModel):
    molde_id: str
    target_week: str


# ═══════════════════════════════════════════════════════════════════════════
# SIMULATION
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/simulate")
async def simulate_scenario(request: SimulateRequest):
    _require_data()
    from backend.simulator.simulator import Mutation, simulate

    mutations = [Mutation(type=m.type, params=m.params) for m in request.mutations]
    try:
        result = simulate(state.engine_data, state.score, mutations, config=state.config)
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from exc

    return {
        "segmentos": [asdict(s) for s in result.segments],
        "score": result.score,
        "delta": asdict(result.delta),
        "time_ms": result.time_ms,
        "summary": (
            "\n".join(result.summary)
            if isinstance(result.summary, list)
            else result.summary
        ),
    }


@router.post("/simulate-apply")
async def simulate_and_apply(request: SimulateRequest):
    """Run simulation and apply result as active schedule. Saves snapshot for revert."""
    _require_data()
    from backend.simulator.simulator import Mutation, simulate

    old_score = dict(state.score) if state.score else {}
    old_n = len(state.segments)

    state.save_current()

    mutations = [Mutation(type=m.type, params=m.params) for m in request.mutations]

    try:
        async with state.lock:
            result = simulate(
                state.engine_data, old_score, mutations, config=state.config,
            )
            # Convert SimulateResponse to ScheduleResult for update_schedule
            from backend.scheduler.types import ScheduleResult
            schedule = ScheduleResult(
                segmentos=result.segments,
                score=result.score,
            )
            state.update_schedule(schedule)
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from exc

    summary = (
        "\n".join(result.summary)
        if isinstance(result.summary, list)
        else result.summary
    )

    return {
        "status": "applied",
        "score": result.score,
        "score_previous": old_score,
        "summary": summary,
        "n_segments_before": old_n,
        "n_segments_after": len(result.segments),
        "time_ms": result.time_ms,
        "can_revert": True,
    }


@router.post("/revert")
async def revert_simulation():
    """Revert to schedule saved before simulate-apply."""
    _require_data()
    if not state.saved_schedule:
        raise HTTPException(400, "Nada para reverter.")
    state.update_schedule(state.saved_schedule)
    state.saved_schedule = None
    return {"status": "reverted", "score": state.score}


@router.get("/can-revert")
async def can_revert():
    """Check if there is a saved schedule to revert to."""
    return {"can_revert": state.saved_schedule is not None}


@router.post("/ctp")
async def check_ctp(request: CTPRequest):
    _require_data()
    from backend.analytics.ctp import compute_ctp_molde

    result = compute_ctp_molde(
        request.molde_id, request.target_week,
        state.segments, state.engine_data, config=state.config,
    )
    return {
        "molde_id": result.molde_id,
        "target_week": result.target_week,
        "feasible": result.feasible,
        "slack_dias": result.slack_dias,
        "dias_extra": result.dias_extra,
        "reason": result.reason,
    }


@router.post("/recalculate")
async def recalculate():
    _require_data()
    from backend.scheduler.scheduler import schedule_all

    old_score = dict(state.score) if state.score else {}
    result = schedule_all(state.engine_data, audit=True, config=state.config)
    state.update_schedule(result)

    return {
        "status": "ok",
        "score": result.score,
        "score_previous": old_score,
        "time_ms": result.time_ms,
        "n_segments": len(result.segmentos),
        "warnings": result.warnings[:10],
    }
