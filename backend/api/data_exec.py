"""Data API — Execution tracking & Calibration endpoints (Moldit Planner)."""

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


class ExecutionLogInput(BaseModel):
    op_id: int
    molde: str
    maquina_id: str
    codigo: str
    work_h_planeado: float
    work_h_real: float
    setup_h_planeado: float = 0.0
    setup_h_real: float = 0.0
    dia_planeado: int = 0
    dia_real: int = 0
    motivo_desvio: str = ""
    reportado_por: str = ""


class MachineEventInput(BaseModel):
    maquina_id: str
    tipo: str
    inicio: str
    fim: str | None = None
    duracao_h: float = 0.0
    planeado: bool = False
    notas: str = ""


# ═══════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════


def _get_exec_store():
    from backend.learning.execution_store import ExecutionStore
    if not hasattr(state, "_exec_store") or state._exec_store is None:
        state._exec_store = ExecutionStore()
    return state._exec_store


# ═══════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/execution-log")
async def add_execution_log(body: ExecutionLogInput):
    """Record an operation completion with actual times."""
    store = _get_exec_store()
    row_id = store.log_completion(
        op_id=body.op_id, molde=body.molde, maquina_id=body.maquina_id,
        codigo=body.codigo, work_h_planeado=body.work_h_planeado,
        work_h_real=body.work_h_real, setup_h_planeado=body.setup_h_planeado,
        setup_h_real=body.setup_h_real, dia_planeado=body.dia_planeado,
        dia_real=body.dia_real, motivo_desvio=body.motivo_desvio,
        reportado_por=body.reportado_por,
    )
    return {"id": row_id, "status": "ok"}


@router.get("/execution-log")
async def get_execution_logs(codigo: str = "", maquina_id: str = "", limit: int = 100):
    """Query execution logs. Filter by codigo or maquina_id."""
    store = _get_exec_store()
    if codigo:
        return store.get_logs_by_codigo(codigo, limit)
    if maquina_id:
        return store.get_logs_by_maquina(maquina_id, limit)
    return store.get_all_logs(limit)


@router.post("/machine-event")
async def add_machine_event(body: MachineEventInput):
    """Record a machine event (downtime, maintenance, etc)."""
    store = _get_exec_store()
    row_id = store.log_machine_event(
        maquina_id=body.maquina_id, tipo=body.tipo, inicio=body.inicio,
        fim=body.fim, duracao_h=body.duracao_h, planeado=body.planeado,
        notas=body.notas,
    )
    return {"id": row_id, "status": "ok"}


@router.get("/machine-events")
async def get_machine_events(maquina_id: str = "", limit: int = 100):
    """Query machine events. Filter by maquina_id."""
    store = _get_exec_store()
    if maquina_id:
        return store.get_machine_events(maquina_id, limit)
    return store.get_all_events(limit)


@router.get("/calibration")
async def get_calibration():
    """Get calibration factors and machine reliability from execution data."""
    from dataclasses import asdict as _asdict

    from backend.learning.calibration import (
        calcular_fatores_calibracao,
        calcular_fiabilidade_maquina,
    )

    store = _get_exec_store()
    logs = store.get_all_logs(limit=1000)
    fatores = calcular_fatores_calibracao(logs)

    fiabilidade: dict[str, dict] = {}
    if state.engine_data:
        machines_map = {m.id: m for m in state.engine_data.maquinas}
        seen: set[str] = set()
        for log in logs:
            mid = log.get("maquina_id", "")
            if mid and mid not in seen:
                seen.add(mid)
                events = store.get_machine_events(mid, limit=200)
                if events:
                    m = machines_map.get(mid)
                    regime = m.regime_h if m else 16
                    rel = calcular_fiabilidade_maquina(events, regime)
                    fiabilidade[mid] = _asdict(rel)

    return {
        "fatores": {k: _asdict(v) for k, v in fatores.items()},
        "fiabilidade": fiabilidade,
    }
