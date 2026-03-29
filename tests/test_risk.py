"""Tests for Risk Assessment -- Moldit Planner Phase 4."""

from __future__ import annotations

import pytest

from backend.config.types import FactoryConfig
from backend.scheduler.scheduler import schedule_all
from backend.types import Dependencia, Maquina, MolditEngineData, Molde, Operacao


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════


def _make_op(
    id: int, molde: str = "M1", codigo: str = "CNC001",
    work_h: float = 8.0, progresso: float = 0.0,
) -> Operacao:
    wr = work_h * (1.0 - progresso / 100.0)
    return Operacao(
        id=id, molde=molde, componente="C1", nome=f"Op{id}",
        codigo=codigo, nome_completo=f"{molde} / C1 / Op{id}",
        duracao_h=work_h, work_h=work_h,
        progresso=progresso, work_restante_h=wr,
    )


def _make_data() -> MolditEngineData:
    ops = [
        _make_op(1, molde="M1", codigo="CNC001", work_h=6.0),
        _make_op(2, molde="M1", codigo="CNC001", work_h=4.0),
    ]
    machines = [
        Maquina(id="CNC-A", grupo="CNC", regime_h=16, setup_h=1.0),
    ]
    moldes = [Molde(id="M1", cliente="ClientA", deadline="S15")]
    deps = [Dependencia(1, 2)]
    return MolditEngineData(
        operacoes=ops,
        maquinas=machines,
        moldes=moldes,
        dependencias=deps,
        compatibilidade={"CNC001": ["CNC-A"]},
        dag={1: [2]},
        dag_reverso={2: [1]},
        caminho_critico=[1, 2],
        data_referencia="2026-03-30",
    )


def _make_config() -> FactoryConfig:
    c = FactoryConfig()
    c.holidays = []
    return c


# ═══════════════════════════════════════════════════════════════════════════
# Monte Carlo Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestMonteCarlo:
    def test_monte_carlo_completes(self):
        """Monte Carlo with small n_samples should complete without errors."""
        try:
            from backend.risk.monte_carlo import monte_carlo_risk
        except ImportError:
            pytest.skip("scipy/numpy not installed")

        data = _make_data()
        config = _make_config()

        result = monte_carlo_risk(
            data,
            schedule_fn=lambda d: schedule_all(d, config=config),
            n_samples=10,
            seed=42,
        )

        assert isinstance(result, dict)
        assert result["n_samples"] == 10

    def test_percentiles_structure(self):
        """Result should contain expected percentile keys."""
        try:
            from backend.risk.monte_carlo import monte_carlo_risk
        except ImportError:
            pytest.skip("scipy/numpy not installed")

        data = _make_data()
        config = _make_config()

        result = monte_carlo_risk(
            data,
            schedule_fn=lambda d: schedule_all(d, config=config),
            n_samples=10,
            seed=42,
        )

        expected_keys = [
            "makespan_p50", "makespan_p80", "makespan_p95",
            "compliance_p50", "compliance_p80", "compliance_p95",
            "compliance_mean", "n_samples",
        ]
        for key in expected_keys:
            assert key in result, f"Missing key: {key}"
