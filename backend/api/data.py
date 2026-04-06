"""Data REST API — direct endpoints for the frontend.

Moldit endpoints as thin wrappers over CopilotState.
All analytics are pre-computed in state._refresh_analytics().
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import asdict

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
# CORE
# ═══════════════════════════════════════════════════════════════════════════


@router.get("/today")
async def get_today():
    """Return today's day_idx based on workdays calendar."""
    _require_data()
    import datetime as _dt
    today = _dt.date.today().isoformat()
    data = state.engine_data
    # Use data_referencia as fallback
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

    # Sort by stress_pct descending, take top 5
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
    # Convert dict to list matching MaquinaStatus[]
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
            result.append({
                "molde": m.id, "deadline": m.deadline,
                "conclusao_prevista": "",
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


# ═══════════════════════════════════════════════════════════════════════════
# CONFIG / MASTER DATA
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


@router.get("/rules")
async def get_rules():
    return state.rules


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
# ACTIONS
# ═══════════════════════════════════════════════════════════════════════════


class MutationInput(BaseModel):
    type: str
    params: dict = {}


class SimulateRequest(BaseModel):
    mutations: list[MutationInput]


@router.post("/simulate")
async def simulate_scenario(request: SimulateRequest):
    _require_data()
    from backend.simulator.simulator import Mutation, simulate

    mutations = [Mutation(type=m.type, params=m.params) for m in request.mutations]
    result = simulate(state.engine_data, state.score, mutations, config=state.config)

    return {
        "score_baseline": state.score,
        "score_scenario": result.score,
        "delta": asdict(result.delta),
        "time_ms": result.time_ms,
        "summary": result.summary,
    }


@router.post("/simulate-apply")
async def simulate_and_apply(request: SimulateRequest):
    """Run simulation and apply result as active schedule. Saves snapshot for revert."""
    _require_data()
    from backend.simulator.simulator import Mutation, simulate

    old_score = dict(state.score) if state.score else {}
    old_n = len(state.segments)

    state.save_current()

    mutations = [Mutation(type=m.type, params=m.params) for m in request.mutations]
    result = simulate(state.engine_data, old_score, mutations, config=state.config)

    state.update_schedule(result)

    return {
        "status": "applied",
        "score": result.score,
        "score_previous": old_score,
        "summary": result.summary,
        "n_segments_before": old_n,
        "n_segments_after": len(result.segmentos),
        "time_ms": result.time_ms,
        "can_revert": True,
    }


@router.post("/revert")
async def revert_simulation():
    """Revert to schedule saved before simulate-apply."""
    _require_data()
    if not state.saved_schedule:
        raise HTTPException(400, "Nada para reverter.")
    state.update_schedule(state.saved_schedule)
    state.saved_schedule = None
    return {"status": "reverted", "score": state.score}


@router.get("/can-revert")
async def can_revert():
    """Check if there is a saved schedule to revert to."""
    return {"can_revert": state.saved_schedule is not None}


class CTPRequest(BaseModel):
    molde_id: str
    target_week: str


@router.post("/ctp")
async def check_ctp(request: CTPRequest):
    _require_data()
    from backend.analytics.ctp import compute_ctp_molde

    result = compute_ctp_molde(
        request.molde_id, request.target_week,
        state.segments, state.engine_data, config=state.config,
    )
    return {
        "molde_id": result.molde_id,
        "target_week": result.target_week,
        "feasible": result.feasible,
        "slack_dias": result.slack_dias,
        "dias_extra": result.dias_extra,
        "reason": result.reason,
    }


@router.post("/recalculate")
async def recalculate():
    _require_data()
    from backend.scheduler.scheduler import schedule_all

    old_score = dict(state.score) if state.score else {}
    result = schedule_all(state.engine_data, audit=True, config=state.config)
    state.update_schedule(result)

    return {
        "status": "ok",
        "score": result.score,
        "score_previous": old_score,
        "time_ms": result.time_ms,
        "n_segments": len(result.segmentos),
        "warnings": result.warnings[:10],
    }


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


# ── Module A: Execution tracking & Calibration ──────────────────────


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


def _get_exec_store():
    from backend.learning.execution_store import ExecutionStore
    if not hasattr(state, "_exec_store") or state._exec_store is None:
        state._exec_store = ExecutionStore()
    return state._exec_store


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
