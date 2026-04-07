"""Data API — Core read endpoints (Moldit Planner)."""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import asdict

from fastapi import APIRouter, HTTPException

from backend.copilot.state import state

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data"])


def _require_data():
    """Raise 503 if no data loaded."""
    if state.engine_data is None:
        raise HTTPException(503, "Sem dados carregados.")


# ═══════════════════════════════════════════════════════════════════════════
# CORE
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/today")
async def get_today():
    """Return today's day_idx based on workdays calendar."""
    _require_data()
    import datetime as _dt
    today = _dt.date.today().isoformat()
    data = state.engine_data
    return {"today": today, "data_referencia": data.data_referencia}


@router.get("/score")
async def get_score():
    _require_data()
    return state.score


@router.get("/segments")
async def get_segments():
    _require_data()
    return [asdict(s) for s in state.segments]


@router.get("/trust")
async def get_trust():
    if state.trust_index is None:
        raise HTTPException(503, "Trust index nao calculado.")
    t = state.trust_index
    return {
        "score": t.score,
        "gate": t.gate,
        "n_ops": t.n_ops,
        "n_issues": t.n_issues,
        "dimensions": [
            {"name": d.name, "score": d.score, "details": d.details}
            for d in t.dimensions
        ],
    }


@router.get("/journal")
async def get_journal():
    return state.journal_entries or []


@router.get("/learning")
async def get_learning():
    """Return learning optimization info (or null if not optimized)."""
    return state.learning_info


# ═══════════════════════════════════════════════════════════════════════════
# MOLDIT ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/moldes")
async def get_moldes():
    """List molds with progress and deadline."""
    _require_data()
    data = state.engine_data
    result = []
    for m in data.moldes:
        result.append({
            "id": m.id,
            "cliente": m.cliente,
            "deadline": m.deadline,
            "data_ensaio": m.data_ensaio,
            "total_ops": m.total_ops,
            "ops_concluidas": m.ops_concluidas,
            "progresso": m.progresso,
            "total_work_h": m.total_work_h,
            "componentes": m.componentes,
        })
    return result


@router.get("/moldes/{molde_id}")
async def get_molde_detail(molde_id: str):
    """Operations, segments, and critical path for a specific mold."""
    _require_data()
    data = state.engine_data

    molde = next((m for m in data.moldes if m.id == molde_id), None)
    if not molde:
        raise HTTPException(404, f"Molde {molde_id} nao encontrado.")

    ops = [
        {
            "id": op.id,
            "componente": op.componente,
            "nome": op.nome,
            "codigo": op.codigo,
            "duracao_h": op.duracao_h,
            "work_h": op.work_h,
            "progresso": op.progresso,
            "work_restante_h": op.work_restante_h,
            "recurso": op.recurso,
            "grupo_recurso": op.grupo_recurso,
            "e_condicional": op.e_condicional,
            "e_2a_placa": op.e_2a_placa,
            "deadline_semana": op.deadline_semana,
            "notas": op.notas,
        }
        for op in data.operacoes
        if op.molde == molde_id
    ]

    segs = [
        asdict(s)
        for s in state.segments
        if s.molde == molde_id
    ]

    # Critical path ops for this molde
    cp_ops = [oid for oid in data.caminho_critico
              if any(op.id == oid and op.molde == molde_id for op in data.operacoes)]

    return {
        "molde": asdict(molde) if hasattr(molde, '__dataclass_fields__') else {
            "id": molde.id, "cliente": molde.cliente, "deadline": molde.deadline,
            "progresso": molde.progresso, "total_work_h": molde.total_work_h,
        },
        "operacoes": ops,
        "segmentos": segs,
        "caminho_critico": cp_ops,
    }


@router.get("/timeline")
async def get_timeline():
    """Segments grouped by machine/day for Gantt chart."""
    _require_data()

    by_machine: dict[str, list[dict]] = defaultdict(list)
    for s in state.segments:
        by_machine[s.maquina_id].append({
            "op_id": s.op_id,
            "molde": s.molde,
            "dia": s.dia,
            "inicio_h": s.inicio_h,
            "fim_h": s.fim_h,
            "duracao_h": s.duracao_h,
            "setup_h": s.setup_h,
            "e_2a_placa": s.e_2a_placa,
            "e_continuacao": s.e_continuacao,
        })

    return {"timeline": dict(by_machine)}


