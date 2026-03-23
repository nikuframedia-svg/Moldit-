"""Internal scheduler types — lightweight @dataclass for speed.

These NEVER cross API boundaries. Pydantic types (Block, EOp, etc.)
live in scheduling/types.py and are imported where needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SkuBucket:
    """One demand bucket for one SKU — produced by demand_grouper."""

    op_id: str
    tool_id: str
    sku: str
    nm: str
    machine_id: str
    qty: int  # pieces to produce
    prod_qty: int  # after eco lot rounding
    prod_min: float  # production time (minutes)
    edd: int  # earliest due date (day index in horizon)
    setup_min: float  # setup time (minutes) — from tool.sH
    operators: int
    pH: int  # pieces per hour
    calco: str | None
    has_alt: bool
    alt_m: str | None
    mp: str | None
    stk: int
    lt: int  # eco lot qty
    atr: int  # backlog
    oee: float
    # Twin info
    is_twin_production: bool = False
    twin_partner_op_id: str | None = None
    co_production_group_id: str | None = None
    twin_outputs: list[tuple[str, str, int]] | None = None  # [(opId, sku, qty)]


@dataclass
class ToolGroup:
    """SkuBuckets sharing the same tool + machine + EDD."""

    tool_id: str
    machine_id: str
    edd: int
    setup_min: float
    total_prod_min: float
    buckets: list[SkuBucket] = field(default_factory=list)


@dataclass
class MachineCursor:
    """Tracks scheduling position on a machine."""

    machine_id: str
    day: int  # current day index
    minute: int  # current minute within day (420 = 07:00)
    last_tool: str | None = None
    third_shift: bool = False

    @property
    def day_end(self) -> int:
        from .constants import S1, S2

        return S2 if self.third_shift else S1


@dataclass
class EarliestStart:
    """Backward scheduling result for one operation."""

    op_id: str
    earliest_day_idx: int
    latest_day_idx: int
    lt_days: int
    source: str = "backward"
