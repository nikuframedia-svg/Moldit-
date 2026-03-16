"""Tests for PORT-05 (Overflow + Auto-Routing)."""

from __future__ import annotations

from src.domain.scheduling.overflow.overflow_helpers import (
    cap_analysis,
    compute_advanced_edd,
    compute_tardiness,
    sum_overflow,
)
from src.domain.scheduling.overflow.tier2_tardiness import run_tier2
from src.domain.scheduling.overflow.tier3_otd_delivery import run_tier3
from src.domain.scheduling.overflow.tier_types import TierContext, TierState
from src.domain.scheduling.scheduler.otd_delivery import compute_otd_delivery_failures
from src.domain.scheduling.types import (
    Block,
    EMachine,
    EOp,
    ETool,
    ScheduleResult,
)

# ── Overflow helpers tests ──


def test_sum_overflow_empty():
    assert sum_overflow([]) == 0


def test_sum_overflow_with_overflow_blocks():
    blocks = [
        Block(
            op_id="op1",
            tool_id="T1",
            machine_id="M1",
            overflow=True,
            overflow_min=60,
            type="overflow",
        ),
        Block(
            op_id="op2",
            tool_id="T2",
            machine_id="M1",
            overflow=True,
            overflow_min=30,
            type="overflow",
        ),
        Block(op_id="op3", tool_id="T3", machine_id="M1", type="ok", prod_min=100),
    ]
    assert sum_overflow(blocks) == 90


def test_sum_overflow_infeasible():
    blocks = [
        Block(op_id="op1", tool_id="T1", machine_id="M1", type="infeasible", prod_min=120),
    ]
    assert sum_overflow(blocks) == 120


def test_compute_tardiness_none():
    blocks = [
        Block(
            op_id="op1", tool_id="T1", machine_id="M1", type="ok", day_idx=3, edd_day=5, prod_min=60
        ),
    ]
    assert compute_tardiness(blocks) == 0


def test_compute_tardiness_late():
    blocks = [
        Block(
            op_id="op1", tool_id="T1", machine_id="M1", type="ok", day_idx=7, edd_day=5, prod_min=60
        ),
        Block(
            op_id="op2",
            tool_id="T2",
            machine_id="M1",
            type="ok",
            day_idx=3,
            edd_day=5,
            prod_min=100,
        ),
    ]
    assert compute_tardiness(blocks) == 60  # only op1 is late


def test_cap_analysis_basic():
    blocks = [
        Block(
            op_id="op1",
            tool_id="T1",
            machine_id="M1",
            day_idx=0,
            prod_min=100,
            setup_min=30,
            type="ok",
        ),
        Block(
            op_id="op2",
            tool_id="T2",
            machine_id="M1",
            day_idx=1,
            prod_min=200,
            setup_min=0,
            type="ok",
        ),
    ]
    machines = [EMachine(id="M1", area="A")]
    result = cap_analysis(blocks, machines)
    assert result["M1"][0]["prod"] == 100
    assert result["M1"][0]["setup"] == 30
    assert result["M1"][1]["prod"] == 200


def test_compute_advanced_edd_basic():
    workdays = [True, True, True, True, True, False, False, True, True, True]
    # from day 9, go back 3 working days
    result = compute_advanced_edd(9, 3, workdays)
    assert result == 4  # day 8(T,1), 7(T,2), 6(F), 5(F), 4(T,3)


def test_compute_advanced_edd_all_workdays():
    workdays = [True] * 10
    result = compute_advanced_edd(5, 3, workdays)
    assert result == 2


def test_compute_advanced_edd_not_enough():
    workdays = [True, True]
    result = compute_advanced_edd(1, 5, workdays)
    assert result == -1  # not enough working days


# ── OTD delivery failure tests ──


def test_otd_no_failures():
    """Production meets demand at every point."""
    ops = [EOp(id="op1", t="T1", m="M1", sku="SKU1", d=[0, 100, 0, 200])]
    blocks = [
        Block(
            op_id="op1", tool_id="T1", machine_id="M1", day_idx=0, qty=150, type="ok", prod_min=60
        ),
        Block(
            op_id="op1", tool_id="T1", machine_id="M1", day_idx=2, qty=200, type="ok", prod_min=60
        ),
    ]
    count, failures = compute_otd_delivery_failures(blocks, ops)
    assert count == 0


