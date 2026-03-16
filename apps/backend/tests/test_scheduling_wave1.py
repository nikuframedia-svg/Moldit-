"""Tests for PORT-01 (Transform), PORT-02 (Constraints), PORT-03 (Dispatch)."""

from __future__ import annotations

from src.domain.scheduling.constraints import (
    CalcoTimeline,
    ConstraintManager,
    OperatorPool,
    SetupCrew,
    ToolTimeline,
)
from src.domain.scheduling.dispatch.atcs import (
    atcs_grid_search,
    atcs_priority,
    compute_atcs_averages,
)
from src.domain.scheduling.dispatch.rules import (
    create_group_comparator,
    merge_consecutive_tools,
    sort_and_merge_groups,
    sort_groups,
)
from src.domain.scheduling.dispatch.ucb1 import UCB1Selector
from src.domain.scheduling.transform import (
    deltaize_cumulative_np,
    extract_stock_from_raw_np,
    raw_np_to_daily_demand,
    raw_np_to_order_demand,
    transform_plan_state,
    validate_twin_references,
)

# ── PORT-01: Transform tests ──


def test_negative_becomes_demand():
    """[-2000, -4000] → demands [2000, 4000], stock=0."""
    result = raw_np_to_order_demand([-2000, -4000])
    assert result == [2000, 4000]


def test_positive_then_negative():
    """[5000, 3000, -2000] → demands [0, 0, 2000]."""
    result = raw_np_to_order_demand([5000, 3000, -2000])
    assert result == [0, 0, 2000]


def test_extract_stock():
    """Stock = last positive before first negative."""
    assert extract_stock_from_raw_np([5000, 3000, -2000]) == 3000
    assert extract_stock_from_raw_np([-2000, -4000]) == 0
    assert extract_stock_from_raw_np([1000, 2000, 3000]) == 3000
    assert extract_stock_from_raw_np([None, None, -500]) == 0


def test_null_values():
    """None/null values produce 0 demand."""
    result = raw_np_to_order_demand([None, -2000, None, -3000])
    assert result == [0, 2000, 0, 3000]


def test_deltaize():
    """Cumulative NP → daily deltas."""
    result = deltaize_cumulative_np([10000, 8000, 5000, 3000])
    assert result == [0, 2000, 3000, 2000]


def test_raw_np_daily():
    result = raw_np_to_daily_demand([-500, 0, -1000, None])
    assert result == [500, 0, 1000, 0]


def test_transform_real_isop():
    """Transform a minimal PlanState → valid EngineData."""
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
            {
                "id": "op2",
                "sku": "REF002",
                "m": "PRM031",
                "t": "BFP002",
                "pH": 300,
                "op": 2,
                "d": [-1000, None, -5000],
                "nm": "Peça 2",
            },
        ],
        "dates": ["2026-03-16", "2026-03-17", "2026-03-18"],
        "dnames": ["Seg", "Ter", "Qua"],
    }
    data = transform_plan_state(plan_state)
    assert data.n_days == 3
    assert len(data.ops) == 2
    assert len(data.machines) == 2
    assert data.order_based is True
    # REF001: d=[None, -2000, -3000] → [0, 2000, 3000]
    assert data.ops[0].d == [0, 2000, 3000]
    # REF002: d=[-1000, None, -5000] → [1000, 0, 5000]
    assert data.ops[1].d == [1000, 0, 5000]


def test_twin_validation_valid():
    """Valid twin pair passes all 7 rules."""
    ops = [
        {
            "id": "op1",
            "sku": "A-LH",
            "twin": "A-RH",
            "m": "PRM019",
            "t": "BFP001",
            "pH": 500,
            "op": 1,
        },
        {
            "id": "op2",
            "sku": "A-RH",
            "twin": "A-LH",
            "m": "PRM019",
            "t": "BFP001",
            "pH": 500,
            "op": 1,
        },
    ]
    report = validate_twin_references(ops)
    assert report.valid_groups == 1
    assert report.invalid_refs == 0


