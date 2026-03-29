"""Tests for Moldit API endpoints (Phase 5)."""

from __future__ import annotations

import pytest

from backend.types import MolditEngineData, Operacao, Molde, Maquina, Dependencia
from backend.scheduler.types import SegmentoMoldit


def _make_engine_data() -> MolditEngineData:
    """Build minimal MolditEngineData for testing."""
    ops = [
        Operacao(
            id=1, molde="M001", componente="Cavidade", nome="Desbaste",
            codigo="CNC-001", nome_completo="M001 Cavidade Desbaste",
            duracao_h=10.0, work_h=8.0, progresso=50.0, work_restante_h=4.0,
            recurso="CNC01", grupo_recurso="CNC",
        ),
        Operacao(
            id=2, molde="M001", componente="Cavidade", nome="Acabamento",
            codigo="CNC-002", nome_completo="M001 Cavidade Acabamento",
            duracao_h=6.0, work_h=5.0, progresso=0.0, work_restante_h=5.0,
            recurso="CNC02", grupo_recurso="CNC",
        ),
        Operacao(
            id=3, molde="M002", componente="Bucha", nome="Desbaste",
            codigo="CNC-003", nome_completo="M002 Bucha Desbaste",
            duracao_h=8.0, work_h=7.0, progresso=100.0, work_restante_h=0.0,
            recurso="CNC01", grupo_recurso="CNC",
        ),
    ]
    moldes = [
        Molde(id="M001", cliente="ClienteA", deadline="S20", total_ops=2,
              ops_concluidas=0, progresso=25.0, total_work_h=13.0),
        Molde(id="M002", cliente="ClienteB", deadline="S18", total_ops=1,
              ops_concluidas=1, progresso=100.0, total_work_h=7.0),
    ]
    maquinas = [
        Maquina(id="CNC01", grupo="CNC", regime_h=16),
        Maquina(id="CNC02", grupo="CNC", regime_h=16),
    ]
    deps = [
        Dependencia(predecessor_id=1, sucessor_id=2),
    ]
    return MolditEngineData(
        operacoes=ops,
        maquinas=maquinas,
        moldes=moldes,
        dependencias=deps,
        dag={1: [2]},
        dag_reverso={2: [1]},
        caminho_critico=[1, 2],
    )


def _make_segments() -> list[SegmentoMoldit]:
    """Build minimal segments for testing."""
    return [
        SegmentoMoldit(
            op_id=1, molde="M001", maquina_id="CNC01",
            dia=0, inicio_h=0.0, fim_h=4.0, duracao_h=4.0, setup_h=1.0,
        ),
        SegmentoMoldit(
            op_id=2, molde="M001", maquina_id="CNC02",
            dia=1, inicio_h=0.0, fim_h=5.0, duracao_h=5.0, setup_h=0.5,
        ),
        SegmentoMoldit(
            op_id=3, molde="M002", maquina_id="CNC01",
            dia=0, inicio_h=5.0, fim_h=12.0, duracao_h=7.0, setup_h=1.0,
        ),
    ]


# --- Tests for /moldes endpoint logic ---

class TestMoldesEndpoint:
    """Test moldes listing logic."""

    def test_moldes_list(self):
        data = _make_engine_data()
        moldes = data.moldes

        assert len(moldes) == 2
        assert moldes[0].id == "M001"
        assert moldes[0].cliente == "ClienteA"
        assert moldes[1].progresso == 100.0

    def test_molde_detail_ops(self):
        data = _make_engine_data()
        molde_id = "M001"

        ops = [op for op in data.operacoes if op.molde == molde_id]
        assert len(ops) == 2
        assert ops[0].nome == "Desbaste"
        assert ops[1].nome == "Acabamento"

    def test_molde_detail_segments(self):
        segments = _make_segments()
        molde_segs = [s for s in segments if s.molde == "M001"]
        assert len(molde_segs) == 2

    def test_molde_not_found(self):
        data = _make_engine_data()
        molde = next((m for m in data.moldes if m.id == "NONEXIST"), None)
        assert molde is None


# --- Tests for /timeline endpoint logic ---

