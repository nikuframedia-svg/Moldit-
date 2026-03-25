"""Client demands extraction — Spec 01 §6.

Preserves per-client demand BEFORE multi-client merge (for expedição view).
"""

from __future__ import annotations

from collections import defaultdict

from backend.types import ClientDemandEntry, RawRow


def extract_client_demands(
    rows: list[RawRow], workdays: list[str]
) -> dict[str, list[ClientDemandEntry]]:
    """Extract client demands from raw ISOP rows.

    For each negative NP value:
    - order_qty = max(prev_stock, 0) + abs(np_val)  (real order, not just NP)
    - np_value = original negative NP

    Returns dict keyed by SKU.
    """
    demands: dict[str, list[ClientDemandEntry]] = defaultdict(list)

    for row in rows:
        for day_idx, np_val in enumerate(row.np_values):
            if np_val < 0:
                demands[row.sku].append(
                    ClientDemandEntry(
                        client=row.client_name,
                        sku=row.sku,
                        day_idx=day_idx,
                        date=workdays[day_idx] if day_idx < len(workdays) else "",
                        order_qty=abs(np_val),
                        np_value=np_val,
                    )
                )

    return dict(demands)