def test_twin_validation_self_reference():
    ops = [{"id": "op1", "sku": "A", "twin": "A", "m": "PRM019", "t": "BFP001", "pH": 500, "op": 1}]
    report = validate_twin_references(ops)
    assert report.invalid_refs == 1
    assert "self_reference" in report.by_code


def test_twin_validation_machine_mismatch():
    ops = [
        {
            "id": "op1",
            "sku": "A-LH",
            "twin": "A-RH",
            "m": "PRM019",
            "t": "BFP001",
            "pH": 500,
            "op": 1,
        },
        {
            "id": "op2",
            "sku": "A-RH",
            "twin": "A-LH",
            "m": "PRM031",
            "t": "BFP001",
            "pH": 500,
            "op": 1,
        },
    ]
    report = validate_twin_references(ops)
    assert report.invalid_refs >= 1


# ── PORT-02: Constraints tests ──


def test_setup_crew_serializes():
    """2 setups simultâneos → segundo adiado."""
    sc = SetupCrew()
    sc.book(100, 130, "PRM019")
    result = sc.check(110, 20, 500, "PRM031")
    assert result.has_conflict
    assert result.available_at == 130


def test_setup_crew_no_conflict():
    sc = SetupCrew()
    sc.book(100, 130, "PRM019")
    result = sc.check(130, 20, 500, "PRM031")
    assert not result.has_conflict


def test_tool_one_machine():
    """BFP079 em PRM031 bloqueia BFP079 em PRM039."""
    tt = ToolTimeline()
    tt.book("BFP079", 100, 200, "PRM031")
    assert not tt.is_available("BFP079", 150, 250, "PRM039")
    assert tt.is_available("BFP079", 150, 250, "PRM031")  # same machine OK


def test_tool_find_next():
    tt = ToolTimeline()
    tt.book("BFP079", 100, 200, "PRM031")
    result = tt.find_next_available("BFP079", 100, 50, 500, "PRM039")
    assert result == 200


def test_calco_no_same_machine_exception():
    """Calco is more restrictive — even same machine conflicts."""
    ct = CalcoTimeline()
    ct.book("C001", 100, 200, "PRM019")
    assert not ct.is_available("C001", 150, 250)
    # Note: calco doesn't have same-machine exception like tool


def test_calco_null_code():
    ct = CalcoTimeline()
    assert ct.is_available(None, 100, 200)
    assert ct.is_available("", 100, 200)


def test_operator_advisory():
    """Exceder operadores → warning, não bloqueio."""
    op = OperatorPool()
    result = op.check_capacity(0, 420, 930, 10, "PRM019")
    assert result.is_warning  # 10 > 6 for Grandes shift X
    # Still returns has_capacity=False but it's advisory


def test_constraint_manager_disabled():
    """Disabled constraints always pass."""
    from src.domain.scheduling.config import ConstraintEntry, ConstraintsConfig, SchedulingConfig

    cfg = SchedulingConfig(
        constraints=ConstraintsConfig(
            setup_crew=ConstraintEntry(mode="disabled"),
        )
    )
    cm = ConstraintManager(config=cfg)
    result = cm.check_setup(100, 30, 500, "PRM019")
    assert result.proceed
    assert not result.was_delayed


def test_constraint_manager_reset():
    cm = ConstraintManager()
    cm.book_setup(100, 130, "PRM019")
    cm.reset()
    result = cm.check_setup(110, 20, 500, "PRM031")
    assert result.proceed
    assert not result.was_delayed


# ── PORT-03: Dispatch tests ──


def test_edd_sorts():
    """EDD: deadline crescente."""
    groups = [
        {"toolId": "T1", "edd": 10, "prodMin": 60},
        {"toolId": "T2", "edd": 5, "prodMin": 120},
        {"toolId": "T3", "edd": 15, "prodMin": 30},
    ]
    cmp = create_group_comparator("EDD")
    sorted_g = sort_groups(groups, cmp)
    assert [g["edd"] for g in sorted_g] == [5, 10, 15]


