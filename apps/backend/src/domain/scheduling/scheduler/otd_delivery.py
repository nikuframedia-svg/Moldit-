"""OTD delivery failure detection — port of overflow/otd-delivery-failures.ts.

Computes per-op demand checkpoints where cumulative production is insufficient.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..types import Block, EOp


@dataclass
class OtdDeliveryFailure:
    op_id: str
    day: int
    shortfall: int


def compute_otd_delivery_failures(
    blocks: list[Block],
    ops: list[EOp],
) -> tuple[int, list[OtdDeliveryFailure]]:
    """Compute per-op OTD-D failures.

    Returns (count, failures).
    """
    failures: list[OtdDeliveryFailure] = []

    for op in ops:
        # Sum demand per day
        n_days = len(op.d)
        cum_demand = 0
        cum_prod = 0

        # Pre-compute production per day for this op
        prod_per_day: dict[int, int] = {}
        for b in blocks:
            if b.type != "ok" or b.qty <= 0:
                continue
            if b.op_id == op.id:
                prod_per_day[b.day_idx] = prod_per_day.get(b.day_idx, 0) + b.qty
            # Twin outputs
            if b.outputs:
                for out in b.outputs:
                    if out.op_id == op.id:
                        prod_per_day[b.day_idx] = prod_per_day.get(b.day_idx, 0) + out.qty

        for d in range(n_days):
            day_demand = max(op.d[d] if d < len(op.d) else 0, 0)
            if day_demand <= 0:
                continue
            cum_demand += day_demand
            # Add production up to and including this day
            for pd in range(d + 1):
                if pd in prod_per_day:
                    cum_prod += prod_per_day.pop(pd, 0)

            if cum_prod < cum_demand:
                failures.append(
                    OtdDeliveryFailure(
                        op_id=op.id,
                        day=d,
                        shortfall=cum_demand - cum_prod,
                    )
                )

    return len(failures), failures
