"""CPO v3.0 Test Suite -- Moldit Planner Phase 4.

Tests chromosome encoding, mutation, crossover, cached pipeline, optimizer.
"""

from __future__ import annotations

import random

import pytest

from backend.config.types import FactoryConfig
from backend.cpo.cached_pipeline import CachedPipeline
from backend.cpo.chromosome import (
    MolditChromosome,
    crossover_uniform,
    mutate_machine,
    mutate_mold_priority,
    mutate_sequence_swap,
    mutate_strong,
)
from backend.cpo.optimizer import optimize
from backend.scheduler.scheduler import schedule_all
from backend.scheduler.types import ScheduleResult
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
    """Synthetic data: 2 moldes, 4 ops, 2 machines."""
    ops = [
        _make_op(1, molde="M1", codigo="CNC001", work_h=6.0),
        _make_op(2, molde="M1", codigo="CNC001", work_h=4.0),
        _make_op(3, molde="M2", codigo="EDM001", work_h=8.0),
        _make_op(4, molde="M2", codigo="EDM001", work_h=5.0),
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
# Chromosome Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestChromosomeFromBaseline:
    def test_creates_valid_chromosome(self):
        data = _make_data()
        config = _make_config()
        result = schedule_all(data, config=config)
        chrom = MolditChromosome.from_baseline(result.segmentos, data)

        assert isinstance(chrom, MolditChromosome)
        assert len(chrom.machine_choice) > 0
        assert len(chrom.mold_priority) == 2
        assert chrom.mold_priority["M1"] == 1.0
        assert 0.0 <= chrom.setup_aversion <= 1.0

    def test_hash_deterministic(self):
        data = _make_data()
        config = _make_config()
        result = schedule_all(data, config=config)
        chrom = MolditChromosome.from_baseline(result.segmentos, data)
        h1 = chrom.compute_hash()
        h2 = chrom.compute_hash()
        assert h1 == h2

    def test_clone_independent(self):
        chrom = MolditChromosome(
            machine_choice={1: 0, 2: 1},
            mold_priority={"M1": 1.0},
            setup_aversion=0.5,
        )
        clone = chrom.clone()
        clone.machine_choice[1] = 99
        assert chrom.machine_choice[1] == 0


# ═══════════════════════════════════════════════════════════════════════════
# Mutation Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestMutations:
    def test_mutate_machine_changes_assignment(self):
        data = _make_data()
        config = _make_config()
        result = schedule_all(data, config=config)
        chrom = MolditChromosome.from_baseline(result.segmentos, data)
        rng = random.Random(42)

        # Run mutation many times -- at least one should change
        changed = False
        for _ in range(20):
            mutant = mutate_machine(chrom, rng, data)
            if mutant.machine_choice != chrom.machine_choice:
                changed = True
                break
        assert changed

    def test_mutate_sequence_swap(self):
        data = _make_data()
        config = _make_config()
        result = schedule_all(data, config=config)
        chrom = MolditChromosome.from_baseline(result.segmentos, data)
        rng = random.Random(42)

        # Need at least 2 ops on same machine
        if any(len(v) >= 2 for v in chrom.sequence_keys.values()):
            mutant = mutate_sequence_swap(chrom, rng, data)
            assert isinstance(mutant, MolditChromosome)

    def test_mutate_mold_priority_bounded(self):
        chrom = MolditChromosome(mold_priority={"M1": 1.0, "M2": 1.5})
        data = _make_data()
        rng = random.Random(42)
        for _ in range(100):
            chrom = mutate_mold_priority(chrom, rng, data)
        for v in chrom.mold_priority.values():
            assert 0.5 <= v <= 2.0

    def test_mutate_strong_changes_multiple(self):
        data = _make_data()
        config = _make_config()
        result = schedule_all(data, config=config)
        chrom = MolditChromosome.from_baseline(result.segmentos, data)
        rng = random.Random(42)
        mutant = mutate_strong(chrom, rng, data)
        assert isinstance(mutant, MolditChromosome)


# ═══════════════════════════════════════════════════════════════════════════
# Crossover Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestCrossover:
    def test_crossover_combines_parents(self):
        data = _make_data()
        a = MolditChromosome(
            machine_choice={1: 0, 2: 0},
            mold_priority={"M1": 0.5, "M2": 0.5},
            setup_aversion=0.0,
        )
        b = MolditChromosome(
            machine_choice={1: 1, 2: 1},
            mold_priority={"M1": 2.0, "M2": 2.0},
            setup_aversion=1.0,
        )
        rng = random.Random(42)
        child = crossover_uniform(a, b, rng, data)
        assert isinstance(child, MolditChromosome)
        # Child should have values from either parent
        for op_id in [1, 2]:
            assert child.machine_choice.get(op_id) in (0, 1, None)


# ═══════════════════════════════════════════════════════════════════════════
# CachedPipeline Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestCachedPipeline:
    def test_cache_hit(self):
        data = _make_data()
        config = _make_config()
        pipeline = CachedPipeline(data, config)

        chrom = MolditChromosome(mold_priority={"M1": 1.0, "M2": 1.0})
        result1, cost1 = pipeline.evaluate(chrom)
        result2, cost2 = pipeline.evaluate(chrom)

        assert cost1 == cost2
        assert pipeline.cache_hits == 1
        assert pipeline.eval_count == 1


# ═══════════════════════════════════════════════════════════════════════════
# Optimizer Tests
# ═══════════════════════════════════════════════════════════════════════════


class TestOptimizer:
    def test_quick_equals_baseline(self):
        data = _make_data()
        config = _make_config()
        baseline = schedule_all(data, config=config)
        quick = optimize(data, mode="quick", config=config)

        assert isinstance(quick, ScheduleResult)
        # Quick mode should produce same score as baseline
        assert quick.score["weighted_score"] == baseline.score["weighted_score"]

    def test_normal_no_worse(self):
        data = _make_data()
        config = _make_config()
        baseline = schedule_all(data, config=config)
        result = optimize(data, mode="normal", config=config, seed=42)

        assert isinstance(result, ScheduleResult)
        # Optimizer should never return worse than baseline
        assert result.score["weighted_score"] >= baseline.score["weighted_score"]
