"""Expedition — Spec 03 §3.

Per day, per client: which orders are ready/partial/in_production/not_planned.
Crosses client_demands with cumulative production from segments.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.scheduler.types import Lot, Segment
from backend.types import EngineData

from .stock_projection import build_production_by_op


@dataclass(slots=True)
class ExpeditionEntry:
    day_idx: int
    date: str
    client: str
    sku: str
    order_qty: int
    produced_qty: int  # cumulative production for this SKU up to this day
    status: str  # "ready" | "partial" | "in_production" | "not_planned"
    coverage_pct: float  # 0-100%
    shortfall: int


@dataclass(slots=True)
class ExpeditionDay:
    day_idx: int
    date: str
    entries: list[ExpeditionEntry]
    total_orders: int
    total_ready: int
    total_partial: int
    total_not_planned: int


@dataclass(slots=True)
class ExpeditionKPIs:
    days: list[ExpeditionDay]
    fill_rate: float  # % entries "ready"
    at_risk_count: int  # entries != "ready" in first 5 days


def compute_expedition(
    segments: list[Segment],
    lots: list[Lot],
    engine_data: EngineData,
) -> ExpeditionKPIs:
    """Build expedition view from segments + client_demands."""
    prod = build_production_by_op(segments, lots)

    # Build cumulative production per op_id
    cum_prod: dict[str, dict[int, int]] = {}
    for op_id, day_prod in prod.items():
        running = 0
        cum: dict[int, int] = {}
        for day in range(engine_data.n_days):
            running += day_prod.get(day, 0)
            cum[day] = running
        cum_prod[op_id] = cum

    # Map sku → op_id (for production lookup)
    sku_to_op: dict[str, str] = {op.sku: op.id for op in engine_data.ops}

    # Check if any segment produces for an op before a given day
    lot_to_op: dict[str, str] = {lot.id: lot.op_id for lot in lots}

    days_map: dict[int, list[ExpeditionEntry]] = defaultdict(list)

    for sku, demand_entries in engine_data.client_demands.items():
        op_id = sku_to_op.get(sku)
        if op_id is None:
            continue

        # Group demands by day for cumulative tracking per client
        client_cum: dict[str, int] = defaultdict(int)

        # Sort entries by day_idx for cumulative computation
        sorted_entries = sorted(demand_entries, key=lambda e: e.day_idx)

        for entry in sorted_entries:
            if entry.order_qty <= 0:
                continue

            client_cum[entry.client] = client_cum.get(entry.client, 0) + entry.order_qty
            cum_demand = client_cum[entry.client]

            produced = cum_prod.get(op_id, {}).get(entry.day_idx, 0)

            if produced >= cum_demand:
                status = "ready"
            elif produced > 0:
                status = "partial"
            elif _has_segments_before(segments, lots, lot_to_op, op_id, entry.day_idx):
                status = "in_production"
            else:
                status = "not_planned"

            coverage = min(100.0, produced / entry.order_qty * 100) if entry.order_qty > 0 else 100.0
            shortfall = max(0, entry.order_qty - produced)

            days_map[entry.day_idx].append(
                ExpeditionEntry(
                    day_idx=entry.day_idx,
                    date=entry.date,
                    client=entry.client,
                    sku=sku,
                    order_qty=entry.order_qty,
                    produced_qty=produced,
                    status=status,
                    coverage_pct=round(coverage, 1),
                    shortfall=shortfall,
                )
            )

    # Build ExpeditionDays
    expedition_days: list[ExpeditionDay] = []
    for day_idx in sorted(days_map.keys()):
        entries = days_map[day_idx]
        expedition_days.append(
            ExpeditionDay(
                day_idx=day_idx,
                date=entries[0].date if entries else "",
                entries=entries,
                total_orders=len(entries),
                total_ready=sum(1 for e in entries if e.status == "ready"),
                total_partial=sum(1 for e in entries if e.status == "partial"),
                total_not_planned=sum(1 for e in entries if e.status == "not_planned"),
            )
        )

    total = sum(d.total_orders for d in expedition_days)
    ready = sum(d.total_ready for d in expedition_days)
    at_risk = sum(
        1 for d in expedition_days if d.day_idx < 5
        for e in d.entries if e.status != "ready"
    )

    return ExpeditionKPIs(
        days=expedition_days,
        fill_rate=round(ready / max(total, 1) * 100, 1),
        at_risk_count=at_risk,
    )


def _has_segments_before(
    segments: list[Segment],
    lots: list[Lot],
    lot_to_op: dict[str, str],
    op_id: str,
    day_idx: int,
) -> bool:
    """True if there's production for this op on or before day_idx."""
    for seg in segments:
        if seg.day_idx <= day_idx:
            if seg.twin_outputs:
                if any(oid == op_id for oid, _, _ in seg.twin_outputs):
                    return True
            elif lot_to_op.get(seg.lot_id) == op_id:
                return True
    return False
