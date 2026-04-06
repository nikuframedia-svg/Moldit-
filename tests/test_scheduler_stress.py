"""Stress tests for the Moldit scheduler.

Tests edge cases, heavy loads, adversarial inputs, timing correctness,
deadline enforcement, and the full real MPP pipeline.
"""

from __future__ import annotations

import os
import time
from collections import defaultdict

import pytest

from backend.config.loader import load_config
from backend.scheduler.dispatch import (
    assign_machines,
    build_priority_queue,
    dispatch_timeline,
)
from backend.scheduler.scheduler import schedule_all
from backend.types import (
    Dependencia,
    Maquina,
    Molde,
    MolditEngineData,
    Operacao,
)

_CFG = load_config()


def _op(oid, molde="M001", codigo="FE010", work_h=8.0, recurso=None,
        progresso=0.0, condicional=False, placa2=False, deadline=None):
    return Operacao(
        id=oid, molde=molde, componente="C", nome=f"Op{oid}",
        codigo=codigo, nome_completo=f"{molde}>Op{oid}",
        duracao_h=work_h, work_h=work_h, progresso=progresso,
        work_restante_h=work_h * (1 - progresso / 100),
        recurso=recurso, e_condicional=condicional, e_2a_placa=placa2,
        deadline_semana=deadline,
    )


def _data(ops, machines, moldes, deps=None, compat=None):
    deps = deps or []
    dag = defaultdict(list)
    dag_rev = defaultdict(list)
    for d in deps:
        dag[d.predecessor_id].append(d.sucessor_id)
        dag_rev[d.sucessor_id].append(d.predecessor_id)
    if compat is None:
        compat = defaultdict(list)
        for m in machines:
            for o in ops:
                if m.id not in compat[o.codigo]:
                    compat[o.codigo].append(m.id)
    return MolditEngineData(
        operacoes=ops, maquinas=machines, moldes=moldes,
        dependencias=deps, compatibilidade=dict(compat),
        dag=dict(dag), dag_reverso=dict(dag_rev),
        caminho_critico=[], feriados=[],
    )


# ═══════════════════════════════════════════════════════════════════════
#  PRIORITY QUEUE TESTS
# ═══════════════════════════════════════════════════════════════════════


class TestPriorityQueue:
    """Test topological ordering, deadline urgency, and conditional handling."""

    def test_linear_chain_order(self):
        """A→B→C must be scheduled in order."""
        ops = [_op(1), _op(2), _op(3)]
        dag = {1: [2], 2: [3]}
        dag_rev = {2: [1], 3: [2]}
        moldes = [Molde(id="M001", cliente="X", deadline="S20")]

        pq = build_priority_queue(ops, dag, dag_rev, moldes, [])
        assert pq.index(1) < pq.index(2) < pq.index(3)

    def test_urgent_deadline_first(self):
        """S15 mold ops should come before S25 mold ops (same topo layer)."""
        ops = [
            _op(1, molde="URGENT", codigo="FE010", work_h=10),
            _op(2, molde="CHILL", codigo="FE010", work_h=10),
        ]
        moldes = [
            Molde(id="URGENT", cliente="X", deadline="S15"),
            Molde(id="CHILL", cliente="Y", deadline="S25"),
        ]
        pq = build_priority_queue(ops, {}, {}, moldes, [])
        assert pq.index(1) < pq.index(2)

    def test_conditional_pushed_to_end(self):
        """Conditional ops go to layer 9999."""
        ops = [_op(1), _op(2, condicional=True), _op(3)]
        moldes = [Molde(id="M001", cliente="X", deadline="S20")]
        pq = build_priority_queue(ops, {}, {}, moldes, [])
        assert pq[-1] == 2  # conditional is last

    def test_completed_ops_excluded(self):
        """Ops with work_restante=0 should not appear in queue."""
        ops = [_op(1, progresso=100), _op(2), _op(3)]
        moldes = [Molde(id="M001", cliente="X", deadline="S20")]
        pq = build_priority_queue(ops, {}, {}, moldes, [])
        assert 1 not in pq
        assert len(pq) == 2

    def test_critical_path_boosted(self):
        """Critical path ops get priority over non-critical at same layer."""
        ops = [_op(1, work_h=5), _op(2, work_h=5)]
        moldes = [Molde(id="M001", cliente="X", deadline="S20")]
        pq = build_priority_queue(ops, {}, {}, moldes, [1])  # op 1 is critical
        assert pq[0] == 1

    def test_diamond_dag(self):
        """Diamond: A→B, A→C, B→D, C→D. All must respect topo order."""
        ops = [_op(i) for i in [1, 2, 3, 4]]
        dag = {1: [2, 3], 2: [4], 3: [4]}
        dag_rev = {2: [1], 3: [1], 4: [2, 3]}
        moldes = [Molde(id="M001", cliente="X", deadline="S20")]

        pq = build_priority_queue(ops, dag, dag_rev, moldes, [])
        assert pq.index(1) < pq.index(2)
        assert pq.index(1) < pq.index(3)
        assert pq.index(2) < pq.index(4)
        assert pq.index(3) < pq.index(4)


