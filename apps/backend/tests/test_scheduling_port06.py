"""Tests for PORT-06: MRP + Analysis + Replan modules."""

from __future__ import annotations

from src.domain.scheduling.constants import S0, S1
from src.domain.scheduling.types import Block, EMachine, EngineData, EOp, ETool

# ── Helpers ─────────────────────────────────────────────────────────────────


def mk_tool(tid="T1", m="M1", pH=100, sH=0.75):
    return ETool(id=tid, m=m, pH=pH, sH=sH, nm=tid)


def mk_machine(mid="M1", area="G"):
    return EMachine(id=mid, area=area)


def mk_op(oid="op1", sku="SKU-A", t="T1", m="M1", d=None, atr=0, stk=None, twin=None):
    """Create EOp. d values should be post-transform (positive = demand)."""
    return EOp(id=oid, sku=sku, t=t, m=m, d=d or [], atr=atr, stk=stk, twin=twin)


def mk_block(
    op_id="op1",
    machine_id="M1",
    tool_id="T1",
    day_idx=0,
    start_min=S0,
    end_min=None,
    shift="X",
    prod_min=120,
    sku="SKU-A",
    qty=0,
    type="ok",
    freeze_status=None,
    setup_s=None,
    setup_e=None,
):
    if end_min is None:
        end_min = start_min + prod_min
    return Block(
        op_id=op_id,
        tool_id=tool_id,
        sku=sku,
        machine_id=machine_id,
        day_idx=day_idx,
        start_min=start_min,
        end_min=end_min,
        shift=shift,
        type=type,
        prod_min=prod_min,
        qty=qty,
        freeze_status=freeze_status,
        setup_s=setup_s,
        setup_e=setup_e,
    )


def mk_engine(ops, tools, machines, n_days, dates=None, dnames=None):
    """Create EngineData with auto tool_map."""
    if dates is None:
        dates = [f"2026-03-{i + 1:02d}" for i in range(n_days)]
    if dnames is None:
        dnames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][:n_days]
        if n_days > 7:
            dnames = [f"D{i}" for i in range(n_days)]
    tool_map = {t.id: t for t in tools}
    return EngineData(
        ops=ops,
        tools=tools,
        machines=machines,
        n_days=n_days,
        dates=dates,
        dnames=dnames,
        tool_map=tool_map,
    )


# ── MRP Engine ──────────────────────────────────────────────────────────────


class TestMRPEngine:
    def test_compute_tool_mrp_basic(self):
        from src.domain.scheduling.mrp.mrp_engine import compute_tool_mrp

        # d values are post-transform: positive = demand
        ops = [mk_op("op1", "SKU-A", "T1", "M1", d=[0, 500, 0, 300], stk=200)]
        tool = mk_tool("T1", "M1", pH=100)

        rec = compute_tool_mrp(
            tool,
            ops,
            num_days=4,
            dates=["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"],
            dnames=["Mon", "Tue", "Wed", "Thu"],
        )

        assert rec.tool_code == "T1"
        assert len(rec.buckets) == 4
        assert rec.buckets[1].gross_requirement == 500

    def test_compute_tool_mrp_no_demand(self):
        from src.domain.scheduling.mrp.mrp_engine import compute_tool_mrp

        ops = [mk_op("op1", "SKU-A", "T1", "M1", d=[0, 0, 0], stk=500)]
        tool = mk_tool("T1", "M1")

        rec = compute_tool_mrp(
            tool,
            ops,
            num_days=3,
            dates=["2026-03-01", "2026-03-02", "2026-03-03"],
            dnames=["Mon", "Tue", "Wed"],
        )

        for b in rec.buckets:
            assert b.gross_requirement == 0
            assert b.net_requirement == 0

    def test_compute_mrp_full(self):
        from src.domain.scheduling.mrp.mrp_engine import compute_mrp

        engine = mk_engine(
            ops=[mk_op("op1", "SKU-A", "T1", "M1", d=[0, 500, 0], stk=200)],
            tools=[mk_tool("T1", "M1")],
            machines=[mk_machine("M1")],
            n_days=3,
        )

        result = compute_mrp(engine)

        assert len(result.records) == 1
        assert result.records[0].tool_code == "T1"
        assert result.summary is not None
        assert result.summary.total_gross_req > 0


# ── CTP ─────────────────────────────────────────────────────────────────────


