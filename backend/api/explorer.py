"""Mold Explorer API endpoints."""
from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.copilot.state import state
from backend.scheduler.flexibility import classify_operations, count_compatible_machines
from backend.scheduler.impact import (
    ImpactResult,
    compute_impact,
    compute_timing_window,
    find_valid_swaps,
)
from backend.scheduler.slack import compute_slack

router = APIRouter(prefix="/api/explorer", tags=["explorer"])


def _require_data():
    """Raise 503 if no data loaded."""
    if state.engine_data is None:
        raise HTTPException(503, "Sem dados carregados.")


# ── GET /api/explorer/moldes/{molde_id} ─────────────────────────────────


@router.get("/moldes/{molde_id}")
async def get_explorer_data(molde_id: str):
    """Explorer data for a mold: ops with flexibility, ghost bars, dependencies."""
    _require_data()
    data = state.engine_data
    segmentos = state.segments

    # Find mold
    molde = next((m for m in data.moldes if m.id == molde_id), None)
    if not molde:
        raise HTTPException(404, f"Molde {molde_id} nao encontrado.")

    # Compute slack and flexibility
    slacks = compute_slack(data, segmentos)
    flex = classify_operations(data, segmentos, slacks)

    # Build ops for this mold
    ops_by_id = {op.id: op for op in data.operacoes}
    mold_op_ids = {op.id for op in data.operacoes if op.molde == molde_id}

    # Segment info per op: earliest segment start, latest segment end
    op_segments: dict[int, list] = {}
    for s in segmentos:
        op_segments.setdefault(s.op_id, []).append(s)

    # Machines used by this mold
    mold_machines: set[str] = set()
    for op_id in mold_op_ids:
        for s in op_segments.get(op_id, []):
            mold_machines.add(s.maquina_id)

    operacoes: list[dict[str, Any]] = []
    for op_id in mold_op_ids:
        op = ops_by_id.get(op_id)
        if op is None:
            continue
        segs = op_segments.get(op_id, [])
        if not segs:
            continue

        first_seg = min(segs, key=lambda s: (s.dia, s.inicio_h))
        last_seg = max(segs, key=lambda s: (s.dia, s.fim_h))
        total_work = sum(s.duracao_h for s in segs)
        total_setup = sum(s.setup_h for s in segs)

        slack_info = slacks.get(op_id)
        timing = compute_timing_window(op_id, data, segmentos, slacks)

        predecessors = [p for p in data.dag_reverso.get(op_id, []) if p in mold_op_ids]
        successors = [s for s in data.dag.get(op_id, []) if s in mold_op_ids]

        operacoes.append({
            "op_id": op_id,
            "nome": op.nome,
            "codigo": op.codigo,
            "maquina": first_seg.maquina_id,
            "dia": first_seg.dia,
            "inicio_h": first_seg.inicio_h,
            "fim_h": last_seg.fim_h,
            "work_h": round(total_work, 2),
            "setup_h": round(total_setup, 2),
            "predecessores": predecessors,
            "sucessores": successors,
            "slack_h": slack_info.slack_h if slack_info else 0.0,
            "maquinas_alternativas": count_compatible_machines(op, data),
            "no_caminho_critico": slack_info.no_caminho_critico if slack_info else False,
            "flexibilidade": flex.get(op_id, "azul"),
            "earliest_start": timing["earliest"],
            "latest_start": timing["latest"],
        })

    # Ghost bars: other mold ops on same machines
    fantasmas: list[dict[str, Any]] = []
    for s in segmentos:
        if s.molde == molde_id:
            continue
        if s.maquina_id in mold_machines:
            fantasmas.append({
                "op_id": s.op_id,
                "molde": s.molde,
                "maquina": s.maquina_id,
                "dia": s.dia,
                "inicio_h": s.inicio_h,
                "fim_h": s.fim_h,
            })

    # Dependencies within this mold
    dependencias: list[dict[str, Any]] = []
    for dep in data.dependencias:
        if dep.predecessor_id in mold_op_ids and dep.sucessor_id in mold_op_ids:
            pred_slack = slacks.get(dep.predecessor_id)
            succ_slack = slacks.get(dep.sucessor_id)
            no_critico = (
                (pred_slack.no_caminho_critico if pred_slack else False)
                and (succ_slack.no_caminho_critico if succ_slack else False)
            )
            dependencias.append({
                "de": dep.predecessor_id,
                "para": dep.sucessor_id,
                "no_critico": no_critico,
            })

    # Mold status
    status = "em_curso"
    if molde.progresso >= 100.0:
        status = "concluido"
    elif molde.progresso == 0.0:
        status = "por_iniciar"

    return {
        "molde": {
            "id": molde.id,
            "deadline": molde.deadline,
            "progresso": molde.progresso,
            "status": status,
        },
        "operacoes": operacoes,
        "fantasmas": fantasmas,
        "dependencias": dependencias,
    }


# ── GET /api/explorer/operacoes/{op_id}/opcoes ──────────────────────────


