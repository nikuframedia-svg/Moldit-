"""Surrogate pre-screening for CPO v3.0.

Uses RandomForest to predict fitness of chromosomes before full evaluation.
Only used in deep/max modes. Graceful fallback if sklearn unavailable.
"""

from __future__ import annotations

import logging

from backend.cpo.chromosome import MolditChromosome

logger = logging.getLogger(__name__)


class SurrogateModel:
    """RandomForest surrogate for pre-screening candidates."""

    def __init__(self, n_estimators: int = 50, min_samples: int = 30):
        self.n_estimators = n_estimators
        self.min_samples = min_samples
        self.model = None
        self.X: list[list[float]] = []
        self.y: list[float] = []
        self.is_trained = False
        self._sklearn_available: bool | None = None

    def _check_sklearn(self) -> bool:
        if self._sklearn_available is not None:
            return self._sklearn_available
        try:
            from sklearn.ensemble import RandomForestRegressor  # noqa: F401
            self._sklearn_available = True
        except ImportError:
            logger.warning("scikit-learn not available; surrogate disabled")
            self._sklearn_available = False
        return self._sklearn_available

    def _encode(self, chrom: MolditChromosome) -> list[float]:
        """Encode 4 Moldit genes as feature vector."""
        # G1: machine choice summary
        n_nonzero = sum(1 for v in chrom.machine_choice.values() if v > 0)
        n_total = max(len(chrom.machine_choice), 1)

        # G2: sequence disorder (sum of key deltas from sorted order)
        disorder = 0.0
        for keys in chrom.sequence_keys.values():
            if len(keys) >= 2:
                sorted_keys = sorted(keys)
                for k, s in zip(keys, sorted_keys):
                    disorder += abs(k - s)

        # G3: mold priority stats
        priorities = list(chrom.mold_priority.values()) if chrom.mold_priority else [1.0]
        priority_mean = sum(priorities) / len(priorities)
        priority_spread = max(priorities) - min(priorities)

        # G4: setup aversion
        return [
            float(n_nonzero) / float(n_total),
            disorder,
            priority_mean,
            priority_spread,
            chrom.setup_aversion,
        ]

    def add_sample(self, chrom: MolditChromosome, cost: float) -> None:
        self.X.append(self._encode(chrom))
        self.y.append(cost)

    def train(self) -> bool:
        if not self._check_sklearn():
            return False
        if len(self.X) < self.min_samples:
            return False

        from sklearn.ensemble import RandomForestRegressor

        self.model = RandomForestRegressor(
            n_estimators=self.n_estimators,
            max_depth=8,
            random_state=42,
        )
        self.model.fit(self.X, self.y)
        self.is_trained = True
        return True

    def predict(self, chrom: MolditChromosome) -> float:
        if not self.is_trained or self.model is None:
            return float("inf")
        features = self._encode(chrom)
        return float(self.model.predict([features])[0])

    def should_evaluate(
        self, chrom: MolditChromosome, best_cost: float, threshold: float = 1.3,
    ) -> bool:
        """Return True if chromosome is worth full evaluation."""
        if not self.is_trained:
            return True
        n = len(self.X)
        ratio = max(0, (self.min_samples * 2 - n) / (self.min_samples * 2))
        adaptive_threshold = threshold + ratio * 0.5
        predicted = self.predict(chrom)
        return predicted < best_cost * adaptive_threshold
