"""References API — all SKU/refs with priority and details."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.api.state import app_state

router = APIRouter(prefix="/api", tags=["references"])


@router.get("/references")
def get_references() -> dict:
    """All references with priority, machine, tool, orders."""
    if app_state.isop_data is None:
        raise HTTPException(400, "No ISOP loaded. POST /api/load-isop first.")

    isop = app_state.isop_data
    refs = []
    for sku in isop.skus.values():
        total_demand = sum(o.qty for o in sku.orders)
        earliest_deadline = min((o.deadline for o in sku.orders), default=None)
        refs.append({
            "sku": sku.sku,
            "designation": sku.designation,
            "machine": sku.machine,
            "tool": sku.tool,
            "pieces_per_hour": sku.pieces_per_hour,
            "operators": sku.operators,
            "economic_lot": sku.economic_lot,
            "stock": sku.stock,
            "atraso": sku.atraso,
            "twin_ref": sku.twin_ref,
            "clients": sku.clients,
            "total_demand": total_demand,
            "orders_count": len(sku.orders),
            "earliest_deadline": earliest_deadline.isoformat() if earliest_deadline else None,
        })

    # Sort: atraso refs first, then by earliest deadline
    refs.sort(key=lambda r: (
        0 if r["atraso"] < 0 else 1,
        r["earliest_deadline"] or "9999-12-31",
    ))

    return {"references": refs, "count": len(refs)}


@router.get("/references/{sku}")
def get_reference(sku: str) -> dict:
    """Single reference detail with all orders."""
    if app_state.isop_data is None:
        raise HTTPException(400, "No ISOP loaded. POST /api/load-isop first.")

    isop = app_state.isop_data
    if sku not in isop.skus:
        raise HTTPException(404, f"Reference {sku} not found")

    s = isop.skus[sku]
    orders = [
        {
            "client_code": o.client_code,
            "client_name": o.client_name,
            "qty": o.qty,
            "deadline": o.deadline.isoformat(),
        }
        for o in s.orders
    ]

    return {
        "sku": s.sku,
        "designation": s.designation,
        "machine": s.machine,
        "tool": s.tool,
        "pieces_per_hour": s.pieces_per_hour,
        "operators": s.operators,
        "economic_lot": s.economic_lot,
        "stock": s.stock,
        "atraso": s.atraso,
        "twin_ref": s.twin_ref,
        "clients": s.clients,
        "orders": orders,
        "total_demand": sum(o.qty for o in s.orders),
    }
