"""Tomorrow prep — Spec 11 §4.3.

What the encarregado needs to know: setups, operators, expeditions, problems.
"""

from __future__ import annotations


from backend.config.loader import _min_to_time
from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit as Segment


from backend.types import MolditEngineData as EngineData


class Lot:  # noqa: D101
    """Legacy stub — removed in Phase 2."""


def _find_previous_tool(segments: list[Segment], machine_id: str, day_idx: int) -> str | None:
    """Last tool_id on this machine the day before."""
    prev_segs = [
        s for s in segments
        if s.machine_id == machine_id and s.day_idx == day_idx - 1
    ]
    if not prev_segs:
        return None
    return max(prev_segs, key=lambda s: s.end_min).tool_id


def check_crew_bottleneck(
    segments: list[Segment],
    day_idx: int,
    window_min: int = 120,
) -> list[dict]:
    """Detect >=3 setups within a time window on the same day.

    Returns list of {"time": str, "simultaneous": int, "machines": [...], "wait_min": float}.
    """
    setup_segs = sorted(
        [s for s in segments if s.day_idx == day_idx and s.setup_min > 0],
        key=lambda s: s.start_min,
    )

    if len(setup_segs) < 3:
        return []

    conflicts = []
    seen = set()

    for i, s in enumerate(setup_segs):
        if i in seen:
            continue
        # Setup starts approximately at start_min (post-setup, but close enough)
        nearby = [s]
        nearby_idx = [i]
        for j, s2 in enumerate(setup_segs):
            if j == i or j in seen:
                continue
            if abs(s2.start_min - s.start_min) < window_min:
                nearby.append(s2)
                nearby_idx.append(j)

        if len(nearby) >= 3:
            for idx in nearby_idx:
                seen.add(idx)
            total_setup = sum(ns.setup_min for ns in nearby)
            conflicts.append({
                "time": _min_to_time(s.start_min),
                "simultaneous": len(nearby),
                "machines": [ns.machine_id for ns in nearby],
                "wait_min": round(total_setup - max(ns.setup_min for ns in nearby), 1),
            })

    return conflicts


def compute_tomorrow_prep(
    segments: list[Segment],
    lots: list[Lot],
    engine_data: EngineData,
    config: FactoryConfig,
    day_idx: int = 1,
) -> dict:
    """Return tomorrow preparation summary."""
    raise NotImplementedError("Moldit tomorrow prep — Phase 2")