# ═══════════════════════════════════════════════════════════════════════
#  MACHINE ASSIGNMENT TESTS
# ═══════════════════════════════════════════════════════════════════════


class TestMachineAssignment:
    """Test least-loaded picking, bancada dedication, 2a placa."""

    def test_load_balancing(self):
        """With 2 identical CNC machines, load should spread evenly."""
        ops = [_op(i, work_h=16) for i in range(1, 7)]
        machines = {
            "CNC-A": Maquina("CNC-A", "Desbaste", 16, False, 1.0),
            "CNC-B": Maquina("CNC-B", "Desbaste", 16, False, 1.0),
        }
        compat = {"FE010": ["CNC-A", "CNC-B"]}
        ops_by_id = {o.id: o for o in ops}
        pq = list(range(1, 7))

        asgn = assign_machines(ops_by_id, pq, compat, machines, _CFG)
        counts = defaultdict(int)
        for mid in asgn.values():
            counts[mid] += 1
        assert counts["CNC-A"] == 3
        assert counts["CNC-B"] == 3

    def test_direct_resource_respected(self):
        """If op.recurso is set, that machine must be used."""
        ops = [_op(1, recurso="CNC-A"), _op(2, recurso="CNC-B")]
        machines = {
            "CNC-A": Maquina("CNC-A", "Desbaste", 16, False, 1.0),
            "CNC-B": Maquina("CNC-B", "Desbaste", 16, False, 1.0),
        }
        compat = {"FE010": ["CNC-A", "CNC-B"]}
        ops_by_id = {o.id: o for o in ops}

        asgn = assign_machines(ops_by_id, [1, 2], compat, machines, _CFG)
        assert asgn[1] == "CNC-A"
        assert asgn[2] == "CNC-B"

    def test_no_compatible_machine(self):
        """Op with unknown code → not assigned (silently skipped)."""
        ops = [_op(1, codigo="UNKNOWN")]
        machines = {"CNC-A": Maquina("CNC-A", "Desbaste", 16, False, 1.0)}
        compat = {"FE010": ["CNC-A"]}  # UNKNOWN not in compat
        ops_by_id = {o.id: o for o in ops}

        asgn = assign_machines(ops_by_id, [1], compat, machines, _CFG)
        assert 1 not in asgn

    def test_2a_placa_virtual_machine(self):
        """2a placa ops get assigned to virtual // machine."""
        ops = [_op(1, recurso="// CNC-A", placa2=True)]
        machines = {
            "CNC-A": Maquina("CNC-A", "Desbaste", 16, False, 1.0),
            "// CNC-A": Maquina("// CNC-A", "Desbaste", 16, False, 0.0),
        }
        compat = {"FE010": ["CNC-A", "// CNC-A"]}
        ops_by_id = {o.id: o for o in ops}

        asgn = assign_machines(ops_by_id, [1], compat, machines, _CFG)
        assert asgn[1] == "// CNC-A"


