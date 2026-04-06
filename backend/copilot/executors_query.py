"""Query executors — Spec 10.

10 read-only executors. Each receives args dict, returns JSON string.
Uses Moldit Operacao fields (no Incompol references).
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict

from backend.copilot.state import state

logger = logging.getLogger(__name__)


def _dumps(obj: object) -> str:
    return json.dumps(obj, ensure_ascii=False, default=str)


def _guard() -> str | None:
    """Return error JSON if state is not initialized, else None."""
    if state.engine_data is None:
        return _dumps({"error": "Sem dados carregados."})
    return None


# --- 1. ver_producao_dia ------------------------------------------------

def exec_ver_producao_dia(args: dict) -> str:
    if (err := _guard()):
        return err

    day = args.get("dia", 0)
    by_machine: dict[str, list[dict]] = defaultdict(list)

    for s in state.segments:
        if s.dia == day:
            by_machine[s.maquina_id].append({
                "op_id": s.op_id,
                "molde": s.molde,
                "duracao_h": round(s.duracao_h, 2),
                "setup_h": round(s.setup_h, 2),
                "inicio_h": s.inicio_h,
                "fim_h": s.fim_h,
                "e_2a_placa": s.e_2a_placa,
                "e_continuacao": s.e_continuacao,
            })

    return _dumps({
        "dia": day,
        "maquinas": dict(by_machine),
        "total_segments": sum(len(v) for v in by_machine.values()),
    })


# --- 2. ver_carga_maquinas ----------------------------------------------

def exec_ver_carga_maquinas(args: dict) -> str:
    if (err := _guard()):
        return err

    dia_inicio = args.get("dia_inicio", 0)
    dia_fim = args.get("dia_fim", 30)

    # machine -> day -> total_h
    load: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for s in state.segments:
        if dia_inicio <= s.dia < dia_fim:
            load[s.maquina_id][s.dia] += s.duracao_h + s.setup_h

    # Build result with regime_h as capacity
    machine_regime: dict[str, int] = {}
    for m in state.engine_data.maquinas:
        machine_regime[m.id] = m.regime_h

    result = {}
    for mid, days in sorted(load.items()):
        regime = machine_regime.get(mid, 16)
        result[mid] = {
            str(d): {"horas": round(h, 1), "pct": round(h / regime * 100, 1) if regime > 0 else 0}
            for d, h in sorted(days.items())
        }

    return _dumps({"carga": result, "regime_h_default": 16})


# --- 3. ver_alertas -----------------------------------------------------

def exec_ver_alertas(args: dict) -> str:
    if (err := _guard()):
        return err

    from backend.risk import compute_risk

    risk = state.risk_result or compute_risk(state.segments, state.engine_data)

    alerts = []
    tardy = state.score.get("tardy_count", 0)
    if tardy > 0:
        alerts.append({"tipo": "tardiness", "mensagem": f"{tardy} moldes em atraso"})

    if risk.critical_count > 0:
        alerts.append({
            "tipo": "risco_critico",
            "mensagem": f"{risk.critical_count} itens com risco critico",
        })

    if risk.bottleneck:
        alerts.append({
            "tipo": "bottleneck",
            "mensagem": f"Bottleneck: {risk.bottleneck}",
        })

    alerts.append({
        "tipo": "health_score",
        "mensagem": f"Health score: {risk.health_score}/100",
    })

    # Operator alerts (crew conflicts)
    if state.operator_alerts:
        for oa in state.operator_alerts[:5]:
            alerts.append({
                "tipo": "operadores",
                "mensagem": f"Dia {oa.dia} grupo {oa.grupo_maquina}: deficit {oa.deficit_h:.1f}h",
            })

    # Stress critical recommendations
    if state.stress_map:
        from backend.scheduler.stress import stress_recommendations
        recs = stress_recommendations(state.stress_map, state.lots, state.segments)
        for rec in recs[:3]:
            alerts.append({
                "tipo": "stress",
                "mensagem": f"[P{rec['priority']}] {rec['machine']}: {rec['action']}",
            })

    return _dumps({"alertas": alerts, "health_score": risk.health_score})


# --- 4. ver_score -------------------------------------------------------

def exec_ver_score(args: dict) -> str:
    if (err := _guard()):
        return err
    return _dumps(state.score)


# --- 5. ver_config ------------------------------------------------------

def exec_ver_config(args: dict) -> str:
    if state.config is None:
        return _dumps({"error": "Configuracao nao carregada."})

    c = state.config
    return _dumps({
        "nome": c.name,
        "site": c.site,
        "timezone": c.timezone,
        "turnos": [
            {"id": s.id, "inicio_min": s.start_min, "fim_min": s.end_min,
             "duracao_min": s.duration_min, "label": s.label}
            for s in c.shifts
        ],
        "day_capacity_min": c.day_capacity_min,
        "maquinas": {
            mid: {"grupo": m.group, "activa": m.active, "regime_h": m.regime_h}
            for mid, m in c.machines.items()
        },
        "n_ferramentas": len(c.tools),
        "n_feriados": len(c.holidays),
        "weight_makespan": c.weight_makespan,
        "weight_deadline_compliance": c.weight_deadline_compliance,
        "weight_setups": c.weight_setups,
        "weight_balance": c.weight_balance,
    })


# --- 6. explicar_referencia (now explicar_operacao) ---------------------

def exec_explicar_referencia(args: dict) -> str:
    if (err := _guard()):
        return err

    # Accept op_id (int) or molde+codigo search
    op_id = args.get("op_id")
    molde = args.get("molde", "")
    codigo = args.get("codigo", "")

    op = None
    if op_id is not None:
        op = next((o for o in state.engine_data.operacoes if o.id == int(op_id)), None)
    elif molde:
        op = next((o for o in state.engine_data.operacoes
                    if o.molde == molde and (not codigo or o.codigo == codigo)), None)

    if not op:
        return _dumps({
            "error": (
                f"Operacao nao encontrada "
                f"(op_id={op_id}, molde={molde}, codigo={codigo})."
            ),
        })

    n_segs = sum(1 for s in state.segments if s.op_id == op.id)

    return _dumps({
        "id": op.id,
        "molde": op.molde,
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
        "n_segments": n_segs,
    })


# --- 7. explicar_decisao ------------------------------------------------

def exec_explicar_decisao(args: dict) -> str:
    if (err := _guard()):
        return err

    if not state.audit_store or not state.schedule_id:
        return _dumps({
            "aviso": "Sem decisoes registadas. Usa recalcular_plano primeiro.",
        })

    op_id = args.get("op_id")
    molde = args.get("molde", "")
    subject_id = str(op_id) if op_id else molde

    decisions = state.audit_store.load_decisions(
        state.schedule_id, subject_id=subject_id,
    )

    return _dumps({
        "op_id": op_id,
        "molde": molde,
        "schedule_id": state.schedule_id,
        "decisoes": decisions[:20],
    })


# --- 8. explicar_logica -------------------------------------------------

_LOGIC_EXPLANATIONS = {
    "dispatch": (
        "Dispatch: o scheduler atribui operacoes a maquinas por prioridade. "
        "Criterios: caminho critico, deadline, work restante, dependencias DAG."
    ),
    "caminho_critico": (
        "Caminho critico: sequencia de operacoes que determina o makespan do molde. "
        "Calculado via DAG (grafo aciclico dirigido) com duracao como peso."
    ),
    "2a_placa": (
        "2a Placa (//): paralelismo na mesma maquina CNC. "
        "Duas operacoes correm em simultaneo, partilhando a maquina."
    ),
    "scoring": (
        "Scoring: 4 componentes com pesos -- makespan (0.35), deadline_compliance (0.35), "
        "setups (0.15), balance (0.15). Configuraveis via presets."
    ),
    "vns": (
        "VNS (Variable Neighbourhood Search): pos-processamento que melhora o plano. "
        "4 vizinhancas: swap, move, resequence, shift."
    ),
    "dependencias": (
        "Dependencias FS (Finish-to-Start): uma operacao so pode comecar quando "
        "a predecessora terminar. Respeita lags definidos no MPP."
    ),
    "compatibilidade": (
        "Compatibilidade: mapeia operacoes a maquinas compativeis. "
        "Cada operacao pode correr em multiplas maquinas do mesmo grupo."
    ),
}


def exec_explicar_logica(args: dict) -> str:
    conceito = args.get("conceito", "")
    text = _LOGIC_EXPLANATIONS.get(conceito)
    if not text:
        return _dumps({
            "error": f"Conceito '{conceito}' desconhecido.",
            "disponiveis": list(_LOGIC_EXPLANATIONS.keys()),
        })
    return _dumps({"conceito": conceito, "explicacao": text})


# --- 9. ver_encomendas --------------------------------------------------

def exec_ver_encomendas(args: dict) -> str:
    if (err := _guard()):
        return err

    # Return molde list with deadlines as "orders"
    moldes = []
    for m in state.engine_data.moldes:
        moldes.append({
            "molde": m.id,
            "cliente": m.cliente,
            "deadline": m.deadline,
            "progresso": m.progresso,
            "total_work_h": m.total_work_h,
        })
    return _dumps({"moldes": moldes})


# --- 10. ver_historico --------------------------------------------------

def exec_ver_historico(args: dict) -> str:
    from backend.learning.store import LearnStore

    limite = args.get("limite", 20)
    store = LearnStore()
    history = store.load_history(limit=limite)

    return _dumps({"estudos": history})


# --- 11. ver_stress -----------------------------------------------------

def exec_ver_stress(args: dict) -> str:
    if (err := _guard()):
        return err

    from backend.scheduler.stress import (
        compute_stress_map,
        stress_recommendations,
        stress_summary,
    )

    smap = state.stress_map or compute_stress_map(
        state.segments, state.lots, state.engine_data.n_days,
        n_holidays=len(state.engine_data.feriados or []),
    )
    summary = stress_summary(smap)
    recs = stress_recommendations(smap, state.lots, state.segments)

    return _dumps({"resumo": summary, "recomendacoes": recs})


# --- 12. e_se (counterfactual) ------------------------------------------

def exec_e_se(args: dict) -> str:
    """Counterfactual: 'E se a operacao X estivesse na maquina Y?'"""
    if (err := _guard()):
        return err

    from backend.audit.counterfactual import compute_counterfactual

    question_type = args.get("tipo", "force_machine")
    params = args.get("params", {})

    result = compute_counterfactual(
        question_type, params,
        state.engine_data, state.score, config=state.config,
    )

    return _dumps({
        "pergunta": f"{question_type}: {params}",
        "score_original": result.original_score,
        "score_alternativo": result.alternative_score,
        "conclusao": result.conclusion,
        "time_ms": result.time_ms,
    })
