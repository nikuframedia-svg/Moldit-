"""Data API — Configuration & master data endpoints (Moldit Planner)."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel

from backend.copilot.executors_master import (
    exec_adicionar_feriado,
    exec_editar_maquina,
    exec_remover_feriado,
)
from backend.copilot.state import state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data"])


def _require_data():
    """Raise 503 if no data loaded."""
    if state.engine_data is None:
        raise HTTPException(503, "Sem dados carregados.")


def _require_config():
    if state.config is None:
        raise HTTPException(503, "Configuracao nao carregada.")


# ═══════════════════════════════════════════════════════════════════════════
# CONFIG READ
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/config")
async def get_config():
    _require_config()
    c = state.config
    return {
        "name": c.name,
        "site": c.site,
        "timezone": c.timezone,
        "shifts": [
            {
                "id": s.id,
                "start_min": s.start_min,
                "end_min": s.end_min,
                "duration_min": s.duration_min,
                "label": s.label,
            }
            for s in c.shifts
        ],
        "day_capacity_min": c.day_capacity_min,
        "machines": {
            mid: {
                "group": m.group, "active": m.active,
                "regime_h": m.regime_h, "setup_h": m.setup_h,
            }
            for mid, m in c.machines.items()
        },
        "operators": {
            f"{k[0]} {k[1]}" if isinstance(k, tuple) else str(k): v
            for k, v in c.operators.items()
        },
        "holidays": [str(h) for h in c.holidays],
        # Scheduler weights
        "weight_makespan": c.weight_makespan,
        "weight_deadline_compliance": c.weight_deadline_compliance,
        "weight_setups": c.weight_setups,
        "weight_balance": c.weight_balance,
        # Risk
        "oee_default": c.oee_default,
        # Scheduler tunables
        "max_run_days": c.max_run_days,
        "max_edd_gap": c.max_edd_gap,
        "edd_swap_tolerance": c.edd_swap_tolerance,
        "urgency_threshold": c.urgency_threshold,
        "vns_enabled": c.vns_enabled,
    }


# ═══════════════════════════════════════════════════════════════════════════
# CONFIG UPDATE
# ═══════════════════════════════════════════════════════════════════════════


@router.put("/config")
async def update_config(updates: dict):
    """Update tunable config parameters and recalculate schedule."""
    _require_config()

    tunables = [
        "oee_default", "max_run_days", "max_edd_gap", "edd_swap_tolerance",
        "urgency_threshold", "vns_enabled", "vns_max_iter",
        "weight_makespan", "weight_deadline_compliance",
        "weight_setups", "weight_balance",
    ]
    c = state.config
    changed = []
    for key in tunables:
        if key in updates:
            old_val = getattr(c, key)
            new_val = type(old_val)(updates[key])
            setattr(c, key, new_val)
            changed.append(key)

    if not changed:
        return {"status": "ok", "changed": [], "score": state.score}

    from backend.config.loader import save_config
    save_config(c)

    # Recalculate if data is loaded
    if state.engine_data:
        from backend.cpo import optimize

        result = optimize(state.engine_data, mode="quick", audit=True, config=c)
        state.update_schedule(result)

    return {"status": "ok", "changed": changed, "score": state.score}


# ═══════════════════════════════════════════════════════════════════════════
# MASTER DATA MUTATIONS
# ═══════════════════════════════════════════════════════════════════════════


def _exec_result(result_json: str) -> dict:
    """Parse executor JSON result, raise HTTPException on error."""
    result = json.loads(result_json)
    if "error" in result:
        raise HTTPException(400, result["error"])
    return result


@router.put("/machines/{mid}")
async def edit_machine(mid: str, body: dict):
    """Toggle machine active/inactive or change group."""
    _require_data()
    body["id"] = mid
    return _exec_result(exec_editar_maquina(body))


@router.put("/operators")
async def update_operators(body: dict):
    """Batch update operator counts. Body: { "Grandes A": 6, ... }"""
    _require_config()
    _require_data()

    from backend.config.loader import save_config
    from backend.cpo import optimize

    old_score = dict(state.score) if state.score else {}
    changed = []
    for key, count in body.items():
        if key in state.config.operators:
            state.config.operators[key] = int(count)
            changed.append(key)
        else:
            # Try tuple key format: "Grandes A" -> ("Grandes", "A")
            parts = key.split()
            if len(parts) == 2:
                tkey = (parts[0], parts[1])
                if tkey in state.config.operators:
                    state.config.operators[tkey] = int(count)
                    changed.append(key)

    if not changed:
        return {"status": "ok", "score": state.score, "score_anterior": old_score}

    save_config(state.config)
    result = optimize(state.engine_data, mode="quick", audit=True, config=state.config)
    state.update_schedule(result)

    return {"status": "ok", "changed": changed, "score": result.score, "score_anterior": old_score}


@router.post("/holidays")
async def add_holiday(body: dict):
    """Add a holiday. Body: { "data": "2026-05-01" }"""
    _require_data()
    date = body.get("data", "")
    if not date:
        raise HTTPException(400, "Campo 'data' obrigatorio.")
    return _exec_result(exec_adicionar_feriado({"data": date}))


@router.delete("/holidays/{date}")
async def remove_holiday(date: str):
    """Remove a holiday by ISO date."""
    _require_data()
    return _exec_result(exec_remover_feriado({"data": date}))


@router.post("/presets/{name}")
async def apply_preset_endpoint(name: str):
    """Apply a named config preset (rapido, equilibrado, min_setups, balanceado)."""
    _require_config()
    from backend.config.presets import get_preset

    try:
        overrides = get_preset(name)
    except KeyError as e:
        raise HTTPException(400, str(e))

    # Reuse existing update_config logic
    return await update_config(overrides)


# ═══════════════════════════════════════════════════════════════════════════
# UPLOAD
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/load")
async def load_project_upload(
    file: UploadFile,
    config_path: str = "config/factory.yaml",
):
    """Load project plan from uploaded .mpp, transform, schedule, respond."""
    import tempfile
    from pathlib import Path

    from backend.config.loader import load_config
    from backend.scheduler.scheduler import schedule_all
    from backend.transform.transform import transform

    fname = file.filename or "plan.mpp"
    suffix = Path(fname).suffix.lower()
    if suffix != ".mpp":
        raise HTTPException(400, f"Formato invalido: {suffix}. Apenas .mpp e aceite.")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(400, "Ficheiro vazio.")
        tmp.write(content)
        tmp_path = tmp.name

    try:
        config = load_config(config_path)
        state.config = config
        engine_data = transform(tmp_path, config)
        state.engine_data = engine_data

        result = schedule_all(engine_data, audit=True, config=config)
        state.update_schedule(result)

        return {
            "status": "ok",
            "n_operacoes": len(engine_data.operacoes),
            "n_moldes": len(engine_data.moldes),
            "n_maquinas": len(engine_data.maquinas),
            "n_segmentos": len(result.segmentos),
            "score": result.score,
            "warnings": result.warnings[:10],
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erro ao processar ficheiro MPP")
        raise HTTPException(422, f"Erro ao processar MPP: {exc}") from exc
    finally:
        import os
        os.unlink(tmp_path)
