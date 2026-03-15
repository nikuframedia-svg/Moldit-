"""Alerts API — coverage-based alerts sorted by severity."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.api.state import app_state

router = APIRouter(prefix="/api", tags=["alerts"])


@router.get("/alerts")
def get_alerts() -> dict:
    """All alerts sorted: atraso > red > yellow, biggest shortage first."""
    if app_state.schedule is None:
        raise HTTPException(400, "No ISOP loaded. POST /api/load-isop first.")
    return {"alerts": app_state.alerts or [], "count": len(app_state.alerts or [])}


@router.get("/alerts/summary")
def alerts_summary() -> dict:
    """Alert counts by severity."""
    if app_state.schedule is None:
        raise HTTPException(400, "No ISOP loaded. POST /api/load-isop first.")
    alerts = app_state.alerts or []
    counts = {"atraso": 0, "red": 0, "yellow": 0}
    for a in alerts:
        sev = a.get("severity", "")
        if sev in counts:
            counts[sev] += 1
    return {"summary": counts, "total": len(alerts)}
