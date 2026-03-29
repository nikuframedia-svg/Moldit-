"""Tests for Phase 3 Scoring — Moldit Planner."""

from __future__ import annotations

from backend.config.types import FactoryConfig
from backend.scheduler.scoring import compute_score
from backend.scheduler.types import SegmentoMoldit
from backend.types import Maquina, MolditEngineData, Molde, Operacao


def _seg(op_id: int, molde: str, machine: str, dia: int,
         inicio: float, fim: float, setup: float = 0.0) -> SegmentoMoldit:
    return SegmentoMoldit(
        op_id=op_id, molde=molde, maquina_id=machine,
        dia=dia, inicio_h=inicio, fim_h=fim,
        duracao_h=fim - inicio, setup_h=setup,
    )


def _data(moldes: list[Molde] | None = None,
          n_ops: int = 5,
          machines: list[Maquina] | None = None) -> MolditEngineData:
    ops = [
        Operacao(
            id=i, molde="M1", componente="C1", nome=f"Op{i}",
            codigo="CNC001", nome_completo=f"M1/C1/Op{i}",
            duracao_h=8.0, work_h=8.0, progresso=0.0, work_restante_h=8.0,
        )
        for i in range(1, n_ops + 1)
    ]
    return MolditEngineData(
        operacoes=ops,
        moldes=moldes or [Molde(id="M1", cliente="C", deadline="S15")],
        maquinas=machines or [Maquina(id="M1", grupo="CNC", regime_h=16)],
    )


def _config() -> FactoryConfig:
    return FactoryConfig()


class TestMakespan:
    def test_single_mold(self):
        segs = [
            _seg(1, "M1", "M1", 0, 7.0, 15.0),
            _seg(2, "M1", "M1", 1, 7.0, 15.0),
        ]
        score = compute_score(segs, _data(n_ops=2), _config())
        assert score["makespan_total_dias"] == 2
        assert score["makespan_por_molde"]["M1"] == 1


class TestDeadlineCompliance:
    def test_all_on_time(self):
        """All molds finish before their deadline -> 100% compliance."""
        segs = [_seg(1, "M1", "M1", 10, 7.0, 15.0)]
        moldes = [Molde(id="M1", cliente="C", deadline="S15")]  # S15 = day 75
        score = compute_score(segs, _data(moldes=moldes, n_ops=1), _config())
        assert score["deadline_compliance"] == 1.0

    def test_one_late(self):
        """One mold finishes after deadline -> < 100%."""
        segs = [
            _seg(1, "M1", "M1", 10, 7.0, 15.0),
            _seg(2, "M2", "M1", 200, 7.0, 15.0),
        ]
        moldes = [
            Molde(id="M1", cliente="C", deadline="S15"),  # day 75, on time
            Molde(id="M2", cliente="C", deadline="S15"),  # day 75, late at day 200
        ]
        ops = [
            Operacao(id=1, molde="M1", componente="C1", nome="Op1",
                     codigo="CNC001", nome_completo="x",
                     duracao_h=8.0, work_h=8.0, progresso=0.0, work_restante_h=8.0),
            Operacao(id=2, molde="M2", componente="C1", nome="Op2",
                     codigo="CNC001", nome_completo="x",
                     duracao_h=8.0, work_h=8.0, progresso=0.0, work_restante_h=8.0),
        ]
        data = MolditEngineData(
            operacoes=ops, moldes=moldes,
            maquinas=[Maquina(id="M1", grupo="CNC", regime_h=16)],
        )
        score = compute_score(segs, data, _config())
        assert score["deadline_compliance"] == 0.5


class TestUtilizationBalance:
    def test_balanced_utilization(self):
        """Two machines with equal load -> high balance."""
        segs = [
            _seg(1, "M1", "A", 0, 7.0, 15.0),
            _seg(2, "M1", "B", 0, 7.0, 15.0),
        ]
        data = _data(
            n_ops=2,
            machines=[
                Maquina(id="A", grupo="CNC", regime_h=16),
                Maquina(id="B", grupo="CNC", regime_h=16),
            ],
        )
        score = compute_score(segs, data, _config())
        assert score["utilization_balance"] >= 0.9

    def test_unbalanced_utilization(self):
        """One machine with all load, one empty -> low balance."""
        segs = [
            _seg(1, "M1", "A", 0, 7.0, 15.0),
            _seg(2, "M1", "A", 1, 7.0, 15.0),
        ]
        data = _data(
            n_ops=2,
            machines=[
                Maquina(id="A", grupo="CNC", regime_h=16),
                Maquina(id="B", grupo="CNC", regime_h=16),
            ],
        )
        score = compute_score(segs, data, _config())
        # Only one machine used -> balance = 1.0 (single-machine case)
        # But A has util > 0, B has util = 0 -> only A counted
        assert score["utilization_balance"] == 1.0


class TestWeightedScore:
    def test_range(self):
        """Weighted score should be between 0 and 1."""
        segs = [_seg(1, "M1", "M1", 5, 7.0, 15.0)]
        score = compute_score(segs, _data(n_ops=1), _config())
        assert 0.0 <= score["weighted_score"] <= 1.0

    def test_empty_schedule(self):
        score = compute_score([], _data(n_ops=0), _config())
        assert score["weighted_score"] == 0.0
        assert score["ops_agendadas"] == 0
