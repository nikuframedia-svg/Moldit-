"""Tests for simulator -- Moldit Planner Phase 4: What-If mutations."""

from __future__ import annotations

import copy

import pytest

from backend.config.types import FactoryConfig
from backend.scheduler.scheduler import schedule_all
from backend.simulator.mutations import apply_mutation
from backend.simulator.simulator import DeltaReport, Mutation, SimulateResponse, simulate
from backend.types import Dependencia, Maquina, MolditEngineData, Molde, Operacao


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════


def _make_op(
    id: int, molde: str = "M1", codigo: str = "CNC001",
    work_h: float = 8.0, recurso: str | None = None, progresso: float = 0.0,
) -> Operacao:
    wr = work_h * (1.0 - progresso / 100.0)
    return Operacao(
        id=id, molde=molde, componente="C1", nome=f"Op{id}",
        codigo=codigo, nome_completo=f"{molde} / C1 / Op{id}",
        duracao_h=work_h, work_h=work_h,
        progresso=progresso, work_restante_h=wr, recurso=recurso,
    )


def _make_data() -> MolditEngineData:
    ops = [
        _make_op(1, molde="M1", codigo="CNC001", work_h=6.0),
        _make_op(2, molde="M1", codigo="CNC001", work_h=4.0),
        _make_op(3, molde="M2", codigo="EDM001", work_h=8.0),
    ]
    machines = [
        Maquina(id="CNC-A", grupo="CNC", regime_h=16, setup_h=1.0),
        Maquina(id="CNC-B", grupo="CNC", regime_h=16, setup_h=1.0),
        Maquina(id="EDM-A", grupo="EDM", regime_h=16, setup_h=0.5),
    ]
    moldes = [
        Molde(id="M1", cliente="ClientA", deadline="S15"),
        Molde(id="M2", cliente="ClientB", deadline="S20"),
    ]
    deps = [Dependencia(1, 2)]
    return MolditEngineData(
        operacoes=ops,
        maquinas=machines,
        moldes=moldes,
        dependencias=deps,
        compatibilidade={"CNC001": ["CNC-A", "CNC-B"], "EDM001": ["EDM-A"]},
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
# Mutation Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestMutations:
    def test_machine_down(self):
        data = _make_data()
        msg = apply_mutation(data, "machine_down", {"machine_id": "CNC-A"})
        assert "CNC-A" in msg
        # Machine regime should be 0
        m = next(m for m in data.maquinas if m.id == "CNC-A")
        assert m.regime_h == 0

    def test_overtime_increases_capacity(self):
        data = _make_data()
        msg = apply_mutation(data, "overtime", {"machine_id": "CNC-A", "new_regime_h": "24"})
        assert "24" in msg
        m = next(m for m in data.maquinas if m.id == "CNC-A")
        assert m.regime_h == 24

    def test_deadline_change(self):
        data = _make_data()
        msg = apply_mutation(data, "deadline_change", {"molde_id": "M1", "new_deadline": "S10"})
        assert "S10" in msg
        molde = next(m for m in data.moldes if m.id == "M1")
        assert molde.deadline == "S10"

    def test_add_holiday(self):
        data = _make_data()
        apply_mutation(data, "add_holiday", {"date": "2026-04-15"})
        assert "2026-04-15" in data.feriados

    def test_remove_holiday(self):
        data = _make_data()
        data.feriados.append("2026-04-15")
        apply_mutation(data, "remove_holiday", {"date": "2026-04-15"})
        assert "2026-04-15" not in data.feriados

    def test_op_done_updates_progress(self):
        data = _make_data()
        msg = apply_mutation(data, "op_done", {"op_id": "1", "progress": "100"})
        op = next(o for o in data.operacoes if o.id == 1)
        assert op.progresso == 100.0
        assert op.work_restante_h == 0.0

    def test_unknown_mutation_raises(self):
        data = _make_data()
        with pytest.raises(ValueError, match="Unknown mutation"):
            apply_mutation(data, "nonexistent", {})


# ═══════════════════════════════════════════════════════════════════════════
# Simulator Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestSimulator:
    def test_delta_report_structure(self):
        data = _make_data()
        config = _make_config()
        baseline = schedule_all(data, config=config)

        response = simulate(
            data, baseline.score,
            [Mutation(type="overtime", params={"machine_id": "CNC-A", "new_regime_h": "24"})],
            config=config,
        )

        assert isinstance(response, SimulateResponse)
        assert isinstance(response.delta, DeltaReport)
        assert response.delta.makespan_before >= 0
        assert response.delta.compliance_before >= 0.0
        assert len(response.summary) >= 2  # mutation summary + delta summary

    def test_simulate_does_not_mutate_original(self):
        data = _make_data()
        config = _make_config()
        baseline = schedule_all(data, config=config)

        original_regime = data.maquinas[0].regime_h
        original_ops = len(data.operacoes)

        simulate(
            data, baseline.score,
            [Mutation(type="machine_down", params={"machine_id": "CNC-A"})],
            config=config,
        )

        # Original data should be unchanged
        assert data.maquinas[0].regime_h == original_regime
        assert len(data.operacoes) == original_ops
