"""ML Trainer — Moldit Planner.

Orchestrates training of all 5 models from historical data.
Supports full retraining and incremental updates.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

from backend.ml.data_model import TrainMetrics, TrainReport
from backend.ml.models.anomaly_detector import AnomalyDetector
from backend.ml.models.duration_predictor import DurationPredictor
from backend.ml.models.machine_recommender import MachineRecommender
from backend.ml.models.project_analogy import ProjectAnalogy
from backend.ml.models.risk_predictor import RiskPredictor
from backend.ml.store import MLStore

logger = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "models"


class MLTrainer:
    """Orchestrates training of all ML models."""

    def __init__(self, store: MLStore) -> None:
        self.store = store
        self.m1 = DurationPredictor()
        self.m2 = RiskPredictor()
        self.m3 = ProjectAnalogy()
        self.m4 = MachineRecommender()
        self.m5 = AnomalyDetector()

    def train_all(self) -> TrainReport:
        """Full training of all models from scratch."""
        t0 = time.time()
        metrics: dict[str, TrainMetrics] = {}
        models_trained: list[str] = []
        warnings: list[str] = []

        # Load data
        projetos = self.store.get_projetos(limit=500)
        ops = self.store.get_all_operacoes(limit=50000)
        n_proj = len(projetos)
        n_ops = len(ops)

        logger.info("Training all models: %d projects, %d operations", n_proj, n_ops)

        # Build ops lookup by project
        ops_by_projeto: dict[str, list[dict]] = {}
        for op in ops:
            pid = op.get("projeto_id", "")
            if pid not in ops_by_projeto:
                ops_by_projeto[pid] = []
            ops_by_projeto[pid].append(op)

        # Build calibration ratios for feature engineering
        from backend.learning.calibration import calcular_fatores_calibracao
        from backend.learning.execution_store import ExecutionStore
        try:
            exec_store = ExecutionStore()
            exec_logs = exec_store.get_all_logs(limit=5000)
            cal_factors = calcular_fatores_calibracao(exec_logs)
            calibration = {k: v.ratio_media for k, v in cal_factors.items()}
            exec_store.close()
        except Exception:
            calibration = {}

        feat_kwargs = {"calibration": calibration}

        # M1 — Duration Predictor (needs >= 10 ops)
        if n_ops >= 10:
            try:
                m = self.m1.train(ops, **feat_kwargs)
                metrics["M1_duration"] = m
                models_trained.append("M1_duration")
                self.m1.save()
                self._save_model_info("M1_duration", self.m1.version, m)
            except Exception as e:
                logger.error("M1 training failed: %s", e)
                warnings.append(f"M1 falhou: {e}")
        else:
            warnings.append(f"M1: dados insuficientes ({n_ops} ops, minimo 10)")

        # M2 — Risk Predictor (needs >= 5 projects)
        if n_proj >= 5:
            try:
                m = self.m2.train(projetos)
                metrics["M2_risk"] = m
                models_trained.append("M2_risk")
                self.m2.save()
                self._save_model_info("M2_risk", self.m2.version, m)
            except Exception as e:
                logger.error("M2 training failed: %s", e)
                warnings.append(f"M2 falhou: {e}")
        else:
            warnings.append(f"M2: dados insuficientes ({n_proj} projectos, minimo 5)")

        # M3 — Project Analogy (needs >= 2 projects)
        if n_proj >= 2:
            try:
                self.m3.train(projetos, ops_by_projeto)
                models_trained.append("M3_analogy")
                metrics["M3_analogy"] = TrainMetrics(
                    model_name="M3_analogy", n_samples=n_proj,
                )
            except Exception as e:
                logger.error("M3 training failed: %s", e)
                warnings.append(f"M3 falhou: {e}")
        else:
            warnings.append(f"M3: dados insuficientes ({n_proj} projectos, minimo 2)")

        # M4 — Machine Recommender (needs >= 5 ops)
        if n_ops >= 5:
            try:
                m = self.m4.train(ops)
                metrics["M4_machine"] = m
                models_trained.append("M4_machine")
            except Exception as e:
                logger.error("M4 training failed: %s", e)
                warnings.append(f"M4 falhou: {e}")
        else:
            warnings.append(f"M4: dados insuficientes ({n_ops} ops, minimo 5)")

        # M5 — Anomaly Detector (needs >= 10 ops)
        if n_ops >= 10:
            try:
                m = self.m5.train(ops)
                metrics["M5_anomaly"] = m
                models_trained.append("M5_anomaly")
            except Exception as e:
                logger.error("M5 training failed: %s", e)
                warnings.append(f"M5 falhou: {e}")
        else:
            warnings.append(f"M5: dados insuficientes ({n_ops} ops, minimo 10)")

        duration_s = time.time() - t0
        status = "ok" if models_trained else ("partial" if warnings else "failed")

        logger.info(
            "Training complete: %d models in %.1fs, %d warnings",
            len(models_trained), duration_s, len(warnings),
        )

        return TrainReport(
            status=status,
            models_trained=models_trained,
            duration_s=round(duration_s, 2),
            metrics=metrics,
            warnings=warnings,
        )

    def train_incremental(self, new_ops: list[dict]) -> None:
        """Quick incremental update for M4 and M5 after new completions."""
        if not new_ops:
            return

        # M4: retrain with full dataset (fast — just statistics)
        all_ops = self.store.get_all_operacoes(limit=50000)
        if len(all_ops) >= 5:
            self.m4.train(all_ops)

        # M5: update baselines
        if len(all_ops) >= 10:
            self.m5.train(all_ops)

        # M1: retrain only if 50+ new ops since last train
        n_total = self.store.count_operacoes()
        if self.m1.is_trained and n_total - self.m1.n_samples >= 50:
            from backend.learning.calibration import calcular_fatores_calibracao
            from backend.learning.execution_store import ExecutionStore
            try:
                exec_store = ExecutionStore()
                cal_factors = calcular_fatores_calibracao(exec_store.get_all_logs(5000))
                calibration = {k: v.ratio_media for k, v in cal_factors.items()}
                exec_store.close()
            except Exception:
                calibration = {}
            self.m1.train(all_ops, calibration=calibration)
            self.m1.save()

    def should_retrain(self) -> bool:
        """Check if full retrain is needed."""
        n_ops = self.store.count_operacoes()
        if not self.m1.is_trained and n_ops >= 10:
            return True
        if self.m1.is_trained and n_ops - self.m1.n_samples >= 50:
            return True
        return False

    def load_models(self) -> list[str]:
        """Load persisted models from disk. Returns names of loaded models."""
        loaded = []
        if self.m1.load():
            loaded.append("M1_duration")
        if self.m2.load():
            loaded.append("M2_risk")
        # M3, M4, M5 are retrained from data (lightweight, no persistence needed)
        return loaded

    def _save_model_info(self, name: str, version: str, metrics: TrainMetrics) -> None:
        """Persist model metadata to store."""
        from dataclasses import asdict
        self.store.save_model_info(
            model_name=name,
            version=version,
            hyperparams={},
            metrics=asdict(metrics),
            feature_importance=(
                self.m1.get_feature_importance() if name == "M1_duration"
                else self.m2.get_feature_importance() if name == "M2_risk"
                else {}
            ),
            model_path=str(_MODELS_DIR / f"{name.lower()}.joblib"),
            n_samples=metrics.n_samples,
        )