class TestTimelineEndpoint:
    """Test timeline (Gantt) grouping logic."""

    def test_timeline_groups_by_machine(self):
        segments = _make_segments()

        from collections import defaultdict
        by_machine: dict[str, list] = defaultdict(list)
        for s in segments:
            by_machine[s.maquina_id].append(s)

        assert "CNC01" in by_machine
        assert "CNC02" in by_machine
        assert len(by_machine["CNC01"]) == 2
        assert len(by_machine["CNC02"]) == 1

    def test_timeline_segment_fields(self):
        segments = _make_segments()
        s = segments[0]

        assert s.op_id == 1
        assert s.molde == "M001"
        assert s.maquina_id == "CNC01"
        assert s.dia == 0
        assert s.inicio_h == 0.0
        assert s.fim_h == 4.0
        assert s.duracao_h == 4.0
        assert s.setup_h == 1.0

    def test_timeline_empty(self):
        from collections import defaultdict
        by_machine: dict[str, list] = defaultdict(list)
        for s in []:
            by_machine[s.maquina_id].append(s)
        assert len(by_machine) == 0


# --- Tests for /bottlenecks endpoint logic ---

class TestBottlenecksEndpoint:
    """Test bottleneck computation logic."""

    def test_bottleneck_stress_calculation(self):
        segments = _make_segments()
        data = _make_engine_data()

        # Manual stress calculation
        hours_by_machine: dict[str, float] = {}
        for s in segments:
            hours_by_machine[s.maquina_id] = hours_by_machine.get(s.maquina_id, 0) + s.duracao_h + s.setup_h

        max_dia = max(s.dia for s in segments)
        n_days = max_dia + 1

        stress = {}
        for m in data.maquinas:
            total_h = hours_by_machine.get(m.id, 0)
            capacity_h = m.regime_h * n_days
            stress[m.id] = total_h / capacity_h * 100 if capacity_h > 0 else 0

        # CNC01: (4+1 + 7+1) / (16*2) * 100 = 13/32 * 100 = 40.6%
        assert 40 < stress["CNC01"] < 42
        # CNC02: (5+0.5) / (16*2) * 100 = 5.5/32 * 100 = 17.2%
        assert 17 < stress["CNC02"] < 18

    def test_bottleneck_ranking(self):
        segments = _make_segments()

        hours_by_machine: dict[str, float] = {}
        for s in segments:
            hours_by_machine[s.maquina_id] = hours_by_machine.get(s.maquina_id, 0) + s.duracao_h + s.setup_h

        ranked = sorted(hours_by_machine.items(), key=lambda kv: -kv[1])
        assert ranked[0][0] == "CNC01"  # CNC01 has more load

    def test_bottleneck_empty_segments(self):
        hours: dict[str, float] = {}
        ranked = sorted(hours.items(), key=lambda kv: -kv[1])
        assert len(ranked) == 0


# --- Tests for coverage audit ---

class TestCoverageAudit:
    """Test coverage audit computation."""

    def test_coverage_basic(self):
        from backend.analytics.coverage_audit import compute_coverage_audit

        data = _make_engine_data()
        segments = _make_segments()

        cov = compute_coverage_audit(segments, data)
        assert cov.overall_coverage_pct == 100.0  # all 3 ops have segments
        assert len(cov.molds) == 2
        assert cov.uncovered_ops == []

    def test_coverage_missing_ops(self):
        from backend.analytics.coverage_audit import compute_coverage_audit

        data = _make_engine_data()
        # Only schedule op 1, leaving op 2 uncovered
        segments = [_make_segments()[0]]

        cov = compute_coverage_audit(segments, data)
        # Op 2 has work_restante > 0, so it's uncovered
        assert 2 in cov.uncovered_ops
        assert cov.overall_coverage_pct < 100.0


# --- Tests for trust index ---

class TestTrustIndex:
    """Test DQA trust index."""

    def test_trust_basic(self):
        from backend.dqa.trust_index import compute_trust_index

        data = _make_engine_data()
        result = compute_trust_index(data)

        assert 0 <= result.score <= 100
        assert result.gate in ("full_auto", "monitoring", "suggestion", "manual")
        assert result.n_ops == 3
        assert len(result.dimensions) == 4


# --- Tests for presets ---

class TestPresets:
    """Test config presets."""

    def test_preset_names(self):
        from backend.config.presets import list_presets
        names = list_presets()
        assert "rapido" in names
        assert "equilibrado" in names
        assert "min_setups" in names
        assert "balanceado" in names

    def test_preset_weights_sum(self):
        from backend.config.presets import PRESETS
        for name, overrides in PRESETS.items():
            weights = [v for k, v in overrides.items() if k.startswith("weight_")]
            if weights:
                assert abs(sum(weights) - 1.0) < 0.01, f"Preset {name} weights sum to {sum(weights)}"

    def test_preset_unknown_raises(self):
        from backend.config.presets import get_preset
        with pytest.raises(KeyError):
            get_preset("nonexistent")
