"""Expedition today — Spec 11 §4.2.

Grouped by client. Status clear.
"""

from __future__ import annotations


from backend.scheduler.types import Lot, Segment
from backend.types import EngineData


def _estimate_eta(
    entry,  # ExpeditionEntry
    segments: list[Segment],
    lots: list[Lot],
    engine_data: EngineData,
) -> str | None:
    """Estimate when production for this SKU will be ready."""
    op = next((o for o in engine_data.ops if o.sku == entry.sku), None)
    if not op:
        return None

    lot_to_op = {l.id: l.op_id for l in lots}
    op_segs = [s for s in segments if lot_to_op.get(s.lot_id) == op.id]
    if not op_segs:
        return None

    ready_day = max(s.day_idx for s in op_segs)
    if ready_day < len(engine_data.workdays):
        return engine_data.workdays[ready_day]
    return None


def compute_expedition_today(
    segments: list[Segment],
    lots: list[Lot],
    engine_data: EngineData,
    day_idx: int = 0,
) -> dict:
    """Return expedition summary for a given day."""
    raise NotImplementedError("Moldit expedition today — Phase 2")