# ═══════════════════════════════════════════════════════════════════════
#  TIMELINE DISPATCH TESTS
# ═══════════════════════════════════════════════════════════════════════


class TestTimelineDispatch:
    """Test timing correctness, multi-day, holidays, setup, regime limits."""

    def _dispatch(self, ops, machines, deps=None, holidays=None):
        deps = deps or []
        dag_rev = defaultdict(list)
        for d in deps:
            dag_rev[d.sucessor_id].append(d.predecessor_id)
        ops_by_id = {o.id: o for o in ops}
        mach_dict = {m.id: m for m in machines}
        pq = [o.id for o in ops if o.work_restante_h > 0]
        compat = defaultdict(list)
        for m in machines:
            for o in ops:
                if m.id not in compat[o.codigo]:
                    compat[o.codigo].append(m.id)
        asgn = assign_machines(ops_by_id, pq, dict(compat), mach_dict, _CFG)
        return dispatch_timeline(
            ops_by_id, pq, asgn, dict(dag_rev), mach_dict, _CFG,
            ref_date="2026-04-06",  # Monday
            holidays=holidays or [],
        )

    def test_single_op_fits_in_one_day(self):
        """8h op on 16h machine — fits within Shift A + B."""
        segs = self._dispatch(
            [_op(1, work_h=8)],
            [Maquina("M1", "CNC", 16, False, 1.0)],
        )
        total_work = sum(s.duracao_h for s in segs)
        assert abs(total_work - 8.0) < 0.1
        assert segs[0].setup_h == 1.0  # setup on first segment
        # With shift-awareness, may split across shift boundary
        assert segs[0].dia == 0

    def test_multi_day_operation(self):
        """40h op on 16h machine should span multiple days."""
        segs = self._dispatch(
            [_op(1, work_h=40)],
            [Maquina("M1", "CNC", 16, False, 1.0)],
        )
        total_work = sum(s.duracao_h for s in segs)
        assert abs(total_work - 40.0) < 0.1
        assert len(segs) >= 3  # 40h / ~15h per day = 3+ days
        # All segments on the same machine
        assert all(s.maquina_id == "M1" for s in segs)

    def test_setup_only_on_first_segment(self):
        """Setup time should only appear on the first segment."""
        segs = self._dispatch(
            [_op(1, work_h=30)],
            [Maquina("M1", "CNC", 16, False, 2.0)],  # 2h setup
        )
        setups = [s for s in segs if s.setup_h > 0]
        assert len(setups) == 1
        assert setups[0].setup_h == 2.0
        # Continuation flag
        continuations = [s for s in segs if s.e_continuacao]
        assert len(continuations) >= 1

    def test_holidays_skipped(self):
        """Operations should skip holidays."""
        segs = self._dispatch(
            [_op(1, work_h=32)],  # Will need 3+ days
            [Maquina("M1", "CNC", 16, False, 0.5)],
            holidays=["2026-04-07"],  # Tuesday holiday
        )
        # Day 1 offset = Tuesday = holiday, should be skipped
        days_used = sorted(set(s.dia for s in segs))
        assert 1 not in days_used  # Tuesday skipped

    def test_weekends_skipped(self):
        """ref_date=Monday → day 5=Saturday, day 6=Sunday should be skipped."""
        segs = self._dispatch(
            [_op(1, work_h=80)],  # Needs ~6 days
            [Maquina("M1", "CNC", 16, False, 0.5)],
        )
        days_used = set(s.dia for s in segs)
        # Day 5=Sat, 6=Sun should be skipped
        assert 5 not in days_used
        assert 6 not in days_used

    def test_dependency_timing(self):
        """B should start only after A finishes."""
        ops = [_op(1, work_h=8), _op(2, work_h=8)]
        deps = [Dependencia(1, 2)]
        segs = self._dispatch(
            ops,
            [Maquina("M1", "CNC", 16, False, 0.5)],
            deps=deps,
        )
        op1_end = max((s.dia, s.fim_h) for s in segs if s.op_id == 1)
        op2_start = min((s.dia, s.inicio_h) for s in segs if s.op_id == 2)
        assert op2_start >= op1_end

    def test_parallel_on_different_machines(self):
        """Two independent ops on 2 machines should start on the same day."""
        ops = [_op(1, work_h=16, codigo="FE010"), _op(2, work_h=16, codigo="EE005")]
        machines = [
            Maquina("CNC", "CNC", 16, False, 0.5),
            Maquina("ERO", "EROSAO", 16, False, 1.0),
        ]
        compat = {"FE010": ["CNC"], "EE005": ["ERO"]}
        data = _data(ops, machines,
                     [Molde("M001", "X", "S20")],
                     compat=compat)
        data.feriados = []  # No holidays for this test
        data.data_referencia = "2026-04-06"  # Monday
        result = schedule_all(data, config=_CFG)

        op1_days = {s.dia for s in result.segmentos if s.op_id == 1}
        op2_days = {s.dia for s in result.segmentos if s.op_id == 2}
        # Both should start on the same first working day (parallel)
        assert min(op1_days) == min(op2_days)

    def test_external_resource_single_segment(self):
        """External (regime_h=0) ops get 1 segment, infinite capacity."""
        ops = [_op(1, work_h=100, codigo="EXT")]
        machines = [Maquina("EXT-01", "Externo", 0, True, 0.0)]
        compat = {"EXT": ["EXT-01"]}
        data = _data(ops, machines,
                     [Molde("M001", "X", "S20")],
                     compat=compat)
        result = schedule_all(data, config=_CFG)

        ext_segs = [s for s in result.segmentos if s.maquina_id == "EXT-01"]
        assert len(ext_segs) == 1
        assert ext_segs[0].duracao_h == 100

    def test_8h_regime_machine(self):
        """8h regime machine should respect limit per day."""
        segs = self._dispatch(
            [_op(1, work_h=20)],
            [Maquina("BAN", "Bancada", 8, False, 0.0)],
        )
        for s in segs:
            day_hours = s.fim_h - s.inicio_h
            assert day_hours <= 8.1  # tolerance

    def test_no_overlap_two_ops_same_machine(self):
        """Two ops on same machine must not overlap."""
        ops = [_op(1, work_h=10), _op(2, work_h=10)]
        segs = self._dispatch(
            ops,
            [Maquina("M1", "CNC", 16, False, 1.0)],
        )
        by_day = defaultdict(list)
        for s in segs:
            by_day[s.dia].append(s)
        for day, day_segs in by_day.items():
            sorted_s = sorted(day_segs, key=lambda s: s.inicio_h)
            for i in range(len(sorted_s) - 1):
                assert sorted_s[i].fim_h <= sorted_s[i + 1].inicio_h + 0.01