def test_otd_with_failure():
    """Production insufficient at day 1."""
    ops = [EOp(id="op1", t="T1", m="M1", sku="SKU1", d=[0, 100, 0, 200])]
    blocks = [
        Block(
            op_id="op1", tool_id="T1", machine_id="M1", day_idx=2, qty=300, type="ok", prod_min=60
        ),
    ]
    count, failures = compute_otd_delivery_failures(blocks, ops)
    assert count >= 1
    assert any(f.op_id == "op1" and f.day == 1 for f in failures)


# ── Tier State / Context integration ──


def _make_simple_schedule_fn(ops, machines, tool_map, workdays, n_days):
    """Create a simple schedule function for testing tier logic."""
    from src.domain.scheduling.scheduler.pipeline import schedule_all

    def run_sched(moves, advances=None):
        return schedule_all(
            ops=ops,
            m_st={},
            t_st={},
            moves=moves,
            machines=machines,
            tool_map=tool_map,
            workdays=workdays,
            n_days=n_days,
            rule="EDD",
            enable_leveling=False,
            enforce_deadlines_enabled=False,
            advance_overrides=advances,
        )

    return run_sched


def test_tier_state_creation():
    """TierState can be created and fields accessed."""
    result = ScheduleResult(blocks=[], decisions=[])
    state = TierState(blocks=[], sched_result=result)
    assert state.auto_moves == []
    assert state.auto_advances == []


def test_tier_context_creation():
    """TierContext can be created with required fields."""
    ctx = TierContext(
        ops=[],
        user_moves=[],
        m_st={},
        workdays=[True] * 5,
        twin_partner_map={},
    )
    assert ctx.third_shift is False


def test_tier2_no_tardy():
    """Tier 2 is a no-op when there's no tardiness."""
    ops = [EOp(id="op1", t="T1", m="M1", sku="SKU1", d=[100])]
    machines = [EMachine(id="M1", area="A")]
    tool_map = {"T1": ETool(id="T1", m="M1")}
    workdays = [True]

    run_sched = _make_simple_schedule_fn(ops, machines, tool_map, workdays, 1)
    result = run_sched([])

    state = TierState(blocks=result.blocks, sched_result=result)
    ctx = TierContext(
        ops=ops,
        user_moves=[],
        m_st={},
        workdays=workdays,
        twin_partner_map={},
        run_schedule=run_sched,
    )
    pre_tardy: set[str] = set()
    run_tier2(state, ctx, pre_tardy)
    # Should be no changes since there's no tardiness
    assert compute_tardiness(state.blocks) == 0


def test_tier3_no_otd_failures():
    """Tier 3 is a no-op when OTD is already 100%."""
    ops = [EOp(id="op1", t="T1", m="M1", sku="SKU1", d=[100])]
    machines = [EMachine(id="M1", area="A")]
    tool_map = {"T1": ETool(id="T1", m="M1")}
    workdays = [True]

    run_sched = _make_simple_schedule_fn(ops, machines, tool_map, workdays, 1)
    result = run_sched([])

    state = TierState(blocks=result.blocks, sched_result=result)
    ctx = TierContext(
        ops=ops,
        user_moves=[],
        m_st={},
        workdays=workdays,
        twin_partner_map={},
        run_schedule=run_sched,
    )
    run_tier3(state, ctx, tool_map)
    count, _ = compute_otd_delivery_failures(state.blocks, ops)
    assert count == 0


def test_overflow_helpers_combined():
    """Test all helper functions work together."""
    workdays = [True, True, True, True, True]
    blocks = [
        Block(
            op_id="op1",
            tool_id="T1",
            machine_id="M1",
            day_idx=0,
            type="ok",
            prod_min=100,
            setup_min=30,
            qty=50,
            edd_day=2,
        ),
        Block(
            op_id="op2",
            tool_id="T2",
            machine_id="M1",
            day_idx=4,
            type="ok",
            prod_min=60,
            setup_min=15,
            qty=30,
            edd_day=1,
        ),
        Block(
            op_id="op3",
            tool_id="T3",
            machine_id="M2",
            day_idx=2,
            type="overflow",
            overflow=True,
            overflow_min=45,
            prod_min=45,
        ),
    ]
    machines = [EMachine(id="M1", area="A"), EMachine(id="M2", area="B")]

    assert sum_overflow(blocks) == 45
    assert compute_tardiness(blocks) == 60  # op2 late: day_idx=4 > edd_day=1

    cap = cap_analysis(blocks, machines)
    assert cap["M1"][0]["prod"] == 100
    assert cap["M1"][4]["prod"] == 60
    assert cap["M2"][2]["prod"] == 45

    assert compute_advanced_edd(4, 2, workdays) == 2
