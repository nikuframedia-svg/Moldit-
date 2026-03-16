"""Tests for PORT-04 (Scheduler Pipeline).

Tests the core scheduling pipeline: demand grouping, slot allocation,
backward scheduling, twin merge, block merge, load leveling, enforce deadlines.
"""

from __future__ import annotations

from src.domain.scheduling.scheduler.backward_scheduler import compute_earliest_starts
from src.domain.scheduling.scheduler.block_merger import merge_consecutive_blocks
from src.domain.scheduling.scheduler.decision_registry import DecisionRegistry
from src.domain.scheduling.scheduler.demand_grouper import group_demand_into_buckets
from src.domain.scheduling.scheduler.enforce_deadlines import enforce_deadlines
from src.domain.scheduling.scheduler.pipeline import schedule_all, schedule_from_engine_data
from src.domain.scheduling.scheduler.repair_violations import repair_schedule_violations
from src.domain.scheduling.scheduler.slot_allocator import schedule_machines
from src.domain.scheduling.transform import transform_plan_state
from src.domain.scheduling.types import (
    Block,
    EMachine,
    EOp,
    ETool,
    MoveAction,
    TwinGroup,
    TwinValidationReport,
)

# ── Helpers ──


def _make_tool(id: str = "BFP001", m: str = "PRM019", pH: int = 500, sH: float = 0.75) -> ETool:
    return ETool(id=id, m=m, pH=pH, sH=sH)


def _make_op(
    id: str = "op1",
    sku: str = "REF001",
    m: str = "PRM019",
    t: str = "BFP001",
    d: list = None,
    atr: int = 0,
) -> EOp:
    return EOp(id=id, sku=sku, m=m, t=t, d=d or [0, 2000, 3000], atr=atr)


def _make_machines() -> list[EMachine]:
    return [EMachine(id="PRM019", area="Grandes"), EMachine(id="PRM031", area="Grandes")]


# ── Backward scheduler tests ──


def test_backward_no_lead_time():
    """Ops without ltDays are not in result."""
    ops = [_make_op()]
    result = compute_earliest_starts(ops, [True] * 5, 5)
    assert len(result) == 0


def test_backward_with_lead_time():
    """Op with ltDays gets earliest start computed."""
    op = EOp(id="op1", sku="REF001", m="PRM019", t="BFP001", d=[0, 0, 0, 0, 1000], lt_days=2)
    result = compute_earliest_starts([op], [True] * 5, 5)
    assert "op1" in result
    entry = result["op1"]
    assert entry.latest_day_idx == 4
    assert entry.earliest_day_idx == 2  # 2 working days before day 4


# ── Demand grouper tests ──


def test_grouper_basic():
    """Basic grouping: single op → single machine → single tool group."""
    ops = [_make_op(d=[0, 2000, 3000])]
    tool_map = {"BFP001": _make_tool()}
    result = group_demand_into_buckets(
        ops,
        {},
        {},
        [],
        tool_map,
        [True] * 3,
        3,
    )
    assert "PRM019" in result
    groups = result["PRM019"]
    assert len(groups) >= 1
    # Total demand should be conserved
    total_qty = sum(sk["total_qty"] for g in groups for sk in g["skus"])
    assert total_qty == 5000


def test_grouper_order_based():
    """Order-based mode: each demand day → separate bucket."""
    ops = [_make_op(d=[1000, 2000, 3000])]
    tool_map = {"BFP001": _make_tool()}
    result = group_demand_into_buckets(
        ops,
        {},
        {},
        [],
        tool_map,
        [True] * 3,
        3,
        order_based=True,
    )
    groups = result["PRM019"]
    total_buckets = sum(len(g["skus"]) for g in groups)
    assert total_buckets == 3  # 3 separate orders


def test_grouper_backlog():
    """Backlog (atr > 0) creates an EDD=0 urgent bucket."""
    ops = [_make_op(d=[0, 2000], atr=500)]
    tool_map = {"BFP001": _make_tool()}
    result = group_demand_into_buckets(
        ops,
        {},
        {},
        [],
        tool_map,
        [True] * 3,
        3,
    )
    groups = result["PRM019"]
    edd0 = [g for g in groups if g["edd"] == 0]
    assert len(edd0) >= 1
    # Total should include atr
    total_qty = sum(sk["total_qty"] for g in groups for sk in g["skus"])
    assert total_qty == 2500


