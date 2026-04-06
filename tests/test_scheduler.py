"""Tests for Phase 3 Scheduler — Moldit Planner.

Unit tests for dispatch (priority, assignment, timeline) + integration test.
"""

from __future__ import annotations

import os

import pytest

from backend.config.types import FactoryConfig
from backend.scheduler.dispatch import (
    assign_machines,
    build_priority_queue,
    dispatch_timeline,
)
from backend.scheduler.scheduler import schedule_all
from backend.scheduler.types import ScheduleResult
from backend.types import Dependencia, Maquina, MolditEngineData, Molde, Operacao


# ═══════════════════════════════════════════════════════════════════════════
# Helpers — synthetic data builders
# ═══════════════════════════════════════════════════════════════════════════


def _make_op(
    id: int,
    molde: str = "M1",
    codigo: str = "CNC001",
    work_h: float = 8.0,
    recurso: str | None = None,
    e_condicional: bool = False,
    e_2a_placa: bool = False,
    progresso: float = 0.0,
) -> Operacao:
    wr = work_h * (1.0 - progresso / 100.0)
    return Operacao(
        id=id,
        molde=molde,
        componente="C1",
        nome=f"Op{id}",
        codigo=codigo,
        nome_completo=f"M1 / C1 / Op{id}",
        duracao_h=work_h,
        work_h=work_h,
        progresso=progresso,
        work_restante_h=wr,
        recurso=recurso,
        e_condicional=e_condicional,
        e_2a_placa=e_2a_placa,
    )


def _make_machine(
    id: str, grupo: str = "CNC", regime_h: int = 16, setup_h: float = 1.0,
) -> Maquina:
    return Maquina(id=id, grupo=grupo, regime_h=regime_h, setup_h=setup_h)


def _make_molde(id: str = "M1", deadline: str = "S15") -> Molde:
    return Molde(id=id, cliente="Client", deadline=deadline)


def _make_config(**overrides) -> FactoryConfig:
    c = FactoryConfig()
    c.holidays = []
    for k, v in overrides.items():
        setattr(c, k, v)
    return c


# ═══════════════════════════════════════════════════════════════════════════
# Priority Queue Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestBuildPriorityQueue:
    def test_respects_dag(self):
        """Op with predecessor should come after it."""
        ops = [_make_op(1), _make_op(2)]
        dag = {1: [2]}
        dag_rev = {2: [1]}
        pq = build_priority_queue(ops, dag, dag_rev, [_make_molde()], [])
        assert pq.index(1) < pq.index(2)

    def test_deadline_ordering(self):
        """Earlier deadline mold should be prioritized."""
        ops = [_make_op(1, molde="M1"), _make_op(2, molde="M2")]
        moldes = [_make_molde("M1", "S20"), _make_molde("M2", "S10")]
        pq = build_priority_queue(ops, {}, {}, moldes, [])
        # M2 has earlier deadline (S10) -> op 2 first
        assert pq.index(2) < pq.index(1)

    def test_conditional_last(self):
        """Conditional ops get layer 9999 -> last."""
        ops = [_make_op(1, e_condicional=True), _make_op(2)]
        pq = build_priority_queue(ops, {}, {}, [_make_molde()], [])
        assert pq.index(2) < pq.index(1)


# ═══════════════════════════════════════════════════════════════════════════
# Machine Assignment Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestAssignMachines:
    def test_uses_mpp_resource(self):
        """Op with explicit recurso should get that machine."""
        ops = {1: _make_op(1, recurso="FE16 - Zayer")}
        machines = {"FE16 - Zayer": _make_machine("FE16 - Zayer")}
        result = assign_machines(ops, [1], {"CNC001": ["FE16 - Zayer"]}, machines, _make_config())
        assert result[1] == "FE16 - Zayer"

    def test_picks_least_loaded(self):
        """With two compatible machines, pick the one with less load."""
        ops = {
            1: _make_op(1, work_h=10.0),
            2: _make_op(2, work_h=8.0),
        }
        machines = {
            "A": _make_machine("A"),
            "B": _make_machine("B"),
        }
        compat = {"CNC001": ["A", "B"]}
        result = assign_machines(ops, [1, 2], compat, machines, _make_config())
        # After op1 assigned to either A or B, op2 should go to the other
        assert result[1] != result[2]

    def test_bancada_dedication(self):
        """Bancada machines should only accept ops from dedicated molds."""
        ops = {
            1: _make_op(1, molde="2950", codigo="BANC01"),
            2: _make_op(2, molde="2944", codigo="BANC01"),
        }
        machines = {
            "BA01": _make_machine("BA01", grupo="Bancada", regime_h=8, setup_h=0),
            "BA02": _make_machine("BA02", grupo="Bancada", regime_h=8, setup_h=0),
        }
        compat = {"BANC01": ["BA01", "BA02"]}
        config = _make_config(bancada_dedicacao={
            "BA01": {"2950": 1.0},
            "BA02": {"2944": 0.75},
        })
        result = assign_machines(ops, [1, 2], compat, machines, config)
        assert result[1] == "BA01"
        assert result[2] == "BA02"


