"""Action items — Moldit Planner.

Real alerts are ACTIONS, not information.
If there's no consequence and no action, it's not an alert.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit as Segment
from backend.types import MolditEngineData as EngineData


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
    deadline: str       # date or "hoje"/"amanha"
    client: str         # for aggregation
    category: str       # "deadline" | "bottleneck" | "conditional"


# --- Diagnostics --------------------------------------------------------


def _moldes_atrasados(
    data: EngineData,
    segments: list[Segment],
) -> list[ActionItem]:
    """Check each mold: is the latest segment past the deadline?"""
    items: list[ActionItem] = []

    for molde in data.moldes:
        if not molde.deadline:
            continue

        molde_segs = [s for s in segments if s.molde == molde.id]
        if not molde_segs:
            # No segments — check if there's remaining work
            ops = [op for op in data.operacoes if op.molde == molde.id]
            remaining = sum(op.work_restante_h for op in ops)
            if remaining > 0:
                items.append(ActionItem(
                    severity="critical",
                    phrase=f"Molde {molde.id} sem producao agendada ({remaining:.0f}h restantes).",
                    body=(
                        f"O molde {molde.id} ({molde.cliente}) tem "
                        f"{remaining:.0f}h de trabalho restante "
                        f"mas nenhum segmento agendado."
                    ),
                    actions=["Agendar molde", "Ver detalhe"],
                    deadline=molde.deadline,
                    client=molde.cliente,
                    category="deadline",
                ))
            continue

        # Latest completion day
        latest_dia = max(s.dia for s in molde_segs)
        # Simple check: if latest dia is high, flag it
        # The deadline is a week string like "S15" or a date
        items.append(ActionItem(
            severity="warning",
            phrase=(
                f"Molde {molde.id}: ultimo segmento dia "
                f"{latest_dia}, deadline {molde.deadline}."
            ),
            body=(
                f"Molde {molde.id} ({molde.cliente}): "
                f"producao termina dia {latest_dia}. "
                f"Deadline: {molde.deadline}."
            ),
            actions=["Ver molde", "CTP"],
            deadline=molde.deadline,
            client=molde.cliente,
            category="deadline",
        ))

    return items


def _bottleneck_machines(
    data: EngineData,
    segments: list[Segment],
    config: FactoryConfig,
) -> list[ActionItem]:
    """Flag machines with stress > 90%."""
    items: list[ActionItem] = []

    # Accumulate hours per machine
    hours_by_machine: dict[str, float] = defaultdict(float)
    for s in segments:
        hours_by_machine[s.maquina_id] += s.duracao_h + s.setup_h

    if not segments:
        return items

    max_dia = max(s.dia for s in segments)
    n_days = max_dia + 1

    for m in data.maquinas:
        total_h = hours_by_machine.get(m.id, 0)
        capacity_h = m.regime_h * n_days if not m.e_externo else float("inf")
        if capacity_h <= 0:
            continue
        stress_pct = total_h / capacity_h * 100
        if stress_pct > 90:
            items.append(ActionItem(
                severity="critical" if stress_pct > 100 else "warning",
                phrase=f"Maquina {m.id} a {stress_pct:.0f}% capacidade.",
                body=(
                    f"{m.id} ({m.grupo}): {total_h:.0f}h agendadas "
                    f"/ {capacity_h:.0f}h capacidade "
                    f"({stress_pct:.0f}%)."
                ),
                actions=["Ver carga", "Simular overtime"],
                deadline="",
                client="",
                category="bottleneck",
            ))

    return items


def _conditional_ops(data: EngineData) -> list[ActionItem]:
    """Flag conditional ops that need a decision."""
    items: list[ActionItem] = []

    conditional = [op for op in data.operacoes if op.e_condicional and op.work_restante_h > 0]
    if conditional:
        moldes = sorted(set(op.molde for op in conditional))
        items.append(ActionItem(
            severity="warning",
            phrase=(
                f"{len(conditional)} operacoes condicionais "
                f"por decidir."
            ),
            body=(
                f"Moldes afectados: {', '.join(moldes[:5])}. "
                f"Decidir se devem ser incluidas no plano."
            ),
            actions=["Ver condicionais"],
            deadline="",
            client="",
            category="conditional",
        ))

    return items


# --- Aggregation --------------------------------------------------------


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
            if isinstance(client, str) and client:
                phrase = f"{client}: {len(group)} itens em {cat}."
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


# --- Main ---------------------------------------------------------------


def compute_action_items(
    segments: list[Segment],
    data: EngineData,
    config: FactoryConfig,
) -> list[ActionItem]:
    """Compute actionable alerts. Max 7 items, aggregated by client."""
    items: list[ActionItem] = []

    items.extend(_moldes_atrasados(data, segments))
    items.extend(_bottleneck_machines(data, segments, config))
    items.extend(_conditional_ops(data))

    return _aggregate_and_cap(items)