def test_grouper_machine_down():
    """Machine down → blocked buckets."""
    ops = [_make_op(d=[0, 2000])]
    tool_map = {"BFP001": _make_tool()}
    result = group_demand_into_buckets(
        ops,
        {"PRM019": "down"},
        {},
        [],
        tool_map,
        [True] * 3,
        3,
    )
    groups = result["PRM019"]
    for g in groups:
        for sk in g["skus"]:
            assert sk["blocked"] is True


def test_grouper_move_action():
    """Move action routes op to different machine."""
    ops = [_make_op(d=[0, 2000])]
    tool_map = {"BFP001": _make_tool()}
    moves = [MoveAction(op_id="op1", to_m="PRM031")]
    result = group_demand_into_buckets(
        ops,
        {},
        {},
        moves,
        tool_map,
        [True] * 3,
        3,
    )
    assert "PRM031" in result
    assert "PRM019" not in result


def test_grouper_conservation():
    """Demand conservation: bucketed qty == input demand."""
    ops = [
        _make_op(id="op1", d=[1000, 2000, 0, 3000, 500], atr=200),
        _make_op(id="op2", sku="REF002", t="BFP002", d=[0, 0, 4000]),
    ]
    tool_map = {
        "BFP001": _make_tool(),
        "BFP002": _make_tool(id="BFP002"),
    }
    result = group_demand_into_buckets(
        ops,
        {},
        {},
        [],
        tool_map,
        [True] * 5,
        5,
    )
    # op1: 1000+2000+3000+500+200(atr) = 6700
    # op2: 4000
    op1_qty = sum(
        sk["total_qty"]
        for groups in result.values()
        for g in groups
        for sk in g["skus"]
        if sk["op_id"] == "op1"
    )
    op2_qty = sum(
        sk["total_qty"]
        for groups in result.values()
        for g in groups
        for sk in g["skus"]
        if sk["op_id"] == "op2"
    )
    assert op1_qty == 6700
    assert op2_qty == 4000


# ── Slot allocator tests ──


def test_slot_allocator_basic():
    """Basic allocation: single op scheduled successfully."""
    tool = _make_tool(pH=1000)
    op = _make_op(d=[0, 1000])
    tool_map = {"BFP001": tool}
    m_groups = group_demand_into_buckets(
        [op],
        {},
        {},
        [],
        tool_map,
        [True] * 3,
        3,
    )
    registry = DecisionRegistry()
    blocks, infeasibilities = schedule_machines(
        m_groups=m_groups,
        mach_order=[EMachine(id="PRM019", area="Grandes")],
        m_st={},
        workdays=[True] * 3,
        workforce_config=None,
        n_days=3,
        registry=registry,
    )
    ok_blocks = [b for b in blocks if b.type == "ok"]
    assert len(ok_blocks) >= 1
    total_qty = sum(b.qty for b in ok_blocks)
    assert total_qty == 1000


def test_slot_allocator_machine_down():
    """Machine down → all blocked."""
    tool = _make_tool(pH=1000)
    op = _make_op(d=[0, 1000])
    tool_map = {"BFP001": tool}
    m_groups = group_demand_into_buckets(
        [op],
        {"PRM019": "down"},
        {},
        [],
        tool_map,
        [True] * 3,
        3,
    )
    registry = DecisionRegistry()
    blocks, _ = schedule_machines(
        m_groups=m_groups,
        mach_order=[EMachine(id="PRM019", area="Grandes")],
        m_st={"PRM019": "down"},
        workdays=[True] * 3,
        workforce_config=None,
        n_days=3,
        registry=registry,
    )
    assert all(b.type == "blocked" for b in blocks)


# ── Block merger tests ──


