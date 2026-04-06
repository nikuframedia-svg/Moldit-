"""Console API — Moldit.

GET /api/console?day_idx=0 — Full console data in one call.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from backend.copilot.state import state

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/api/console")
async def get_console(day_idx: int = 0):
    """Full console data: state phrase, actions, machines, expedition."""
    if state.engine_data is None or state.config is None:
        raise HTTPException(status_code=503, detail="Sem dados carregados.")

    # Build actions
    actions = []
    try:
        from backend.console.action_items import compute_action_items
        raw = compute_action_items(state.segments, state.engine_data, state.config)
        actions = [
            {
                "severity": a.severity,
                "title": a.phrase,
                "detail": a.body,
                "suggestion": a.actions[0] if a.actions else None,
                "machine_id": None,
                "deadline": a.deadline,
                "client": a.client,
                "category": a.category,
            }
            for a in raw
        ]
    except Exception as e:
        logger.warning("Console actions failed: %s", e)

    # Build machines list
    machines_list = []
    try:
        from backend.console.machines_today import compute_machines_today
        machines = compute_machines_today(state.segments, state.engine_data, state.config, day_idx)
        machines_list = [
            {
                "machine_id": m.get("id", "?"),
                "utilization_pct": round(m.get("util", 0) * 100, 1) if m.get("util", 0) <= 1 else round(m.get("util", 0), 1),
                "setup_count": m.get("setup_count", 0),
            }
            for m in machines.get("machines", [])
        ]
    except Exception as e:
        logger.warning("Console machines failed: %s", e)

    # Build expedition list
    expedition_list = []
    try:
        from backend.console.expedition_today import compute_deadlines_this_week
        expedition = compute_deadlines_this_week(state.segments, state.engine_data, day_idx)
        expedition_list = [
            {
                "client": c.get("client", "?"),
                "ready": c.get("ready", 0),
                "partial": c.get("partial", 0),
                "not_ready": c.get("total", 0) - c.get("ready", 0),
                "total": c.get("total", 0),
            }
            for c in expedition.get("clients", [])
        ]
    except Exception as e:
        logger.warning("Console expedition failed: %s", e)

    # State phrase
    color, phrase = "green", "Tudo dentro do prazo."
    try:
        from backend.console.state_phrase import compute_state_phrase
        color, phrase = compute_state_phrase(actions, {"clients": expedition_list}, {"machines": machines_list})
    except Exception as e:
        logger.warning("Console state phrase failed: %s", e)

    # Summary
    summary = []
    try:
        from backend.console.day_summary import compute_day_summary
        summary = compute_day_summary(
            state.segments, state.engine_data, state.config,
            day_idx, {"machines": machines_list}, {"clients": expedition_list}, actions,
        )
    except Exception as e:
        logger.warning("Console day summary failed: %s", e)

    return {
        "state": {"color": color, "phrase": phrase},
        "actions": actions,
        "machines": machines_list,
        "expedition": expedition_list,
        "tomorrow": None,
        "summary": summary,
    }
