"""Tests for ML Store — CRUD operations on SQLite."""

import pytest
from datetime import date

from backend.ml.store import MLStore
from backend.ml.data_model import OperacaoHistorica, ProjetoHistorico


@pytest.fixture
def store():
    s = MLStore(db_path=":memory:")
    yield s
    s.close()


def _make_projeto(pid="PRJ-001", molde="Molde-001", n_ops=3):
    ops = []
    for i in range(n_ops):
        ops.append(OperacaoHistorica(
            op_id=i + 1, tipo_operacao="fresagem", molde_id=molde,
            projeto_id=pid, maquina_planeada="CNC-01", maquina_real="CNC-01",
            work_h_estimado=8.0, work_h_real=9.2, setup_h_estimado=1.0,
            setup_h_real=1.1, ratio_work=1.15, ratio_setup=1.1,
            dia_planeado=i, dia_real=i,
        ))
    return ProjetoHistorico(
        projeto_id=pid, molde_id=molde, cliente="TestCorp",
        data_inicio=date(2025, 1, 1), data_conclusao=date(2025, 2, 1),
        data_deadline=date(2025, 1, 25),
        n_operacoes=n_ops, n_maquinas_usadas=5, work_total_h=100.0,
        n_dependencias=10, profundidade_dag=4, n_tipos_operacao=3,
        complexidade="media", makespan_planeado_dias=20,
        makespan_real_dias=25, compliance=False, score_final=72.0,
        operacoes=ops,
    )


def test_save_and_load_projeto(store: MLStore):
    proj = _make_projeto()
    store.save_projeto(proj)

    loaded = store.get_projetos()
    assert len(loaded) == 1
    assert loaded[0]["projeto_id"] == "PRJ-001"
    assert loaded[0]["molde_id"] == "Molde-001"
    assert loaded[0]["compliance"] == 0  # False stored as 0


def test_count_projetos(store: MLStore):
    assert store.count_projetos() == 0
    store.save_projeto(_make_projeto("PRJ-001"))
    assert store.count_projetos() == 1
    store.save_projeto(_make_projeto("PRJ-002", "Molde-002"))
    assert store.count_projetos() == 2


def test_operacoes_saved_and_queryable(store: MLStore):
    proj = _make_projeto(n_ops=5)
    store.save_projeto(proj)

    ops = store.get_operacoes_projeto("PRJ-001")
    assert len(ops) == 5
    assert ops[0]["tipo_operacao"] == "fresagem"
    assert ops[0]["ratio_work"] == 1.15


def test_all_operacoes(store: MLStore):
    store.save_projeto(_make_projeto("P1", n_ops=3))
    store.save_projeto(_make_projeto("P2", "M2", n_ops=4))
    all_ops = store.get_all_operacoes()
    assert len(all_ops) == 7


def test_model_info_crud(store: MLStore):
    store.save_model_info(
        model_name="M1_duration", version="100",
        hyperparams={"lr": 0.05}, metrics={"mae": 1.2},
        feature_importance={"work_h": 0.5}, model_path="/tmp/m1.joblib",
        n_samples=100,
    )
    latest = store.get_latest_model("M1_duration")
    assert latest is not None
    assert latest["version"] == "100"
    assert latest["metrics"]["mae"] == 1.2


def test_predictions_crud(store: MLStore):
    store.save_prediction(
        op_id=42, model_name="M1", model_version="1",
        predicted_h=9.5, p10=7.8, p90=11.2, confidence=0.87,
    )
    # No actuals yet
    preds = store.get_predictions_with_actuals()
    assert len(preds) == 0

    # Fill actual
    store.update_prediction_actual(op_id=42, actual_h=10.1)
    preds = store.get_predictions_with_actuals()
    assert len(preds) == 1
    assert preds[0]["actual_h"] == 10.1


def test_analogy_feedback(store: MLStore):
    store.save_analogy_feedback("Molde-001", "PRJ-100", True)
    store.save_analogy_feedback("Molde-001", "PRJ-101", False)
    fb = store.get_analogy_feedback()
    assert len(fb) == 2


def test_stats(store: MLStore):
    store.save_projeto(_make_projeto())
    stats = store.get_stats()
    assert stats["n_projetos"] == 1
    assert stats["n_operacoes"] == 3
