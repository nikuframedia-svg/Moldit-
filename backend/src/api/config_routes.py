"""Config & Rules API — factory definitions + configurable rules."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.api.state import app_state

router = APIRouter(prefix="/api", tags=["config"])


# ─── Config endpoints ────────────────────────────────────────────────────────


@router.get("/config")
def get_config() -> dict:
    """Current factory configuration (YAML as JSON)."""
    return {"config": app_state.get_config()}


@router.put("/config")
def update_config(config: dict) -> dict:
    """Update factory configuration in memory."""
    app_state.set_config(config)
    return {"status": "updated"}


# ─── Rules CRUD ───────────────────────────────────────────────────────────────


class RulePayload(BaseModel):
    id: str
    name: str
    condition: dict
    action: dict
    enabled: bool = True


@router.get("/rules")
def get_rules() -> dict:
    """All configurable rules."""
    return {"rules": app_state.get_rules()}


@router.post("/rules")
def create_rule(payload: RulePayload) -> dict:
    """Add a new rule."""
    existing = app_state.get_rules()
    if any(r.get("id") == payload.id for r in existing):
        raise HTTPException(409, f"Rule {payload.id} already exists")
    app_state.add_rule(payload.model_dump())
    return {"status": "created", "rule_id": payload.id}


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str) -> dict:
    """Remove a rule by ID."""
    removed = app_state.remove_rule(rule_id)
    if not removed:
        raise HTTPException(404, f"Rule {rule_id} not found")
    return {"status": "deleted", "rule_id": rule_id}
