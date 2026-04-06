"""Explain API — Moldit Planner.

Aggregated phrase endpoints for the 4-page frontend.
Each endpoint returns Portuguese phrases ready for display.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from backend.copilot.state import state
from backend.explain.phrases import (
    frase_alerta,
    frase_analogo,
    frase_cartao_maquinas,
    frase_cartao_prazos,
    frase_cartao_tempo,
    frase_cartao_trocas,
    frase_conflito,
    frase_equipa_resumo,
    frase_operacao_ml,
    frase_pessoa,
    frase_resumo_fabrica,
    frase_resumo_molde,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/explain", tags=["explain"])


def _require_data():
    if not state.engine_data or not state.segments:
        raise HTTPException(400, "Sem projecto carregado.")


@router.get("/inicio")
async def explain_inicio() -> dict:
    """All phrases needed for the INICIO page."""
    _require_data()

    score = state.score or {}
    segmentos = state.segments or []

    # Build stress list from schedule
    stress = _build_stress(segmentos)
    deadlines = _build_deadlines()

    # Get actions from console
    try:
        from backend.console.action_items import compute_action_items
        actions_raw = compute_action_items(
            state.segments, state.engine_data, state.config,
        )
        actions = [_action_to_dict(a) for a in actions_raw]
    except Exception:
        actions = []

    return {
        "frase_resumo": frase_resumo_fabrica(score, deadlines, stress, actions),
        "cartoes": [
            {"id": "tempo", **frase_cartao_tempo(score, deadlines)},
            {"id": "prazos", **frase_cartao_prazos(deadlines)},
            {"id": "maquinas", **frase_cartao_maquinas(stress)},
            {"id": "trocas", **frase_cartao_trocas(score)},
        ],
        "alertas": [frase_alerta(a) for a in actions[:5]],
    }


@router.get("/molde/{molde_id}")
async def explain_molde(molde_id: str) -> dict:
    """All phrases needed for one mold in the MOLDES page."""
    _require_data()

    # Find mold
    molde = None
    for m in state.engine_data.moldes:
        if m.id == molde_id:
            molde = m
            break
    if not molde:
        raise HTTPException(404, f"Molde {molde_id} nao encontrado.")

    molde_dict = {
        "id": molde.id, "ops_concluidas": molde.ops_concluidas,
        "total_ops": molde.total_ops, "progresso": molde.progresso,
    }

    # Deadline info
    deadlines = _build_deadlines()
    deadline_info = None
    for d in deadlines:
        if d.get("molde") == molde_id:
            deadline_info = d
            break

    # ML predictions (if available)
    ops_ml = []
    try:
        from backend.api.ml import _get_trainer
        trainer = _get_trainer()
        if trainer.m1.is_trained:
            for op in state.engine_data.operacoes:
                if op.molde == molde_id:
                    op_dict = {
                        "op_id": op.id, "codigo": op.codigo,
                        "work_h_estimado": op.work_h,
                    }
                    from dataclasses import asdict
                    pred = asdict(trainer.m1.predict(op_dict))
                    frase = frase_operacao_ml(op_dict, pred)
                    if frase:
                        ops_ml.append({"op_id": op.id, "frase_ml": frase})
    except Exception:
        pass

    # Analogy
    analogo_frase = None
    try:
        from backend.api.ml import _get_trainer
        trainer = _get_trainer()
        if trainer.m3.is_trained:
            ops = [o for o in state.engine_data.operacoes if o.molde == molde_id]
            projeto = {
                "n_operacoes": len(ops),
                "work_total_h": sum(o.work_h for o in ops),
                "n_tipos_operacao": len(set(o.codigo for o in ops)),
                "complexidade": "media",
            }
            from dataclasses import asdict
            analogos = trainer.m3.encontrar_analogos(projeto)
            if analogos:
                analogo_frase = frase_analogo(asdict(analogos[0]))
    except Exception:
        pass

    return {
        "frase_resumo": frase_resumo_molde(molde_dict, deadline_info),
        "deadline": _build_deadline_phrase(deadline_info),
        "analogo": analogo_frase,
        "operacoes_ml": ops_ml,
    }


@router.get("/equipa")
async def explain_equipa(dia: int = 1) -> dict:
    """All phrases needed for the EQUIPA page."""
    dia_labels = {0: "Hoje", 1: "Amanha", 2: "Depois de amanha"}
    dia_label = dia_labels.get(dia, f"Dia {dia}")

    # Get operators
    try:
        from backend.workforce.store import get_operadores
        operadores = get_operadores()
    except Exception:
        operadores = []

    # Get conflicts
    try:
        from backend.workforce.conflicts import detect_conflicts
        conflicts = detect_conflicts(dia=dia)
    except Exception:
        conflicts = []

    ops_dicts = [_op_to_dict(o) for o in operadores]
    conf_dicts = [_conflict_to_dict(c) for c in conflicts]

    return {
        "frase_resumo": frase_equipa_resumo(ops_dicts, conf_dicts, dia_label),
        "pessoas": [
            {"nome": o.get("nome", "?"), "frase": frase_pessoa(o)}
            for o in ops_dicts
        ],
        "problemas": [frase_conflito(c) for c in conf_dicts],
    }


# ── Helpers ──────────────────────────────────────────────────────────

def _build_stress(segmentos) -> list[dict]:
    """Build stress list from segments."""
    machine_hours: dict[str, float] = {}
    for seg in segmentos:
        mid = seg.maquina_id if hasattr(seg, "maquina_id") else seg.get("maquina_id", "")
        dur = seg.duracao_h if hasattr(seg, "duracao_h") else seg.get("duracao_h", 0)
        machine_hours[mid] = machine_hours.get(mid, 0) + dur

    stress = []
    for mid, hours in machine_hours.items():
        cap = 16 * 30  # rough capacity estimate
        stress.append({
            "maquina_id": mid,
            "stress_pct": min(100, hours / cap * 100) if cap > 0 else 0,
            "total_horas": hours,
        })
    return sorted(stress, key=lambda s: -s["stress_pct"])


def _build_deadlines() -> list[dict]:
    """Build deadline list from state."""
    if not state.score:
        return []

    score = state.score
    violations = score.get("deadline_violations", [])
    violation_moldes = {v["molde"] for v in violations}

    result = []
    for m in state.engine_data.moldes:
        is_late = m.id in violation_moldes
        dias_atraso = 0
        for v in violations:
            if v["molde"] == m.id:
                dias_atraso = v.get("delta_dias", 0)

        result.append({
            "molde": m.id,
            "on_time": not is_late,
            "dias_atraso": dias_atraso,
            "dias_folga": max(0, -dias_atraso) if not is_late else 0,
        })
    return result


def _build_deadline_phrase(deadline_info: dict | None) -> dict:
    """Deadline phrase for mold header."""
    if not deadline_info:
        return {"frase": "Sem informacao de prazo.", "cor": "green"}

    if deadline_info.get("on_time", True):
        folga = deadline_info.get("dias_folga", 0)
        if folga > 5:
            return {"frase": f"Dentro do prazo. {folga} dias de folga.", "cor": "green"}
        if folga > 0:
            return {"frase": f"Dentro do prazo. Pouca margem ({folga} dias).", "cor": "orange"}
        return {"frase": "Dentro do prazo.", "cor": "green"}
    else:
        dias = abs(deadline_info.get("dias_atraso", 0))
        return {"frase": f"Atrasado {dias} dias.", "cor": "red"}


def _action_to_dict(action) -> dict:
    """Convert ActionItem to dict."""
    if isinstance(action, dict):
        return action
    return {
        "severity": getattr(action, "severity", "warning"),
        "phrase": getattr(action, "phrase", ""),
        "body": getattr(action, "body", ""),
        "actions": getattr(action, "actions", []),
        "category": getattr(action, "category", ""),
    }


def _op_to_dict(op) -> dict:
    if isinstance(op, dict):
        return op
    return {
        "nome": getattr(op, "nome", "?"),
        "disponivel": getattr(op, "disponivel", True),
        "turno": getattr(op, "turno", ""),
        "zona": getattr(op, "zona", ""),
    }


def _conflict_to_dict(c) -> dict:
    if isinstance(c, dict):
        return c
    return {
        "tipo": getattr(c, "tipo", ""),
        "descricao": getattr(c, "descricao", ""),
        "sugestao": getattr(c, "sugestao", ""),
        "maquinas": getattr(c, "maquinas", []),
        "deficit": getattr(c, "deficit", 0),
    }
