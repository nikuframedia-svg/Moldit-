"""Workforce conflict detector — Moldit Planner.

Analyses the schedule to find day/shift slots where the workforce
is insufficient, mismatched, or conflicting.
"""

from __future__ import annotations

import logging
from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.workforce.types import (
    CompetenciasMaquina,
    Operador,
    WorkforceConflict,
)

logger = logging.getLogger(__name__)

# Shift boundary defaults (minutes from midnight)
_SHIFT_A_START = 420   # 07:00
_SHIFT_A_END = 930     # 15:30
_SHIFT_B_END = 1440    # 24:00


def _shift_for_hour(hora_h: float, config: FactoryConfig | None) -> str:
    """Map a fractional hour within a day to a shift ID."""
    hora_min = hora_h * 60
    if config and config.shifts:
        for s in config.shifts:
            if s.start_min <= hora_min < s.end_min:
                return s.id
        # If beyond all shifts, assign to last
        return config.shifts[-1].id
    # Fallback: A before 15:30, B after
    return "A" if hora_min < _SHIFT_A_END else "B"


def _machines_in_slot(
    segmentos: list,
    dia: int,
    turno: str,
    config: FactoryConfig | None,
) -> list[str]:
    """Return machine IDs that have active work in a given (day, shift)."""
    machines: set[str] = set()
    for seg in segmentos:
        if seg.dia != dia:
            continue
        # Check if any part of the segment overlaps this shift
        seg_shift = _shift_for_hour(seg.inicio_h, config)
        seg_end_shift = (
            _shift_for_hour(seg.fim_h - 0.01, config)
            if seg.fim_h > seg.inicio_h else seg_shift
        )
        if turno in (seg_shift, seg_end_shift):
            machines.add(seg.maquina_id)
    return sorted(machines)


def _operators_for_competency(
    operadores: list[Operador],
    competencias_req: list[str],
    nivel_minimo: int,
    turno: str,
) -> list[Operador]:
    """Filter available operators that can cover required competencies in shift."""
    result: list[Operador] = []
    for op in operadores:
        if not op.disponivel:
            continue
        if op.turno != turno:
            continue
        # Operator must have ALL required competencies at minimum level
        has_all = True
        for comp in competencias_req:
            if comp not in op.competencias:
                has_all = False
                break
            if op.nivel.get(comp, 0) < nivel_minimo:
                has_all = False
                break
        if has_all:
            result.append(op)
    return result


def detectar_conflitos(
    segmentos: list,
    operadores: list[Operador],
    competencias: dict[str, CompetenciasMaquina],
    config: FactoryConfig | None = None,
) -> list[WorkforceConflict]:
    """Detect workforce conflicts across all day/shift slots.

    Conflict types
    --------------
    - sobreposicao: more active machines than total available operators
    - subdimensionamento: a machine group needs more operators than available
    - competencia: no operator has the required competency/level
    - turno: machines active in a shift with no operators assigned to that shift
    """
    conflicts: list[WorkforceConflict] = []

    # Determine day range from segments
    if not segmentos:
        return conflicts
    max_dia = max(s.dia for s in segmentos)

    # Determine shifts
    shift_ids = [s.id for s in config.shifts] if config and config.shifts else ["A", "B"]

    for dia in range(0, max_dia + 1):
        for turno in shift_ids:
            active_machines = _machines_in_slot(segmentos, dia, turno, config)
            if not active_machines:
                continue

            # ── Total available operators for this shift ──
            ops_turno = [op for op in operadores if op.disponivel and op.turno == turno]
            total_needed = 0

            # Track per-group needs
            group_needs: dict[str, list[str]] = defaultdict(list)
            machines_no_comp: list[str] = []

            for mid in active_machines:
                comp_req = competencias.get(mid)
                if comp_req is None:
                    # Unknown machine — skip
                    continue

                n_needed = comp_req.n_operadores
                total_needed += n_needed
                group_needs[comp_req.grupo].append(mid)

                # Check competency match
                qualified = _operators_for_competency(
                    operadores,
                    comp_req.competencias_necessarias,
                    comp_req.nivel_minimo,
                    turno,
                )
                if not qualified and comp_req.competencias_necessarias:
                    machines_no_comp.append(mid)

            # ── 1) Sobreposicao: total demand > total supply ──
            if total_needed > len(ops_turno):
                deficit = total_needed - len(ops_turno)
                conflicts.append(WorkforceConflict(
                    tipo="sobreposicao",
                    dia=dia,
                    turno=turno,
                    maquinas=active_machines,
                    operadores_necessarios=total_needed,
                    operadores_disponiveis=len(ops_turno),
                    deficit=deficit,
                    descricao=(
                        f"Dia {dia}, turno {turno}: {total_needed} operadores necessarios "
                        f"mas apenas {len(ops_turno)} disponiveis ({deficit} em falta)"
                    ),
                    severidade="alta" if deficit >= 3 else "media",
                ))

            # ── 2) Subdimensionamento per group ──
            for grupo, group_machines in group_needs.items():
                n_group_needed = sum(
                    competencias[m].n_operadores
                    for m in group_machines
                    if m in competencias
                )
                qualified_for_group: set[str] = set()
                for m in group_machines:
                    cr = competencias.get(m)
                    if cr is None:
                        continue
                    for op in _operators_for_competency(
                        operadores, cr.competencias_necessarias, cr.nivel_minimo, turno,
                    ):
                        qualified_for_group.add(op.id)

                if n_group_needed > len(qualified_for_group) and qualified_for_group:
                    deficit = n_group_needed - len(qualified_for_group)
                    conflicts.append(WorkforceConflict(
                        tipo="subdimensionamento",
                        dia=dia,
                        turno=turno,
                        maquinas=group_machines,
                        operadores_necessarios=n_group_needed,
                        operadores_disponiveis=len(qualified_for_group),
                        deficit=deficit,
                        descricao=(
                            f"Dia {dia}, turno {turno}, grupo {grupo}: "
                            f"{n_group_needed} operadores necessarios, "
                            f"{len(qualified_for_group)} qualificados"
                        ),
                        severidade="media",
                    ))

            # ── 3) Competencia: machines with no qualified operator ──
            if machines_no_comp:
                conflicts.append(WorkforceConflict(
                    tipo="competencia",
                    dia=dia,
                    turno=turno,
                    maquinas=machines_no_comp,
                    operadores_necessarios=len(machines_no_comp),
                    operadores_disponiveis=0,
                    deficit=len(machines_no_comp),
                    descricao=(
                        f"Dia {dia}, turno {turno}: nenhum operador qualificado "
                        f"para {len(machines_no_comp)} maquina(s): "
                        + ", ".join(machines_no_comp[:5])
                    ),
                    severidade="alta",
                ))

            # ── 4) Turno: active machines but zero operators for shift ──
            if active_machines and not ops_turno:
                conflicts.append(WorkforceConflict(
                    tipo="turno",
                    dia=dia,
                    turno=turno,
                    maquinas=active_machines,
                    operadores_necessarios=total_needed,
                    operadores_disponiveis=0,
                    deficit=total_needed,
                    descricao=(
                        f"Dia {dia}, turno {turno}: {len(active_machines)} maquinas "
                        f"activas mas nenhum operador atribuido a este turno"
                    ),
                    severidade="alta",
                ))

    return conflicts