@router.get("/operacoes/{op_id}/opcoes")
async def get_op_options(op_id: int):
    """Options for one operation: compatible machines, timing, swaps."""
    _require_data()
    data = state.engine_data
    segmentos = state.segments

    op = next((o for o in data.operacoes if o.id == op_id), None)
    if not op:
        raise HTTPException(404, f"Operacao {op_id} nao encontrada.")

    slacks = compute_slack(data, segmentos)

    # Current position
    op_segs = [s for s in segmentos if s.op_id == op_id]
    if op_segs:
        first = min(op_segs, key=lambda s: (s.dia, s.inicio_h))
        last = max(op_segs, key=lambda s: (s.dia, s.fim_h))
        situacao_atual = {
            "maquina": first.maquina_id,
            "dia": first.dia,
            "inicio": first.inicio_h,
            "fim": last.fim_h,
        }
    else:
        situacao_atual = {"maquina": "", "dia": 0, "inicio": 0, "fim": 0}

    # Compatible machines with impact preview
    candidates = data.compatibilidade.get(op.codigo, [])
    machine_ids = {m.id for m in data.maquinas}
    current_machine = situacao_atual["maquina"]

    opcoes_maquina: list[dict] = []
    for mid in candidates:
        if mid not in machine_ids or mid == current_machine:
            continue
        # Compute impact
        impact = compute_impact(
            op_id, mid, data, segmentos, state.score, config=state.config,
        )
        opcoes_maquina.append({
            "maquina": mid,
            "dia": 0,  # will be determined by scheduler
            "inicio": 0,
            "fim": 0,
            "setup_delta": 0,
            "impacto": {
                "makespan_delta": impact.makespan_delta,
                "compliance_delta": impact.compliance_delta,
                "setups_delta": impact.setups_delta,
                "balance_delta": impact.balance_delta,
                "score_delta": impact.score_delta,
            },
            "cascata": impact.cascata,
        })

    # Timing window
    timing = compute_timing_window(op_id, data, segmentos, slacks)

    # Valid swaps
    swaps = find_valid_swaps(op_id, segmentos, data)

    return {
        "op_id": op_id,
        "situacao_atual": situacao_atual,
        "opcoes_maquina": opcoes_maquina,
        "opcoes_timing": timing,
        "opcoes_sequencia": swaps,
    }


# ── POST /api/explorer/operacoes/{op_id}/preview ────────────────────────


class PreviewRequest(BaseModel):
    target_machine: str
    target_day: int | None = None


@router.post("/operacoes/{op_id}/preview")
async def preview_change(op_id: int, request: PreviewRequest):
    """Preview impact of a change."""
    _require_data()
    data = state.engine_data
    segmentos = state.segments

    op = next((o for o in data.operacoes if o.id == op_id), None)
    if not op:
        raise HTTPException(404, f"Operacao {op_id} nao encontrada.")

    impact = compute_impact(
        op_id, request.target_machine, data, segmentos, state.score,
        config=state.config,
    )

    return {
        "op_id": op_id,
        "target_machine": request.target_machine,
        "impacto": {
            "makespan_delta": impact.makespan_delta,
            "compliance_delta": impact.compliance_delta,
            "setups_delta": impact.setups_delta,
            "balance_delta": impact.balance_delta,
            "score_delta": impact.score_delta,
        },
        "cascata": impact.cascata,
    }


# ── POST /api/explorer/operacoes/{op_id}/apply ──────────────────────────


class ApplyRequest(BaseModel):
    target_machine: str


@router.post("/operacoes/{op_id}/apply")
async def apply_change(op_id: int, request: ApplyRequest):
    """Apply change: modify data, re-schedule, update state."""
    _require_data()
    data = state.engine_data

    op = next((o for o in data.operacoes if o.id == op_id), None)
    if not op:
        raise HTTPException(404, f"Operacao {op_id} nao encontrada.")

    # Modify data
    op.recurso = request.target_machine

    # Re-schedule
    from backend.scheduler.scheduler import schedule_all

    async with state.lock:
        result = schedule_all(data, audit=True, config=state.config)
        state.update_schedule(result)

    # Return new explorer data
    return await get_explorer_data(op.molde)


# ── POST /api/explorer/operacoes/{op_id}/complete ─────────────────────


class CompleteOpRequest(BaseModel):
    work_h_real: float
    setup_h_real: float = 0.0
    motivo_desvio: str = ""
    reportado_por: str = ""


@router.post("/operacoes/{op_id}/complete")
async def complete_operation(op_id: int, request: CompleteOpRequest):
    """Mark operation as complete and record execution data."""
    if state.engine_data is None:
        raise HTTPException(503, "Sem dados carregados.")
    data = state.engine_data

    op = next((o for o in data.operacoes if o.id == op_id), None)
    if not op:
        raise HTTPException(404, f"Operacao {op_id} nao encontrada.")

    # Record in execution store
    from backend.learning.execution_store import ExecutionStore

    if not hasattr(state, "_exec_store") or state._exec_store is None:
        state._exec_store = ExecutionStore()

    # Find planned segment for this op
    op_segs = [s for s in state.segments if s.op_id == op_id]
    dia_planeado = op_segs[0].dia if op_segs else 0
    setup_h_planeado = op_segs[0].setup_h if op_segs else 0.0

    state._exec_store.log_completion(
        op_id=op.id, molde=op.molde,
        maquina_id=op.recurso or "",
        codigo=op.codigo,
        work_h_planeado=op.work_h,
        work_h_real=request.work_h_real,
        setup_h_planeado=setup_h_planeado,
        setup_h_real=request.setup_h_real,
        dia_planeado=dia_planeado,
        dia_real=dia_planeado,  # Assume same day unless specified
        motivo_desvio=request.motivo_desvio,
        reportado_por=request.reportado_por,
    )

    # Update operation progress
    op.progresso = 100.0
    op.work_restante_h = 0.0

    # Re-schedule
    from backend.scheduler.scheduler import schedule_all

    async with state.lock:
        result = schedule_all(data, audit=True, config=state.config)
        state.update_schedule(result)

    return {
        "status": "ok",
        "op_id": op_id,
        "score": state.score,
    }
