"""Tests for the coverage-based alerts engine — Contract C-05.

All tests use synthetic data (no ISOP file dependency).
"""

from __future__ import annotations

from datetime import date, timedelta

from src.engine.alerts import compute_alerts
from src.engine.models import SKU, ISOPData, Order

# ─── Helpers ─────────────────────────────────────────────────────────────────

TODAY = date(2026, 3, 15)


def _make_order(
    sku: str = "REF001",
    qty: int = 1000,
    deadline: date | None = None,
    client_code: str = "CLI01",
) -> Order:
    return Order(
        sku=sku,
        client_code=client_code,
        client_name="Cliente Teste",
        qty=qty,
        deadline=deadline or TODAY + timedelta(days=1),
        tool="T001",
        machine="PRM019",
        pieces_per_hour=500,
        operators=2,
        economic_lot=5000,
        twin_ref=None,
    )


def _make_sku(
    sku: str = "REF001",
    designation: str = "Peça Teste",
    stock: int = 0,
    atraso: int = 0,
    orders: list[Order] | None = None,
) -> SKU:
    ords = orders or []
    return SKU(
        sku=sku,
        designation=designation,
        machine="PRM019",
        tool="T001",
        pieces_per_hour=500,
        operators=2,
        economic_lot=5000,
        twin_ref=None,
        stock=stock,
        atraso=atraso,
        orders=ords,
        clients=list({o.client_code for o in ords}) if ords else ["CLI01"],
    )


def _make_isop(skus: list[SKU]) -> ISOPData:
    all_orders = []
    for s in skus:
        all_orders.extend(s.orders)
    return ISOPData(
        skus={s.sku: s for s in skus},
        orders=all_orders,
        machines=["PRM019"],
        tools=["T001"],
        twin_pairs=[],
        date_range=(TODAY, TODAY + timedelta(days=30)),
        workdays=[TODAY + timedelta(days=i) for i in range(30)],
    )


# ─── Francisco Tests (INVIOLABLE) ───────────────────────────────────────────


def test_francisco_F4_cobertura_769():
    """Ref 769/825 has 2 weeks coverage — should NOT generate any alert.

    Francisco said: 'ref 769/825 was marked as risk but has 2 weeks coverage.'
    """
    orders = [
        _make_order(sku="769/825", qty=1000, deadline=TODAY + timedelta(days=i))
        for i in range(1, 15)  # 14 orders of 1000 over 14 days
    ]
    sku = _make_sku(
        sku="769/825",
        designation="Peça 769/825",
        stock=20000,  # covers all 14000
        orders=orders,
    )
    alerts = compute_alerts(_make_isop([sku]), TODAY)
    assert len(alerts) == 0, f"Expected no alerts for 769/825 with 2 weeks coverage, got {alerts}"


def test_francisco_F6_alertas_vermelho():
    """SKU with stock=0 and order for tomorrow -> RED alert."""
    order = _make_order(qty=5000, deadline=TODAY + timedelta(days=1))
    sku = _make_sku(stock=0, orders=[order])

    alerts = compute_alerts(_make_isop([sku]), TODAY)

    assert len(alerts) == 1
    alert = alerts[0]
    assert alert.severity == "red"
    assert "Faltam" in alert.message
    assert "peças" in alert.message
    assert "amanhã" in alert.message


def test_francisco_F6_alertas_amarelo():
    """SKU with stockout in 2 days -> YELLOW alert."""
    order = _make_order(qty=5000, deadline=TODAY + timedelta(days=2))
    sku = _make_sku(stock=0, orders=[order])

    alerts = compute_alerts(_make_isop([sku]), TODAY)

    assert len(alerts) == 1
    alert = alerts[0]
    assert alert.severity == "yellow"
    assert "Faltam" in alert.message
    assert "peças" in alert.message


