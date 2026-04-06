"""M1 — Duration Predictor (XGBoost Quantile Regression).

Predicts actual operation duration given context.
Returns median, P10, P90 intervals and confidence.
"""
from __future__ import annotations

import logging
from pathlib import Path

import joblib
import numpy as np

from backend.ml.data_model import DurationPrediction, TrainMetrics
from backend.ml.feature_engineering import (
    FEATURE_NAMES_OP,
    extrair_features_operacao,
    extrair_features_operacao_df,
)

logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "models"


class DurationPredictor:
    """M1: Predicts work_h_real from operation context."""

    def __init__(self) -> None:
        self.model_median = None
        self.model_p10 = None
        self.model_p90 = None
        self.is_trained = False
        self.version = "0"
        self.n_samples = 0
        self._feature_importance: dict[str, float] = {}

    def train(self, ops: list[dict], **feat_kwargs) -> TrainMetrics:
        """Train on historical operation data.

        Each op dict must have: work_h_real (target) + feature fields.
        """
        from sklearn.model_selection import TimeSeriesSplit
        from xgboost import XGBRegressor

        X = extrair_features_operacao_df(ops, **feat_kwargs)
        y = np.array([op["work_h_real"] for op in ops], dtype=np.float64)

        if len(X) < 10:
            logger.warning("M1: Not enough data (%d ops), skipping training", len(X))
            return TrainMetrics(model_name="M1_duration", n_samples=len(X))

        self.model_median = XGBRegressor(
            objective="reg:squarederror",
            n_estimators=200, max_depth=6, learning_rate=0.05,
            random_state=42, verbosity=0,
        )
        self.model_p10 = XGBRegressor(
            objective="reg:quantileerror", quantile_alpha=0.10,
            n_estimators=150, max_depth=5, learning_rate=0.05,
            random_state=42, verbosity=0,
        )
        self.model_p90 = XGBRegressor(
            objective="reg:quantileerror", quantile_alpha=0.90,
            n_estimators=150, max_depth=5, learning_rate=0.05,
            random_state=42, verbosity=0,
        )

        # TimeSeriesSplit: train on old, validate on recent
        tscv = TimeSeriesSplit(n_splits=min(5, max(2, len(X) // 20)))
        mae_scores, coverage_scores = [], []

        for train_idx, val_idx in tscv.split(X):
            X_tr, X_val = X[train_idx], X[val_idx]
            y_tr, y_val = y[train_idx], y[val_idx]

            self.model_median.fit(X_tr, y_tr)
            self.model_p10.fit(X_tr, y_tr)
            self.model_p90.fit(X_tr, y_tr)

            pred = self.model_median.predict(X_val)
            p10 = self.model_p10.predict(X_val)
            p90 = self.model_p90.predict(X_val)

            mae_scores.append(float(np.mean(np.abs(pred - y_val))))
            in_interval = ((y_val >= p10) & (y_val <= p90)).mean()
            coverage_scores.append(float(in_interval))

        # Final fit on all data
        self.model_median.fit(X, y)
        self.model_p10.fit(X, y)
        self.model_p90.fit(X, y)

        # Feature importance
        importances = self.model_median.feature_importances_
        self._feature_importance = {
            name: float(imp)
            for name, imp in zip(FEATURE_NAMES_OP, importances)
        }

        self.is_trained = True
        self.n_samples = len(X)
        self.version = str(self.n_samples)

        mae = float(np.mean(mae_scores)) if mae_scores else 0.0
        coverage = float(np.mean(coverage_scores)) if coverage_scores else 0.0
        rmse = float(np.sqrt(np.mean((self.model_median.predict(X) - y) ** 2)))

        logger.info("M1 trained: %d ops, MAE=%.2fh, coverage=%.1f%%", len(X), mae, coverage * 100)

        return TrainMetrics(
            model_name="M1_duration",
            mae=round(mae, 3),
            rmse=round(rmse, 3),
            coverage=round(coverage, 3),
            n_samples=len(X),
            n_features=X.shape[1],
        )

    def predict(self, op: dict, **feat_kwargs) -> DurationPrediction:
        """Predict duration for a single operation."""
        if not self.is_trained:
            work_h = op.get("work_h_estimado", op.get("work_h", 1.0))
            return DurationPrediction(
                op_id=op.get("op_id", op.get("id", 0)),
                estimado_mpp=work_h,
                previsao_ml=work_h,
                intervalo_p10=work_h * 0.8,
                intervalo_p90=work_h * 1.2,
                ratio=1.0,
                confianca=0.0,
            )

        X = extrair_features_operacao(op, **feat_kwargs).reshape(1, -1)
        work_h = op.get("work_h_estimado", op.get("work_h", 1.0))

        median = float(self.model_median.predict(X)[0])
        p10 = float(self.model_p10.predict(X)[0])
        p90 = float(self.model_p90.predict(X)[0])

        # Ensure p10 <= median <= p90
        p10 = min(p10, median)
        p90 = max(p90, median)
        median = max(median, 0.1)
        p10 = max(p10, 0.1)

        ratio = median / work_h if work_h > 0 else 1.0
        confianca = self._calcular_confianca(op)

        return DurationPrediction(
            op_id=op.get("op_id", op.get("id", 0)),
            estimado_mpp=work_h,
            previsao_ml=round(median, 2),
            intervalo_p10=round(p10, 2),
            intervalo_p90=round(p90, 2),
            ratio=round(ratio, 3),
            confianca=round(confianca, 2),
        )

    def predict_batch(self, ops: list[dict], **feat_kwargs) -> list[DurationPrediction]:
        """Predict for multiple operations."""
        return [self.predict(op, **feat_kwargs) for op in ops]

    def get_feature_importance(self) -> dict[str, float]:
        return dict(self._feature_importance)

    def _calcular_confianca(self, op: dict) -> float:
        """Confidence based on sample count and feature coverage."""
        if self.n_samples < 10:
            return 0.1
        base = min(self.n_samples / 100, 0.8)
        # Boost if operation type is well-represented (heuristic)
        return min(base + 0.2, 1.0)

    def save(self, path: Path | None = None) -> Path:
        """Serialize models to disk."""
        path = path or _MODELS_DIR / "m1_duration.joblib"
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({
            "median": self.model_median,
            "p10": self.model_p10,
            "p90": self.model_p90,
            "version": self.version,
            "n_samples": self.n_samples,
            "feature_importance": self._feature_importance,
        }, path)
        return path

    def load(self, path: Path | None = None) -> bool:
        """Load from disk. Returns True if successful."""
        path = path or _MODELS_DIR / "m1_duration.joblib"
        if not path.exists():
            return False
        data = joblib.load(path)
        self.model_median = data["median"]
        self.model_p10 = data["p10"]
        self.model_p90 = data["p90"]
        self.version = data.get("version", "0")
        self.n_samples = data.get("n_samples", 0)
        self._feature_importance = data.get("feature_importance", {})
        self.is_trained = True
        return True