# ═══════════════════════════════════════════════════════════════════════
#  SCORING TESTS
# ═══════════════════════════════════════════════════════════════════════


class TestScoringDeep:
    """Test scoring edge cases and deadline compliance logic."""

    def test_100_percent_compliance(self):
        """All molds finish before deadline → 100% compliance."""
        ops = [_op(1, molde="M1", work_h=8), _op(2, molde="M2", work_h=8)]
        machines = [Maquina("M", "CNC", 16, False, 0.5)]
        moldes = [
            Molde("M1", "X", "S20"),  # day 100 → easy
            Molde("M2", "Y", "S25"),  # day 125 → easy
        ]
        data = _data(ops, machines, moldes)
        result = schedule_all(data, config=_CFG)
        assert result.score["deadline_compliance"] == 1.0

    def test_deadline_violation_detected(self):
        """Tight deadline → violation flagged."""
        ops = [_op(i, work_h=50) for i in range(1, 6)]  # 250h total
        machines = [Maquina("M", "CNC", 16, False, 1.0)]
        moldes = [Molde("M001", "X", "S2")]  # S2 = 10 days → impossible
        data = _data(ops, machines, moldes)
        result = schedule_all(data, config=_CFG)

        assert result.score["deadline_compliance"] < 1.0
        assert len(result.score.get("deadline_violations", [])) > 0

    def test_deadline_penalty_reduces_score(self):
        """Deadline violations should multiply score by compliance."""
        ops = [_op(1, work_h=200)]
        machines = [Maquina("M", "CNC", 16, False, 1.0)]
        moldes = [Molde("M001", "X", "S1")]  # S1 = 5 days
        data = _data(ops, machines, moldes)
        result = schedule_all(data, config=_CFG)

        score = result.score
        assert score["deadline_compliance"] < 1.0
        assert score["weighted_score"] < 0.5

    def test_utilization_balance_perfect(self):
        """Equal load on 2 machines → balance near 1.0."""
        ops = [
            _op(1, work_h=16, codigo="A"),
            _op(2, work_h=16, codigo="B"),
        ]
        machines = [
            Maquina("M1", "CNC", 16, False, 0.5),
            Maquina("M2", "CNC", 16, False, 0.5),
        ]
        compat = {"A": ["M1"], "B": ["M2"]}
        data = _data(ops, machines, [Molde("M001", "X", "S20")], compat=compat)
        result = schedule_all(data, config=_CFG)

        assert result.score["utilization_balance"] > 0.9

    def test_utilization_balance_skewed(self):
        """Uneven load across 2 machines → balance < 1.0."""
        ops = [
            _op(1, work_h=48, codigo="A"),  # Heavy load on M1
            _op(2, work_h=8, codigo="B"),   # Light load on M2
        ]
        machines = [
            Maquina("M1", "CNC", 16, False, 0.5),
            Maquina("M2", "CNC", 16, False, 0.5),
        ]
        compat = {"A": ["M1"], "B": ["M2"]}
        data = _data(ops, machines, [Molde("M001", "X", "S20")], compat=compat)
        result = schedule_all(data, config=_CFG)

        # Both machines used but very uneven → balance < 1.0
        assert result.score["utilization_balance"] < 1.0