class TestCTP:
    def test_compute_ctp_basic(self):
        from src.domain.scheduling.mrp.ctp import CTPInput, compute_ctp
        from src.domain.scheduling.mrp.mrp_engine import compute_mrp

        engine = mk_engine(
            ops=[mk_op("op1", "SKU-A", "T1", "M1", d=[0, 500])],
            tools=[mk_tool("T1", "M1", pH=100)],
            machines=[mk_machine("M1")],
            n_days=2,
        )

        mrp = compute_mrp(engine)
        inp = CTPInput(tool_code="T1", quantity=500, target_day=1)
        result = compute_ctp(inp, mrp, engine)

        assert result.tool_code == "T1"
        assert result.earliest_feasible_day >= 0
        assert result.confidence in ("high", "medium", "low")

    def test_compute_ctp_not_found(self):
        from src.domain.scheduling.mrp.ctp import CTPInput, compute_ctp
        from src.domain.scheduling.mrp.mrp_engine import compute_mrp

        engine = mk_engine(
            ops=[mk_op("op1", "SKU-A", "T1", "M1", d=[0, 500])],
            tools=[mk_tool("T1", "M1")],
            machines=[mk_machine("M1")],
            n_days=2,
        )

        mrp = compute_mrp(engine)
        inp = CTPInput(tool_code="NONEXISTENT", quantity=500, target_day=1)
        result = compute_ctp(inp, mrp, engine)

        assert result.earliest_feasible_day is None
        assert result.confidence == "low"
        assert result.feasible is False


# ── Supply Priority ─────────────────────────────────────────────────────────


class TestSupplyPriority:
    def test_compute_supply_priority_basic(self):
        from src.domain.scheduling.mrp.mrp_engine import compute_mrp
        from src.domain.scheduling.mrp.supply_priority import compute_supply_priority

        engine = mk_engine(
            ops=[mk_op("op1", "SKU-A", "T1", "M1", d=[0, 500, 500, 500])],
            tools=[mk_tool("T1", "M1")],
            machines=[mk_machine("M1")],
            n_days=4,
        )

        mrp = compute_mrp(engine)
        priorities = compute_supply_priority(engine, mrp)

        # Keyed by op_id
        assert "op1" in priorities
        sp = priorities["op1"]
        assert sp.boost in (0, 1, 2, 3)
        assert sp.tool_code == "T1"

    def test_compute_supply_priority_empty(self):
        from src.domain.scheduling.mrp.mrp_engine import compute_mrp
        from src.domain.scheduling.mrp.supply_priority import compute_supply_priority

        engine = mk_engine(ops=[], tools=[], machines=[], n_days=2)

        mrp = compute_mrp(engine)
        priorities = compute_supply_priority(engine, mrp)

        assert priorities == {}


# ── Score Schedule ──────────────────────────────────────────────────────────


class TestScoreSchedule:
    def test_score_empty_schedule(self):
        from src.domain.scheduling.analysis.score_schedule import score_schedule

        result = score_schedule(blocks=[], ops=[], machines=[mk_machine("M1")])

        assert result.score == 0.0
        assert result.setup_count == 0

    def test_score_with_blocks(self):
        from src.domain.scheduling.analysis.score_schedule import score_schedule

        blocks = [
            mk_block("op1", "M1", "T1", 0, S0, S0 + 120, prod_min=120, sku="SKU-A"),
            mk_block(
                "op2",
                "M1",
                "T2",
                0,
                S0 + 150,
                S0 + 300,
                prod_min=150,
                sku="SKU-B",
                setup_s=S0 + 120,
                setup_e=S0 + 150,
            ),
        ]
        ops = [
            mk_op("op1", "SKU-A", "T1", "M1", d=[500]),
            mk_op("op2", "SKU-B", "T2", "M1", d=[500]),
        ]

        result = score_schedule(blocks, ops, [mk_machine("M1")])

        assert isinstance(result.score, float)
        assert result.setup_count == 1


# ── Validate Schedule ───────────────────────────────────────────────────────


