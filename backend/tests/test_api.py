"""Tests for API endpoints — Contract C-04.

Uses synthetic data to avoid ISOP file dependency.
"""

from datetime import date

from src.api.state import app_state
from src.engine.models import SKU, ISOPData, Order

# ─── Helpers ─────────────────────────────────────────────────────────────────


def _load_synthetic(client):
    """Load synthetic schedule into app_state for API tests."""
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
                stock=0, atraso=-100, orders=[orders[1]], clients=["C1"],
            ),
        },
        orders=orders,
        machines=["M1"],
        tools=["T1", "T2"],
        twin_pairs=[],
        date_range=(date(2026, 3, 1), date(2026, 3, 15)),
        workdays=[date(2026, 3, d) for d in range(2, 14) if date(2026, 3, d).weekday() < 5],
    )

    from src.engine.alerts import compute_alerts
    from src.engine.transform import run_pipeline

    gantt = run_pipeline(isop, today=date(2026, 3, 1))
    alerts = compute_alerts(isop, date(2026, 3, 1))

    app_state.isop_data = isop
    app_state.schedule = gantt
    app_state.alerts = [a.model_dump() for a in alerts]


# ─── Tests ───────────────────────────────────────────────────────────────────


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_endpoints_require_loaded(client):
    """All data endpoints return 400 when no ISOP loaded."""
    app_state.schedule = None
    app_state.isop_data = None
    app_state.alerts = None

    for path in ["/api/dashboard", "/api/schedule", "/api/alerts", "/api/machines"]:
        r = client.get(path)
        assert r.status_code == 400, f"{path} should require loaded ISOP"


def test_dashboard(client):
    _load_synthetic(client)
    r = client.get("/api/dashboard")
    assert r.status_code == 200
    data = r.json()
    assert "kpis" in data
    assert "top_alerts" in data
    assert "machines" in data


def test_schedule(client):
    _load_synthetic(client)
    r = client.get("/api/schedule")
    assert r.status_code == 200
    data = r.json()
    assert "jobs" in data
    assert "machines" in data
    assert "kpis" in data
    assert len(data["jobs"]) > 0


def test_alerts_endpoint(client):
    _load_synthetic(client)
    r = client.get("/api/alerts")
    assert r.status_code == 200
    data = r.json()
    assert "alerts" in data
    assert "count" in data


def test_alerts_summary(client):
    _load_synthetic(client)
    r = client.get("/api/alerts/summary")
    assert r.status_code == 200
    data = r.json()
    assert "summary" in data
    assert "total" in data
    for sev in ("atraso", "red", "yellow"):
        assert sev in data["summary"]


def test_references(client):
    _load_synthetic(client)
    r = client.get("/api/references")
    assert r.status_code == 200
    data = r.json()
    assert data["count"] == 2
    refs = data["references"]
    # Atraso refs should be sorted first
    assert refs[0]["atraso"] < 0


def test_reference_detail(client):
    _load_synthetic(client)
    r = client.get("/api/references/SKU-A")
    assert r.status_code == 200
    data = r.json()
    assert data["sku"] == "SKU-A"
    assert len(data["orders"]) == 1
    assert data["total_demand"] == 1000


def test_reference_not_found(client):
    _load_synthetic(client)
    r = client.get("/api/references/NONEXISTENT")
    assert r.status_code == 404


def test_config(client):
    r = client.get("/api/config")
    assert r.status_code == 200
    assert "config" in r.json()


def test_rules_crud(client):
    # GET empty rules
    r = client.get("/api/rules")
    assert r.status_code == 200

    # CREATE rule
    rule = {
        "id": "test_rule",
        "name": "Test Rule",
        "condition": {"type": "machine_load_above", "params": {"threshold": 0.9}},
        "action": {"type": "alert", "params": {"severity": "yellow"}},
        "enabled": True,
    }
    r = client.post("/api/rules", json=rule)
    assert r.status_code == 200
    assert r.json()["rule_id"] == "test_rule"

    # Duplicate should fail
    r = client.post("/api/rules", json=rule)
    assert r.status_code == 409

    # DELETE
    r = client.delete("/api/rules/test_rule")
    assert r.status_code == 200

    # Delete non-existent
    r = client.delete("/api/rules/nonexistent")
    assert r.status_code == 404


def test_machine_schedule(client):
    _load_synthetic(client)
    r = client.get("/api/schedule/M1")
    assert r.status_code == 200
    data = r.json()
    assert data["machine"] == "M1"
    assert len(data["jobs"]) > 0


def test_machine_not_found(client):
    _load_synthetic(client)
    r = client.get("/api/schedule/NONEXISTENT")
    assert r.status_code == 404


def test_recalculate(client):
    _load_synthetic(client)
    r = client.post("/api/recalculate")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "recalculated"
    assert "jobs_count" in data
