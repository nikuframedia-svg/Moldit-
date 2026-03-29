"""CPO v3.0 Optimizer -- Entry point.

Modes:
  quick  (~200ms): greedy baseline only (schedule_all passthrough)
  normal (5-15s):  Phase 0 (greedy) + Phase 1 (GA polish)
  deep   (1-3min): + surrogate pre-screening + larger population
  max    (5min+):  + MAP-Elites + full search
"""

from __future__ import annotations

import logging
import random
import time

from backend.config.loader import load_config
from backend.config.types import FactoryConfig
from backend.cpo.cached_pipeline import CachedPipeline
from backend.cpo.chromosome import (
    OPERATORS,
    MolditChromosome,
    crossover_uniform,
    mutate_strong,
)
from backend.cpo.population import FRRMAB, MAPElitesArchive, OneFifthRule, tournament_select
from backend.cpo.surrogate import SurrogateModel
from backend.scheduler.scheduler import schedule_all
from backend.scheduler.types import ScheduleResult
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)


# Mode configurations
MODE_CONFIG = {
    "quick": {
        "pop_size": 0,
        "max_gen": 0,
        "time_budget": 0.5,
        "use_surrogate": False,
        "use_archive": False,
    },
    "normal": {
        "pop_size": 20,
        "max_gen": 30,
        "time_budget": 15.0,
        "use_surrogate": False,
        "use_archive": True,
    },
    "deep": {
        "pop_size": 40,
        "max_gen": 100,
        "time_budget": 120.0,
        "use_surrogate": True,
        "use_archive": True,
    },
    "max": {
        "pop_size": 60,
        "max_gen": 300,
        "time_budget": 300.0,
        "use_surrogate": True,
        "use_archive": True,
    },
}


def optimize(
    engine_data: MolditEngineData,
    mode: str = "normal",
    config: FactoryConfig | None = None,
    seed: int | None = 42,
    audit: bool = False,
) -> ScheduleResult:
    """CPO v3.0 entry point.

    1. Baseline via schedule_all()
    2. from_baseline() -> chrom0
    3. Population init with mutate_strong
    4. Evolution loop with FRRMAB, tournament, elitism
    5. Never return worse than baseline
    """
    t0 = time.perf_counter()
    rng = random.Random(seed)

    if config is None:
        config = load_config()

    mc = MODE_CONFIG.get(mode, MODE_CONFIG["normal"])

    # Phase 0: Greedy baseline
    baseline = schedule_all(engine_data, config=config)
    baseline_cost = -baseline.score.get("weighted_score", 0.0)

    if mc["pop_size"] == 0 or mc["max_gen"] == 0:
        # quick mode: return baseline directly
        baseline.time_ms = round((time.perf_counter() - t0) * 1000, 1)
        return baseline

    # Phase 1: GA optimization
    pipeline = CachedPipeline(engine_data, config)

    # Build baseline chromosome
    chrom0 = MolditChromosome.from_baseline(baseline.segmentos, engine_data)

    # Initialize population with mutations of baseline
    pop_size = mc["pop_size"]
    population: list[tuple[MolditChromosome, float]] = [(chrom0, baseline_cost)]

    for _ in range(pop_size - 1):
        mutant = mutate_strong(chrom0, rng, engine_data)
        cost = pipeline.cost_of(mutant)
        population.append((mutant, cost))

    # Sort: lowest cost first
    population.sort(key=lambda x: x[1])
    best_chrom, best_cost = population[0]
    best_result = pipeline.evaluate(best_chrom)[0]

    # Adaptive operator selection
    op_names = list(OPERATORS.keys())
    bandit = FRRMAB(op_names)
    rate = OneFifthRule()

    # Optional components
    surrogate = SurrogateModel() if mc["use_surrogate"] else None
    archive = MAPElitesArchive() if mc["use_archive"] else None

    time_budget = mc["time_budget"]
    max_gen = mc["max_gen"]
    journal: list[dict] = [] if audit else None  # type: ignore[assignment]

    for gen in range(max_gen):
        elapsed = time.perf_counter() - t0
        if elapsed > time_budget:
            logger.info("Time budget exhausted at gen %d (%.1fs)", gen, elapsed)
            break

        # Train surrogate periodically
        if surrogate and gen % 10 == 0 and gen > 0:
            surrogate.train()

        new_pop: list[tuple[MolditChromosome, float]] = []

        for _ in range(pop_size):
            # Select parents
            parent_a = tournament_select(population, k=3, rng=rng)

            if rng.random() < rate.rate:
                # Mutation
                op_name = bandit.select(rng)
                op_fn = OPERATORS[op_name]
                child = op_fn(parent_a, rng, engine_data)
            else:
                # Crossover
                parent_b = tournament_select(population, k=3, rng=rng)
                child = crossover_uniform(parent_a, parent_b, rng, engine_data)
                op_name = "crossover"

            # Surrogate pre-screening
            if surrogate and surrogate.is_trained:
                if not surrogate.should_evaluate(child, best_cost):
                    continue

            # Evaluate
            result, cost = pipeline.evaluate(child)

            # Update surrogate
            if surrogate:
                surrogate.add_sample(child, cost)

            # Update archive
            if archive:
                archive.try_insert(child, result.score, cost)

            # Track improvement
            improved = cost < best_cost
            if op_name != "crossover":
                bandit.update(op_name, 1.0 if improved else 0.0)
            rate.record(improved)

            if improved:
                best_chrom = child
                best_cost = cost
                best_result = result
                logger.debug("Gen %d: new best cost=%.4f", gen, cost)

            new_pop.append((child, cost))

        # Elitism: keep top 20% from previous generation
        elite_n = max(2, pop_size // 5)
        population.sort(key=lambda x: x[1])
        elites = population[:elite_n]

        # Merge new pop + elites, keep top pop_size
        combined = elites + new_pop
        combined.sort(key=lambda x: x[1])
        population = combined[:pop_size]

        if journal is not None:
            journal.append({
                "gen": gen,
                "best_cost": best_cost,
                "evals": pipeline.eval_count,
                "cache_hits": pipeline.cache_hits,
            })

    # Never return worse than baseline
    if best_cost > baseline_cost:
        best_result = baseline

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)
    best_result.time_ms = elapsed_ms

    if journal is not None:
        best_result.journal = journal

    logger.info(
        "CPO %s: %d evals, %d cache hits, %.0fms, cost %.4f -> %.4f",
        mode, pipeline.eval_count, pipeline.cache_hits, elapsed_ms,
        baseline_cost, best_cost,
    )

    return best_result
