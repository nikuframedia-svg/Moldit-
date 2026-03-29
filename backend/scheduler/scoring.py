"""Phase 3 — Scoring: Moldit Planner.

Compute KPIs from a schedule (list of SegmentoMoldit).
"""

from __future__ import annotations

import math
from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData


def _parse_deadline_to_days(deadline: str) -> int | None:
    """Parse 'S15' -> ~75 working days (15*5). Returns None if empty."""
    if not deadline:
        return None
    d = deadline.strip().upper()
    if d.startswith("S") and d[1:].isdigit():
        return int(d[1:]) * 5
    return None


def compute_score(
    segmentos: list[SegmentoMoldit],
    data: MolditEngineData,
    config: FactoryConfig | None = None,
) -> dict:
    """Compute schedule quality metrics.

    Returns dict with: makespan_total_dias, makespan_por_molde,
    deadline_compliance, total_setups, utilization, utilization_balance,
    weighted_score, ops_agendadas, ops_total.
    """
    if config is None:
        from backend.config.loader import load_config
        config = load_config()

    if not segmentos:
        return {
            "makespan_total_dias": 0,
            "makespan_por_molde": {},
            "deadline_compliance": 0.0,
            "total_setups": 0,
            "utilization": {},
            "utilization_balance": 0.0,
            "weighted_score": 0.0,
            "ops_agendadas": 0,
            "ops_total": len(data.operacoes),
        }

    # Makespan
    min_day = min(s.dia for s in segmentos)
    max_day = max(s.dia for s in segmentos)
    makespan_dias = max_day - min_day + 1

    # Makespan per mold (last segment day)
    mold_max_day: dict[str, int] = defaultdict(int)
    for s in segmentos:
        if s.dia > mold_max_day[s.molde]:
            mold_max_day[s.molde] = s.dia
    makespan_por_molde = dict(mold_max_day)

    # Deadline compliance
    molde_deadline: dict[str, int | None] = {}
    for m in data.moldes:
        molde_deadline[m.id] = _parse_deadline_to_days(m.deadline)

    on_time = 0
    total_with_deadline = 0
    for molde_id, deadline_day in molde_deadline.items():
        if deadline_day is None:
            continue
        total_with_deadline += 1
        last_day = makespan_por_molde.get(molde_id, 0)
        if last_day <= deadline_day:
            on_time += 1

    deadline_compliance = (on_time / total_with_deadline) if total_with_deadline > 0 else 1.0

    # Setups
    total_setups = sum(1 for s in segmentos if s.setup_h > 0)

    # Utilization per machine
    machine_hours: dict[str, float] = defaultdict(float)
    for s in segmentos:
        machine_hours[s.maquina_id] += s.duracao_h

    machine_regime: dict[str, int] = {}
    for m in data.maquinas:
        machine_regime[m.id] = m.regime_h

    utilization: dict[str, float] = {}
    for mid, hours in machine_hours.items():
        regime = machine_regime.get(mid, 16)
        if regime > 0 and makespan_dias > 0:
            cap = makespan_dias * regime
            utilization[mid] = min(hours / cap, 1.0) if cap > 0 else 0.0
        else:
            utilization[mid] = 0.0

    # Utilization balance: 1 - (std / mean)
    utils = [v for v in utilization.values() if v > 0]
    if len(utils) > 1:
        mean_u = sum(utils) / len(utils)
        std_u = math.sqrt(sum((u - mean_u) ** 2 for u in utils) / len(utils))
        utilization_balance = max(0.0, 1.0 - (std_u / mean_u)) if mean_u > 0 else 0.0
    elif len(utils) == 1:
        utilization_balance = 1.0
    else:
        utilization_balance = 0.0

    # Ops scheduled
    ops_agendadas = len({s.op_id for s in segmentos})
    ops_total = len(data.operacoes)

    # Weighted score
    w_mk = config.weight_makespan
    w_dc = config.weight_deadline_compliance
    w_st = config.weight_setups
    w_bal = config.weight_balance

    # Normalize makespan: lower is better. Use 200 days as a reference max.
    makespan_norm = min(makespan_dias / 200.0, 1.0)
    # Normalize setups: fewer is better. Use ops_total as reference max.
    setups_norm = min(total_setups / max(ops_total, 1), 1.0)

    weighted_score = (
        w_mk * (1.0 - makespan_norm)
        + w_dc * deadline_compliance
        + w_st * (1.0 - setups_norm)
        + w_bal * utilization_balance
    )

    return {
        "makespan_total_dias": makespan_dias,
        "makespan_por_molde": makespan_por_molde,
        "deadline_compliance": round(deadline_compliance, 4),
        "total_setups": total_setups,
        "utilization": utilization,
        "utilization_balance": round(utilization_balance, 4),
        "weighted_score": round(weighted_score, 4),
        "ops_agendadas": ops_agendadas,
        "ops_total": ops_total,
    }