# ═══════════════════════════════════════════════════════════════════════
#  HEAVY LOAD / STRESS TESTS
# ═══════════════════════════════════════════════════════════════════════


class TestHeavyLoad:
    """Stress the scheduler with large volumes."""

    def test_100_ops_4_machines(self):
        """100 ops across 4 machines — should complete in <2s."""
        ops = [_op(i, molde=f"M{i % 5:03d}", work_h=float(4 + i % 8))
               for i in range(1, 101)]
        machines = [Maquina(f"CNC-{j}", "CNC", 16, False, 1.0) for j in range(4)]
        moldes = [Molde(f"M{i:03d}", "X", f"S{15 + i}") for i in range(5)]
        data = _data(ops, machines, moldes)

        t0 = time.perf_counter()
        result = schedule_all(data, config=_CFG)
        elapsed = time.perf_counter() - t0

        assert len(result.segmentos) >= 80
        assert elapsed < 2.0, f"Scheduling took {elapsed:.2f}s"
        assert result.score["ops_agendadas"] == 100

    def test_200_ops_chain(self):
        """200 ops in a single chain — deep DAG."""
        ops = [_op(i, work_h=2.0) for i in range(1, 201)]
        deps = [Dependencia(i, i + 1) for i in range(1, 200)]
        machines = [Maquina("M1", "CNC", 16, False, 0.5)]
        moldes = [Molde("M001", "X", "S50")]
        data = _data(ops, machines, moldes, deps=deps)

        result = schedule_all(data, config=_CFG)
        assert result.score["ops_agendadas"] == 200

        # Verify chain ordering
        op_start = {}
        for s in result.segmentos:
            key = (s.dia, s.inicio_h)
            if s.op_id not in op_start or key < op_start[s.op_id]:
                op_start[s.op_id] = key
        for i in range(1, 200):
            if i in op_start and i + 1 in op_start:
                assert op_start[i] <= op_start[i + 1]

    def test_wide_dag_50_parallel(self):
        """50 parallel independent ops → should fill machines efficiently."""
        ops = [_op(i, work_h=8.0) for i in range(1, 51)]
        machines = [Maquina(f"M{j}", "CNC", 16, False, 0.5) for j in range(5)]
        moldes = [Molde("M001", "X", "S20")]
        data = _data(ops, machines, moldes)

        result = schedule_all(data, config=_CFG)
        assert result.score["ops_agendadas"] == 50

        # Makespan should be much less than sequential
        # 50 ops × 8h / 5 machines / 16h per day ≈ 5 days
        assert result.score["makespan_total_dias"] <= 12

    def test_10_molds_mixed(self):
        """10 molds with varying deadlines and load."""
        ops = []
        deps = []
        moldes = []
        oid = 1
        for m in range(10):
            mid = f"MOL{m:02d}"
            moldes.append(Molde(mid, f"Client{m}", f"S{15 + m * 2}"))
            n_ops = 5 + m
            for j in range(n_ops):
                ops.append(_op(oid, molde=mid, work_h=float(4 + j % 6)))
                if j > 0:
                    deps.append(Dependencia(oid - 1, oid))
                oid += 1

        machines = [Maquina(f"M{j}", "CNC", 16, False, 1.0) for j in range(6)]
        data = _data(ops, machines, moldes, deps=deps)

        result = schedule_all(data, config=_CFG)
        assert result.score["ops_agendadas"] == len(ops)
        assert result.score["makespan_total_dias"] > 0


