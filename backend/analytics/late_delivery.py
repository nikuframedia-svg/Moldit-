"""Late Delivery Analysis -- Moldit Planner (Phase 4).

Root cause classification for tardy operations/moldes.
Categories: capacity, setup_overhead, priority_conflict, dependency_chain.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData, Operacao


def _parse_deadline_to_days(deadline: str) -> int | None:
    """Parse 'S15' -> ~75 working days."""
    if not deadline:
        return None
    d = deadline.strip().upper()
    if d.startswith("S") and d[1:].isdigit():
        return int(d[1:]) * 5
    return None


@dataclass(slots=True)
class TardyAnalysis:
    molde_id: str
    op_id: int
    maquina_id: str
    deadline_dia: int
    completion_dia: int
    delay_dias: int
    root_cause: str       # "capacity" | "setup_overhead" | "priority_conflict" | "dependency_chain"
    explanation: str      # Portuguese
    capacity_gap_h: float
    competing_moldes: list[str]


@dataclass(slots=True)
class LateDeliveryReport:
    tardy_count: int
    by_cause: dict[str, int]
    analyses: list[TardyAnalysis]
    worst_machine: str | None
    suggestion: str


def analyze_late_deliveries(
    segmentos: list[SegmentoMoldit],
    data: MolditEngineData,
    config: FactoryConfig | None = None,
) -> LateDeliveryReport:
    """Classify root causes for all tardy moldes."""
    # Build molde -> deadline (days)
    molde_deadline: dict[str, int] = {}
    for m in data.moldes:
        dd = _parse_deadline_to_days(m.deadline)
        if dd is not None:
            molde_deadline[m.id] = dd

    # Build molde -> last segment day
    molde_last_day: dict[str, int] = defaultdict(int)
    for seg in segmentos:
        if seg.dia > molde_last_day[seg.molde]:
            molde_last_day[seg.molde] = seg.dia

    # Build op -> segments
    op_segs: dict[int, list[SegmentoMoldit]] = defaultdict(list)
    for seg in segmentos:
        op_segs[seg.op_id].append(seg)

    # Machine utilization per day
    machine_day_h: dict[tuple[str, int], float] = defaultdict(float)
    for seg in segmentos:
        machine_day_h[(seg.maquina_id, seg.dia)] += seg.duracao_h + seg.setup_h

    # Machine regime lookup
    machine_regime: dict[str, int] = {m.id: m.regime_h for m in data.maquinas}

    # Machine-day moldes (for priority conflict)
    machine_day_moldes: dict[tuple[str, int], set[str]] = defaultdict(set)
    for seg in segmentos:
        machine_day_moldes[(seg.maquina_id, seg.dia)].add(seg.molde)

    analyses: list[TardyAnalysis] = []

    for molde_id, deadline_day in molde_deadline.items():
        last_day = molde_last_day.get(molde_id, 0)
        if last_day <= deadline_day:
            continue  # on time

        delay = last_day - deadline_day

        # Find the op that finishes latest for this molde
        molde_ops = [op for op in data.operacoes if op.molde == molde_id]
        latest_op = None
        latest_op_day = -1
        for op in molde_ops:
            segs = op_segs.get(op.id, [])
            if segs:
                op_last = max(s.dia for s in segs)
                if op_last > latest_op_day:
                    latest_op_day = op_last
                    latest_op = op

        if latest_op is None:
            continue

        segs = op_segs.get(latest_op.id, [])
        machine = segs[0].maquina_id if segs else "?"

        cause, explanation, gap, competing = _classify(
            molde_id, latest_op, segs, last_day, deadline_day,
            machine, machine_regime, machine_day_h, machine_day_moldes,
            molde_deadline, data,
        )

        analyses.append(TardyAnalysis(
            molde_id=molde_id,
            op_id=latest_op.id,
            maquina_id=machine,
            deadline_dia=deadline_day,
            completion_dia=last_day,
            delay_dias=delay,
            root_cause=cause,
            explanation=explanation,
            capacity_gap_h=gap,
            competing_moldes=competing,
        ))

    # Aggregate
    by_cause: dict[str, int] = defaultdict(int)
    machine_tardy: dict[str, int] = defaultdict(int)
    for a in analyses:
        by_cause[a.root_cause] += 1
        machine_tardy[a.maquina_id] += 1

    worst = max(machine_tardy, key=machine_tardy.get) if machine_tardy else None

    if not analyses:
        suggestion = "Sem atrasos. Plano cumpre todas as entregas."
    elif worst:
        suggestion = (
            f"{len(analyses)} molde{'s' if len(analyses) > 1 else ''} em atraso. "
            f"Maquina mais afectada: {worst} ({machine_tardy[worst]} atrasos). "
            f"Causa principal: {max(by_cause, key=by_cause.get)}."
        )
    else:
        suggestion = f"{len(analyses)} moldes em atraso."

    return LateDeliveryReport(
        tardy_count=len(analyses),
        by_cause=dict(by_cause),
        analyses=analyses,
        worst_machine=worst,
        suggestion=suggestion,
    )


def _classify(
    molde_id: str,
    op: Operacao,
    segs: list[SegmentoMoldit],
    completion_day: int,
    deadline_day: int,
    machine: str,
    machine_regime: dict[str, int],
    machine_day_h: dict[tuple[str, int], float],
    machine_day_moldes: dict[tuple[str, int], set[str]],
    molde_deadline: dict[str, int],
    data: MolditEngineData,
) -> tuple[str, str, float, list[str]]:
    """Classify root cause. Returns (cause, explanation, gap_h, competing_moldes)."""
    regime = machine_regime.get(machine, 16)

    # Total work and setup for this op
    total_work = sum(s.duracao_h for s in segs)
    total_setup = sum(s.setup_h for s in segs)

    # 1. Dependency chain: check if predecessor finishes late
    predecessors = data.dag_reverso.get(op.id, [])
    for pred_id in predecessors:
        pred_molde = next((o.molde for o in data.operacoes if o.id == pred_id), None)
        if pred_molde and pred_molde != molde_id:
            return (
                "dependency_chain",
                f"Op {op.id} depende de op {pred_id} (molde {pred_molde}), "
                f"criando cadeia de dependencias.",
                0.0,
                [pred_molde],
            )

    # 2. Setup overhead: setup > 20% of total time
    total_time = total_work + total_setup
    if total_time > 0 and total_setup / total_time > 0.20:
        return (
            "setup_overhead",
            f"Setup ({total_setup:.1f}h) representa "
            f"{total_setup / total_time * 100:.0f}% do tempo total na {machine}.",
            total_setup,
            [],
        )

    # 3. Capacity: machine utilization near deadline > 95%
    edd_window = range(max(0, deadline_day - 2), deadline_day + 1)
    window_util = []
    for d in edd_window:
        used = machine_day_h.get((machine, d), 0)
        cap = regime
        window_util.append(used / max(cap, 1))
    avg_util = sum(window_util) / max(len(window_util), 1)

    if avg_util > 0.95:
        gap = sum(
            max(0, machine_day_h.get((machine, d), 0) - regime)
            for d in edd_window
        )
        return (
            "capacity",
            f"Maquina {machine} a {avg_util * 100:.0f}% nos dias "
            f"{min(edd_window)}-{max(edd_window)}. Sem espaco.",
            gap,
            [],
        )

    # 4. Priority conflict: another molde with earlier deadline on same machine
    competing: list[str] = []
    for d in edd_window:
        for other_molde in machine_day_moldes.get((machine, d), set()):
            if other_molde == molde_id:
                continue
            other_deadline = molde_deadline.get(other_molde)
            if other_deadline is not None and other_deadline < deadline_day:
                if other_molde not in competing:
                    competing.append(other_molde)

    if competing:
        return (
            "priority_conflict",
            f"{len(competing)} molde{'s' if len(competing) > 1 else ''} com deadline anterior "
            f"na {machine} deslocaram este molde.",
            0.0,
            competing[:5],
        )

    # Fallback: capacity
    return (
        "capacity",
        f"Capacidade insuficiente na {machine} para cumprir deadline dia {deadline_day}.",
        0.0,
        [],
    )
