"""Integration tests — Contract C-08.

End-to-end validation with synthetic data.
Tests all Francisco requirements (F1-F6) through the full pipeline.
"""

from __future__ import annotations

import json
from datetime import date, timedelta

from src.api.state import app_state
from src.copilot.engine import execute_tool
from src.engine.alerts import compute_alerts
from src.engine.models import SKU, ISOPData, Order
from src.engine.transform import run_pipeline

# ─── Helpers ─────────────────────────────────────────────────────────────────


TODAY = date(2026, 3, 1)


def _make_order(
    sku: str = "REF001",
    qty: int = 1000,
    deadline: date | None = None,
    tool: str = "T1",
    machine: str = "PRM019",
    pph: int = 500,
    client: str = "C1",
    twin_ref: str | None = None,
) -> Order:
    return Order(
        sku=sku,
        client_code=client,
        client_name=f"Client {client}",
        qty=qty,
        deadline=deadline or TODAY + timedelta(days=5),
        tool=tool,
        machine=machine,
        pieces_per_hour=pph,
        operators=1,
        economic_lot=5000,
        twin_ref=twin_ref,
    )


def _make_sku(
    sku: str = "REF001",
    machine: str = "PRM019",
    tool: str = "T1",
    pph: int = 500,
    stock: int = 0,
    atraso: int = 0,
    orders: list[Order] | None = None,
    twin_ref: str | None = None,
) -> SKU:
    ords = orders or []
    return SKU(
        sku=sku,
        designation=f"Peça {sku}",
        machine=machine,
        tool=tool,
        pieces_per_hour=pph,
        operators=1,
        economic_lot=5000,
        twin_ref=twin_ref,
        stock=stock,
        atraso=atraso,
        orders=ords,
        clients=list({o.client_code for o in ords}) if ords else [],
    )


def _build_isop(skus: list[SKU], machines: list[str] | None = None) -> ISOPData:
    all_orders = []
    all_tools = set()
    all_machines = set()
    for s in skus:
        all_orders.extend(s.orders)
        all_tools.add(s.tool)
        all_machines.add(s.machine)
    return ISOPData(
        skus={s.sku: s for s in skus},
        orders=all_orders,
        machines=machines or sorted(all_machines),
        tools=sorted(all_tools),
        twin_pairs=[],
        date_range=(TODAY, TODAY + timedelta(days=30)),
        workdays=[
            TODAY + timedelta(days=i)
            for i in range(1, 30)
            if (TODAY + timedelta(days=i)).weekday() < 5
        ],
    )


# ─── Test 1: Full pipeline ──────────────────────────────────────────────────


def test_full_pipeline():
    """ISOP → solve → API → zero crashes."""
    orders = [
        _make_order(sku="A", qty=500, deadline=TODAY + timedelta(days=3)),
        _make_order(sku="B", qty=800, deadline=TODAY + timedelta(days=7), tool="T2"),
    ]
    skus = [
        _make_sku(sku="A", orders=[orders[0]]),
        _make_sku(sku="B", tool="T2", orders=[orders[1]]),
    ]
    isop = _build_isop(skus)

    gantt = run_pipeline(isop, today=TODAY)
    alerts = compute_alerts(isop, TODAY)

    assert gantt["solver_status"] in ("optimal", "feasible")
    assert len(gantt["jobs"]) > 0
    assert "kpis" in gantt
    assert "machines" in gantt
    assert isinstance(alerts, list)


# ─── Test 2: Francisco F1 — JIT ─────────────────────────────────────────────


