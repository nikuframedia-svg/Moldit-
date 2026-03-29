"""Deadlines this week — upcoming mold deadlines.

Replaces Incompol expedition_today. Shows molds with deadlines
approaching this week and their completion status.
"""

from __future__ import annotations

from backend.scheduler.types import SegmentoMoldit as Segment
from backend.types import MolditEngineData as EngineData


def compute_deadlines_this_week(
    segments: list[Segment],
    engine_data: EngineData,
    current_day: int = 0,
    window_days: int = 5,
) -> dict:
    """Return mold deadlines within the upcoming window.

    Returns dict with 'moldes' list, each containing:
      - id, cliente, deadline, progresso, work_restante_h, ultimo_segmento_dia
    """
    result = []

    for molde in engine_data.moldes:
        if not molde.deadline:
            continue

        # Find segments for this mold
        molde_segs = [s for s in segments if s.molde == molde.id]
        ultimo_dia = max((s.dia for s in molde_segs), default=None)

        result.append({
            "id": molde.id,
            "cliente": molde.cliente,
            "deadline": molde.deadline,
            "data_ensaio": molde.data_ensaio,
            "progresso": molde.progresso,
            "total_work_h": molde.total_work_h,
            "total_ops": molde.total_ops,
            "ops_concluidas": molde.ops_concluidas,
            "ultimo_segmento_dia": ultimo_dia,
        })

    # Sort by deadline
    result.sort(key=lambda m: m["deadline"] or "")

    return {
        "moldes": result,
        "total": len(result),
    }