def test_francisco_F6_atraso_prioridade_1():
    """SKU with atraso < 0 -> severity 'atraso', appears BEFORE all others."""
    # Atraso SKU (priority #1)
    atraso_order = _make_order(sku="LATE", qty=3000, deadline=TODAY + timedelta(days=5))
    atraso_sku = _make_sku(
        sku="LATE",
        designation="Peça Atrasada",
        stock=0,
        atraso=-500,
        orders=[atraso_order],
    )

    # Red SKU (tomorrow)
    red_order = _make_order(sku="URGENT", qty=2000, deadline=TODAY + timedelta(days=1))
    red_sku = _make_sku(
        sku="URGENT",
        designation="Peça Urgente",
        stock=0,
        atraso=0,
        orders=[red_order],
    )

    alerts = compute_alerts(_make_isop([atraso_sku, red_sku]), TODAY)

    assert len(alerts) == 2
    assert alerts[0].severity == "atraso"
    assert alerts[0].sku == "LATE"
    assert "ATRASO" in alerts[0].message
    assert alerts[1].severity == "red"


# ─── Technical Tests ─────────────────────────────────────────────────────────


def test_green_no_alert():
    """SKU with stock for 2+ weeks -> no alert."""
    orders = [
        _make_order(qty=500, deadline=TODAY + timedelta(days=i))
        for i in range(5, 20)
    ]
    sku = _make_sku(stock=50000, orders=orders)

    alerts = compute_alerts(_make_isop([sku]), TODAY)
    assert len(alerts) == 0


def test_coverage_considers_stock():
    """SKU with stock=5000 and order of 3000 tomorrow -> green (2000 left)."""
    order = _make_order(qty=3000, deadline=TODAY + timedelta(days=1))
    sku = _make_sku(stock=5000, orders=[order])

    alerts = compute_alerts(_make_isop([sku]), TODAY)
    assert len(alerts) == 0


def test_multi_order_drain():
    """SKU with stock=5000 and 3 orders of 2000 -> stockout at 3rd order."""
    orders = [
        _make_order(qty=2000, deadline=TODAY + timedelta(days=1)),
        _make_order(qty=2000, deadline=TODAY + timedelta(days=2)),
        _make_order(qty=2000, deadline=TODAY + timedelta(days=3)),
    ]
    sku = _make_sku(stock=5000, orders=orders)

    alerts = compute_alerts(_make_isop([sku]), TODAY)

    assert len(alerts) == 1
    alert = alerts[0]
    # Stockout at 3rd order (day+3): 5000-2000-2000-2000 = -1000
    assert alert.shortage_qty == 1000
    assert alert.shortage_date == TODAY + timedelta(days=3)
    assert alert.severity == "yellow"  # day+3 is within 3 days


def test_alerts_sorted():
    """Atraso first, then red, then yellow. Within same severity, biggest shortage first."""
    # Yellow with small shortage
    yellow_order = _make_order(sku="Y1", qty=100, deadline=TODAY + timedelta(days=2))
    yellow_sku = _make_sku(sku="Y1", designation="Yellow Small", stock=0, orders=[yellow_order])

    # Red with big shortage
    red_order = _make_order(sku="R1", qty=9000, deadline=TODAY + timedelta(days=1))
    red_sku = _make_sku(sku="R1", designation="Red Big", stock=0, orders=[red_order])

    # Atraso
    atraso_order = _make_order(sku="A1", qty=500, deadline=TODAY + timedelta(days=5))
    atraso_sku = _make_sku(
        sku="A1", designation="Atraso", stock=0, atraso=-200, orders=[atraso_order]
    )

    # Red with small shortage
    red2_order = _make_order(sku="R2", qty=300, deadline=TODAY + timedelta(days=1))
    red2_sku = _make_sku(sku="R2", designation="Red Small", stock=0, orders=[red2_order])

    alerts = compute_alerts(
        _make_isop([yellow_sku, red_sku, atraso_sku, red2_sku]), TODAY
    )

    assert len(alerts) == 4
    # Atraso first
    assert alerts[0].severity == "atraso"
    # Then reds, biggest first
    assert alerts[1].severity == "red"
    assert alerts[1].shortage_qty == 9000
    assert alerts[2].severity == "red"
    assert alerts[2].shortage_qty == 300
    # Then yellow
    assert alerts[3].severity == "yellow"