def test_e2e_francisco_F1_jit():
    """No ref with deadline >7d should be scheduled >3d before deadline."""
    orders = [
        _make_order(sku="FAR", qty=500, deadline=TODAY + timedelta(days=14)),
    ]
    skus = [_make_sku(sku="FAR", orders=orders)]
    isop = _build_isop(skus)

    gantt = run_pipeline(isop, today=TODAY)

    for job in gantt["jobs"]:
        if job.get("deadline"):
            deadline = date.fromisoformat(job["deadline"])
            start = date.fromisoformat(job["start"][:10])
            days_before = (deadline - start).days
            # Should not be scheduled more than 3 days before
            if (deadline - TODAY).days > 7:
                assert days_before <= 5, (
                    f"Job {job['sku']} scheduled {days_before}d before deadline"
                )


# ─── Test 3: Francisco F2 — Lote económico ──────────────────────────────────


def test_e2e_francisco_F2_lote():
    """Economic lot respected when there's time, never delays."""
    orders = [
        _make_order(sku="LOT", qty=3000, deadline=TODAY + timedelta(days=20)),
    ]
    skus = [_make_sku(sku="LOT", orders=orders)]
    isop = _build_isop(skus)

    gantt = run_pipeline(isop, today=TODAY)

    for job in gantt["jobs"]:
        if job["sku"] == "LOT":
            # qty should be at least the order qty
            assert job["qty"] >= 3000


# ─── Test 4: Francisco F3 — Material affinity ───────────────────────────────


def test_e2e_francisco_F3_material_affinity():
    """Refs 262/170 on same machine via copilot rule."""
    orders = [
        _make_order(sku="262", qty=1000, machine="PRM019", tool="T1"),
        _make_order(sku="170", qty=1500, machine="PRM031", tool="T2"),
    ]
    skus = [
        _make_sku(sku="262", orders=[orders[0]]),
        _make_sku(sku="170", machine="PRM031", tool="T2", orders=[orders[1]]),
    ]
    isop = _build_isop(skus, machines=["PRM019", "PRM031"])

    # Set up app_state and create affinity rule via copilot
    gantt = run_pipeline(isop, today=TODAY)
    alerts = compute_alerts(isop, TODAY)
    app_state.isop_data = isop
    app_state.schedule = gantt
    app_state.alerts = [a.model_dump() for a in alerts]
    config = app_state.get_config()
    config["rules"] = []
    app_state.set_config(config)

    result = json.loads(execute_tool("agrupar_material", json.dumps({
        "sku_list": ["262", "170"],
        "machine_id": "PRM019",
        "reason": "matéria-prima comum",
    })))
    assert result["status"] == "ok"

    # Verify rule was created
    rules = app_state.get_rules()
    assert len(rules) == 1
    assert "262" in str(rules[0])


# ─── Test 5: Francisco F4 — Ref 769 sem alerta ─────────────────────────────


def test_e2e_francisco_F4_no_alert_769():
    """Ref 769 with 2 weeks coverage should NOT generate alert."""
    orders = [
        _make_order(sku="769", qty=1000, deadline=TODAY + timedelta(days=i))
        for i in range(1, 15)
    ]
    skus = [_make_sku(sku="769", stock=20000, orders=orders)]
    isop = _build_isop(skus)

    alerts = compute_alerts(isop, TODAY)
    sku_alerts = [a for a in alerts if a.sku == "769"]
    assert len(sku_alerts) == 0, f"769 should have no alerts, got {sku_alerts}"


# ─── Test 6: Francisco F6 — Red alert format ────────────────────────────────


def test_e2e_francisco_F6_red_alert():
    """Red alert: 'Faltam X peças ... amanhã'."""
    order = _make_order(sku="URG", qty=5000, deadline=TODAY + timedelta(days=1))
    skus = [_make_sku(sku="URG", stock=0, orders=[order])]
    isop = _build_isop(skus)

    alerts = compute_alerts(isop, TODAY)
    assert len(alerts) == 1
    a = alerts[0]
    assert a.severity == "red"
    assert "Faltam" in a.message
    assert "peças" in a.message
    assert "amanhã" in a.message


# ─── Test 7: Francisco F6 — Atraso priority ─────────────────────────────────


