"""Visualization executors — Spec 10.

8 executors returning JSON with viz_type + data for frontend widgets.
Uses Moldit types (no Incompol references).
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
    if state.engine_data is None:
        return _dumps({"error": "Sem dados carregados."})
    return None


# --- 1. visualizar_stock ------------------------------------------------

def exec_visualizar_stock(args: dict) -> str:
    if (err := _guard()):
        return err
    return _dumps({"error": "Not available in Moldit -- no stock concept"})


# --- 2. visualizar_carga_temporal ----------------------------------------

def exec_visualizar_carga_temporal(args: dict) -> str:
    if (err := _guard()):
        return err

    dia_inicio = args.get("dia_inicio", 0)
    dia_fim = args.get("dia_fim", 30)

    # machine -> day -> total_h
    load: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for s in state.segments:
        if dia_inicio <= s.dia < dia_fim:
            load[s.maquina_id][s.dia] += s.duracao_h + s.setup_h

    machines = sorted(load.keys())
    days = list(range(dia_inicio, dia_fim))

    # Get regime per machine
    machine_regime: dict[str, int] = {}
    for m in state.engine_data.maquinas:
        machine_regime[m.id] = m.regime_h

    series = []
    for mid in machines:
        regime = machine_regime.get(mid, 16)
        values = [round(load[mid].get(d, 0) / regime * 100, 1) if regime > 0 else 0 for d in days]
        series.append({"name": mid, "values": values})

    return _dumps({
        "viz_type": "bar_chart",
        "title": "Carga maquinas (%)",
        "data": {
            "labels": [str(d) for d in days],
            "series": series,
        },
    })


# --- 3. visualizar_risco_heatmap ----------------------------------------

def exec_visualizar_risco_heatmap(args: dict) -> str:
    if (err := _guard()):
        return err

    from backend.risk import compute_risk

    risk = state.risk_result or compute_risk(state.segments, state.engine_data)

    cells = []
    for cell in risk.heatmap:
        cells.append({
            "maquina": cell.machine_id,
            "dia": cell.day_idx,
            "utilizacao": round(cell.utilization, 2),
            "risco": cell.risk_level,
        })

    return _dumps({
        "viz_type": "heatmap",
        "title": "Risco (maquina x dia)",
        "data": {"cells": cells},
        "meta": {
            "health_score": risk.health_score,
            "critical_count": risk.critical_count,
            "bottleneck": risk.bottleneck,
        },
    })


# --- 4. visualizar_encomendas -------------------------------------------

def exec_visualizar_encomendas(args: dict) -> str:
    if (err := _guard()):
        return err

    rows = []
    for m in state.engine_data.moldes:
        rows.append({
            "molde": m.id,
            "cliente": m.cliente,
            "deadline": m.deadline,
            "progresso": m.progresso,
            "total_work_h": m.total_work_h,
        })

    return _dumps({
        "viz_type": "table",
        "title": "Moldes",
        "data": {
            "columns": ["molde", "cliente", "deadline", "progresso", "total_work_h"],
            "rows": rows,
        },
    })


# --- 5. visualizar_expedicao -------------------------------------------

def exec_visualizar_expedicao(args: dict) -> str:
    if (err := _guard()):
        return err
    return _dumps({"error": "Not available in Moldit -- use /moldes endpoint"})


# --- 6. visualizar_gantt ------------------------------------------------

def exec_visualizar_gantt(args: dict) -> str:
    if (err := _guard()):
        return err

    maquina_filter = args.get("maquina")
    dia_inicio = args.get("dia_inicio", 0)
    dia_fim = args.get("dia_fim", 10)

    events = []
    for s in state.segments:
        if s.dia < dia_inicio or s.dia >= dia_fim:
            continue
        if maquina_filter and s.maquina_id != maquina_filter:
            continue

        events.append({
            "maquina": s.maquina_id,
            "molde": s.molde,
            "op_id": s.op_id,
            "dia": s.dia,
            "inicio_h": s.inicio_h,
            "fim_h": s.fim_h,
            "duracao_h": round(s.duracao_h, 2),
            "setup_h": round(s.setup_h, 2),
            "e_2a_placa": s.e_2a_placa,
            "e_continuacao": s.e_continuacao,
        })

    return _dumps({
        "viz_type": "timeline",
        "title": "Gantt",
        "data": {"events": events},
    })


# --- 7. visualizar_comparacao -------------------------------------------

def exec_visualizar_comparacao(args: dict) -> str:
    if (err := _guard()):
        return err

    from backend.simulator.simulator import Mutation, simulate

    mutacoes_raw = args.get("mutacoes", [])
    mutations = [
        Mutation(type=m["type"], params=m.get("params", {}))
        for m in mutacoes_raw
    ]

    result = simulate(
        state.engine_data, state.score, mutations, config=state.config,
    )

    return _dumps({
        "viz_type": "kpi_compare",
        "title": "Comparacao: actual vs cenario",
        "data": {
            "baseline": {
                "otd": result.delta.otd_before,
                "otd_d": result.delta.otd_d_before,
                "setups": result.delta.setups_before,
                "tardy": result.delta.tardy_before,
                "earliness": result.delta.earliness_before,
            },
            "cenario": {
                "otd": result.delta.otd_after,
                "otd_d": result.delta.otd_d_after,
                "setups": result.delta.setups_after,
                "tardy": result.delta.tardy_after,
                "earliness": result.delta.earliness_after,
            },
        },
        "meta": {
            "time_ms": result.time_ms,
            "resumo": result.summary,
        },
    })


# --- 8. visualizar_learning ---------------------------------------------

def exec_visualizar_learning(args: dict) -> str:
    from backend.learning.store import LearnStore

    store = LearnStore()
    history = store.load_history(limit=20)

    labels = []
    reward_series = []
    baseline_series = []

    for entry in history:
        labels.append(entry.get("created_at", ""))
        reward_series.append(entry.get("reward", 0))
        baseline_series.append(entry.get("baseline_reward", 0))

    return _dumps({
        "viz_type": "line_chart",
        "title": "Aprendizagem ao longo do tempo",
        "data": {
            "labels": labels,
            "series": [
                {"name": "Reward (optimizado)", "values": reward_series},
                {"name": "Reward (baseline)", "values": baseline_series},
            ],
        },
    })


# --- 9. visualizar_atrasos ---------------------------------------------

def exec_visualizar_atrasos(args: dict) -> str:
    if (err := _guard()):
        return err

    from backend.analytics.late_delivery import analyze_late_deliveries

    late = state.late_deliveries or analyze_late_deliveries(
        state.segments, state.lots, state.engine_data, state.config,
    )

    rows = []
    for a in late.analyses:
        rows.append({
            "molde": a.molde if hasattr(a, "molde") else getattr(a, "lot_id", ""),
            "completion_day": a.completion_day,
            "delay_days": a.delay_days,
            "root_cause": a.root_cause,
            "suggestion": a.suggestion,
        })

    return _dumps({
        "viz_type": "table",
        "title": f"Atrasos ({late.tardy_count})",
        "data": {
            "columns": ["molde", "completion_day", "delay_days", "root_cause", "suggestion"],
            "rows": rows,
        },
        "meta": {
            "tardy_count": late.tardy_count,
            "avg_delay": late.avg_delay_days,
            "summary": late.summary,
        },
    })


# --- 10. visualizar_workforce -------------------------------------------

def exec_visualizar_workforce(args: dict) -> str:
    if (err := _guard()):
        return err
    return _dumps({"error": "Not yet available in Moldit"})


# --- 11. visualizar_cobertura -------------------------------------------

def exec_visualizar_cobertura(args: dict) -> str:
    if (err := _guard()):
        return err

    from backend.analytics.coverage_audit import compute_coverage_audit

    cov = state.coverage or compute_coverage_audit(
        state.segments, state.engine_data,
    )

    rows = []
    for c in cov.molds:
        rows.append({
            "molde": c.molde_id,
            "total_ops": c.total_ops,
            "ops_agendadas": c.ops_agendadas,
            "cobertura_pct": c.cobertura_pct,
            "ops_sem_maquina": c.ops_sem_maquina,
        })

    return _dumps({
        "viz_type": "table",
        "title": f"Cobertura ({cov.overall_coverage_pct:.0f}%)",
        "data": {
            "columns": ["molde", "total_ops", "ops_agendadas", "cobertura_pct", "ops_sem_maquina"],
            "rows": rows,
        },
        "meta": {
            "overall_coverage_pct": cov.overall_coverage_pct,
            "uncovered_ops": cov.uncovered_ops,
            "summary": cov.summary,
        },
    })


# --- 12. visualizar_propostas -------------------------------------------

def exec_visualizar_propostas(args: dict) -> str:
    if (err := _guard()):
        return err

    from backend.analytics.replan_proposals import generate_proposals

    report = generate_proposals(
        state.segments, state.lots, state.engine_data, state.score, state.config,
    )

    rows = []
    for p in report.proposals:
        rows.append({
            "id": p.id,
            "tipo": p.type,
            "descricao": p.description,
            "impacto": p.estimated_impact,
            "prioridade": p.priority,
            "maquina_de": p.machine_from,
            "maquina_para": p.machine_to,
        })

    return _dumps({
        "viz_type": "table",
        "title": f"Propostas de Melhoria ({len(report.proposals)})",
        "data": {
            "columns": [
                "id", "tipo", "descricao", "impacto",
                "prioridade", "maquina_de", "maquina_para",
            ],
            "rows": rows,
        },
        "meta": {
            "current_tardy": report.current_tardy,
            "current_setups": report.current_setups,
            "summary": report.summary,
        },
    })
