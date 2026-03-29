"""Action items — Spec 11 §3.

Real alerts are ACTIONS, not information.
If there's no consequence and no action, it's not an alert.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.config.types import FactoryConfig
from backend.scheduler.types import Lot, Segment
from backend.types import EngineData


@dataclass
class Fix:
    description: str
    buttons: list[str]


@dataclass
class ActionItem:
    severity: str       # "critical" | "warning"
    phrase: str         # 1 sentence for state bar
    body: str           # 2-3 sentences with context
    actions: list[str]  # buttons
    deadline: str       # date or "hoje"/"amanhã"
    client: str         # for aggregation
    category: str       # "delivery" | "stockout" | "operators" | "crew"


# ─── Diagnostics ──────────────────────────────────────────────────────────


def _diagnose_why_short(
    entry: object,
    segments: list[Segment],
    lots: list[Lot],
    engine_data: EngineData,
) -> str:
    """ONE sentence in Portuguese explaining why delivery is short."""
    op = next((o for o in engine_data.ops if o.sku == entry.sku), None)
    if not op:
        return "Referência não está no plano."

    lot_to_op = {l.id: l.op_id for l in lots}
    op_segs = [s for s in segments if lot_to_op.get(s.lot_id) == op.id]

    # Also check twin segments
    for s in segments:
        if s.twin_outputs:
            for op_id, _, _ in s.twin_outputs:
                if op_id == op.id and s not in op_segs:
                    op_segs.append(s)

    if not op_segs:
        return "Sem produção planeada para esta referência."

    last_seg = max(op_segs, key=lambda s: s.day_idx * 10000 + s.end_min)
    if last_seg.day_idx > entry.day_idx:
        late = last_seg.day_idx - entry.day_idx
        return (
            f"Produção na {last_seg.machine_id} termina "
            f"{late} dia{'s' if late > 1 else ''} depois da entrega."
        )

    total = sum(s.qty for s in op_segs if s.day_idx <= entry.day_idx)
    if total < entry.order_qty:
        return (
            f"Produzidas {total:,} de {entry.order_qty:,} até à data. "
            f"Faltam {entry.order_qty - total:,}."
        )

    return "Produção planeada. A acompanhar."


def _find_fix(
    entry: object,
    engine_data: EngineData,
    segments: list[Segment],
    config: FactoryConfig,
) -> Fix | None:
    """Find a fix: alt machine or night shift. Returns None if no fix."""
    op = next((o for o in engine_data.ops if o.sku == entry.sku), None)
    if not op or entry.shortfall <= 0:
        return None

    needed_min = entry.shortfall / max(op.pH * (op.oee or 0.66), 1) * 60

    # Option A: alternative machine
    if op.alt:
        day_cap = config.day_capacity_min
        used = sum(
            s.prod_min + s.setup_min
            for s in segments
            if s.machine_id == op.alt and s.day_idx == entry.day_idx
        )
        free = max(0, day_cap - used)

        if free >= needed_min:
            return Fix(
                description=(
                    f"{op.alt} tem capacidade. Setup {op.sH}h. "
                    f"Peças prontas a tempo."
                ),
                buttons=[f"Mover para {op.alt}", "Ver impacto"],
            )

    # Option B: night shift (7h = 420 min)
    if needed_min <= 420:
        return Fix(
            description=f"Turno noite na {op.m} resolveria ({needed_min:.0f} min).",
            buttons=["Simular turno noite", "Ver impacto"],
        )

    return None


def _has_production_before(
    proj,  # StockProjection
    segments: list[Segment],
    lots: list[Lot],
) -> bool:
    """True if there's production for this op before stockout day."""
    if proj.stockout_day is None:
        return True

    lot_to_op = {l.id: l.op_id for l in lots}
    for seg in segments:
        if seg.day_idx < proj.stockout_day:
            # Check regular lots
            if lot_to_op.get(seg.lot_id) == proj.op_id:
                return True
            # Check twin outputs
            if seg.twin_outputs:
                for op_id, _, _ in seg.twin_outputs:
                    if op_id == proj.op_id:
                        return True
    return False


# ─── Aggregation ──────────────────────────────────────────────────────────


def _aggregate_and_cap(items: list[ActionItem]) -> list[ActionItem]:
    """Group by (client, category). Max 7 items. Critical first."""
    if not items:
        return []

    groups: dict[tuple, list[ActionItem]] = defaultdict(list)
    for item in items:
        if item.client:
            key = (item.client, item.category)
        else:
            key = (id(item), item.category)
        groups[key].append(item)

    result = []
    for (client, cat), group in groups.items():
        if len(group) == 1:
            result.append(group[0])
        else:
            worst = "critical" if any(g.severity == "critical" for g in group) else "warning"
            # Only aggregate delivery/stockout by client name
            if isinstance(client, str) and client:
                phrase = f"{client}: {len(group)} entregas em risco esta semana."
            else:
                phrase = group[0].phrase
            result.append(ActionItem(
                severity=worst,
                phrase=phrase,
                body="\n".join(g.body for g in group[:3]),
                actions=group[0].actions,
                deadline=group[0].deadline,
                client=client if isinstance(client, str) else "",
                category=cat,
            ))

    result.sort(key=lambda a: (0 if a.severity == "critical" else 1, a.deadline))
    return result[:7]


# ─── Main ─────────────────────────────────────────────────────────────────


def compute_action_items(
    segments: list[Segment],
    lots: list[Lot],
    engine_data: EngineData,
    config: FactoryConfig,
) -> list[ActionItem]:
    """Compute actionable alerts. Max 7 items, aggregated by client."""
    raise NotImplementedError("Moldit action items — Phase 2")