def test_block_merger_adjacent():
    """Adjacent ok blocks merged."""
    b1 = Block(
        op_id="op1",
        tool_id="T1",
        machine_id="M1",
        day_idx=0,
        shift="X",
        start_min=420,
        end_min=500,
        type="ok",
        qty=100,
        prod_min=80,
    )
    b2 = Block(
        op_id="op1",
        tool_id="T1",
        machine_id="M1",
        day_idx=0,
        shift="X",
        start_min=500,
        end_min=600,
        type="ok",
        qty=50,
        prod_min=100,
    )
    merged = merge_consecutive_blocks([b1, b2])
    assert len(merged) == 1
    assert merged[0].qty == 150
    assert merged[0].prod_min == 180
    assert merged[0].start_min == 420
    assert merged[0].end_min == 600


def test_block_merger_different_ops():
    """Different ops not merged."""
    b1 = Block(
        op_id="op1",
        tool_id="T1",
        machine_id="M1",
        day_idx=0,
        shift="X",
        start_min=420,
        end_min=500,
        type="ok",
        qty=100,
        prod_min=80,
    )
    b2 = Block(
        op_id="op2",
        tool_id="T1",
        machine_id="M1",
        day_idx=0,
        shift="X",
        start_min=500,
        end_min=600,
        type="ok",
        qty=50,
        prod_min=100,
    )
    merged = merge_consecutive_blocks([b1, b2])
    assert len(merged) == 2


def test_block_merger_gap():
    """Non-adjacent blocks not merged."""
    b1 = Block(
        op_id="op1",
        tool_id="T1",
        machine_id="M1",
        day_idx=0,
        shift="X",
        start_min=420,
        end_min=500,
        type="ok",
        qty=100,
        prod_min=80,
    )
    b2 = Block(
        op_id="op1",
        tool_id="T1",
        machine_id="M1",
        day_idx=0,
        shift="X",
        start_min=510,
        end_min=600,
        type="ok",
        qty=50,
        prod_min=90,
    )
    merged = merge_consecutive_blocks([b1, b2])
    assert len(merged) == 2


# ── Repair violations tests ──


def test_repair_no_violations():
    """No violations → blocks unchanged."""
    b = Block(
        op_id="op1",
        tool_id="T1",
        machine_id="M1",
        day_idx=0,
        shift="X",
        start_min=420,
        end_min=600,
        type="ok",
        qty=100,
        prod_min=180,
    )
    result, setup, cap = repair_schedule_violations([b])
    assert setup == 0
    assert cap == 0
    assert len(result) == 1


# ── Enforce deadlines tests ──


def test_enforce_deadlines_all_met():
    """All demand met → no infeasibilities."""
    ops = [_make_op(d=[0, 1000])]
    blocks = [
        Block(
            op_id="op1",
            tool_id="BFP001",
            machine_id="PRM019",
            day_idx=0,
            type="ok",
            qty=1000,
            prod_min=120,
        )
    ]
    tool_map = {"BFP001": _make_tool()}
    inf, rem = enforce_deadlines(ops, blocks, tool_map, {}, {})
    assert len(inf) == 0


def test_enforce_deadlines_deficit():
    """Partial production → infeasibility with remediation."""
    ops = [_make_op(d=[0, 1000])]
    blocks = [
        Block(
            op_id="op1",
            tool_id="BFP001",
            machine_id="PRM019",
            day_idx=0,
            type="ok",
            qty=500,
            prod_min=60,
        ),
        Block(
            op_id="op1",
            tool_id="BFP001",
            machine_id="PRM019",
            day_idx=1,
            type="overflow",
            qty=0,
            prod_min=60,
        ),
    ]
    tool_map = {"BFP001": _make_tool()}
    inf, rem = enforce_deadlines(ops, blocks, tool_map, {}, {})
    assert len(inf) == 1
    assert inf[0].reason == "CAPACITY_OVERFLOW"
    assert len(rem) >= 1  # At least one remediation


# ── Full pipeline tests ──


