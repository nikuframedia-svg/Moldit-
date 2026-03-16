"""Supply priority — port of mrp/supply-priority.ts.

Maps MRP risk metrics to scheduler priority boosts.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..types import EngineData
from .mrp_engine import MRPResult


@dataclass
class SupplyPriority:
    op_id: str
    tool_code: str
    boost: int  # 0=normal, 1=medium, 2=high, 3=critical
    reason: str


DEFAULT_COVERAGE_THRESHOLD = 3  # days


def compute_supply_priority(
    engine: EngineData,
    mrp: MRPResult,
    coverage_days: int = DEFAULT_COVERAGE_THRESHOLD,
) -> dict[str, SupplyPriority]:
    """Compute supply priority boosts for all operations.

    Returns dict[op_id -> SupplyPriority] (only for ops with boost > 0).
    """
    # Build tool_code → MRPRecord lookup
    record_by_tool: dict[str, object] = {}
    for rec in mrp.records:
        record_by_tool[rec.tool_code] = rec

    result: dict[str, SupplyPriority] = {}

    for op in engine.ops:
        rec = record_by_tool.get(op.t)
        if not rec:
            continue

        # Use per-SKU data if available
        sku_rec = None
        for sr in rec.sku_records:
            if sr.op_id == op.id:
                sku_rec = sr
                break

        stockout_day = sku_rec.stockout_day if sku_rec else rec.stockout_day
        coverage = sku_rec.coverage_days if sku_rec else rec.coverage_days

        # Check if there's active demand
        gross_req = sum(max(d, 0) for d in op.d)

        boost = 0
        reason = ""

        if stockout_day is not None and stockout_day <= 1:
            boost = 3
            reason = f"Rutura iminente (dia {stockout_day})"
        elif stockout_day is not None:
            boost = 2
            reason = f"Rutura prevista (dia {stockout_day})"
        elif coverage < coverage_days and gross_req > 0:
            boost = 1
            reason = f"Cobertura baixa ({coverage:.1f} dias < {coverage_days})"

        if boost > 0:
            result[op.id] = SupplyPriority(
                op_id=op.id,
                tool_code=op.t,
                boost=boost,
                reason=reason,
            )

    return result
