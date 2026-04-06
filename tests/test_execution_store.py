"""Tests for execution tracking store (Module A)."""

import os
import tempfile

import pytest

from backend.learning.execution_store import ExecutionStore


@pytest.fixture
def store():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    s = ExecutionStore(db_path=path)
    yield s
    s.close()
    os.unlink(path)


class TestExecutionLog:
    def test_log_and_retrieve(self, store):
        row_id = store.log_completion(
            op_id=42, molde="2950", maquina_id="FE31",
            codigo="FE010", work_h_planeado=10.0, work_h_real=11.5,
            setup_h_planeado=1.0, setup_h_real=1.2,
            dia_planeado=5, dia_real=5,
            motivo_desvio="Ferramenta partiu",
            reportado_por="Joao",
        )
        assert row_id >= 1

        logs = store.get_all_logs()
        assert len(logs) == 1
        assert logs[0]["op_id"] == 42
        assert logs[0]["work_h_real"] == 11.5

    def test_filter_by_codigo(self, store):
        store.log_completion(1, "2950", "FE31", "FE010", 10, 11, 1, 1, 0, 0)
        store.log_completion(2, "2950", "EE01", "EE005", 8, 10, 1.5, 2, 0, 0)
        store.log_completion(3, "2944", "FE31", "FE010", 12, 13, 1, 1, 0, 0)

        fe010 = store.get_logs_by_codigo("FE010")
        assert len(fe010) == 2

        ee005 = store.get_logs_by_codigo("EE005")
        assert len(ee005) == 1

    def test_filter_by_maquina(self, store):
        store.log_completion(1, "2950", "FE31", "FE010", 10, 11, 1, 1, 0, 0)
        store.log_completion(2, "2950", "EE01", "EE005", 8, 10, 1.5, 2, 0, 0)

        fe31 = store.get_logs_by_maquina("FE31")
        assert len(fe31) == 1
        assert fe31[0]["maquina_id"] == "FE31"


class TestMachineEvents:
    def test_log_event(self, store):
        row_id = store.log_machine_event(
            maquina_id="EE08", tipo="avaria",
            inicio="2026-04-01T10:00", fim="2026-04-01T14:30",
            duracao_h=4.5, planeado=False,
            notas="Falha electrica",
        )
        assert row_id >= 1

        events = store.get_machine_events("EE08")
        assert len(events) == 1
        assert events[0]["duracao_h"] == 4.5
        assert events[0]["planeado"] == 0

    def test_planned_vs_unplanned(self, store):
        store.log_machine_event("FE31", "manutencao", "2026-04-01", duracao_h=2, planeado=True)
        store.log_machine_event("FE31", "avaria", "2026-04-02", duracao_h=3, planeado=False)

        events = store.get_machine_events("FE31")
        assert len(events) == 2

    def test_empty_query(self, store):
        events = store.get_machine_events("NONEXISTENT")
        assert events == []
