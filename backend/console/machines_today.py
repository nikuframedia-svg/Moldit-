"""Machines today — per-machine summary for a given day.

Sorted by utilisation (descending). Uses Moldit SegmentoMoldit.
"""

from __future__ import annotations

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit as Segment
from backend.types import MolditEngineData as EngineData


def _get_molde(seg: Segment) -> str:
    """Return molde from segment."""
    return seg.molde


def compute_machines_today(
    segments: list[Segment],
    engine_data: EngineData,
    config: FactoryConfig,
    day_idx: int = 0,
) -> dict:
    """Return machine summary for a given day.

    Keys: machines (list sorted by -util), total_setups.
    """
    result = []

    for m in engine_data.maquinas:
        segs = sorted(
            [s for s in segments if s.maquina_id == m.id and s.dia == day_idx],
            key=lambda s: s.inicio_h,
        )
        used_h = sum(s.duracao_h + s.setup_h for s in segs)
        util = used_h / m.regime_h if m.regime_h > 0 else 0

        # Molde sequence
        moldes: list[str] = []
        for s in segs:
            if not moldes or moldes[-1] != s.molde:
                moldes.append(s.molde)

        setup_segs = [s for s in segs if s.setup_h > 0]

        result.append({
            "id": m.id,
            "grupo": m.grupo,
            "util": round(util, 2),
            "moldes": moldes,
            "total_h": round(used_h, 1),
            "setup_count": len(setup_segs),
        })

    total_setups = sum(m["setup_count"] for m in result)

    return {
        "machines": sorted(result, key=lambda m: -m["util"]),
        "total_setups": total_setups,
    }
