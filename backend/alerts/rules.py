"""Alert rules — Moldit Planner.

Six rules (R1-R3, R7-R9) that do not depend on Modules A/D.
Each rule function returns a list of Alert objects.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from backend.alerts.types import Alert, AlertSuggestion
from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit
from backend.types import Maquina, MolditEngineData, Molde

# ── Helpers ───────────────────────────────────────────────────────────

_seq_counter: int = 0


def _next_id() -> str:
    """Generate a unique alert ID."""
    global _seq_counter  # noqa: PLW0603
    _seq_counter += 1
    return f"alert-{datetime.now():%Y%m%d%H%M%S}-{_seq_counter:03d}"


def _now_iso() -> str:
    return datetime.now().isoformat()


def _parse_deadline_to_days(deadline: str) -> int | None:
    """Parse 'S15' -> 15 * 5 = 75 working days."""
    if not deadline:
        return None
    d = deadline.strip().upper()
    if d.startswith("S") and d[1:].isdigit():
        return int(d[1:]) * 5
    return None


def _molde_last_day(segmentos: list[SegmentoMoldit], molde_id: str) -> int:
    """Return the last scheduled day for a mold."""
    return max(
        (s.dia for s in segmentos if s.molde == molde_id),
        default=0,
    )


def _molde_ops(segmentos: list[SegmentoMoldit], molde_id: str) -> list[int]:
    """Unique op IDs for a mold."""
    return list({s.op_id for s in segmentos if s.molde == molde_id})


# ── R1: Deadline em risco ─────────────────────────────────────────────


def r1_deadline_em_risco(
    segmentos: list[SegmentoMoldit],
    moldes: list[Molde],
    config: FactoryConfig | None = None,
) -> list[Alert]:
    """Mold completion is within 2 days of deadline or past it.

    Severity: critico if past, aviso if within buffer.
    """
    if not segmentos:
        return []

    buffer_dias = 2
    alerts: list[Alert] = []

    for molde in moldes:
        deadline_dias = _parse_deadline_to_days(molde.deadline)
        if deadline_dias is None:
            continue

        last_day = _molde_last_day(segmentos, molde.id)
        if last_day == 0:
            continue

        margem = deadline_dias - last_day

        if margem > buffer_dias:
            continue  # safe

        impacto = max(0.0, last_day - deadline_dias)
        if margem <= 0:
            sev = "critico"
            titulo = f"Molde {molde.id} ultrapassa deadline"
            msg = (
                f"Molde {molde.id} termina no dia {last_day}, "
                f"{abs(margem)} dia(s) apos a deadline (S{deadline_dias // 5}, dia {deadline_dias})."
            )
        else:
            sev = "aviso"
            titulo = f"Molde {molde.id} em risco de atraso"
            msg = (
                f"Molde {molde.id} termina no dia {last_day}, "
                f"apenas {margem} dia(s) de margem ate a deadline (S{deadline_dias // 5}, dia {deadline_dias})."
            )

        sugestoes = [
            AlertSuggestion(
                acao=f"Ativar regime extra (overtime) para operacoes do molde {molde.id}",
                impacto=f"Pode recuperar ate {buffer_dias} dias",
                esforco="medio",
                mutation_type="overtime",
                mutation_params={"molde": molde.id, "extra_h": 8},
            ),
            AlertSuggestion(
                acao="Resequenciar operacoes para priorizar este molde",
                impacto="Reduz espera entre operacoes",
                esforco="baixo",
                mutation_type="priority_boost",
                mutation_params={"molde": molde.id, "boost": 2},
            ),
        ]

        alerts.append(Alert(
            id=_next_id(),
            regra="R1",
            severidade=sev,
            titulo=titulo,
            mensagem=msg,
            timestamp=_now_iso(),
            moldes_afetados=[molde.id],
            maquinas_afetadas=[],
            operacoes=_molde_ops(segmentos, molde.id),
            impacto_dias=impacto,
            sugestoes=sugestoes,
        ))

    return alerts


# ── R2: Cascata perigosa ──────────────────────────────────────────────


def r2_cascata_perigosa(
    segmentos: list[SegmentoMoldit],
    dag: dict[int, list[int]],
    dag_reverso: dict[int, list[int]],
    moldes: list[Molde],
    config: FactoryConfig | None = None,
) -> list[Alert]:
    """If a critical path op delays, downstream ops in OTHER molds also violate deadline.

    Detects cross-mold dependency cascades.
    """
    if not segmentos or not dag:
        return []

    # Pre-compute: op_id -> molde, op_id -> last segment day
    op_molde: dict[int, str] = {}
    op_last_day: dict[int, int] = defaultdict(int)
    for s in segmentos:
        op_molde[s.op_id] = s.molde
        if s.dia > op_last_day[s.op_id]:
            op_last_day[s.op_id] = s.dia

    molde_deadline: dict[str, int] = {}
    for m in moldes:
        dd = _parse_deadline_to_days(m.deadline)
        if dd is not None:
            molde_deadline[m.id] = dd

    alerts: list[Alert] = []

    # For each op, check if it has successors in a different mold
    for op_id, successors in dag.items():
        src_molde = op_molde.get(op_id)
        if src_molde is None:
            continue

        cross_mold_successors: list[int] = []
        affected_moldes: set[str] = set()

        for succ_id in successors:
            succ_molde = op_molde.get(succ_id)
            if succ_molde is None or succ_molde == src_molde:
                continue
            # Check if the successor's mold is already at risk
            succ_deadline = molde_deadline.get(succ_molde)
            if succ_deadline is None:
                continue
            succ_last = max(
                (s.dia for s in segmentos if s.molde == succ_molde),
                default=0,
            )
            if succ_last > succ_deadline - 2:
                cross_mold_successors.append(succ_id)
                affected_moldes.add(succ_molde)

        if not cross_mold_successors:
            continue

        all_moldes = sorted({src_molde} | affected_moldes)
        max_impact = 0.0
        for mid in affected_moldes:
            dl = molde_deadline.get(mid, 0)
            last = max((s.dia for s in segmentos if s.molde == mid), default=0)
            max_impact = max(max_impact, last - dl)

        affected_machines: list[str] = list({
            s.maquina_id for s in segmentos
            if s.op_id == op_id or s.op_id in cross_mold_successors
        })

        alerts.append(Alert(
            id=_next_id(),
            regra="R2",
            severidade="critico",
            titulo=f"Cascata: op {op_id} afeta {len(affected_moldes)} molde(s)",
            mensagem=(
                f"Operacao {op_id} (molde {src_molde}) tem dependencias cross-mold. "
                f"Atraso propaga-se para: {', '.join(sorted(affected_moldes))}."
            ),
            timestamp=_now_iso(),
            moldes_afetados=all_moldes,
            maquinas_afetadas=affected_machines,
            operacoes=[op_id] + cross_mold_successors,
            impacto_dias=max(0.0, max_impact),
            sugestoes=[
                AlertSuggestion(
                    acao=f"Priorizar operacao {op_id} para desbloquear cadeia",
                    impacto=f"Pode evitar atraso em {len(affected_moldes)} molde(s)",
                    esforco="medio",
                    mutation_type="priority_boost",
                    mutation_params={"molde": src_molde, "boost": 3},
                ),
            ],
        ))

    return alerts


# ── R3: Maquina sobrecarregada ────────────────────────────────────────


def r3_maquina_sobrecarregada(
    segmentos: list[SegmentoMoldit],
    maquinas: list[Maquina],
    config: FactoryConfig | None = None,
) -> list[Alert]:
    """Machine stress > 90% with critical ops assigned. Suggest redistribution."""
    if not segmentos:
        return []

    max_day = max(s.dia for s in segmentos)
    n_days = max_day + 1

    machine_regime: dict[str, int] = {m.id: m.regime_h for m in maquinas}
    machine_total_h: dict[str, float] = defaultdict(float)
    machine_moldes: dict[str, set[str]] = defaultdict(set)
    machine_ops: dict[str, set[int]] = defaultdict(set)

    for s in segmentos:
        machine_total_h[s.maquina_id] += s.duracao_h + s.setup_h
        machine_moldes[s.maquina_id].add(s.molde)
        machine_ops[s.maquina_id].add(s.op_id)

    alerts: list[Alert] = []

    for maq in maquinas:
        if maq.e_externo or maq.regime_h == 0:
            continue

        total_h = machine_total_h.get(maq.id, 0.0)
        capacity = n_days * maq.regime_h
        if capacity <= 0:
            continue

        stress_pct = (total_h / capacity) * 100

        if stress_pct < 90:
            continue

        moldes = sorted(machine_moldes.get(maq.id, set()))
        ops = sorted(machine_ops.get(maq.id, set()))
        excesso_h = total_h - capacity

        alerts.append(Alert(
            id=_next_id(),
            regra="R3",
            severidade="critico" if stress_pct > 100 else "aviso",
            titulo=f"Maquina {maq.id} sobrecarregada ({stress_pct:.0f}%)",
            mensagem=(
                f"Maquina {maq.id} ({maq.grupo}) a {stress_pct:.0f}% de stress. "
                f"Total: {total_h:.0f}h vs capacidade {capacity}h "
                f"({max(0, excesso_h):.0f}h em excesso). "
                f"Afeta {len(moldes)} molde(s)."
            ),
            timestamp=_now_iso(),
            moldes_afetados=moldes,
            maquinas_afetadas=[maq.id],
            operacoes=ops[:20],  # cap to avoid oversized alerts
            impacto_dias=round(max(0, excesso_h) / max(maq.regime_h, 1), 1),
            sugestoes=[
                AlertSuggestion(
                    acao=f"Redistribuir operacoes de {maq.id} para maquinas alternativas no grupo {maq.grupo}",
                    impacto=f"Reduzir carga em {max(0, excesso_h):.0f}h",
                    esforco="medio",
                    mutation_type="force_machine",
                    mutation_params={"from_machine": maq.id, "group": maq.grupo},
                ),
                AlertSuggestion(
                    acao=f"Aumentar regime de {maq.id} para {min(24, maq.regime_h + 8)}h",
                    impacto=f"Ganho de {n_days * 8}h de capacidade",
                    esforco="alto",
                    mutation_type="overtime",
                    mutation_params={"maquina_id": maq.id, "extra_h": 8},
                ),
            ],
        ))

    return alerts


# ── R7: Slot livre ────────────────────────────────────────────────────


def r7_slot_livre(
    segmentos: list[SegmentoMoldit],
    maquinas: list[Maquina],
    config: FactoryConfig | None = None,
) -> list[Alert]:
    """Machine has a gap > 4h between consecutive ops on the same day.

    Severity: info. Suggests advancing the next operation.
    """
    if not segmentos:
        return []

    min_gap_h = 4.0

    # Group segments by (machine, day), sorted by start
    by_machine_day: dict[tuple[str, int], list[SegmentoMoldit]] = defaultdict(list)
    for s in segmentos:
        by_machine_day[(s.maquina_id, s.dia)].append(s)

    machine_regime: dict[str, int] = {m.id: m.regime_h for m in maquinas}

    alerts: list[Alert] = []

    for (mid, dia), segs in by_machine_day.items():
        regime = machine_regime.get(mid, 16)
        if regime == 0:
            continue  # external

        segs_sorted = sorted(segs, key=lambda s: s.inicio_h)

        for i in range(len(segs_sorted) - 1):
            fim_atual = segs_sorted[i].fim_h
            inicio_prox = segs_sorted[i + 1].inicio_h
            gap = inicio_prox - fim_atual

            if gap >= min_gap_h:
                next_seg = segs_sorted[i + 1]
                alerts.append(Alert(
                    id=_next_id(),
                    regra="R7",
                    severidade="info",
                    titulo=f"Slot livre de {gap:.1f}h em {mid} (dia {dia})",
                    mensagem=(
                        f"Maquina {mid} tem {gap:.1f}h livre entre "
                        f"op {segs_sorted[i].op_id} (fim {fim_atual:.1f}h) e "
                        f"op {next_seg.op_id} (inicio {inicio_prox:.1f}h) no dia {dia}."
                    ),
                    timestamp=_now_iso(),
                    moldes_afetados=list({segs_sorted[i].molde, next_seg.molde}),
                    maquinas_afetadas=[mid],
                    operacoes=[segs_sorted[i].op_id, next_seg.op_id],
                    impacto_dias=0.0,
                    sugestoes=[
                        AlertSuggestion(
                            acao=f"Antecipar op {next_seg.op_id} para preencher slot",
                            impacto=f"Recuperar {gap:.1f}h de capacidade",
                            esforco="baixo",
                        ),
                    ],
                ))

    return alerts


# ── R8: Setup evitavel ────────────────────────────────────────────────


def r8_setup_evitavel(
    segmentos: list[SegmentoMoldit],
    config: FactoryConfig | None = None,
) -> list[Alert]:
    """Consecutive ops on the same machine with different molds that could be
    resequenced to reduce setups.

    Detects A-B-A patterns where grouping A-A-B would save one setup.
    Severity: info.
    """
    if not segmentos:
        return []

    # Group by machine, order by (dia, inicio_h)
    by_machine: dict[str, list[SegmentoMoldit]] = defaultdict(list)
    for s in segmentos:
        by_machine[s.maquina_id].append(s)

    alerts: list[Alert] = []

    for mid, segs in by_machine.items():
        ordered = sorted(segs, key=lambda s: (s.dia, s.inicio_h))
        if len(ordered) < 3:
            continue

        # Detect A-B-A pattern (setup could be saved by reordering to A-A-B)
        seen_patterns: set[tuple[str, str, str]] = set()
        for i in range(len(ordered) - 2):
            a, b, c = ordered[i], ordered[i + 1], ordered[i + 2]
            if a.molde == c.molde and a.molde != b.molde:
                pattern = (a.molde, b.molde, mid)
                if pattern in seen_patterns:
                    continue
                seen_patterns.add(pattern)

                setup_h = config.default_setup_hours if config else 0.5

                alerts.append(Alert(
                    id=_next_id(),
                    regra="R8",
                    severidade="info",
                    titulo=f"Setup evitavel em {mid}: {a.molde}/{b.molde}",
                    mensagem=(
                        f"Em {mid}, sequencia {a.molde} -> {b.molde} -> {a.molde} "
                        f"causa setup extra. Reagrupar pode poupar ~{setup_h:.1f}h."
                    ),
                    timestamp=_now_iso(),
                    moldes_afetados=sorted({a.molde, b.molde}),
                    maquinas_afetadas=[mid],
                    operacoes=[a.op_id, b.op_id, c.op_id],
                    impacto_dias=0.0,
                    sugestoes=[
                        AlertSuggestion(
                            acao=f"Reagrupar ops do molde {a.molde} consecutivamente em {mid}",
                            impacto=f"Poupar ~{setup_h:.1f}h de setup",
                            esforco="baixo",
                            mutation_type="resequence",
                            mutation_params={
                                "maquina_id": mid,
                                "molde": a.molde,
                            },
                        ),
                    ],
                ))

    return alerts


# ── R9: Caminho critico alterou ───────────────────────────────────────


def r9_caminho_critico_alterou(
    critico_anterior: list[int],
    critico_atual: list[int],
) -> list[Alert]:
    """Critical path changed between schedule runs.

    Severity: info. Flags newly critical and no-longer-critical ops.
    """
    set_ant = set(critico_anterior) if critico_anterior else set()
    set_atu = set(critico_atual) if critico_atual else set()

    if set_ant == set_atu:
        return []

    novos = sorted(set_atu - set_ant)
    removidos = sorted(set_ant - set_atu)

    parts: list[str] = []
    if novos:
        parts.append(f"Novas ops criticas: {novos[:10]}")
    if removidos:
        parts.append(f"Ops que sairam do critico: {removidos[:10]}")

    return [Alert(
        id=_next_id(),
        regra="R9",
        severidade="info",
        titulo=f"Caminho critico alterado ({len(novos)} novas, {len(removidos)} removidas)",
        mensagem=". ".join(parts) + ".",
        timestamp=_now_iso(),
        moldes_afetados=[],
        maquinas_afetadas=[],
        operacoes=sorted(set_atu)[:20],
        impacto_dias=0.0,
        sugestoes=[
            AlertSuggestion(
                acao="Rever planeamento — caminho critico mudou",
                impacto="Prioridades podem estar desalinhadas",
                esforco="baixo",
            ),
        ],
    )]