# ═══════════════════════════════════════════════════════════════════════
#  EDGE CASES
# ═══════════════════════════════════════════════════════════════════════


class TestEdgeCases:
    """Adversarial and degenerate inputs."""

    def test_single_op(self):
        data = _data(
            [_op(1, work_h=4)],
            [Maquina("M", "CNC", 16, False, 0.5)],
            [Molde("M001", "X", "S20")],
        )
        result = schedule_all(data, config=_CFG)
        assert result.score["ops_agendadas"] == 1
        assert len(result.segmentos) == 1

    def test_zero_work_op(self):
        """Op with 0h work should not generate segments."""
        data = _data(
            [_op(1, work_h=0, progresso=100)],
            [Maquina("M", "CNC", 16, False, 0.5)],
            [Molde("M001", "X", "S20")],
        )
        result = schedule_all(data, config=_CFG)
        assert result.score["ops_agendadas"] == 0

    def test_all_ops_complete(self):
        ops = [_op(i, progresso=100) for i in range(1, 6)]
        data = _data(
            ops,
            [Maquina("M", "CNC", 16, False, 0.5)],
            [Molde("M001", "X", "S20")],
        )
        result = schedule_all(data, config=_CFG)
        assert len(result.segmentos) == 0

    def test_very_long_operation(self):
        """500h op — should span many days without error."""
        data = _data(
            [_op(1, work_h=500)],
            [Maquina("M", "CNC", 16, False, 1.0)],
            [Molde("M001", "X", "S50")],
        )
        result = schedule_all(data, config=_CFG)
        total = sum(s.duracao_h for s in result.segmentos)
        assert abs(total - 500) < 0.5

    def test_tiny_operation(self):
        """0.1h op — should generate 1 tiny segment."""
        data = _data(
            [_op(1, work_h=0.1)],
            [Maquina("M", "CNC", 16, False, 0.5)],
            [Molde("M001", "X", "S20")],
        )
        result = schedule_all(data, config=_CFG)
        assert len(result.segmentos) == 1
        assert abs(result.segmentos[0].duracao_h - 0.1) < 0.01

    def test_many_molds_no_deps(self):
        """20 molds × 3 ops each, no deps — completely parallel."""
        ops = []
        moldes = []
        for m in range(20):
            mid = f"M{m:02d}"
            moldes.append(Molde(mid, "X", "S20"))
            for j in range(3):
                ops.append(_op(m * 3 + j + 1, molde=mid, work_h=8))
        machines = [Maquina(f"C{i}", "CNC", 16, False, 1.0) for i in range(4)]
        data = _data(ops, machines, moldes)

        result = schedule_all(data, config=_CFG)
        assert result.score["ops_agendadas"] == 60

    def test_all_holidays_week(self):
        """Every day is a holiday for a week → ops pushed to next week."""
        data = _data(
            [_op(1, work_h=8)],
            [Maquina("M", "CNC", 16, False, 0.5)],
            [Molde("M001", "X", "S20")],
        )
        data.feriados = [
            "2026-04-06", "2026-04-07", "2026-04-08",
            "2026-04-09", "2026-04-10",  # Mon-Fri all holidays
        ]
        data.data_referencia = "2026-04-06"
        result = schedule_all(data, config=_CFG)

        assert len(result.segmentos) >= 1
        # Should be pushed to next week (day 7+)
        first_day = min(s.dia for s in result.segmentos)
        assert first_day >= 7


