"""Alerts REST API — Moldit Planner.

CRUD and lifecycle endpoints for the alert engine.
"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.alerts.engine import AlertEngine
from backend.alerts.store import AlertStore
from backend.copilot.state import state

router = APIRouter(prefix="/api/alerts", tags=["alerts"])

# Lazy singleton — initialised on first use
_store: AlertStore | None = None
_engine: AlertEngine | None = None


def _get_store() -> AlertStore:
    global _store  # noqa: PLW0603
    if _store is None:
        _store = AlertStore()
    return _store


def _get_engine() -> AlertEngine:
    global _engine  # noqa: PLW0603
    if _engine is None:
        _engine = AlertEngine()
    return _engine


# ── List & detail ─────────────────────────────────────────────────────


@router.get("/")
async def list_alerts(
    severidade: str | None = None,
    estado: str | None = None,
):
    """List active alerts, optionally filtered by severidade and/or estado."""
    store = _get_store()
    alerts = store.list_active(severidade=severidade, estado=estado)
    return [asdict(a) for a in alerts]


@router.get("/stats")
async def alert_stats():
    """Counts by severidade and estado."""
    store = _get_store()
    return store.stats()


@router.get("/{alert_id}")
async def get_alert(alert_id: str):
    """Single alert detail."""
    store = _get_store()
    alert = store.get(alert_id)
    if alert is None:
        raise HTTPException(404, f"Alerta {alert_id} nao encontrado.")
    return asdict(alert)


# ── Lifecycle transitions ─────────────────────────────────────────────


@router.put("/{alert_id}/acknowledge")
async def acknowledge_alert(alert_id: str):
    """Mark an alert as acknowledged."""
    store = _get_store()
    ok = store.acknowledge(alert_id)
    if not ok:
        raise HTTPException(404, f"Alerta {alert_id} nao encontrado ou ja tratado.")
    return {"status": "reconhecido", "id": alert_id}


class ResolveBody(BaseModel):
    note: str = ""


@router.put("/{alert_id}/resolve")
async def resolve_alert(alert_id: str, body: ResolveBody | None = None):
    """Mark an alert as resolved, with an optional note."""
    store = _get_store()
    note = body.note if body else ""
    ok = store.resolve(alert_id, note)
    if not ok:
        raise HTTPException(404, f"Alerta {alert_id} nao encontrado ou ja resolvido.")
    return {"status": "resolvido", "id": alert_id}


@router.put("/{alert_id}/ignore")
async def ignore_alert(alert_id: str):
    """Suppress an alert."""
    store = _get_store()
    ok = store.ignore(alert_id)
    if not ok:
        raise HTTPException(404, f"Alerta {alert_id} nao encontrado ou ja tratado.")
    return {"status": "ignorado", "id": alert_id}


# ── Evaluate (manual trigger) ────────────────────────────────────────


@router.post("/evaluate")
async def evaluate_alerts():
    """Manually trigger alert evaluation on the current schedule.

    Requires data to be loaded in state.
    """
    if state.engine_data is None:
        raise HTTPException(503, "Sem dados carregados.")

    engine = _get_engine()
    alerts = engine.evaluate(
        segmentos=state.segments,
        data=state.engine_data,
        config=state.config,
        caminho_critico_anterior=getattr(state, "_last_critico", None),
    )

    # Store current critical path for next comparison
    state._last_critico = list(state.engine_data.caminho_critico)  # type: ignore[attr-defined]

    return {
        "total": len(alerts),
        "critico": sum(1 for a in alerts if a.severidade == "critico"),
        "aviso": sum(1 for a in alerts if a.severidade == "aviso"),
        "info": sum(1 for a in alerts if a.severidade == "info"),
        "alerts": [asdict(a) for a in alerts],
    }
