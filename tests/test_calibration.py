"""Tests for calibration engine (Module A)."""

import pytest

from backend.learning.calibration import (
    CalibrationFactor,
    MachineReliability,
    calcular_fatores_calibracao,
    calcular_fiabilidade_maquina,
)


class TestFatoresCalibracao:
    def test_basic_ratio(self):
        logs = [
            {"codigo": "FE010", "work_h_planeado": 10, "work_h_real": 11.5},
            {"codigo": "FE010", "work_h_planeado": 8, "work_h_real": 9.2},
            {"codigo": "FE010", "work_h_planeado": 12, "work_h_real": 13.8},
            {"codigo": "FE010", "work_h_planeado": 6, "work_h_real": 6.9},
            {"codigo": "FE010", "work_h_planeado": 10, "work_h_real": 11.0},
        ]
        result = calcular_fatores_calibracao(logs)
        assert "FE010" in result
        f = result["FE010"]
        assert f.n_amostras == 5
        assert 1.10 < f.ratio_media < 1.20  # ~15% longer
        assert f.confianca == 0.25  # 5/20

    def test_minimum_samples(self):
        logs = [
            {"codigo": "FE010", "work_h_planeado": 10, "work_h_real": 11},
            {"codigo": "FE010", "work_h_planeado": 8, "work_h_real": 9},
        ]
        result = calcular_fatores_calibracao(logs)
        assert "FE010" not in result  # <5 samples

    def test_full_confidence(self):
        logs = [
            {"codigo": "EE005", "work_h_planeado": 10, "work_h_real": 12.2}
            for _ in range(25)
        ]
        result = calcular_fatores_calibracao(logs)
        assert result["EE005"].confianca == 1.0

    def test_multiple_codes(self):
        logs = []
        for _ in range(6):
            logs.append({"codigo": "FE010", "work_h_planeado": 10, "work_h_real": 11})
            logs.append({"codigo": "EE005", "work_h_planeado": 8, "work_h_real": 10})
        result = calcular_fatores_calibracao(logs)
        assert len(result) == 2
        assert result["FE010"].ratio_media < result["EE005"].ratio_media

    def test_zero_planned_skipped(self):
        logs = [
            {"codigo": "FE010", "work_h_planeado": 0, "work_h_real": 5},
        ] * 10
        result = calcular_fatores_calibracao(logs)
        assert "FE010" not in result

    def test_missing_actual_skipped(self):
        logs = [
            {"codigo": "FE010", "work_h_planeado": 10, "work_h_real": None},
        ] * 10
        result = calcular_fatores_calibracao(logs)
        assert "FE010" not in result


class TestFiabilidadeMaquina:
    def test_perfect_uptime(self):
        events = [{"maquina_id": "FE31", "duracao_h": 0, "planeado": True}]
        rel = calcular_fiabilidade_maquina(events, regime_h=16, periodo_dias=90)
        assert rel.uptime_pct == 1.0
        assert rel.n_eventos == 0

    def test_with_failures(self):
        events = [
            {"maquina_id": "EE08", "duracao_h": 4, "planeado": False},
            {"maquina_id": "EE08", "duracao_h": 6, "planeado": False},
            {"maquina_id": "EE08", "duracao_h": 2, "planeado": True},  # planned, ignored
        ]
        rel = calcular_fiabilidade_maquina(events, regime_h=16, periodo_dias=90)
        assert rel.n_eventos == 2
        total_h = 90 * 16
        expected_uptime = (total_h - 10) / total_h
        assert abs(rel.uptime_pct - expected_uptime) < 0.001
        assert rel.mttr_h == 5.0  # (4+6)/2
