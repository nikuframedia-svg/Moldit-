"""Replan Proposals -- Moldit Planner (Phase 4).

Proactive improvement suggestions. Heuristic-based, does NOT re-schedule.

Proposal types:
  move_to_alt     -- move op to alternative compatible machine
  extend_regime   -- extend machine regime (overtime)
  resequence      -- reorder ops on a machine to reduce setups
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData


def _parse_deadline_to_days(deadline: str) -> int | None:
    if not deadline:
        return None
    d = deadline.strip().upper()
    if d.startswith("S") and d[1:].isdigit():
        return int(d[1:]) * 5
    return None


@dataclass(slots=True)
class Proposal:
    id: str
    type: str          # "move_to_alt" | "extend_regime" | "resequence"
    description: str   # Portuguese
    estimated_impact: str
    affected_ops: list[int]
    machine_from: str | None
    machine_to: str | None
    priority: int      # 1=highest


@dataclass(slots=True)
class ReplanReport:
    proposals: list[Proposal]
    current_makespan: int
    current_setups: int
    summary: str


def generate_proposals(
    segmentos: list[SegmentoMoldit],
    data: MolditEngineData,
    score: dict,
    config: FactoryConfig,
) -> ReplanReport:
    """Generate ranked improvement proposals."""
    current_makespan = score.get("makespan_total_dias", 0)
    current_setups = score.get("total_setups", 0)

    proposals: list[Proposal] = []
    pid = 0

    # Build helpers
    molde_deadline: dict[str, int] = {}
    for m in data.moldes:
        dd = _parse_deadline_to_days(m.deadline)
        if dd is not None:
            molde_deadline[m.id] = dd

    # Op segments
    op_segs: dict[int, list[SegmentoMoldit]] = defaultdict(list)
    for seg in segmentos:
        op_segs[seg.op_id].append(seg)

    # Machine utilization
    machine_hours: dict[str, float] = defaultdict(float)
    for seg in segmentos:
        machine_hours[seg.maquina_id] += seg.duracao_h + seg.setup_h

    machine_regime: dict[str, int] = {m.id: m.regime_h for m in data.maquinas}
    makespan = max((s.dia for s in segmentos), default=1) + 1

    machine_util: dict[str, float] = {}
    for mid, hours in machine_hours.items():
        cap = makespan * machine_regime.get(mid, 16)
        machine_util[mid] = hours / max(cap, 1)

    # Find tardy moldes
    molde_last_day: dict[str, int] = defaultdict(int)
    for seg in segmentos:
        if seg.dia > molde_last_day[seg.molde]:
            molde_last_day[seg.molde] = seg.dia

    tardy_moldes: list[tuple[str, int, int]] = []  # (molde_id, last_day, deadline)
    for molde_id, deadline in molde_deadline.items():
        last_day = molde_last_day.get(molde_id, 0)
        if last_day > deadline:
            tardy_moldes.append((molde_id, last_day, deadline))

    # ── A. Move to alt machine ──
    for molde_id, last_day, deadline in tardy_moldes:
        molde_ops = [op for op in data.operacoes if op.molde == molde_id]
        for op in molde_ops:
            segs = op_segs.get(op.id, [])
            if not segs:
                continue
            op_last = max(s.dia for s in segs)
            if op_last <= deadline:
                continue

            machine = segs[0].maquina_id
            compat = data.compatibilidade.get(op.codigo, [])
            alts = [m for m in compat if m != machine]

            for alt in alts:
                alt_util = machine_util.get(alt, 0)
                if alt_util < 0.80:
                    pid += 1
                    proposals.append(Proposal(
                        id=f"P{pid:03d}",
                        type="move_to_alt",
                        description=(
                            f"Mover op {op.id} ({op.nome}) de {machine} para {alt}. "
                            f"Utilizacao {alt}: {alt_util:.0%}."
                        ),
                        estimated_impact=(
                            f"Pode resolver atraso de {last_day - deadline} "
                            f"dia(s) no molde {molde_id}"
                        ),
                        affected_ops=[op.id],
                        machine_from=machine,
                        machine_to=alt,
                        priority=1,
                    ))
                    break  # one proposal per op

    # ── B. Extend regime (overtime) ──
    machine_tardy: dict[str, int] = defaultdict(int)
    for molde_id, last_day, deadline in tardy_moldes:
        for seg in segmentos:
            if seg.molde == molde_id:
                machine_tardy[seg.maquina_id] += 1

    for mid, util in machine_util.items():
        if util < 0.85:
            continue
        regime = machine_regime.get(mid, 16)
        if regime >= 24:
            continue
        n_tardy = machine_tardy.get(mid, 0)
        if n_tardy == 0:
            continue

        pid += 1
        new_regime = min(24, regime + 8)
        proposals.append(Proposal(
            id=f"P{pid:03d}",
            type="extend_regime",
            description=(
                f"Aumentar regime {mid} de {regime}h para {new_regime}h "
                f"(utilizacao {util:.0%}, {n_tardy} atrasos)."
            ),
            estimated_impact=f"Pode resolver ate {n_tardy} atraso(s)",
            affected_ops=[],
            machine_from=mid,
            machine_to=None,
            priority=2,
        ))

    # ── C. Resequence (save setups) ──
    by_machine: dict[str, list[SegmentoMoldit]] = defaultdict(list)
    for seg in segmentos:
        if seg.setup_h > 0:
            by_machine[seg.maquina_id].append(seg)

    for mid, setup_segs in by_machine.items():
        sorted_segs = sorted(setup_segs, key=lambda s: s.dia * 24 + s.inicio_h)
        for i in range(len(sorted_segs) - 1):
            s1 = sorted_segs[i]
            s2 = sorted_segs[i + 1]
            # Same molde consecutive segments with setups: could be merged
            if s1.molde == s2.molde and abs(s2.dia - s1.dia) <= 2:
                pid += 1
                proposals.append(Proposal(
                    id=f"P{pid:03d}",
                    type="resequence",
                    description=(
                        f"Reordenar ops do molde {s1.molde} na {mid} "
                        f"(dias {s1.dia}-{s2.dia}). Poupa setup."
                    ),
                    estimated_impact="Poupa 1 setup",
                    affected_ops=[s1.op_id, s2.op_id],
                    machine_from=mid,
                    machine_to=None,
                    priority=3,
                ))
                if sum(1 for p in proposals if p.type == "resequence") >= 5:
                    break

    # Sort by priority
    proposals.sort(key=lambda p: p.priority)

    if not proposals:
        summary = "Sem propostas de melhoria. Plano esta optimizado."
    else:
        n_move = sum(1 for p in proposals if p.type == "move_to_alt")
        n_regime = sum(1 for p in proposals if p.type == "extend_regime")
        n_reseq = sum(1 for p in proposals if p.type == "resequence")
        parts = []
        if n_move:
            parts.append(f"{n_move} transferencia{'s' if n_move > 1 else ''}")
        if n_regime:
            parts.append(f"{n_regime} extensao de regime")
        if n_reseq:
            parts.append(f"{n_reseq} resequenciamento{'s' if n_reseq > 1 else ''}")
        summary = f"{len(proposals)} propostas: {', '.join(parts)}."

    return ReplanReport(
        proposals=proposals,
        current_makespan=current_makespan,
        current_setups=current_setups,
        summary=summary,
    )
