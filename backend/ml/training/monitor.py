"""Model Monitor — Moldit ML.

Tracks prediction quality over time and detects drift.
"""
from __future__ import annotations

import logging

from backend.ml.data_model import EvolutionPoint
from backend.ml.store import MLStore
from backend.ml.training.evaluator import ModelEvaluator

logger = logging.getLogger(__name__)


class ModelMonitor:
    """Monitors ML model quality over time."""

    def __init__(self, store: MLStore) -> None:
        self.store = store
        self.evaluator = ModelEvaluator()

    def compute_rolling_metrics(self, window: int = 100) -> dict:
        """Compute rolling metrics from recent predictions with actual values."""
        preds = self.store.get_predictions_with_actuals(limit=window)
        if not preds:
            return {"mae": 0, "rmse": 0, "coverage": 0, "n": 0}
        return self.evaluator.evaluate_m1_rolling(preds)

    def detect_drift(self) -> list[str]:
        """Check all models for quality degradation."""
        warnings = []

        # M1 rolling check
        metrics = self.compute_rolling_metrics()
        if metrics["n"] >= 20:
            w = self.evaluator.check_degradation("M1_duration", metrics)
            warnings.extend(w)

        return warnings

    def get_evolution(self, n_months: int = 6) -> list[EvolutionPoint]:
        """Get model evolution points for the chart.

        Groups predictions by month and computes MAE/coverage per month.
        """
        preds = self.store.get_predictions_with_actuals(limit=5000)
        if not preds:
            return []

        # Group by month
        by_month: dict[str, list[dict]] = {}
        for p in preds:
            created = p.get("created_at", "")
            if len(created) >= 7:
                month_key = created[:7]  # 'YYYY-MM'
            else:
                continue
            if month_key not in by_month:
                by_month[month_key] = []
            by_month[month_key].append(p)

        points = []
        for month, month_preds in sorted(by_month.items()):
            metrics = self.evaluator.evaluate_m1_rolling(month_preds)
            points.append(EvolutionPoint(
                date=month,
                mae=metrics["mae"],
                coverage=metrics["coverage"],
                n_samples=metrics["n"],
            ))

        return points