def test_pipeline_basic():
    """Full pipeline: 2 ops → blocks with feasibility report."""
    ops = [
        _make_op(id="op1", d=[0, 2000, 3000]),
        _make_op(id="op2", sku="REF002", t="BFP002", d=[0, 0, 1000]),
    ]
    machines = [EMachine(id="PRM019", area="Grandes")]
    tool_map = {
        "BFP001": _make_tool(),
        "BFP002": _make_tool(id="BFP002"),
    }
    result = schedule_all(
        ops=ops,
        m_st={},
        t_st={},
        moves=[],
        machines=machines,
        tool_map=tool_map,
        workdays=[True] * 5,
        n_days=5,
    )
    assert result.feasibility is not None
    assert result.feasibility.total_ops == 2
    assert len(result.blocks) > 0
    ok_blocks = [b for b in result.blocks if b.type == "ok"]
    assert len(ok_blocks) >= 2


def test_pipeline_empty():
    """Empty ops → empty result."""
    result = schedule_all(
        ops=[],
        m_st={},
        t_st={},
        moves=[],
        machines=[],
        tool_map={},
        workdays=[],
        n_days=0,
    )
    assert len(result.blocks) == 0
    assert result.feasibility.feasibility_score == 1.0


def test_pipeline_order_based():
    """Order-based mode: each demand day = separate bucket."""
    ops = [_make_op(d=[1000, 2000, 3000])]
    machines = [EMachine(id="PRM019", area="Grandes")]
    tool_map = {"BFP001": _make_tool()}
    result = schedule_all(
        ops=ops,
        m_st={},
        t_st={},
        moves=[],
        machines=machines,
        tool_map=tool_map,
        workdays=[True] * 5,
        n_days=5,
        order_based=True,
    )
    ok_blocks = [b for b in result.blocks if b.type == "ok"]
    total_qty = sum(b.qty for b in ok_blocks)
    assert total_qty == 6000


def test_pipeline_with_twins():
    """Pipeline with twin co-production."""
    ops = [
        EOp(id="op1", sku="A-LH", m="PRM019", t="BFP001", d=[0, 1000], twin="A-RH"),
        EOp(id="op2", sku="A-RH", m="PRM019", t="BFP001", d=[0, 2000], twin="A-LH"),
    ]
    machines = [EMachine(id="PRM019", area="Grandes")]
    tool_map = {"BFP001": _make_tool()}
    twin_groups = [
        TwinGroup(
            op_id1="op1",
            op_id2="op2",
            sku1="A-LH",
            sku2="A-RH",
            machine="PRM019",
            tool="BFP001",
            pH=500,
            operators=1,
        )
    ]
    tvr = TwinValidationReport(
        total_twin_refs=2,
        valid_groups=1,
        twin_groups=twin_groups,
    )
    result = schedule_all(
        ops=ops,
        m_st={},
        t_st={},
        moves=[],
        machines=machines,
        tool_map=tool_map,
        workdays=[True] * 5,
        n_days=5,
        twin_validation_report=tvr,
        order_based=True,
    )
    # Should have twin co-production blocks
    twin_blocks = [b for b in result.blocks if b.is_twin_production]
    assert len(twin_blocks) >= 1


def test_pipeline_from_engine_data():
    """schedule_from_engine_data convenience wrapper works."""
    plan_state = {
        "operations": [
            {
                "id": "op1",
                "sku": "REF001",
                "m": "PRM019",
                "t": "BFP001",
                "pH": 500,
                "op": 1,
                "d": [None, -2000, -3000],
                "nm": "Peça 1",
            },
        ],
        "dates": ["2026-03-16", "2026-03-17", "2026-03-18"],
        "dnames": ["Seg", "Ter", "Qua"],
    }
    data = transform_plan_state(plan_state)
    result = schedule_from_engine_data(data)
    assert len(result.blocks) > 0
    ok_blocks = [b for b in result.blocks if b.type == "ok"]
    assert len(ok_blocks) >= 1


def test_decision_registry():
    """Registry records decisions."""
    registry = DecisionRegistry()
    registry.record(type="TEST", detail="hello")
    entries = registry.get_all()
    assert len(entries) == 1
    assert entries[0].type == "TEST"
    assert entries[0].detail == "hello"
    registry.clear()
    assert len(registry.get_all()) == 0