class TestValidateSchedule:
    def test_validate_empty_schedule(self):
        from src.domain.scheduling.analysis.validate_schedule import validate_schedule

        report = validate_schedule(
            blocks=[],
            machines=[mk_machine("M1")],
            tool_map={"T1": mk_tool("T1", "M1")},
            ops=[],
        )

        assert report.valid is True
        assert len(report.violations) == 0

    def test_validate_tool_conflict(self):
        from src.domain.scheduling.analysis.validate_schedule import validate_schedule

        blocks = [
            mk_block("op1", "M1", "T1", 0, S0, S0 + 120, prod_min=120),
            mk_block("op2", "M2", "T1", 0, S0 + 60, S0 + 180, prod_min=120),
        ]
        ops = [
            mk_op("op1", "SKU-A", "T1", "M1", d=[500]),
            mk_op("op2", "SKU-A", "T1", "M2", d=[500]),
        ]

        report = validate_schedule(
            blocks=blocks,
            machines=[mk_machine("M1"), mk_machine("M2")],
            tool_map={"T1": mk_tool("T1", "M1")},
            ops=ops,
        )

        assert report.valid is False
        tool_violations = [v for v in report.violations if v.type == "TOOL_UNIQUENESS"]
        assert len(tool_violations) > 0


# ── Coverage Audit ──────────────────────────────────────────────────────────


class TestCoverageAudit:
    def test_audit_empty(self):
        from src.domain.scheduling.analysis.coverage_audit import audit_coverage

        result = audit_coverage(blocks=[], ops=[], tool_map={})

        assert result.global_coverage_pct == 100.0
        assert len(result.rows) == 0

    def test_audit_full_coverage(self):
        from src.domain.scheduling.analysis.coverage_audit import audit_coverage

        blocks = [mk_block("op1", "M1", "T1", 0, S0, prod_min=300, qty=500)]
        ops = [mk_op("op1", "SKU-A", "T1", "M1", d=[500])]
        tool_map = {"T1": mk_tool("T1", "M1")}

        result = audit_coverage(blocks, ops, tool_map)

        assert result.global_coverage_pct >= 100.0

    def test_audit_partial_coverage(self):
        from src.domain.scheduling.analysis.coverage_audit import audit_coverage

        blocks = [mk_block("op1", "M1", "T1", 0, S0, prod_min=100, qty=150)]
        ops = [mk_op("op1", "SKU-A", "T1", "M1", d=[500])]
        tool_map = {"T1": mk_tool("T1", "M1")}

        result = audit_coverage(blocks, ops, tool_map)

        assert result.global_coverage_pct < 100.0


# ── Transparency Report ────────────────────────────────────────────────────


class TestTransparencyReport:
    def test_transparency_empty(self):
        from src.domain.scheduling.analysis.transparency_report import build_transparency_report

        report = build_transparency_report(blocks=[], ops=[], tool_map={})

        assert len(report.order_justifications) == 0
        assert len(report.failure_justifications) == 0

    def test_transparency_with_blocks(self):
        from src.domain.scheduling.analysis.transparency_report import build_transparency_report

        blocks = [mk_block("op1", "M1", "T1", 0, S0, prod_min=300, qty=500)]
        ops = [mk_op("op1", "SKU-A", "T1", "M1", d=[500])]
        tool_map = {"T1": mk_tool("T1", "M1")}

        report = build_transparency_report(blocks, ops, tool_map)

        assert len(report.order_justifications) == 1
        assert report.order_justifications[0].op_id == "op1"


# ── Replan: Right-Shift ────────────────────────────────────────────────────


class TestRightShift:
    def test_right_shift_basic(self):
        from src.domain.scheduling.replan.right_shift import RightShiftInput, replan_right_shift

        blocks = [
            mk_block("op1", "M1", "T1", 0, S0, prod_min=120),
            mk_block("op2", "M1", "T2", 0, S0 + 150, prod_min=150, sku="SKU-B"),
        ]

        inp = RightShiftInput(perturbed_op_id="op1", delay_min=20, machine_id="M1")
        result = replan_right_shift(blocks, inp)

        assert len(result.blocks) == 2
        assert "op1" in result.affected_ops
        assert "op2" in result.affected_ops
        assert result.total_propagated_delay == 20
        shifted = {b.op_id: b for b in result.blocks}
        assert shifted["op1"].start_min == S0 + 20
        assert shifted["op2"].start_min == S0 + 170

    def test_right_shift_no_delay(self):
        from src.domain.scheduling.replan.right_shift import RightShiftInput, replan_right_shift

        blocks = [mk_block("op1", "M1", "T1", 0, S0, prod_min=120)]

        inp = RightShiftInput(perturbed_op_id="op1", delay_min=0, machine_id="M1")
        result = replan_right_shift(blocks, inp)

        assert result.affected_ops == []
        assert result.total_propagated_delay == 0

    def test_right_shift_overflow(self):
        from src.domain.scheduling.replan.right_shift import RightShiftInput, replan_right_shift

        blocks = [mk_block("op1", "M1", "T1", 0, S1 - 60, S1, prod_min=60)]

        inp = RightShiftInput(perturbed_op_id="op1", delay_min=30, machine_id="M1")
        result = replan_right_shift(blocks, inp)

        assert result.has_overflow is True
        assert result.blocks[0].end_min == S1 + 30


