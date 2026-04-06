"""VNS Post-Processing -- Moldit Planner.

Variable Neighbourhood Search with correct re-dispatch evaluation.
Mutates machine ASSIGNMENTS, then re-runs the full dispatch pipeline
to produce valid schedules. Slower per iteration but correct.

Neighbourhoods:
  N1: relocate_op     — move 1 op to a different compatible machine
  N2: swap_machines    — swap machine assignments of 2 compatible ops
  N3: boost_mold       — adjust priority of 1 mold (reorder priority queue)
"""

from __future__ import annotations

import logging
import random
import time

from backend.config.types import FactoryConfig
from backend.scheduler.dispatch import (
    build_priority_queue,
    dispatch_timeline,
)
from backend.scheduler.scoring import compute_score
from backend.scheduler.types import ScheduleResult, SegmentoMoldit
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)


def _extract_assignments(
    segmentos: list[SegmentoMoldit],
) -> dict[int, str]:
    """Extract op_id → machine_id from existing segments."""
    asgn: dict[int, str] = {}
    for s in segmentos:
        if s.op_id not in asgn:
            asgn[s.op_id] = s.maquina_id
    return asgn


def _evaluate(
    assignments: dict[int, str],
    data: MolditEngineData,
    config: FactoryConfig,
) -> tuple[list[SegmentoMoldit], dict]:
    """Re-dispatch with given assignments and score the result."""
    ops_by_id = {op.id: op for op in data.operacoes}
    machines = {m.id: m for m in data.maquinas}

    pq = build_priority_queue(
        data.operacoes, data.dag, data.dag_reverso,
        data.moldes, data.caminho_critico,
    )

    segs = dispatch_timeline(
        ops_by_id, pq, assignments, data.dag_reverso,
        machines, config,
        ref_date=data.data_referencia,
        holidays=data.feriados or config.holidays,
    )

    score = compute_score(segs, data, config)
    return segs, score


# ── Neighbourhoods ───────────────────────────────────────────────────


def _relocate_op(
    assignments: dict[int, str],
    data: MolditEngineData,
    rng: random.Random,
) -> dict[int, str] | None:
    """N1: Move 1 random op to a different compatible machine."""
    ops_by_id = {op.id: op for op in data.operacoes}
    candidates = list(assignments.keys())
    if not candidates:
        return None

    op_id = rng.choice(candidates)
    op = ops_by_id.get(op_id)
    if not op:
        return None

    compat = data.compatibilidade.get(op.codigo, [])
    machine_set = {m.id for m in data.maquinas}
    current = assignments[op_id]
    alts = [m for m in compat if m in machine_set and m != current]
    if not alts:
        return None

    new_asgn = dict(assignments)
    new_asgn[op_id] = rng.choice(alts)
    return new_asgn


def _swap_machines(
    assignments: dict[int, str],
    data: MolditEngineData,
    rng: random.Random,
) -> dict[int, str] | None:
    """N2: Swap machine assignments of 2 ops (if mutually compatible)."""
    ops_by_id = {op.id: op for op in data.operacoes}
    machine_set = {m.id for m in data.maquinas}
    candidates = list(assignments.keys())
    if len(candidates) < 2:
        return None

    a_id, b_id = rng.sample(candidates, 2)
    a_machine = assignments[a_id]
    b_machine = assignments[b_id]
    if a_machine == b_machine:
        return None

    op_a = ops_by_id.get(a_id)
    op_b = ops_by_id.get(b_id)
    if not op_a or not op_b:
        return None

    compat_a = set(data.compatibilidade.get(op_a.codigo, []))
    compat_b = set(data.compatibilidade.get(op_b.codigo, []))

    if b_machine not in compat_a or a_machine not in compat_b:
        return None
    if b_machine not in machine_set or a_machine not in machine_set:
        return None

    new_asgn = dict(assignments)
    new_asgn[a_id] = b_machine
    new_asgn[b_id] = a_machine
    return new_asgn


def _boost_mold(
    assignments: dict[int, str],
    data: MolditEngineData,
    rng: random.Random,
) -> dict[int, str] | None:
    """N3: Re-assign all ops of 1 mold to their least-loaded alternatives.

    This shakes up the schedule by moving an entire mold's workload,
    potentially freeing bottleneck machines.
    """
    ops_by_id = {op.id: op for op in data.operacoes}
    machine_set = {m.id for m in data.maquinas}
    molds = list({op.molde for op in data.operacoes if op.id in assignments})
    if not molds:
        return None

    target_mold = rng.choice(molds)
    mold_ops = [oid for oid in assignments
                if ops_by_id.get(oid) and ops_by_id[oid].molde == target_mold]
    if not mold_ops:
        return None

    new_asgn = dict(assignments)
    changed = False
    for oid in mold_ops:
        op = ops_by_id[oid]
        compat = data.compatibilidade.get(op.codigo, [])
        alts = [m for m in compat if m in machine_set and m != assignments[oid]]
        if alts:
            new_asgn[oid] = rng.choice(alts)
            changed = True

    return new_asgn if changed else None


