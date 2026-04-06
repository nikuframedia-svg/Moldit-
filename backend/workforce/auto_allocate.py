"""Automatic operator-to-machine allocation — Moldit Planner.

Uses the Hungarian algorithm (scipy.optimize.linear_sum_assignment) when
available, falling back to a greedy heuristic otherwise.
"""

from __future__ import annotations

import logging

from backend.workforce.types import (
    CompetenciasMaquina,
    Operador,
    WorkforceAllocation,
)

logger = logging.getLogger(__name__)

_INFINITY = 1_000_000


def _operator_can_cover(
    op: Operador,
    comp_req: CompetenciasMaquina,
    turno: str,
) -> bool:
    """Check whether an operator satisfies machine requirements."""
    if not op.disponivel:
        return False
    if op.turno != turno:
        return False
    for c in comp_req.competencias_necessarias:
        if c not in op.competencias:
            return False
        if op.nivel.get(c, 0) < comp_req.nivel_minimo:
            return False
    return True


def _operator_cost(op: Operador, comp_req: CompetenciasMaquina) -> float:
    """Cost of assigning operator to machine. Lower = better.

    Uses negative skill level so that the most skilled operator wins.
    """
    if not comp_req.competencias_necessarias:
        return 0.0
    total_nivel = sum(op.nivel.get(c, 0) for c in comp_req.competencias_necessarias)
    return -total_nivel


def _greedy_allocate(
    dia: int,
    turno: str,
    machines: list[str],
    operadores: list[Operador],
    competencias: dict[str, CompetenciasMaquina],
) -> list[WorkforceAllocation]:
    """Greedy fallback when scipy is unavailable."""
    allocations: list[WorkforceAllocation] = []
    used_ops: set[str] = set()

    # Sort machines by number of qualified operators (ascending) — most
    # constrained first.
    def _n_qualified(mid: str) -> int:
        cr = competencias.get(mid)
        if cr is None:
            return _INFINITY
        return sum(
            1 for op in operadores
            if _operator_can_cover(op, cr, turno) and op.id not in used_ops
        )

    sorted_machines = sorted(machines, key=_n_qualified)

    for mid in sorted_machines:
        cr = competencias.get(mid)
        if cr is None:
            continue
        # Find best available operator
        best_op: Operador | None = None
        best_cost = _INFINITY
        for op in operadores:
            if op.id in used_ops:
                continue
            if not _operator_can_cover(op, cr, turno):
                continue
            cost = _operator_cost(op, cr)
            if cost < best_cost:
                best_cost = cost
                best_op = op

        if best_op is not None:
            used_ops.add(best_op.id)
            allocations.append(WorkforceAllocation(
                dia=dia,
                turno=turno,
                maquina_id=mid,
                operador_id=best_op.id,
                auto=True,
            ))

    return allocations


def auto_allocate(
    dia: int,
    turno: str,
    segmentos: list,
    operadores: list[Operador],
    competencias: dict[str, CompetenciasMaquina],
) -> list[WorkforceAllocation]:
    """Compute optimal operator-to-machine assignments for a day/shift.

    Parameters
    ----------
    dia : int
        Work day index.
    turno : str
        Shift identifier (e.g. "A" or "B").
    segmentos : list[SegmentoMoldit]
        Full schedule segments (filtered here to the target day).
    operadores : list[Operador]
        All operators (filtered to available + correct shift).
    competencias : dict[str, CompetenciasMaquina]
        Machine competency requirements.

    Returns
    -------
    list[WorkforceAllocation]
        One allocation per assigned operator-machine pair.
    """
    # Active machines for this day (any shift overlap)
    active_machines: list[str] = sorted({
        s.maquina_id for s in segmentos if s.dia == dia
    })

    if not active_machines:
        return []

    # Filter to machines that actually need operators
    machines = [
        mid for mid in active_machines
        if mid in competencias and competencias[mid].competencias_necessarias
    ]
    if not machines:
        return []

    # Available operators
    avail_ops = [op for op in operadores if op.disponivel and op.turno == turno]
    if not avail_ops:
        return []

    # Try scipy Hungarian method
    try:
        from scipy.optimize import linear_sum_assignment  # type: ignore[import-untyped]
        return _hungarian_allocate(
            dia, turno, machines, avail_ops, competencias, linear_sum_assignment,
        )
    except ImportError:
        logger.debug("scipy unavailable — using greedy allocation")
        return _greedy_allocate(dia, turno, machines, avail_ops, competencias)


def _hungarian_allocate(
    dia: int,
    turno: str,
    machines: list[str],
    operadores: list[Operador],
    competencias: dict[str, CompetenciasMaquina],
    linear_sum_assignment,  # noqa: ANN001
) -> list[WorkforceAllocation]:
    """Optimal assignment via the Hungarian algorithm."""
    # Build cost matrix: rows = operators, cols = machines
    cost: list[list[float]] = []
    for op in operadores:
        row: list[float] = []
        for mid in machines:
            cr = competencias.get(mid)
            if cr is None or not _operator_can_cover(op, cr, turno):
                row.append(_INFINITY)
            else:
                row.append(_operator_cost(op, cr))
        cost.append(row)

    row_idx, col_idx = linear_sum_assignment(cost)

    allocations: list[WorkforceAllocation] = []
    for r, c in zip(row_idx, col_idx):
        if cost[r][c] >= _INFINITY:
            continue  # infeasible pair
        allocations.append(WorkforceAllocation(
            dia=dia,
            turno=turno,
            maquina_id=machines[c],
            operador_id=operadores[r].id,
            auto=True,
        ))

    return allocations
