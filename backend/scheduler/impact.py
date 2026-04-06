"""Impact analysis for operation changes."""
from __future__ import annotations

import copy
from dataclasses import dataclass, field

from backend.scheduler.scheduler import schedule_all
from backend.scheduler.scoring import compute_score
from backend.scheduler.slack import SlackInfo
from backend.scheduler.types import ScheduleResult, SegmentoMoldit
from backend.types import MolditEngineData


@dataclass
class ImpactResult:
    makespan_delta: int = 0
    compliance_delta: float = 0.0
    setups_delta: int = 0
    balance_delta: float = 0.0
    score_delta: float = 0.0
    cascata: list[dict] = field(default_factory=list)


def compute_impact(
    op_id: int,
    target_machine: str,
    data: MolditEngineData,
    current_segmentos: list[SegmentoMoldit],
    current_score: dict,
    config=None,
) -> ImpactResult:
    """Compute impact of moving an operation to a different machine."""
    # 1. Deep copy data
    new_data = copy.deepcopy(data)

    # 2. Set op.recurso = target_machine in the copy
    for op in new_data.operacoes:
        if op.id == op_id:
            op.recurso = target_machine
            break

    # 3. Run schedule_all on modified data
    try:
        new_result = schedule_all(new_data, config=config)
    except Exception:
        return ImpactResult()

    new_score = new_result.score

    # 4. Compare scores
    mk_before = current_score.get("makespan_total_dias", 0)
    mk_after = new_score.get("makespan_total_dias", 0)

    dc_before = current_score.get("deadline_compliance", 0.0)
    dc_after = new_score.get("deadline_compliance", 0.0)

    st_before = current_score.get("total_setups", 0)
    st_after = new_score.get("total_setups", 0)

    bal_before = current_score.get("utilization_balance", 0.0)
    bal_after = new_score.get("utilization_balance", 0.0)

    ws_before = current_score.get("weighted_score", 0.0)
    ws_after = new_score.get("weighted_score", 0.0)

    # 5. Find cascade: ops from other molds that moved
    old_positions: dict[int, tuple[str, int, float]] = {}
    for s in current_segmentos:
        key = s.op_id
        if key not in old_positions:
            old_positions[key] = (s.maquina_id, s.dia, s.inicio_h)

    # Find the mold of the changed op
    op_molde = ""
    for op in data.operacoes:
        if op.id == op_id:
            op_molde = op.molde
            break

    cascata: list[dict] = []
    new_positions: dict[int, tuple[str, int, float]] = {}
    for s in new_result.segmentos:
        key = s.op_id
        if key not in new_positions:
            new_positions[key] = (s.maquina_id, s.dia, s.inicio_h)

    ops_by_id = {op.id: op for op in data.operacoes}
    for oid, new_pos in new_positions.items():
        if oid == op_id:
            continue
        op = ops_by_id.get(oid)
        if op is None or op.molde == op_molde:
            continue
        old_pos = old_positions.get(oid)
        if old_pos is None:
            continue
        if old_pos != new_pos:
            # Determine effect and severity
            day_diff = new_pos[1] - old_pos[1]
            if day_diff > 0:
                efeito = f"adiado {day_diff}d"
                severidade = "alto" if day_diff > 2 else "medio"
            elif day_diff < 0:
                efeito = f"antecipado {-day_diff}d"
                severidade = "baixo"
            elif new_pos[0] != old_pos[0]:
                efeito = f"movido para {new_pos[0]}"
                severidade = "medio"
            else:
                efeito = "reagendado"
                severidade = "baixo"

            cascata.append({
                "op_id": oid,
                "molde": op.molde,
                "efeito": efeito,
                "severidade": severidade,
            })

    return ImpactResult(
        makespan_delta=mk_after - mk_before,
        compliance_delta=round(dc_after - dc_before, 4),
        setups_delta=st_after - st_before,
        balance_delta=round(bal_after - bal_before, 4),
        score_delta=round(ws_after - ws_before, 4),
        cascata=cascata[:20],  # limit cascade list
    )


def compute_timing_window(
    op_id: int,
    data: MolditEngineData,
    segmentos: list[SegmentoMoldit],
    slacks: dict[int, SlackInfo],
) -> dict:
    """Return {earliest: {dia, hora}, latest: {dia, hora}, atual: {dia, hora}}."""
    # Find current position
    current_dia = 0
    current_hora = 0.0
    for s in segmentos:
        if s.op_id == op_id:
            current_dia = s.dia
            current_hora = s.inicio_h
            break

    slack_info = slacks.get(op_id)
    if slack_info is None:
        return {
            "earliest": {"dia": current_dia, "hora": current_hora},
            "latest": {"dia": current_dia, "hora": current_hora},
            "atual": {"dia": current_dia, "hora": current_hora},
        }

    # Convert absolute hours to (dia, hora) using 16h working day
    _DAY_H = 16  # working hours per day (matches CNC regime)
    _DAY_START = 7.0  # day starts at 7:00
    es_h = slack_info.earliest_start_h
    ls_h = slack_info.latest_start_h

    earliest_dia = int(es_h // _DAY_H)
    earliest_hora = round(es_h % _DAY_H + _DAY_START, 1)

    latest_dia = int(ls_h // _DAY_H)
    latest_hora = round(ls_h % _DAY_H + _DAY_START, 1)

    return {
        "earliest": {"dia": earliest_dia, "hora": earliest_hora},
        "latest": {"dia": latest_dia, "hora": latest_hora},
        "atual": {"dia": current_dia, "hora": current_hora},
    }


def find_valid_swaps(
    op_id: int,
    segmentos: list[SegmentoMoldit],
    data: MolditEngineData,
) -> list[dict]:
    """Find operations on same machine that can be swapped without violating DAG."""
    # Find machine for this op
    op_machine = None
    for s in segmentos:
        if s.op_id == op_id:
            op_machine = s.maquina_id
            break
    if op_machine is None:
        return []

    # Find other ops on the same machine
    other_ops = {s.op_id for s in segmentos if s.maquina_id == op_machine and s.op_id != op_id}

    # Get ancestors and descendants
    from backend.scheduler.flexibility import _get_all_ancestors, _get_all_descendants
    ancestors = _get_all_ancestors(op_id, data.dag_reverso)
    descendants = _get_all_descendants(op_id, data.dag)

    ops_by_id = {op.id: op for op in data.operacoes}
    swaps: list[dict] = []

    for other_id in other_ops:
        if other_id in ancestors or other_id in descendants:
            continue
        other_op = ops_by_id.get(other_id)
        if other_op is None:
            continue
        swaps.append({
            "trocar_com": other_id,
            "descricao": f"{other_op.nome} ({other_op.molde})",
            "setup_delta": 0,  # simplified; full implementation would compute real setup delta
        })

    return swaps[:10]  # limit
