"""Coverage-based alerts engine — Contract C-05.

Francisco's requirements:
  RED:    refs missing to cover orders for TOMORROW
  YELLOW: refs missing to cover orders within 2-3 DAYS
  ATRASO: refs with negative atraso in ISOP = delivery failure ALREADY HAPPENED (priority #1)
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel

from .models import SKU, ISOPData

# ─── Alert Model ─────────────────────────────────────────────────────────────


class Alert(BaseModel):
    sku: str
    client: str
    designation: str
    severity: Literal["atraso", "red", "yellow"]
    shortage_qty: int  # pieces missing (positive)
    shortage_date: date  # when stockout occurs
    machine: str
    message: str  # Portuguese text ready to display
    coverage_days: int  # remaining coverage days (0 if already stocked out)


# ─── Severity ordering for sort ──────────────────────────────────────────────

_SEVERITY_ORDER = {"atraso": 0, "red": 1, "yellow": 2}


# ─── Core Logic ──────────────────────────────────────────────────────────────


def _classify_severity(
    sku: SKU,
    stockout_date: date,
    today: date,
) -> Literal["atraso", "red", "yellow"] | None:
    """Classify alert severity based on stockout date relative to today."""
    if sku.atraso < 0:
        return "atraso"
    if stockout_date <= today + timedelta(days=1):
        return "red"
    if stockout_date <= today + timedelta(days=3):
        return "yellow"
    return None


def _build_message(
    severity: Literal["atraso", "red", "yellow"],
    sku_code: str,
    designation: str,
    shortage_qty: int,
    shortage_date: date,
) -> str:
    """Build Portuguese alert message."""
    if severity == "atraso":
        return (
            f"ATRASO: {designation} \u2014 falha de entrega. "
            f"Faltam {shortage_qty} pe\u00e7as."
        )
    if severity == "red":
        return (
            f"Faltam {shortage_qty} pe\u00e7as da ref {sku_code} "
            f"para cobrir pedidos de amanh\u00e3."
        )
    # yellow
    formatted = shortage_date.strftime("%d/%m")
    return (
        f"Faltam {shortage_qty} pe\u00e7as da ref {sku_code} "
        f"para cobrir pedidos de {formatted}."
    )


def _compute_sku_alert(sku: SKU, today: date) -> Alert | None:
    """Compute alert for a single SKU using coverage drain logic."""
    orders = sorted(sku.orders, key=lambda o: o.deadline)
    if not orders:
        # No orders — if atraso < 0 still flag it
        if sku.atraso < 0:
            return Alert(
                sku=sku.sku,
                client=", ".join(sku.clients) if sku.clients else "",
                designation=sku.designation,
                severity="atraso",
                shortage_qty=abs(sku.atraso),
                shortage_date=today,
                machine=sku.machine,
                message=_build_message(
                    "atraso", sku.sku, sku.designation, abs(sku.atraso), today
                ),
                coverage_days=0,
            )
        return None

    stock_available = sku.stock
    stockout_date: date | None = None
    shortage_qty = 0

    for order in orders:
        stock_available -= order.qty
        if stock_available < 0:
            stockout_date = order.deadline
            shortage_qty = abs(stock_available)
            break

    if stockout_date is None:
        # Stock covers all orders — check atraso anyway
        if sku.atraso < 0:
            return Alert(
                sku=sku.sku,
                client=", ".join(sku.clients) if sku.clients else "",
                designation=sku.designation,
                severity="atraso",
                shortage_qty=abs(sku.atraso),
                shortage_date=today,
                machine=sku.machine,
                message=_build_message(
                    "atraso", sku.sku, sku.designation, abs(sku.atraso), today
                ),
                coverage_days=0,
            )
        return None

    coverage_days = max((stockout_date - today).days, 0)

    severity = _classify_severity(sku, stockout_date, today)
    if severity is None:
        return None

    message = _build_message(severity, sku.sku, sku.designation, shortage_qty, stockout_date)

    return Alert(
        sku=sku.sku,
        client=", ".join(sku.clients) if sku.clients else "",
        designation=sku.designation,
        severity=severity,
        shortage_qty=shortage_qty,
        shortage_date=stockout_date,
        machine=sku.machine,
        message=message,
        coverage_days=coverage_days,
    )


def compute_alerts(isop: ISOPData, today: date) -> list[Alert]:
    """Compute all alerts from parsed ISOP data.

    Returns alerts sorted: atraso first, then red, then yellow.
    Within same severity, biggest shortage first.
    """
    alerts: list[Alert] = []
    for sku in isop.skus.values():
        alert = _compute_sku_alert(sku, today)
        if alert is not None:
            alerts.append(alert)

    alerts.sort(key=lambda a: (_SEVERITY_ORDER[a.severity], -a.shortage_qty))
    return alerts
