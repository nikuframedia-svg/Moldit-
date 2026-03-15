"""Domain models for the PP1 LEAN scheduling engine."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class Order(BaseModel):
    """A single production order derived from a negative NP cell in the ISOP."""

    sku: str
    client_code: str
    client_name: str
    qty: int  # abs(negative NP value)
    deadline: date  # date of the column
    tool: str
    machine: str
    pieces_per_hour: int
    operators: int
    economic_lot: int  # SOFT constraint — never delays an order
    twin_ref: str | None


class SKU(BaseModel):
    """Aggregated SKU data — merges rows from different clients."""

    sku: str
    designation: str
    machine: str
    tool: str
    pieces_per_hour: int
    operators: int
    economic_lot: int
    twin_ref: str | None
    stock: int  # last positive NP before first negative (0 if all negative)
    atraso: int  # col N — if negative, delivery failure already happened
    orders: list[Order]  # all orders (from all clients)
    clients: list[str]  # unique client_codes


class ISOPData(BaseModel):
    """Parsed ISOP file — the complete demand picture."""

    skus: dict[str, SKU]  # aggregated by SKU code
    orders: list[Order]  # flat list, all orders
    machines: list[str]  # unique machines (sorted)
    tools: list[str]  # unique tools (sorted)
    twin_pairs: list[tuple[str, str]]  # [(sku_a, sku_b), ...] deduplicated & sorted
    date_range: tuple[date, date]  # (first_date, last_date)
    workdays: list[date]  # only working days (Mon-Fri)