# ── Replan: Match-Up ───────────────────────────────────────────────────────


class TestMatchUp:
    def test_find_match_up_point(self):
        from src.domain.scheduling.replan.match_up import find_match_up_point

        blocks = [
            mk_block("op1", "M1", "T1", day_idx=0),
            mk_block("op2", "M1", "T2", day_idx=2, sku="SKU-B"),
        ]

        point = find_match_up_point(blocks, "M1", perturbation_day=0, n_days=5)
        assert point == 3

    def test_match_up_replan(self):
        from src.domain.scheduling.replan.match_up import MatchUpInput, replan_match_up

        blocks = [
            mk_block("op1", "M1", "T1", day_idx=0, freeze_status="liquid"),
            mk_block("op2", "M1", "T2", day_idx=1, sku="SKU-B", freeze_status="liquid"),
        ]

        inp = MatchUpInput(
            perturbed_op_id="op1",
            delay_min=30,
            machine_id="M1",
            original_blocks=blocks,
        )

        result = replan_match_up(blocks, inp)

        assert result.match_up_day >= 0
        assert len(result.rescheduled_ops) > 0


# ── Replan: Partial ─────────────────────────────────────────────────────────


class TestPartialReplan:
    def test_propagate_impact_machine(self):
        from src.domain.scheduling.replan.partial_replan import propagate_impact

        ops = [
            mk_op("op1", "SKU-A", "T1", "M1", d=[500]),
            mk_op("op2", "SKU-B", "T2", "M1", d=[500]),
            mk_op("op3", "SKU-C", "T3", "M2", d=[500]),
        ]
        blocks = [mk_block("op1", "M1", "T1")]

        affected = propagate_impact(["op1"], ops, {}, blocks, machine_id="M1")

        assert "op1" in affected
        assert "op2" in affected
        assert "op3" not in affected

    def test_partial_replan_annotates_freeze(self):
        from src.domain.scheduling.replan.partial_replan import PartialReplanInput, replan_partial

        blocks = [
            mk_block("op1", "M1", "T1"),
            mk_block("op2", "M2", "T2", sku="SKU-B"),
        ]
        ops = [
            mk_op("op1", "SKU-A", "T1", "M1", d=[500]),
            mk_op("op2", "SKU-B", "T2", "M2", d=[500]),
        ]

        inp = PartialReplanInput(
            event_type="breakdown",
            machine_id="M1",
            affected_op_ids=["op1"],
        )

        result = replan_partial(blocks, inp, ops, tool_map={})

        assert "op1" in result.rescheduled_ops
        freeze_map = {b.op_id: b.freeze_status for b in result.blocks}
        assert freeze_map["op1"] == "liquid"
        assert freeze_map["op2"] == "frozen"


# ── Replan: Full ────────────────────────────────────────────────────────────


class TestFullReplan:
    def test_assign_freeze_zones(self):
        from src.domain.scheduling.replan.full_replan import assign_freeze_zones

        blocks = [mk_block(f"op{i}", "M1", "T1", day_idx=i) for i in range(20)]

        result = assign_freeze_zones(blocks, frozen_day_limit=5)

        for b in result:
            if b.day_idx < 5:
                assert b.freeze_status == "frozen"
            elif b.day_idx < 15:
                assert b.freeze_status == "slushy"
            else:
                assert b.freeze_status == "liquid"

    def test_full_replan_no_schedule_fn(self):
        from src.domain.scheduling.replan.full_replan import FullReplanInput, replan_full

        inp = FullReplanInput(frozen_day_limit=5)
        result = replan_full(inp)

        assert result.blocks == []
        assert result.frozen_count == 0
        assert result.emergency_night_shift is False
