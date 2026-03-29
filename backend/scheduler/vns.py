"""VNS Post-Processing -- Moldit Planner.

Variable Neighbourhood Search with 4 neighbourhoods for local improvement
of a greedy schedule.

Neighbourhoods:
  N1: swap_same_machine    -- swap 2 ops on the same machine
  N2: move_to_machine      -- move 1 op to a different compatible machine
  N3: swap_between_machines -- swap 2 ops between different machines
  N4: shift_earlier        -- shift an op to an earlier slot on its machine
"""

from __future__ import annotations

import copy
import logging
import random
import time

from backend.config.types import FactoryConfig
from backend.scheduler.scoring import compute_score
from backend.scheduler.types import ScheduleResult, SegmentoMoldit
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)


def _swap_same_machine(
    segmentos: list[SegmentoMoldit], rng: random.Random,
) -> list[SegmentoMoldit] | None:
    """N1: Swap scheduling order of 2 ops on the same machine."""
    # Group non-continuation segments by machine
    by_machine: dict[str, list[int]] = {}
    for i, seg in enumerate(segmentos):
        if not seg.e_continuacao:
            by_machine.setdefault(seg.maquina_id, []).append(i)

    candidates = [m for m, idxs in by_machine.items() if len(idxs) >= 2]
    if not candidates:
        return None

    mid = rng.choice(candidates)
    idxs = by_machine[mid]
    a, b = rng.sample(idxs, 2)

    new_segs = list(segmentos)
    sa, sb = copy.copy(new_segs[a]), copy.copy(new_segs[b])
    # Swap time slots
    sa.dia, sb.dia = sb.dia, sa.dia
    sa.inicio_h, sb.inicio_h = sb.inicio_h, sa.inicio_h
    sa.fim_h, sb.fim_h = sb.fim_h, sa.fim_h
    new_segs[a] = sa
    new_segs[b] = sb
    return new_segs


def _move_to_machine(
    segmentos: list[SegmentoMoldit],
    data: MolditEngineData,
    rng: random.Random,
) -> list[SegmentoMoldit] | None:
    """N2: Move 1 op to a different compatible machine."""
    ops_by_id = {op.id: op for op in data.operacoes}
    non_cont = [i for i, s in enumerate(segmentos) if not s.e_continuacao]
    if not non_cont:
        return None

    idx = rng.choice(non_cont)
    seg = segmentos[idx]
    op = ops_by_id.get(seg.op_id)
    if not op or op.codigo not in data.compatibilidade:
        return None

    compat = data.compatibilidade[op.codigo]
    alts = [m for m in compat if m != seg.maquina_id]
    if not alts:
        return None

    new_machine = rng.choice(alts)
    new_segs = list(segmentos)
    new_seg = copy.copy(seg)
    new_seg.maquina_id = new_machine
    new_segs[idx] = new_seg
    return new_segs


def _swap_between_machines(
    segmentos: list[SegmentoMoldit],
    data: MolditEngineData,
    rng: random.Random,
) -> list[SegmentoMoldit] | None:
    """N3: Swap 2 ops between different machines (if compatible)."""
    ops_by_id = {op.id: op for op in data.operacoes}
    non_cont = [(i, s) for i, s in enumerate(segmentos) if not s.e_continuacao]
    if len(non_cont) < 2:
        return None

    (ia, sa), (ib, sb) = rng.sample(non_cont, 2)
    if sa.maquina_id == sb.maquina_id:
        return None

    op_a = ops_by_id.get(sa.op_id)
    op_b = ops_by_id.get(sb.op_id)
    if not op_a or not op_b:
        return None

    compat_a = set(data.compatibilidade.get(op_a.codigo, []))
    compat_b = set(data.compatibilidade.get(op_b.codigo, []))

    if sb.maquina_id not in compat_a or sa.maquina_id not in compat_b:
        return None

    new_segs = list(segmentos)
    new_a = copy.copy(sa)
    new_b = copy.copy(sb)
    new_a.maquina_id = sb.maquina_id
    new_b.maquina_id = sa.maquina_id
    new_a.dia, new_b.dia = new_b.dia, new_a.dia
    new_a.inicio_h, new_b.inicio_h = new_b.inicio_h, new_a.inicio_h
    new_a.fim_h, new_b.fim_h = new_b.fim_h, new_a.fim_h
    new_segs[ia] = new_a
    new_segs[ib] = new_b
    return new_segs


def _shift_earlier(
    segmentos: list[SegmentoMoldit], rng: random.Random,
) -> list[SegmentoMoldit] | None:
    """N4: Shift an op to an earlier day on its machine."""
    non_cont = [(i, s) for i, s in enumerate(segmentos) if not s.e_continuacao and s.dia > 0]
    if not non_cont:
        return None

    idx, seg = rng.choice(non_cont)
    new_segs = list(segmentos)
    new_seg = copy.copy(seg)
    new_seg.dia = max(0, seg.dia - rng.randint(1, 3))
    new_segs[idx] = new_seg
    return new_segs


_NEIGHBORHOODS = [
    _swap_same_machine,
    _move_to_machine,
    _swap_between_machines,
    _shift_earlier,
]


def vns_polish(
    result: ScheduleResult,
    data: MolditEngineData,
    config: FactoryConfig,
    max_iter: int = 150,
    seed: int = 42,
    time_budget: float = 5.0,
) -> ScheduleResult:
    """VNS local search to improve a schedule.

    Cycles through 4 neighbourhoods. Accepts strictly improving moves.
    Returns improved ScheduleResult (or original if no improvement found).
    """
    if not result.segmentos:
        return result

    rng = random.Random(seed)
    t0 = time.perf_counter()

    best_segs = result.segmentos
    best_score = result.score
    best_cost = -best_score.get("weighted_score", 0.0)

    k = 0  # current neighbourhood index
    improvements = 0

    for iteration in range(max_iter):
        if time.perf_counter() - t0 > time_budget:
            break

        nhood = _NEIGHBORHOODS[k]

        # Generate neighbour
        if nhood in (_move_to_machine, _swap_between_machines):
            candidate_segs = nhood(best_segs, data, rng)
        else:
            candidate_segs = nhood(best_segs, rng)

        if candidate_segs is None:
            k = (k + 1) % len(_NEIGHBORHOODS)
            continue

        # Score candidate
        candidate_score = compute_score(candidate_segs, data, config)
        candidate_cost = -candidate_score.get("weighted_score", 0.0)

        if candidate_cost < best_cost:
            best_segs = candidate_segs
            best_score = candidate_score
            best_cost = candidate_cost
            improvements += 1
            k = 0  # restart from N1
        else:
            k = (k + 1) % len(_NEIGHBORHOODS)

    if improvements > 0:
        logger.info("VNS: %d improvements in %d iterations", improvements, iteration + 1)
        return ScheduleResult(
            segmentos=best_segs,
            score=best_score,
            time_ms=result.time_ms,
            warnings=result.warnings,
            alerts=result.alerts,
            caminho_critico=result.caminho_critico,
            makespan_por_molde=best_score.get("makespan_por_molde", {}),
        )

    return result