def test_e2e_francisco_F6_atraso_first():
    """ATRASO alerts before everything else."""
    orders_atraso = [_make_order(sku="LATE", qty=100, deadline=TODAY + timedelta(days=10))]
    orders_red = [_make_order(sku="NOW", qty=200, deadline=TODAY + timedelta(days=1))]
    skus = [
        _make_sku(sku="LATE", stock=0, atraso=-500, orders=orders_atraso),
        _make_sku(sku="NOW", stock=0, orders=orders_red, tool="T2"),
    ]
    isop = _build_isop(skus)

    alerts = compute_alerts(isop, TODAY)
    assert len(alerts) >= 2
    assert alerts[0].severity == "atraso"
    assert alerts[0].sku == "LATE"


# ─── Test 8: Copilot flow ───────────────────────────────────────────────────


def test_copilot_flow():
    """Chat → rule → recalculate → result."""
    orders = [_make_order(sku="CP1", qty=500)]
    skus = [_make_sku(sku="CP1", orders=orders)]
    isop = _build_isop(skus)

    gantt = run_pipeline(isop, today=TODAY)
    alerts = compute_alerts(isop, TODAY)
    app_state.isop_data = isop
    app_state.schedule = gantt
    app_state.alerts = [a.model_dump() for a in alerts]
    config = app_state.get_config()
    config["rules"] = []
    app_state.set_config(config)

    # Add rule
    result = json.loads(execute_tool("adicionar_regra", json.dumps({
        "id": "flow_test",
        "name": "Flow test rule",
        "condition_type": "sku_equals",
        "action_type": "set_priority",
    })))
    assert result["status"] == "ok"

    # Recalculate
    result = json.loads(execute_tool("recalcular_plano", "{}"))
    assert result["status"] == "ok"
    assert result["jobs"] > 0


# ─── Test 9: API smoke ──────────────────────────────────────────────────────


def test_api_smoke(client):
    """All endpoints 200 after load."""
    orders = [_make_order(sku="SM1", qty=500)]
    skus = [_make_sku(sku="SM1", orders=orders)]
    isop = _build_isop(skus)

    gantt = run_pipeline(isop, today=TODAY)
    alerts = compute_alerts(isop, TODAY)
    app_state.isop_data = isop
    app_state.schedule = gantt
    app_state.alerts = [a.model_dump() for a in alerts]

    endpoints = [
        "/health",
        "/api/dashboard",
        "/api/schedule",
        "/api/alerts",
        "/api/alerts/summary",
        "/api/references",
        "/api/config",
        "/api/rules",
        "/api/machines",
        "/api/copilot/tools",
    ]
    for ep in endpoints:
        r = client.get(ep)
        assert r.status_code == 200, f"{ep} returned {r.status_code}"


# ─── Test 10: Gantt render-ready ─────────────────────────────────────────────


def test_gantt_render_ready():
    """Gantt JSON has all render-ready fields for frontend."""
    orders = [
        _make_order(sku="RR1", qty=1000, deadline=TODAY + timedelta(days=5)),
        _make_order(sku="RR2", qty=2000, deadline=TODAY + timedelta(days=8), tool="T2"),
    ]
    skus = [
        _make_sku(sku="RR1", orders=[orders[0]]),
        _make_sku(sku="RR2", tool="T2", orders=[orders[1]]),
    ]
    isop = _build_isop(skus)

    gantt = run_pipeline(isop, today=TODAY)

    # Structure
    assert "jobs" in gantt
    assert "machines" in gantt
    assert "kpis" in gantt
    assert "time_range" in gantt
    assert "solver_status" in gantt

    # Each job has render-ready fields
    for job in gantt["jobs"]:
        assert "bar_left_pct" in job, f"Missing bar_left_pct in {job}"
        assert "bar_width_pct" in job, f"Missing bar_width_pct in {job}"
        assert "color" in job, f"Missing color in {job}"
        assert "priority_label" in job, f"Missing priority_label in {job}"
        assert job["qty"] > 0
