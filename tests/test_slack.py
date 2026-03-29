"""Tests for slack computation via CPM."""
from __future__ import annotations

import pytest

from backend.scheduler.slack import compute_slack
from backend.scheduler.types import SegmentoMoldit
from backend.types import Dependencia, Maquina, MolditEngineData, Molde, Operacao


def _make_op(id: int, molde: str = "M1", codigo: str = "CNC001", work_h: float = 8.0, progresso: float = 0.0) -> Operacao:
    wr = work_h * (1.0 - progresso / 100.0)
    return Operacao(
        id=id, molde=molde, componente="C1", nome=f"Op{id}", codigo=codigo,
        nome_completo=f"{molde}/C1/Op{id}", duracao_h=work_h, work_h=work_h,
        progresso=progresso, work_restante_h=wr,
    )


def _make_seg(op_id: int, molde: str = "M1", maquina: str = "M1", dia: int = 0,
              inicio_h: float = 7.0, duracao_h: float = 8.0, setup_h: float = 0.0) -> SegmentoMoldit:
    return SegmentoMoldit(
        op_id=op_id, molde=molde, maquina_id=maquina, dia=dia,
        inicio_h=inicio_h, fim_h=inicio_h + duracao_h, duracao_h=duracao_h, setup_h=setup_h,
    )


def _make_data(ops, dag=None, dag_rev=None) -> MolditEngineData:
    return MolditEngineData(
        operacoes=ops,
        maquinas=[Maquina(id="M1", grupo="CNC", regime_h=16)],
        moldes=[Molde(id="M1", cliente="C", deadline="S20")],
        dag=dag or {},
        dag_reverso=dag_rev or {},
        compatibilidade={"CNC001": ["M1"]},
    )


class TestSimpleChainSlack:
    def test_simple_chain_slack(self):
        """A->B->C in a chain: all should be critical (slack 0)."""
        ops = [_make_op(1, work_h=4.0), _make_op(2, work_h=4.0), _make_op(3, work_h=4.0)]
        segs = [
            _make_seg(1, dia=0, inicio_h=7.0, duracao_h=4.0),
            _make_seg(2, dia=0, inicio_h=11.0, duracao_h=4.0),
            _make_seg(3, dia=0, inicio_h=15.0, duracao_h=4.0),
        ]
        data = _make_data(ops, dag={1: [2], 2: [3]}, dag_rev={2: [1], 3: [2]})
        slacks = compute_slack(data, segs)

        assert len(slacks) == 3
        for oid in [1, 2, 3]:
            assert slacks[oid].no_caminho_critico is True
            assert slacks[oid].slack_h == 0.0


class TestParallelPathsSlack:
    def test_parallel_paths_slack(self):
        """Two parallel paths: longer path is critical, shorter has slack."""
        # Path 1: op1 (8h) -> op3 (4h)  = 12h total
        # Path 2: op2 (4h) -> op3 (4h)  = 8h total
        # op3 depends on both op1 and op2
        ops = [_make_op(1, work_h=8.0), _make_op(2, work_h=4.0), _make_op(3, work_h=4.0)]
        segs = [
            _make_seg(1, dia=0, inicio_h=7.0, duracao_h=8.0),
            _make_seg(2, dia=0, inicio_h=7.0, duracao_h=4.0),
            _make_seg(3, dia=0, inicio_h=15.0, duracao_h=4.0),
        ]
        data = _make_data(ops, dag={1: [3], 2: [3]}, dag_rev={3: [1, 2]})
        slacks = compute_slack(data, segs)

        # op1 is on critical path (8h, longer)
        assert slacks[1].no_caminho_critico is True
        assert slacks[1].slack_h == 0.0

        # op2 has slack (4h shorter path, 4h slack)
        assert slacks[2].no_caminho_critico is False
        assert slacks[2].slack_h > 0.0

        # op3 is on critical path
        assert slacks[3].no_caminho_critico is True


class TestCompletedOpsExcluded:
    def test_completed_ops_excluded(self):
        """Completed ops that are not in segments should not appear in slacks."""
        ops = [_make_op(1, work_h=4.0, progresso=100.0), _make_op(2, work_h=4.0)]
        # Only op2 has a segment (op1 is done)
        segs = [_make_seg(2, dia=0, inicio_h=7.0, duracao_h=4.0)]
        data = _make_data(ops, dag={1: [2]}, dag_rev={2: [1]})
        slacks = compute_slack(data, segs)

        assert 1 not in slacks
        assert 2 in slacks
