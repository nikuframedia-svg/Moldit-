"""Integration tests for the full ML pipeline — bootstrap → train → predict."""

import pytest

from backend.ml.store import MLStore
from backend.ml.bootstrap import Bootstrapper
from backend.ml.training.evaluator import ModelEvaluator
from backend.ml.cold_start import ColdStartManager, ColdStartPhase
from backend.ml.feature_engineering import (
    extrair_features_operacao,
    extrair_features_molde,
    cosine_similarity,
    inferir_complexidade,
    calcular_profundidade_dag,
)


@pytest.fixture
def store():
    s = MLStore(db_path=":memory:")
    yield s
    s.close()


class TestFeatureEngineering:
    def test_op_features_shape(self):
        op = {"codigo": "fresagem", "work_h": 8.0, "setup_h": 1.0, "maquina_id": "CNC-01"}
        features = extrair_features_operacao(op)
        assert features.shape == (12,)

    def test_molde_features_shape(self):
        proj = {"n_operacoes": 50, "work_total_h": 800, "profundidade_dag": 8,
                "n_dependencias": 40, "n_maquinas_usadas": 15, "n_tipos_operacao": 6,
                "complexidade": "alta", "peso_estimado_kg": 2000, "n_cavidades": 4,
                "folga_deadline_dias": 5}
        features = extrair_features_molde(proj)
        assert features.shape[0] >= 10  # 10 base + 12 type distribution

    def test_cosine_similarity(self):
        import numpy as np
        a = np.array([1.0, 0.0, 1.0])
        b = np.array([1.0, 0.0, 1.0])
        assert cosine_similarity(a, b) == pytest.approx(1.0, abs=0.001)

        c = np.array([0.0, 1.0, 0.0])
        assert cosine_similarity(a, c) == pytest.approx(0.0, abs=0.001)

    def test_inferir_complexidade(self):
        assert inferir_complexidade(30, 400) == "baixa"
        assert inferir_complexidade(60, 800) == "media"
        assert inferir_complexidade(100, 1500) == "alta"
        assert inferir_complexidade(150, 3000) == "muito_alta"

    def test_calcular_profundidade_dag(self):
        dag = {1: [2, 3], 2: [4], 3: [4], 4: []}
        assert calcular_profundidade_dag(dag) == 2  # 1→2→4 = depth 2


class TestColdStart:
    def test_phases(self):
        cs = ColdStartManager()
        assert cs.get_phase(0) == ColdStartPhase.ZERO
        assert cs.get_phase(3) == ColdStartPhase.COLD
        assert cs.get_phase(10) == ColdStartPhase.WARM
        assert cs.get_phase(30) == ColdStartPhase.STABLE
        assert cs.get_phase(100) == ColdStartPhase.MATURE

    def test_should_use_ml(self):
        cs = ColdStartManager()
        assert not cs.should_use_ml("M1_duration", 0)
        assert not cs.should_use_ml("M1_duration", 3)
        assert cs.should_use_ml("M1_duration", 10)
        assert cs.should_use_ml("M2_risk", 30)

    def test_phase_info(self):
        cs = ColdStartManager()
        info = cs.get_phase_info(15)
        assert info["phase"] == "warm"
        assert "M1_duration" in info["models_active"]


class TestBootstrap:
    def test_ingest_single(self, store: MLStore):
        from datetime import date
        bs = Bootstrapper(store)
        pid = bs.ingest_completed_project(
            molde_id="M-test", cliente="TestCorp",
            data_inicio=date(2025, 1, 1), data_conclusao=date(2025, 2, 1),
            data_deadline=date(2025, 1, 28),
            n_operacoes=50, work_total_h=800,
            makespan_planeado_dias=20, makespan_real_dias=25,
        )
        assert pid.startswith("PRJ-")
        assert store.count_projetos() == 1


class TestFullPipeline:
    def test_evaluator(self, store: MLStore):
        # Save some predictions with actuals
        for i in range(30):
            store.save_prediction(
                op_id=i, model_name="M1", model_version="1",
                predicted_h=8.0 + i * 0.1, p10=7.0, p90=10.0, confidence=0.8,
            )
            store.update_prediction_actual(op_id=i, actual_h=8.5 + i * 0.1)

        evaluator = ModelEvaluator()
        preds = store.get_predictions_with_actuals()
        metrics = evaluator.evaluate_m1_rolling(preds)
        assert metrics["n"] == 30
        assert metrics["mae"] >= 0
        assert 0 <= metrics["coverage"] <= 1
