"""CTP -- Capable to Promise -- Moldit Planner (Phase 4).

"Can molde X be delivered by week W?"

Uses REAL capacity from schedule segments to compute feasibility and slack.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData


@dataclass(slots=True)
class CTPResult:
    feasible: bool
    molde_id: str
    target_week: str
    slack_dias: float
    dias_extra: float
    reason: str | None


def _week_to_days(week_str: str) -> int | None:
    """Parse 'S15' -> ~75 working days (15*5). Returns None if invalid."""
    if not week_str:
        return None
    w = week_str.strip().upper()
    if w.startswith("S") and w[1:].isdigit():
        return int(w[1:]) * 5
    return None


def compute_ctp_molde(
    molde_id: str,
    target_week: str,
    segmentos: list[SegmentoMoldit],
    data: MolditEngineData,
    config: FactoryConfig | None = None,
) -> CTPResult:
    """CTP for a specific mold: can it be delivered by target_week?

    Compares the latest scheduled day for the molde against the target
    deadline, using actual schedule data.
    """
    target_day = _week_to_days(target_week)
    if target_day is None:
        return CTPResult(
            feasible=False, molde_id=molde_id, target_week=target_week,
            slack_dias=0.0, dias_extra=0.0,
            reason=f"Formato de semana invalido: {target_week}",
        )

    # Find the molde
    molde = next((m for m in data.moldes if m.id == molde_id), None)
    if molde is None:
        return CTPResult(
            feasible=False, molde_id=molde_id, target_week=target_week,
            slack_dias=0.0, dias_extra=0.0,
            reason=f"Molde {molde_id} nao encontrado",
        )

    # Find all segments for this molde
    molde_segs = [s for s in segmentos if s.molde == molde_id]
    if not molde_segs:
        # No segments: either all ops are done or none scheduled
        ops = [op for op in data.operacoes if op.molde == molde_id]
        remaining = sum(op.work_restante_h for op in ops)
        if remaining <= 0:
            return CTPResult(
                feasible=True, molde_id=molde_id, target_week=target_week,
                slack_dias=float(target_day), dias_extra=0.0,
                reason="Todas as operacoes concluidas",
            )
        return CTPResult(
            feasible=False, molde_id=molde_id, target_week=target_week,
            slack_dias=0.0, dias_extra=0.0,
            reason=f"Molde {molde_id} sem segmentos agendados ({remaining:.0f}h restantes)",
        )

    # Latest completion day for this molde
    completion_day = max(s.dia for s in molde_segs)

    slack = target_day - completion_day

    if slack >= 0:
        return CTPResult(
            feasible=True, molde_id=molde_id, target_week=target_week,
            slack_dias=float(slack), dias_extra=0.0,
            reason=None,
        )
    else:
        # How many extra days needed
        # Estimate remaining capacity needed
        total_remaining_h = sum(s.duracao_h for s in molde_segs if s.dia > target_day)

        # Find machines used by this molde
        machines_used = {s.maquina_id for s in molde_segs}
        machine_regime: dict[str, int] = {}
        for m in data.maquinas:
            if m.id in machines_used:
                machine_regime[m.id] = m.regime_h

        # Capacity per day from those machines
        cap_per_day = sum(machine_regime.get(m, 16) for m in machines_used)
        dias_extra = total_remaining_h / max(cap_per_day, 1)

        return CTPResult(
            feasible=False, molde_id=molde_id, target_week=target_week,
            slack_dias=float(slack), dias_extra=round(dias_extra, 1),
            reason=(
                f"Molde termina dia {completion_day}, target dia {target_day} "
                f"({abs(slack)} dias atrasado)"
            ),
        )
