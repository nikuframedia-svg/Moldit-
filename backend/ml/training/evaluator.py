"""Model Evaluator — Moldit ML.

Computes quality metrics and checks for model degradation.
"""
from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)

# Quality thresholds per model
THRESHOLDS = {
    "M1_duration": {"mae": 1.5, "coverage": 0.80},
    "M2_risk": {"auc_roc": 0.75},
    "M4_machine": {"ndcg": 0.7},
    "M5_anomaly": {"f1": 0.6},
}


class ModelEvaluator:
    """Evaluates ML model quality and detects degradation."""

    def evaluate_m1_rolling(self, predictions_with_actuals: list[dict]) -> dict:
        """Evaluate M1 from stored predictions that now have actual values.

        Each dict: predicted_h, p10, p90, actual_h.
        """
        if not predictions_with_actuals:
            return {"mae": 0, "rmse": 0, "coverage": 0, "n": 0}

        preds = np.array([p["predicted_h"] for p in predictions_with_actuals])
        actuals = np.array([p["actual_h"] for p in predictions_with_actuals])
        p10s = np.array([p["p10"] for p in predictions_with_actuals])
        p90s = np.array([p["p90"] for p in predictions_with_actuals])

        errors = np.abs(preds - actuals)
        mae = float(errors.mean())
        rmse = float(np.sqrt(np.mean(errors ** 2)))
        in_interval = ((actuals >= p10s) & (actuals <= p90s)).mean()

        return {
            "mae": round(mae, 3),
            "rmse": round(rmse, 3),
            "coverage": round(float(in_interval), 3),
            "n": len(predictions_with_actuals),
        }

    def check_degradation(
        self,
        model_name: str,
        current_metrics: dict,
    ) -> list[str]:
        """Check if a model's metrics are below thresholds."""
        warnings = []
        thresholds = THRESHOLDS.get(model_name, {})

        for metric, threshold in thresholds.items():
            value = current_metrics.get(metric, 0)
            if metric in ("mae",):
                # For MAE, lower is better
                if value > threshold:
                    warnings.append(
                        f"{model_name}: {metric}={value:.3f} > threshold {threshold}"
                    )
            else:
                # For others, higher is better
                if value < threshold:
                    warnings.append(
                        f"{model_name}: {metric}={value:.3f} < threshold {threshold}"
                    )

        return warnings