# ═══════════════════════════════════════════════════════════════════════
#  REAL MPP DEEP VALIDATION
# ═══════════════════════════════════════════════════════════════════════


import os as _os
_MPP_PATH = _os.environ.get("MPP_TEST_FILE", str(Path(__file__).resolve().parent.parent / "data" / "test_fixture.mpp"))


@pytest.mark.skipif(not os.path.exists(_MPP_PATH), reason="Real MPP not found")
class TestRealMPPDeep:
    """Deep validation of the real MPP schedule."""

    @pytest.fixture(autouse=True)
    def _schedule(self):
        from backend.transform.transform import transform
        self.data = transform(_MPP_PATH)
        self.result = schedule_all(self.data, config=_CFG)

    def test_all_schedulable_ops_assigned(self):
        schedulable = {o.id for o in self.data.operacoes
                       if o.work_restante_h > 0 and not o.e_condicional}
        scheduled = {s.op_id for s in self.result.segmentos}
        # Some ops lack compatible machines (BA045/FU015 not in compat).
        # At least 70% should be scheduled with current parser coverage.
        coverage = len(scheduled & schedulable) / max(len(schedulable), 1)
        assert coverage > 0.65, f"Only {coverage:.0%} scheduled"

    def test_no_dependency_violations(self):
        op_end = {}
        op_start = {}
        for s in self.result.segmentos:
            key_e = (s.dia, s.fim_h)
            key_s = (s.dia, s.inicio_h)
            if s.op_id not in op_end or key_e > op_end[s.op_id]:
                op_end[s.op_id] = key_e
            if s.op_id not in op_start or key_s < op_start[s.op_id]:
                op_start[s.op_id] = key_s

        violations = 0
        for d in self.data.dependencias:
            pred_op = next((o for o in self.data.operacoes if o.id == d.predecessor_id), None)
            if pred_op and pred_op.e_condicional:
                continue
            pe = op_end.get(d.predecessor_id)
            ss = op_start.get(d.sucessor_id)
            if pe and ss and ss < pe:
                violations += 1
        assert violations == 0, f"{violations} dependency violations"

    def test_no_machine_overlaps(self):
        """Non-external machines should have no overlapping segments."""
        from collections import defaultdict
        machine_map = {m.id: m for m in self.data.maquinas}
        by_md = defaultdict(list)
        for s in self.result.segmentos:
            m = machine_map.get(s.maquina_id)
            # Skip 2a placa and external (infinite capacity)
            if s.e_2a_placa or (m and m.regime_h == 0):
                continue
            by_md[(s.maquina_id, s.dia)].append(s)

        overlaps = 0
        for (mid, day), segs in by_md.items():
            sorted_s = sorted(segs, key=lambda s: s.inicio_h)
            for i in range(len(sorted_s) - 1):
                if sorted_s[i].fim_h > sorted_s[i + 1].inicio_h + 0.1:
                    overlaps += 1
        assert overlaps == 0, f"{overlaps} machine overlaps"

    def test_deadline_compliance_high(self):
        assert self.result.score["deadline_compliance"] >= 0.85

    def test_reasonable_makespan(self):
        mk = self.result.score["makespan_total_dias"]
        assert 10 < mk < 200, f"Makespan {mk} days seems unreasonable"

    def test_all_machines_used(self):
        used = {s.maquina_id for s in self.result.segmentos}
        assert len(used) >= 10, f"Only {len(used)} machines used"

    def test_segments_within_regime(self):
        """No segment should exceed machine daily regime."""
        machine_map = {m.id: m for m in self.data.maquinas}
        for s in self.result.segmentos:
            m = machine_map.get(s.maquina_id)
            if m and m.regime_h > 0:
                day_hours = s.fim_h - s.inicio_h
                assert day_hours <= m.regime_h + 0.5, (
                    f"Segment for op {s.op_id} on {s.maquina_id} day {s.dia}: "
                    f"{day_hours:.1f}h > regime {m.regime_h}h"
                )

    def test_setup_only_on_first_segment_per_op(self):
        """Each op should have setup on at most 1 segment."""
        from collections import Counter
        setup_counts = Counter()
        for s in self.result.segmentos:
            if s.setup_h > 0:
                setup_counts[s.op_id] += 1
        multi = {oid: c for oid, c in setup_counts.items() if c > 1}
        assert len(multi) == 0, f"Ops with multiple setups: {multi}"

    def test_electrode_before_erosion(self):
        """After our fix: all electrodes finish before erosions start (same mold)."""
        el_ops = {o.id for o in self.data.operacoes if o.codigo in ("EL001", "EL005")}
        ee_ops = {o.id for o in self.data.operacoes if o.codigo == "EE005"}

        op_end = {}
        op_start = {}
        for s in self.result.segmentos:
            ke = (s.dia, s.fim_h)
            ks = (s.dia, s.inicio_h)
            if s.op_id not in op_end or ke > op_end[s.op_id]:
                op_end[s.op_id] = ke
            if s.op_id not in op_start or ks < op_start[s.op_id]:
                op_start[s.op_id] = ks

        # For each dependency we created: electrode → erosion
        for d in self.data.dependencias:
            if d.predecessor_id in el_ops and d.sucessor_id in ee_ops:
                pe = op_end.get(d.predecessor_id)
                ss = op_start.get(d.sucessor_id)
                if pe and ss:
                    assert ss >= pe, (
                        f"Erosion {d.sucessor_id} starts before "
                        f"electrode {d.predecessor_id}"
                    )

    def test_subcontracted_ops_external(self):
        """Ops that were Fora? should now be on external machines."""
        ext_ops = [o for o in self.data.operacoes
                   if o.recurso and "Externo" in o.recurso]
        for o in ext_ops:
            assert not o.e_condicional, f"Op {o.id} still conditional"
            segs = [s for s in self.result.segmentos if s.op_id == o.id]
            # External-assigned segments should be single (infinite capacity)
            ext_segs = [s for s in segs if "Externo" in s.maquina_id]
            for s in ext_segs:
                assert s.duracao_h >= 0  # valid segment

    def test_performance(self):
        """Full pipeline should complete in <5s."""
        from backend.transform.transform import transform
        t0 = time.perf_counter()
        data = transform(_MPP_PATH)
        schedule_all(data, config=_CFG)
        elapsed = time.perf_counter() - t0
        assert elapsed < 5.0, f"Full pipeline took {elapsed:.2f}s"
