"""Tests for ML models M1-M5 — unit tests (no synthetic data)."""

from backend.ml.models.duration_predictor import DurationPredictor
from backend.ml.models.anomaly_detector import AnomalyDetector


class TestM1DurationPredictor:
    def test_untrained_returns_passthrough(self):
        m1 = DurationPredictor()
        pred = m1.predict({"op_id": 1, "work_h": 8.0, "codigo": "fresagem"})
        assert pred.previsao_ml == 8.0
        assert pred.confianca == 0.0


class TestM2RiskPredictor:
    def test_untrained_returns_zero(self):
        from backend.ml.models.risk_predictor import RiskPredictor
        m2 = RiskPredictor()
        pred = m2.predict({"molde_id": "M1", "n_operacoes": 50})
        assert pred.prob_atraso == 0.0


class TestM3ProjectAnalogy:
    def test_empty_history(self):
        from backend.ml.models.project_analogy import ProjectAnalogy
        m3 = ProjectAnalogy()
        results = m3.encontrar_analogos({"n_operacoes": 50})
        assert results == []


class TestM5AnomalyDetector:
    def test_setup_anomaly(self):
        m5 = AnomalyDetector()
        m5.is_trained = True
        result = m5.check_setup_anomaly(
            {"op_id": 1, "setup_h_estimado": 1.0}, setup_h_real=3.5,
        )
        assert result is not None
        assert result.tipo == "setup_excessivo"
