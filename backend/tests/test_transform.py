"""Tests for the transform layer — ISOP → Solver → Gantt pipeline."""

from datetime import date

from src.engine.transform import isop_to_solver_input, run_pipeline
from src.parser.isop import parse_isop


def test_isop_to_solver_input(isop_path):
    """Parser output converts to valid SolverInput."""
    isop = parse_isop(isop_path)
    solver_input = isop_to_solver_input(isop)

    assert len(solver_input.orders) > 0
    assert len(solver_input.machines) > 0
    assert solver_input.horizon_days > 0

    # Every order should have required fields
    for order in solver_input.orders:
        assert "sku" in order
        assert "qty" in order
        assert order["qty"] > 0
        assert "deadline_min" in order
        assert order["deadline_min"] > 0
        assert "tool" in order
        assert "machine" in order
        assert "pieces_per_hour" in order


def test_solver_input_has_twin_pairs(isop_path):
    """Twin pairs from parser should propagate to solver input."""
    isop = parse_isop(isop_path)
    solver_input = isop_to_solver_input(isop)

    # Twin pairs should be present (auto-detected from shared tool)
    assert len(solver_input.twin_pairs) > 0


def test_solver_input_has_machines(isop_path):
    """All machines from ISOP should be in solver input."""
    isop = parse_isop(isop_path)
    solver_input = isop_to_solver_input(isop)

    machine_ids = {m.id for m in solver_input.machines}
    for m in isop.machines:
        assert m in machine_ids


def test_full_pipeline_small():
    """Full pipeline with synthetic small data (no ISOP file needed)."""
    from src.engine.models import SKU, ISOPData, Order

    today = date(2026, 3, 1)
    orders = [
        Order(
            sku="SKU-A", client_code="C1", client_name="Client1",
            qty=1000, deadline=date(2026, 3, 5), tool="T1", machine="M1",
            pieces_per_hour=500, operators=1, economic_lot=0, twin_ref=None,
        ),
        Order(
            sku="SKU-B", client_code="C1", client_name="Client1",
            qty=2000, deadline=date(2026, 3, 8), tool="T2", machine="M1",
            pieces_per_hour=400, operators=1, economic_lot=0, twin_ref=None,
        ),
    ]
    isop = ISOPData(
        skus={
            "SKU-A": SKU(
                sku="SKU-A", designation="Part A", machine="M1", tool="T1",
                pieces_per_hour=500, operators=1, economic_lot=0, twin_ref=None,
                stock=0, atraso=0, orders=[orders[0]], clients=["C1"],
            ),
            "SKU-B": SKU(
                sku="SKU-B", designation="Part B", machine="M1", tool="T2",
                pieces_per_hour=400, operators=1, economic_lot=0, twin_ref=None,
                stock=0, atraso=0, orders=[orders[1]], clients=["C1"],
            ),
        },
        orders=orders,
        machines=["M1"],
        tools=["T1", "T2"],
        twin_pairs=[],
        date_range=(date(2026, 3, 1), date(2026, 3, 15)),
        workdays=[date(2026, 3, d) for d in range(2, 14) if date(2026, 3, d).weekday() < 5],
    )

    gantt = run_pipeline(isop, today=today)

    assert gantt["solver_status"] in ("optimal", "feasible")
    assert len(gantt["jobs"]) > 0
    assert "machines" in gantt
    assert "kpis" in gantt
    assert "time_range" in gantt

    # Gantt jobs should have render-ready fields
    for job in gantt["jobs"]:
        assert "bar_left_pct" in job
        assert "bar_width_pct" in job
        assert "color" in job
        assert "priority_label" in job
        assert job["qty"] > 0


def test_gantt_response_has_all_fields():
    """Gantt response has required structure for frontend rendering."""
    from src.engine.models import SKU, ISOPData, Order

    today = date(2026, 3, 1)
    orders = [
        Order(
            sku="SKU-X", client_code="C1", client_name="Client1",
            qty=500, deadline=date(2026, 3, 3), tool="T1", machine="M1",
            pieces_per_hour=500, operators=1, economic_lot=0, twin_ref=None,
        ),
    ]
    isop = ISOPData(
        skus={
            "SKU-X": SKU(
                sku="SKU-X", designation="Part X", machine="M1", tool="T1",
                pieces_per_hour=500, operators=1, economic_lot=0, twin_ref=None,
                stock=0, atraso=0, orders=orders, clients=["C1"],
            ),
        },
        orders=orders,
        machines=["M1"],
        tools=["T1"],
        twin_pairs=[],
        date_range=(date(2026, 3, 1), date(2026, 3, 10)),
        workdays=[date(2026, 3, d) for d in range(2, 7)],
    )

    gantt = run_pipeline(isop, today=today)

    # Top-level keys
    assert "jobs" in gantt
    assert "machines" in gantt
    assert "kpis" in gantt
    assert "time_range" in gantt
    assert "solver_status" in gantt
    assert "solve_time_seconds" in gantt
    assert "infeasible_count" in gantt

    # KPI structure
    kpis = gantt["kpis"]
    assert "total_jobs" in kpis
    assert "total_qty" in kpis
    assert "otd_pct" in kpis