def _relieve_bottleneck(
    assignments: dict[int, str],
    data: MolditEngineData,
    rng: random.Random,
) -> dict[int, str] | None:
    """N4: Move an op from the most loaded machine to a less loaded one.

    Guided neighbourhood: targets the bottleneck directly instead of
    random exploration.
    """
    ops_by_id = {op.id: op for op in data.operacoes}
    machine_set = {m.id for m in data.maquinas}

    # Compute load per machine
    load: dict[str, float] = {}
    ops_on: dict[str, list[int]] = {}
    for oid, mid in assignments.items():
        op = ops_by_id.get(oid)
        if not op:
            continue
        load[mid] = load.get(mid, 0) + op.work_restante_h
        ops_on.setdefault(mid, []).append(oid)

    if not load:
        return None

    # Pick the most loaded machine
    busiest = max(load, key=lambda m: load[m])
    candidates = ops_on.get(busiest, [])
    if not candidates:
        return None

    # Pick a random op from the busiest machine
    op_id = rng.choice(candidates)
    op = ops_by_id.get(op_id)
    if not op:
        return None

    compat = data.compatibilidade.get(op.codigo, [])
    alts = [m for m in compat if m in machine_set and m != busiest]
    if not alts:
        return None

    # Move to least loaded alternative
    target = min(alts, key=lambda m: load.get(m, 0))
    new_asgn = dict(assignments)
    new_asgn[op_id] = target
    return new_asgn


def _compress_mold(
    assignments: dict[int, str],
    data: MolditEngineData,
    rng: random.Random,
) -> dict[int, str] | None:
    """N5: Consolidate ops of 1 mold onto fewer machines to reduce setups.

    Picks a mold, finds which machine has the most ops for it,
    and tries to move other ops of that mold to the same machine.
    """
    ops_by_id = {op.id: op for op in data.operacoes}
    machine_set = {m.id for m in data.maquinas}
    molds = list({ops_by_id[oid].molde for oid in assignments if oid in ops_by_id})
    if not molds:
        return None

    target_mold = rng.choice(molds)
    mold_ops = [
        oid for oid in assignments
        if ops_by_id.get(oid) and ops_by_id[oid].molde == target_mold
    ]
    if len(mold_ops) < 2:
        return None

    # Find which machine has most ops for this mold
    machine_count: dict[str, int] = {}
    for oid in mold_ops:
        mid = assignments[oid]
        machine_count[mid] = machine_count.get(mid, 0) + 1
    dominant = max(machine_count, key=lambda m: machine_count[m])

    # Try to move other ops to the dominant machine (if compatible)
    new_asgn = dict(assignments)
    changed = False
    for oid in mold_ops:
        if assignments[oid] == dominant:
            continue
        op = ops_by_id[oid]
        compat = data.compatibilidade.get(op.codigo, [])
        if dominant in compat and dominant in machine_set:
            new_asgn[oid] = dominant
            changed = True

    return new_asgn if changed else None


_NEIGHBORHOODS = [
    _relocate_op,
    _swap_machines,
    _boost_mold,
    _relieve_bottleneck,
    _compress_mold,
]


# ── Main VNS loop ───────────────────────────────────────────────────


def vns_polish(
    result: ScheduleResult,
    data: MolditEngineData,
    config: FactoryConfig,
    max_iter: int = 150,
    seed: int = 42,
    time_budget: float = 5.0,
) -> ScheduleResult:
    """VNS local search to improve a schedule.

    Mutates machine assignments, re-dispatches fully, and accepts
    strictly improving moves. Returns improved ScheduleResult or
    original if no improvement found.

    Per APS best practice: never return a result worse than baseline.
    """
    if not result.segmentos:
        return result

    rng = random.Random(seed)
    t0 = time.perf_counter()

    best_asgn = _extract_assignments(result.segmentos)
    best_segs = result.segmentos
    best_score = result.score
    best_ws = best_score.get("weighted_score", 0.0)

    k = 0  # current neighbourhood
    improvements = 0
    iterations = 0

    for iterations in range(max_iter):
        if time.perf_counter() - t0 > time_budget:
            break

        nhood = _NEIGHBORHOODS[k]
        candidate_asgn = nhood(best_asgn, data, rng)

        if candidate_asgn is None:
            k = (k + 1) % len(_NEIGHBORHOODS)
            continue

        # Full re-dispatch and score (correct evaluation)
        try:
            candidate_segs, candidate_score = _evaluate(
                candidate_asgn, data, config,
            )
        except Exception:
            k = (k + 1) % len(_NEIGHBORHOODS)
            continue

        candidate_ws = candidate_score.get("weighted_score", 0.0)

        if candidate_ws > best_ws:
            best_asgn = candidate_asgn
            best_segs = candidate_segs
            best_score = candidate_score
            best_ws = candidate_ws
            improvements += 1
            k = 0  # restart from N1
        else:
            k = (k + 1) % len(_NEIGHBORHOODS)

    elapsed = time.perf_counter() - t0
    if improvements > 0:
        logger.info(
            "VNS: %d improvements in %d iterations (%.1fs), "
            "score %.4f → %.4f",
            improvements, iterations + 1, elapsed,
            result.score.get("weighted_score", 0), best_ws,
        )
        return ScheduleResult(
            segmentos=best_segs,
            score=best_score,
            time_ms=result.time_ms,
            warnings=result.warnings,
            alerts=result.alerts,
            caminho_critico=result.caminho_critico,
            makespan_por_molde=best_score.get("makespan_por_molde", {}),
        )

    logger.info("VNS: no improvement in %d iterations (%.1fs)", iterations + 1, elapsed)
    return result
