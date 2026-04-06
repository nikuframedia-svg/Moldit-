"""M2 — Risk Predictor (Random Forest).

Predicts probability of a mold missing its deadline,
expected delay days, and top risk factors.
"""
from __future__ import annotations

import logging
from pathlib import Path

import joblib
import numpy as np

from backend.ml.data_model import RiskPrediction, TrainMetrics
from backend.ml.feature_engineering import FEATURE_NAMES_MOLDE, extrair_features_molde

logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "models"


class RiskPredictor:
    """M2: Predicts mold delay probability and expected delay days."""

    def __init__(self) -> None:
        self.classifier = None
        self.regressor = None
        self.is_trained = False
        self.version = "0"
        self.n_samples = 0
        self._feature_importance: dict[str, float] = {}

    def train(self, projetos: list[dict]) -> TrainMetrics:
        """Train on historical project data.

        Each dict must have: compliance (bool/int), makespan_real_dias,
        makespan_planeado_dias, + mold feature fields.
        """
        from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
        from sklearn.model_selection import cross_val_score

        if len(projetos) < 5:
            logger.warning("M2: Not enough projects (%d), skipping", len(projetos))
            return TrainMetrics(model_name="M2_risk", n_samples=len(projetos))

        X = np.vstack([extrair_features_molde(p) for p in projetos])
        y_class = np.array([0 if p.get("compliance", True) else 1 for p in projetos])
        y_delay = np.array([
            max(0, p.get("makespan_real_dias", 0) - p.get("makespan_planeado_dias", 0))
            for p in projetos
        ], dtype=np.float64)

        # Classifier: will this mold be late?
        self.classifier = RandomForestClassifier(
            n_estimators=100, max_depth=8, class_weight="balanced",
            random_state=42,
        )
        self.classifier.fit(X, y_class)

        # Regressor: how many days late?
        self.regressor = RandomForestRegressor(
            n_estimators=100, max_depth=8, random_state=42,
        )
        self.regressor.fit(X, y_delay)

        # Feature importance from classifier
        importances = self.classifier.feature_importances_
        names = FEATURE_NAMES_MOLDE[:len(importances)]
        self._feature_importance = {
            name: float(imp) for name, imp in zip(names, importances)
        }

        # Cross-validated AUC
        auc_scores = cross_val_score(
            self.classifier, X, y_class, cv=min(3, len(projetos)), scoring="roc_auc",
        )

        self.is_trained = True
        self.n_samples = len(projetos)
        self.version = str(self.n_samples)

        auc = float(np.mean(auc_scores)) if len(auc_scores) > 0 else 0.0
        logger.info("M2 trained: %d projects, AUC=%.3f", len(projetos), auc)

        return TrainMetrics(
            model_name="M2_risk",
            auc_roc=round(auc, 3),
            n_samples=len(projetos),
            n_features=X.shape[1],
        )

    def predict(self, projeto: dict, ops: list[dict] | None = None) -> RiskPrediction:
        """Predict delay risk for a mold."""
        molde_id = projeto.get("molde_id", projeto.get("id", ""))

        if not self.is_trained:
            return RiskPrediction(
                molde_id=molde_id,
                prob_atraso=0.0,
                dias_atraso_esperado=0,
                top_fatores_risco=[],
                recomendacao="Sem dados historicos suficientes para previsao ML.",
            )

        X = extrair_features_molde(projeto, ops).reshape(1, -1)
        prob = float(self.classifier.predict_proba(X)[0, 1])
        delay = max(0, int(round(self.regressor.predict(X)[0])))

        # Top risk factors
        importances = self.classifier.feature_importances_
        names = FEATURE_NAMES_MOLDE[:len(importances)]
        top_idx = np.argsort(importances)[::-1][:3]
        top_fatores = []
        for i in top_idx:
            name = names[i] if i < len(names) else f"feature_{i}"
            val = X[0, i] if i < X.shape[1] else 0
            top_fatores.append(f"{name}={val:.1f}")

        # Recommendation
        if prob < 0.3:
            rec = "Risco baixo. Manter plano actual."
        elif prob < 0.6:
            rec = "Risco moderado. Monitorizar caminho critico e considerar buffer."
        elif prob < 0.8:
            rec = (
                f"Risco alto ({prob:.0%}). Redistribuir "
                "operacoes criticas ou renegociar deadline."
            )
        else:
            rec = (
                f"Risco muito alto ({prob:.0%}). "
                f"Atraso de ~{delay} dias esperado. Accao urgente."
            )

        return RiskPrediction(
            molde_id=molde_id,
            prob_atraso=round(prob, 3),
            dias_atraso_esperado=delay,
            top_fatores_risco=top_fatores,
            recomendacao=rec,
        )

    def get_feature_importance(self) -> dict[str, float]:
        return dict(self._feature_importance)

    def save(self, path: Path | None = None) -> Path:
        path = path or _MODELS_DIR / "m2_risk.joblib"
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump({
            "classifier": self.classifier,
            "regressor": self.regressor,
            "version": self.version,
            "n_samples": self.n_samples,
            "feature_importance": self._feature_importance,
        }, path)
        return path

    def load(self, path: Path | None = None) -> bool:
        path = path or _MODELS_DIR / "m2_risk.joblib"
        if not path.exists():
            return False
        data = joblib.load(path)
        self.classifier = data["classifier"]
        self.regressor = data["regressor"]
        self.version = data.get("version", "0")
        self.n_samples = data.get("n_samples", 0)
        self._feature_importance = data.get("feature_importance", {})
        self.is_trained = True
        return True
