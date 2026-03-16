"""Backward scheduler — port of scheduler/backward-scheduler.ts.

Computes earliest production start dates from Prz.Fabrico (lead time).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from ..types import EOp

if TYPE_CHECKING:
    from .decision_registry import DecisionRegistry


@dataclass
class EarliestStartEntry:
    earliest_day_idx: int
    latest_day_idx: int
    lt_days: int
    source: str


def compute_earliest_starts(
    ops: list[EOp],
    workdays: list[bool],
    n_days: int,
    registry: DecisionRegistry | None = None,
) -> dict[str, EarliestStartEntry]:
    """Compute earliest production start dates for ops with Prz.Fabrico."""
    result: dict[str, EarliestStartEntry] = {}

    # Build working day indices
    work_day_indices = [d for d in range(n_days) if workdays[d]]

    for op in ops:
        lt_days = op.lt_days
        if not lt_days or lt_days <= 0:
            continue

        # Find LAST day with positive demand
        last_demand_day = -1
        for d in range(n_days - 1, -1, -1):
            if (op.d[d] if d < len(op.d) else 0) > 0:
                last_demand_day = d
                break

        if last_demand_day < 0:
            continue

        # Find position in working day list
        wd_pos = -1
        for i in range(len(work_day_indices) - 1, -1, -1):
            if work_day_indices[i] <= last_demand_day:
                wd_pos = i
                break

        if wd_pos < 0:
            continue

        # Count backward lt_days working days
        target_pos = wd_pos - lt_days
        if target_pos < 0:
            earliest_day_idx = 0
        else:
            earliest_day_idx = work_day_indices[target_pos]

        entry = EarliestStartEntry(
            earliest_day_idx=earliest_day_idx,
            latest_day_idx=last_demand_day,
            lt_days=lt_days,
            source="prz_fabrico",
        )
        result[op.id] = entry

        if registry:
            registry.record(
                type="BACKWARD_SCHEDULE",
                op_id=op.id,
                detail=f"Op {op.id} ({op.sku}): ltDays={lt_days}, delivery=day{last_demand_day}, earliest=day{earliest_day_idx}",
                metadata={
                    "ltDays": lt_days,
                    "deliveryDay": last_demand_day,
                    "earliestDay": earliest_day_idx,
                    "sku": op.sku,
                },
            )

    return result
