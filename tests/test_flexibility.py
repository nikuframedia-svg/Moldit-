"""Tests for flexibility classification."""
from __future__ import annotations

import pytest

from backend.scheduler.flexibility import classify_operations
from backend.scheduler.slack import SlackInfo, compute_slack
from backend.scheduler.types import SegmentoMoldit
from backend.types import Maquina, MolditEngineData, Molde, Operacao


def _make_op(id: int, molde: str = "M1", codigo: str = "CNC001", work_h: float = 8.0, progresso: float = 0.0) -> Operacao:
    wr = work_h * (1.0 - progresso / 100.0)
    return Operacao(
        id=id, molde=molde, componente="C1", nome=f"Op{id}", codigo=codigo,
        nome_completo=f"{molde}/C1/Op{id}", duracao_h=work_h, work_h=work_h,
        progresso=progresso, work_restante_h=wr,
    )


def _make_seg(op_id: int, molde: str = "M1", maquina: str = "M1", dia: int = 0,
              inicio_h: float = 7.0, duracao_h: float = 8.0) -> SegmentoMoldit:
    return SegmentoMoldit(
        op_id=op_id, molde=molde, maquina_id=maquina, dia=dia,
        inicio_h=inicio_h, fim_h=inicio_h + duracao_h, duracao_h=duracao_h,
    )


class TestGreenWithSlack:
    def test_green_with_slack(self):
        """Op with slack should be green."""
        ops = [_make_op(1, work_h=8.0), _make_op(2, work_h=4.0), _make_op(3, work_h=4.0)]
        segs = [
            _make_seg(1, dia=0, inicio_h=7.0, duracao_h=8.0),
            _make_seg(2, dia=0, inicio_h=7.0, duracao_h=4.0),
            _make_seg(3, dia=0, inicio_h=15.0, duracao_h=4.0),
        ]
        data = MolditEngineData(
            operacoes=ops,
            maquinas=[Maquina(id="M1", grupo="CNC", regime_h=16)],
            moldes=[Molde(id="M1", cliente="C", deadline="S20")],
            dag={1: [3], 2: [3]},
            dag_reverso={3: [1, 2]},
            compatibilidade={"CNC001": ["M1"]},
        )
        slacks = compute_slack(data, segs)
        flex = classify_operations(data, segs, slacks)

        # op2 has slack -> should be verde
        assert flex[2] == "verde"


class TestRedCriticalNoAlternatives:
    def test_red_critical_no_alternatives(self):
        """Op on critical path with 1 machine -> vermelho."""
        ops = [_make_op(1, work_h=4.0), _make_op(2, work_h=4.0)]
        segs = [
            _make_seg(1, dia=0, inicio_h=7.0, duracao_h=4.0),
            _make_seg(2, dia=0, inicio_h=11.0, duracao_h=4.0),
        ]
        data = MolditEngineData(
            operacoes=ops,
            maquinas=[Maquina(id="M1", grupo="CNC", regime_h=16)],
            moldes=[Molde(id="M1", cliente="C", deadline="S20")],
            dag={1: [2]},
            dag_reverso={2: [1]},
            compatibilidade={"CNC001": ["M1"]},
        )
        slacks = compute_slack(data, segs)
        flex = classify_operations(data, segs, slacks)

        # Both on critical path, only 1 compatible machine -> vermelho
        assert flex[1] == "vermelho"
        assert flex[2] == "vermelho"


class TestCinzentoCompleted:
    def test_cinzento_completed(self):
        """Completed op -> cinzento."""
        ops = [_make_op(1, work_h=4.0, progresso=100.0)]
        segs = [_make_seg(1, dia=0, inicio_h=7.0, duracao_h=4.0)]
        data = MolditEngineData(
            operacoes=ops,
            maquinas=[Maquina(id="M1", grupo="CNC", regime_h=16)],
            moldes=[Molde(id="M1", cliente="C", deadline="S20")],
            dag={},
            dag_reverso={},
            compatibilidade={"CNC001": ["M1"]},
        )
        slacks = compute_slack(data, segs)
        flex = classify_operations(data, segs, slacks)

        assert flex[1] == "cinzento"