def test_spt_sorts():
    groups = [
        {"toolId": "T1", "edd": 10, "prodMin": 120},
        {"toolId": "T2", "edd": 5, "prodMin": 30},
        {"toolId": "T3", "edd": 15, "prodMin": 60},
    ]
    cmp = create_group_comparator("SPT")
    sorted_g = sort_groups(groups, cmp)
    assert [g["prodMin"] for g in sorted_g] == [30, 60, 120]


def test_atcs_urgency():
    """Deadline amanhã > deadline em 2 semanas."""
    p_urgent = atcs_priority(60, 10, 45, 1.0, 0.5, 60, 45)
    p_relaxed = atcs_priority(60, 14 * 1020, 45, 1.0, 0.5, 60, 45)
    assert p_urgent > p_relaxed


def test_atcs_averages():
    groups = [
        {"prodMin": 100, "setupMin": 30},
        {"prodMin": 200, "setupMin": 60},
    ]
    avgs = compute_atcs_averages(groups)
    assert avgs.avg_prod_min == 150
    assert avgs.avg_setup_min == 45


def test_atcs_grid_search():
    groups = [
        {"prodMin": 60, "slack": 100, "setupMin": 45, "weight": 1.0},
        {"prodMin": 120, "slack": 50, "setupMin": 30, "weight": 2.0},
    ]
    result = atcs_grid_search(groups)
    assert result.best_params.k1 > 0
    assert result.best_params.k2 > 0
    assert len(result.results) == 25  # 5×5 grid


def test_ucb1_explores_all():
    """Primeiras 5 iterações: 1 de cada regra."""
    ucb = UCB1Selector()
    seen = set()
    for _ in range(5):
        rule = ucb.select()
        seen.add(rule)
        ucb.update(rule, 0.5)
    assert len(seen) == 5


def test_ucb1_exploits_best():
    """After many updates, best arm has highest average reward."""
    ucb = UCB1Selector()
    # Round-robin phase
    for r in ["ATCS", "EDD", "CR", "SPT", "WSPT"]:
        ucb.update(r, 0.1)
    # Give ATCS a much higher reward
    for _ in range(50):
        ucb.update("ATCS", 1.0)
    # ATCS should have the highest average reward
    stats = ucb.get_stats()
    atcs_stats = next(s for s in stats if s.rule == "ATCS")
    other_stats = [s for s in stats if s.rule != "ATCS"]
    assert atcs_stats.avg_reward > max(s.avg_reward for s in other_stats)


def test_merge_consecutive_tools():
    groups = [
        {"toolId": "T1", "machineId": "M1", "edd": 5, "qty": 100, "prodMin": 60},
        {"toolId": "T1", "machineId": "M1", "edd": 7, "qty": 200, "prodMin": 120},
        {"toolId": "T2", "machineId": "M1", "edd": 10, "qty": 50, "prodMin": 30},
    ]
    merged = merge_consecutive_tools(groups, max_edd_gap=5)
    assert len(merged) == 2  # T1 groups merged
    assert merged[0]["qty"] == 300
    assert merged[0]["edd"] == 5


def test_sort_and_merge_full():
    groups = [
        {"toolId": "T2", "machineId": "M1", "edd": 10, "prodMin": 30, "setupMin": 15, "qty": 50},
        {"toolId": "T1", "machineId": "M1", "edd": 3, "prodMin": 60, "setupMin": 30, "qty": 100},
        {"toolId": "T1", "machineId": "M1", "edd": 5, "prodMin": 120, "setupMin": 30, "qty": 200},
    ]
    result = sort_and_merge_groups(groups, rule="EDD")
    # T1 edd=3 and T1 edd=5 should be merged (gap=2, < 5)
    assert len(result) == 2
