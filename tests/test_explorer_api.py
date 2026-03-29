"""Tests for the Mold Explorer API — unit-level tests on the explorer functions."""
from __future__ import annotations

import pytest

from backend.scheduler.flexibility import classify_operations, count_compatible_machines
from backend.scheduler.impact import compute_timing_window, find_valid_swaps
from backend.scheduler.slack import compute_slack
from backend.scheduler.types import SegmentoMoldit
from backend.types import Maquina, MolditEngineData, Molde, Operacao


def _make_data_and_segments():
    """Build synthetic data for explorer tests."""
    ops = [
        Operacao(
            id=1, molde="M1", componente="C1", nome="Op1", codigo="CNC001",
            nome_completo="M1/C1/Op1", duracao_h=8.0, work_h=8.0,
            progresso=0.0, work_restante_h=8.0,
        ),
        Operacao(
            id=2, molde="M1", componente="C1", nome="Op2", codigo="CNC001",
            nome_completo="M1/C1/Op2", duracao_h=4.0, work_h=4.0,
            progresso=0.0, work_restante_h=4.0,
        ),
        Operacao(
            id=3, molde="M2", componente="C1", nome="Op3", codigo="CNC001",
            nome_completo="M2/C1/Op3", duracao_h=4.0, work_h=4.0,
            progresso=0.0, work_restante_h=4.0,
        ),
    ]
    machines = [
        Maquina(id="M1", grupo="CNC", regime_h=16),
        Maquina(id="M2", grupo="CNC", regime_h=16),
    ]
    moldes = [
        Molde(id="M1", cliente="Client", deadline="S20"),
        Molde(id="M2", cliente="Client", deadline="S20"),
    ]

    data = MolditEngineData(
        operacoes=ops,
        maquinas=machines,
        moldes=moldes,
        dag={1: [2]},
        dag_reverso={2: [1]},
        dependencias=[],
        compatibilidade={"CNC001": ["M1", "M2"]},
    )

    segments = [
        SegmentoMoldit(op_id=1, molde="M1", maquina_id="M1", dia=0, inicio_h=7.0, fim_h=15.0, duracao_h=8.0, setup_h=1.0),
        SegmentoMoldit(op_id=2, molde="M1", maquina_id="M1", dia=0, inicio_h=16.0, fim_h=20.0, duracao_h=4.0, setup_h=0.0),
        SegmentoMoldit(op_id=3, molde="M2", maquina_id="M1", dia=1, inicio_h=7.0, fim_h=11.0, duracao_h=4.0, setup_h=0.0),
    ]

    return data, segments


class TestExplorerEndpointReturnsData:
    def test_explorer_endpoint_returns_data(self):
        """Compute explorer data: slack, flexibility, ghost bars, deps."""
        data, segments = _make_data_and_segments()

        slacks = compute_slack(data, segments)
        flex = classify_operations(data, segments, slacks)

        # Should have slack info for all 3 ops
        assert len(slacks) == 3

        # Flexibility should be assigned to all scheduled ops
        assert len(flex) == 3
        for op_id, color in flex.items():
            assert color in ("verde", "azul", "laranja", "vermelho", "cinzento")

        # M1 mold ops
        mold_op_ids = {op.id for op in data.operacoes if op.molde == "M1"}
        assert mold_op_ids == {1, 2}

        # Ghost: op3 is on machine M1 but belongs to M2
        mold_machines = {"M1"}  # M1 mold uses machine M1
        ghosts = [s for s in segments if s.molde != "M1" and s.maquina_id in mold_machines]
        assert len(ghosts) == 1
        assert ghosts[0].op_id == 3

    def test_compatible_machines_count(self):
        """count_compatible_machines should return 2 for CNC001."""
        data, _ = _make_data_and_segments()
        op = data.operacoes[0]
        assert count_compatible_machines(op, data) == 2


class TestOpcoesEndpointReturnsAlternatives:
    def test_opcoes_endpoint_returns_alternatives(self):
        """Timing window and valid swaps should be computable."""
        data, segments = _make_data_and_segments()
        slacks = compute_slack(data, segments)

        timing = compute_timing_window(1, data, segments, slacks)
        assert "earliest" in timing
        assert "latest" in timing
        assert "atual" in timing
        assert timing["atual"]["dia"] == 0

    def test_valid_swaps(self):
        """Op3 (M2) is on same machine as Op1/Op2 (M1), but not in their DAG -> swappable."""
        data, segments = _make_data_and_segments()
        swaps = find_valid_swaps(1, segments, data)
        # Op3 is on same machine M1 and not related by DAG to op1
        swap_ids = [s["trocar_com"] for s in swaps]
        assert 3 in swap_ids
        # Op2 is a successor of op1 -> should NOT be in swaps
        assert 2 not in swap_ids