# ═══════════════════════════════════════════════════════════════════════════
# Dispatch Timeline Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestDispatchTimeline:
    def test_respects_dependencies(self):
        """Successor should not start before predecessor finishes."""
        ops = {1: _make_op(1, work_h=4.0), 2: _make_op(2, work_h=4.0)}
        machines = {"M1": _make_machine("M1", regime_h=16)}
        dag_rev = {2: [1]}
        config = _make_config()
        segs = dispatch_timeline(
            ops, [1, 2], {1: "M1", 2: "M1"}, dag_rev, machines, config,
            ref_date="2026-03-30",  # Monday
        )
        # Find end of op1 and start of op2
        op1_segs = [s for s in segs if s.op_id == 1]
        op2_segs = [s for s in segs if s.op_id == 2]
        assert op1_segs and op2_segs
        op1_end = max((s.dia, s.fim_h) for s in op1_segs)
        op2_start = min((s.dia, s.inicio_h) for s in op2_segs)
        assert op2_start >= op1_end

    def test_respects_regime(self):
        """No segment should exceed the machine's regime hours per day."""
        ops = {1: _make_op(1, work_h=20.0)}
        machines = {"M1": _make_machine("M1", regime_h=8, setup_h=0)}
        config = _make_config()
        segs = dispatch_timeline(
            ops, [1], {1: "M1"}, {}, machines, config,
            ref_date="2026-03-30",
        )
        for s in segs:
            assert s.duracao_h <= 8.0 + 0.01

    def test_multi_day_op(self):
        """A 30h op on 8h regime should span multiple days."""
        ops = {1: _make_op(1, work_h=30.0)}
        machines = {"M1": _make_machine("M1", regime_h=8, setup_h=0)}
        config = _make_config()
        segs = dispatch_timeline(
            ops, [1], {1: "M1"}, {}, machines, config,
            ref_date="2026-03-30",
        )
        days = {s.dia for s in segs}
        assert len(days) >= 4  # 30h / 8h = 3.75 -> 4 days

    def test_skips_holidays(self):
        """Operations should not be scheduled on holidays."""
        ops = {1: _make_op(1, work_h=40.0)}
        machines = {"M1": _make_machine("M1", regime_h=8, setup_h=0)}
        config = _make_config()
        # ref_date is 2026-03-30 (Monday), holiday on 2026-03-31 (Tuesday, day offset 1)
        segs = dispatch_timeline(
            ops, [1], {1: "M1"}, {}, machines, config,
            ref_date="2026-03-30",
            holidays=["2026-03-31"],
        )
        # Day offset 1 (Tuesday March 31) should be skipped
        days = {s.dia for s in segs}
        assert 1 not in days

    def test_external_infinite(self):
        """External (regime_h=0) should schedule in one segment."""
        ops = {1: _make_op(1, work_h=100.0)}
        machines = {"EXT": _make_machine("EXT", grupo="Externo", regime_h=0, setup_h=0)}
        config = _make_config()
        segs = dispatch_timeline(
            ops, [1], {1: "EXT"}, {}, machines, config,
            ref_date="2026-03-30",
        )
        assert len(segs) == 1
        assert segs[0].duracao_h == 100.0


# ═══════════════════════════════════════════════════════════════════════════
# Pipeline Integration Test (synthetic)
# ═══════════════════════════════════════════════════════════════════════════


class TestScheduleAllPipeline:
    def test_synthetic_3_op_chain(self):
        """3 ops in a chain: 1->2->3. All should be scheduled in order."""
        ops = [_make_op(1, work_h=4.0), _make_op(2, work_h=4.0), _make_op(3, work_h=4.0)]
        machines = [_make_machine("M1", regime_h=16)]
        moldes = [_make_molde("M1", "S20")]
        deps = [Dependencia(1, 2), Dependencia(2, 3)]
        dag = {1: [2], 2: [3]}
        dag_rev = {2: [1], 3: [2]}
        compat = {"CNC001": ["M1"]}

        data = MolditEngineData(
            operacoes=ops,
            maquinas=machines,
            moldes=moldes,
            dependencias=deps,
            compatibilidade=compat,
            dag=dag,
            dag_reverso=dag_rev,
            caminho_critico=[1, 2, 3],
            data_referencia="2026-03-30",
        )

        result = schedule_all(data)
        assert isinstance(result, ScheduleResult)
        assert len(result.segmentos) >= 3
        assert result.score["ops_agendadas"] == 3

        # Check dependency order
        op_end: dict[int, tuple[int, float]] = {}
        op_start: dict[int, tuple[int, float]] = {}
        for s in result.segmentos:
            end = (s.dia, s.fim_h)
            start = (s.dia, s.inicio_h)
            if s.op_id not in op_end or end > op_end[s.op_id]:
                op_end[s.op_id] = end
            if s.op_id not in op_start or start < op_start[s.op_id]:
                op_start[s.op_id] = start

        assert op_start[2] >= op_end[1]
        assert op_start[3] >= op_end[2]


# ═══════════════════════════════════════════════════════════════════════════
# Integration Test with real MPP file
# ═══════════════════════════════════════════════════════════════════════════

import os as _os
_MPP_PATH = _os.environ.get("MPP_TEST_FILE", str(Path(__file__).resolve().parent.parent / "data" / "test_fixture.mpp"))


@pytest.mark.skipif(
    not os.path.exists(_MPP_PATH),
    reason="Real MPP file not found",
)
class TestScheduleRealMPP:
    def test_schedule_real_mpp(self):
        """Integration test: schedule the real MPP file and validate output."""
        from backend.transform.transform import transform

        data = transform(_MPP_PATH)
        result = schedule_all(data)

        assert isinstance(result, ScheduleResult)
        assert len(result.segmentos) > 0
        # ~183 schedulable ops (328 complete/0h, some dropped by guardian)
        assert result.score["ops_agendadas"] >= 150

        # Check no dependency violations in warnings
        dep_violations = [w for w in result.warnings if "comeca antes do predecessor" in w]
        assert len(dep_violations) == 0, f"Dependency violations: {dep_violations[:5]}"
