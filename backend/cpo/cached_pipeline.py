"""CachedPipeline for CPO v3.0 -- Moldit Planner.

Evaluates chromosomes via schedule_all(), with hash-based caching to avoid
redundant evaluations.
"""

from __future__ import annotations

import logging

from backend.config.types import FactoryConfig
from backend.cpo.chromosome import MolditChromosome
from backend.scheduler.scheduler import schedule_all
from backend.scheduler.types import ScheduleResult
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)


class CachedPipeline:
    """Evaluate chromosomes by applying genes then running schedule_all().

    Caches results by chromosome hash to avoid redundant scheduling.
    """

    def __init__(
        self,
        data: MolditEngineData,
        config: FactoryConfig,
    ):
        self.data = data
        self.config = config
        self._cache: dict[str, tuple[ScheduleResult, float]] = {}
        self.eval_count: int = 0
        self.cache_hits: int = 0

    def evaluate(self, chrom: MolditChromosome) -> tuple[ScheduleResult, float]:
        """Evaluate chromosome, returning (ScheduleResult, cost).

        Cost = negative weighted_score (lower is better for minimization).
        """
        h = chrom.compute_hash()
        if h in self._cache:
            self.cache_hits += 1
            return self._cache[h]

        self.eval_count += 1

        # Apply chromosome to data, then schedule
        modified_data = chrom.apply_to_data(self.data, self.config)
        result = schedule_all(modified_data, config=self.config)

        # Cost: negate weighted_score so lower = better
        cost = -result.score.get("weighted_score", 0.0)

        self._cache[h] = (result, cost)
        return result, cost

    def cost_of(self, chrom: MolditChromosome) -> float:
        """Convenience: return just the cost."""
        _, cost = self.evaluate(chrom)
        return cost

    @property
    def cache_size(self) -> int:
        return len(self._cache)