@router.get("/bottlenecks")
async def get_bottlenecks():
    """Top 5 machines by stress (total hours / capacity)."""
    _require_data()
    from backend.scheduler.stress import compute_stress

    machines = {m.id: m for m in state.engine_data.maquinas}
    stress = compute_stress(state.segments, machines, state.config)

    ranked = sorted(stress.items(), key=lambda kv: kv[1].get("stress_pct", 0), reverse=True)
    top5 = [
        {"maquina_id": mid, **metrics}
        for mid, metrics in ranked[:5]
    ]
    return {"bottlenecks": top5}


# ═══════════════════════════════════════════════════════════════════════════
# ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/coverage")
async def get_coverage():
    _require_data()
    from backend.analytics.coverage_audit import compute_coverage_audit
    from dataclasses import asdict as _asdict
    result = compute_coverage_audit(state.segments, state.engine_data)
    return _asdict(result)


@router.get("/risk")
async def get_risk():
    _require_data()
    if state.risk_result is None:
        raise HTTPException(503, "Risco nao calculado.")
    return asdict(state.risk_result)


@router.get("/stress")
async def get_stress():
    _require_data()
    from backend.scheduler.stress import compute_stress
    machines = {m.id: m for m in state.engine_data.maquinas}
    stress_map = compute_stress(state.segments, machines, state.config)
    return [
        {"maquina_id": mid, **vals}
        for mid, vals in stress_map.items()
    ]


@router.get("/deadlines")
async def get_deadlines():
    """Compute deadline status for each mold."""
    _require_data()
    score = state.score or {}
    violations = {v["molde"]: v for v in score.get("deadline_violations", [])}

    makespan_molde = score.get("makespan_por_molde", {})

    result = []
    for m in state.engine_data.moldes:
        v = violations.get(m.id)
        pendentes = m.total_ops - m.ops_concluidas
        if v:
            result.append({
                "molde": m.id, "deadline": m.deadline,
                "conclusao_prevista": v.get("conclusao_prevista", ""),
                "dias_atraso": v.get("delta_dias", 0),
                "on_time": False,
                "operacoes_pendentes": pendentes,
                "progresso": m.progresso,
            })
        else:
            # For on-time molds, compute conclusao from makespan_por_molde
            dias = makespan_molde.get(m.id, 0)
            conclusao = f"Dia {dias}" if dias > 0 else ""
            result.append({
                "molde": m.id, "deadline": m.deadline,
                "conclusao_prevista": conclusao,
                "dias_atraso": 0,
                "on_time": True,
                "operacoes_pendentes": pendentes,
                "progresso": m.progresso,
            })
    return result


@router.get("/late")
async def get_late_deliveries():
    _require_data()
    if state.late_deliveries is None:
        raise HTTPException(503, "Atrasos nao calculados.")
    return asdict(state.late_deliveries)


@router.get("/ops")
async def get_ops():
    """Return all operations (Moldit Operacao fields)."""
    _require_data()
    return [
        {
            "id": op.id,
            "molde": op.molde,
            "componente": op.componente,
            "nome": op.nome,
            "codigo": op.codigo,
            "nome_completo": op.nome_completo,
            "duracao_h": op.duracao_h,
            "work_h": op.work_h,
            "progresso": op.progresso,
            "work_restante_h": op.work_restante_h,
            "recurso": op.recurso,
            "grupo_recurso": op.grupo_recurso,
            "e_condicional": op.e_condicional,
            "e_2a_placa": op.e_2a_placa,
            "deadline_semana": op.deadline_semana,
            "notas": op.notas,
        }
        for op in state.engine_data.operacoes
    ]


@router.get("/proposals")
async def get_proposals():
    """Replan proposals from analytics engine."""
    _require_data()
    from dataclasses import asdict

    from backend.analytics.replan_proposals import generate_proposals

    report = generate_proposals(
        state.segments, state.engine_data, state.score, state.config,
    )
    return {
        "proposals": [asdict(p) for p in report.proposals],
        "current_makespan": report.current_makespan,
        "current_setups": report.current_setups,
        "summary": report.summary,
    }


@router.get("/rules")
async def get_rules():
    return state.rules
