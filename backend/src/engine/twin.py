"""Twin parts logic for Incompol scheduling engine.

Twin parts share the same tool and machine, producing simultaneously.
Time = max(qty_A, qty_B) / pieces_per_hour (ONCE, not double).
"""

from __future__ import annotations


def merge_twin_orders(
    orders: list[dict],
    twin_pairs: list[tuple[str, str]],
) -> list[dict]:
    """Merge twin-pair orders into single production jobs.

    For each twin pair (sku_A, sku_B):
    - Match orders with the same deadline
    - Create 1 merged job with qty = max(qty_A, qty_B)
    - Production time = qty / pieces_per_hour (ONCE, not doubled)
    - Excess production goes to stock

    Orders without a twin match pass through unchanged.

    Returns a new list of order dicts. Merged orders have:
        is_twin=True, twin_outputs=[{sku, qty}, ...], twin_pair=(skuA, skuB)
    """
    if not twin_pairs:
        return [_tag_non_twin(o) for o in orders]

    # Build lookup: sku -> partner sku
    partner_map: dict[str, str] = {}
    pair_set: set[tuple[str, str]] = set()
    for a, b in twin_pairs:
        partner_map[a] = b
        partner_map[b] = a
        pair_set.add((min(a, b), max(a, b)))

    # Group orders by (deadline, canonical_pair_key)
    # canonical_pair_key = sorted tuple of (skuA, skuB)
    twin_groups: dict[tuple, list[dict]] = {}
    standalone: list[dict] = []

    for order in orders:
        sku = order["sku"]
        if sku not in partner_map:
            standalone.append(_tag_non_twin(order))
            continue

        partner = partner_map[sku]
        pair_key = (min(sku, partner), max(sku, partner))
        deadline = order["deadline"]
        group_key = (deadline, pair_key)

        if group_key not in twin_groups:
            twin_groups[group_key] = []
        twin_groups[group_key].append(order)

    # Process twin groups
    merged: list[dict] = []
    for (deadline, pair_key), group_orders in twin_groups.items():
        sku_a, sku_b = pair_key

        # Separate orders by SKU
        orders_a = [o for o in group_orders if o["sku"] == sku_a]
        orders_b = [o for o in group_orders if o["sku"] == sku_b]

        # Match pairs by index (cross-EDD: already grouped by deadline)
        max_len = max(len(orders_a), len(orders_b))
        for i in range(max_len):
            oa = orders_a[i] if i < len(orders_a) else None
            ob = orders_b[i] if i < len(orders_b) else None

            if oa and ob:
                # Merged twin job
                qty_a = oa["qty"]
                qty_b = ob["qty"]
                merged_qty = max(qty_a, qty_b)
                # Use the first order as base, take the faster pieces_per_hour
                base = oa
                merged.append({
                    **base,
                    "qty": merged_qty,
                    "is_twin": True,
                    "twin_pair": pair_key,
                    "twin_outputs": [
                        {"sku": sku_a, "qty": qty_a},
                        {"sku": sku_b, "qty": qty_b},
                    ],
                    "pieces_per_hour": max(
                        oa.get("pieces_per_hour", 1),
                        ob.get("pieces_per_hour", 1),
                    ),
                    "clients": list(
                        set(oa.get("clients", []) + ob.get("clients", []))
                    ),
                })
            elif oa:
                # Unpaired A
                merged.append({
                    **oa,
                    "is_twin": True,
                    "twin_pair": pair_key,
                    "twin_outputs": [{"sku": sku_a, "qty": oa["qty"]}],
                })
            else:
                # Unpaired B
                assert ob is not None
                merged.append({
                    **ob,
                    "is_twin": True,
                    "twin_pair": pair_key,
                    "twin_outputs": [{"sku": sku_b, "qty": ob["qty"]}],
                })

    return standalone + merged


def _tag_non_twin(order: dict) -> dict:
    """Tag a non-twin order with is_twin=False."""
    return {**order, "is_twin": False, "twin_outputs": None}
