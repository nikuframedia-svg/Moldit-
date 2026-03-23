"""Demand grouper — sections 2.2-2.9 of the spec.

Converts EngineData.ops into SkuBuckets grouped by ToolGroup per machine.
Includes twin merge (cross-EDD pairing).
"""

from __future__ import annotations

import math
from collections import defaultdict

from ..scheduling.types import EOp, ETool, TwinGroup
from .constants import BUCKET_WINDOW, DEFAULT_OEE
from .types import SkuBucket, ToolGroup


def group_demand_into_buckets(
    ops: list[EOp],
    tool_map: dict[str, ETool],
    twin_groups: list[TwinGroup],
    workdays: list[bool],
    n_days: int,
    order_based: bool = True,
    moves: dict[str, str] | None = None,
    m_st: dict[str, str] | None = None,
    t_st: dict[str, str] | None = None,
) -> dict[str, list[ToolGroup]]:
    """Convert ops → ToolGroups per machine.

    Returns: {machine_id: [ToolGroup, ...]} sorted by EDD within each machine.
    """
    moves = moves or {}
    m_st = m_st or {}
    t_st = t_st or {}

    # machine_id → tool_key → ToolGroup
    machine_groups: dict[str, dict[str, ToolGroup]] = defaultdict(dict)

    for op in ops:
        tool = tool_map.get(op.t)
        if tool is None or tool.pH <= 0:
            continue

        total_demand = sum(max(v, 0) for v in op.d) + op.atr
        if total_demand <= 0:
            continue

        # 2.2 Effective machine
        eff_m = moves.get(op.id, op.m)

        # 2.3 Check tool/machine status
        if t_st.get(op.t) == "down":
            continue
        if m_st.get(eff_m) == "down":
            continue

        oee = tool.oee if tool.oee else DEFAULT_OEE
        has_alt = bool(tool.alt and tool.alt != "-")
        alt_m = tool.alt if has_alt else None

        # 2.4 Backlog bucket
        if op.atr > 0:
            bkt = _make_bucket(
                op,
                tool,
                eff_m,
                op.atr,
                op.atr,
                0,
                oee,
                has_alt,
                alt_m,
                order_based,
            )
            _add_to_group(machine_groups, eff_m, bkt)

        # 2.5 Bucket daily demand
        buckets = _bucket_demand(op, tool, eff_m, oee, has_alt, alt_m, order_based, workdays)
        for bkt in buckets:
            _add_to_group(machine_groups, eff_m, bkt)

    # Merge twin buckets
    result: dict[str, list[ToolGroup]] = {}
    for mid, gmap in machine_groups.items():
        groups = list(gmap.values())
        result[mid] = groups

    if twin_groups:
        _merge_twin_buckets(result, twin_groups, tool_map)

    # Sort groups by EDD within each machine
    for mid in result:
        result[mid].sort(key=lambda g: g.edd)

    return result


def _bucket_demand(
    op: EOp,
    tool: ETool,
    machine_id: str,
    oee: float,
    has_alt: bool,
    alt_m: str | None,
    order_based: bool,
    workdays: list[bool],
) -> list[SkuBucket]:
    """Section 2.5: Convert op.d[] into SkuBuckets."""
    buckets: list[SkuBucket] = []
    accum_qty = 0
    accum_wdays = 0
    first_day = -1

    for day_idx, qty in enumerate(op.d):
        if qty <= 0:
            continue

        if order_based:
            # Each day with demand = 1 bucket
            bkt = _make_bucket(
                op,
                tool,
                machine_id,
                qty,
                qty,
                day_idx,
                oee,
                has_alt,
                alt_m,
                order_based,
            )
            buckets.append(bkt)
            continue

        # Accumulation mode
        accum_qty += qty
        if first_day < 0:
            first_day = day_idx
        if day_idx < len(workdays) and workdays[day_idx]:
            accum_wdays += 1

        emit = False
        if tool.lt > 0 and accum_qty >= tool.lt:
            emit = True
        elif tool.lt <= 0 and accum_wdays >= BUCKET_WINDOW:
            emit = True

        if emit:
            bkt = _make_bucket(
                op,
                tool,
                machine_id,
                accum_qty,
                accum_qty,
                day_idx,
                oee,
                has_alt,
                alt_m,
                order_based,
            )
            buckets.append(bkt)
            accum_qty = 0
            accum_wdays = 0
            first_day = -1

    # Emit remainder
    if accum_qty > 0 and not order_based:
        last_day = -1
        for i in range(len(op.d) - 1, -1, -1):
            if op.d[i] > 0:
                last_day = i
                break
        if last_day >= 0:
            bkt = _make_bucket(
                op,
                tool,
                machine_id,
                accum_qty,
                accum_qty,
                last_day,
                oee,
                has_alt,
                alt_m,
                order_based,
            )
            buckets.append(bkt)

    return buckets


def _make_bucket(
    op: EOp,
    tool: ETool,
    machine_id: str,
    qty: int,
    total_qty: int,
    edd: int,
    oee: float,
    has_alt: bool,
    alt_m: str | None,
    order_based: bool,
) -> SkuBucket:
    """Section 2.6: Create a SkuBucket with production time calculation."""
    # Eco lot rounding (only in non-order-based mode)
    if not order_based and tool.lt > 0:
        prod_qty = math.ceil(total_qty / tool.lt) * tool.lt
    else:
        prod_qty = total_qty

    # Production time: (prod_qty / pH) * 60 / OEE
    prod_min = (prod_qty / tool.pH) * 60.0 / oee

    return SkuBucket(
        op_id=op.id,
        tool_id=tool.id,
        sku=op.sku,
        nm=op.nm,
        machine_id=machine_id,
        qty=total_qty,
        prod_qty=prod_qty,
        prod_min=prod_min,
        edd=edd,
        setup_min=tool.sH * 60.0,
        operators=tool.op,
        pH=tool.pH,
        calco=tool.calco,
        has_alt=has_alt,
        alt_m=alt_m,
        mp=tool.mp,
        stk=op.stk or 0,
        lt=tool.lt,
        atr=op.atr,
        oee=oee,
    )


def _add_to_group(
    machine_groups: dict[str, dict[str, ToolGroup]],
    machine_id: str,
    bucket: SkuBucket,
) -> None:
    """Section 2.7: Add bucket to its ToolGroup (same tool + machine + EDD)."""
    gmap = machine_groups[machine_id]
    key = f"{bucket.tool_id}|{bucket.edd}"
    if key not in gmap:
        gmap[key] = ToolGroup(
            tool_id=bucket.tool_id,
            machine_id=machine_id,
            edd=bucket.edd,
            setup_min=bucket.setup_min,
            total_prod_min=0.0,
            buckets=[],
        )
    grp = gmap[key]
    grp.buckets.append(bucket)
    grp.total_prod_min += bucket.prod_min


def _merge_twin_buckets(
    machine_groups: dict[str, list[ToolGroup]],
    twin_groups: list[TwinGroup],
    tool_map: dict[str, ETool],
) -> None:
    """Section 2.9: Cross-EDD twin merge.

    For each twin pair, pair buckets 1st-1st, 2nd-2nd by EDD.
    Merged: edd=min, qty=max, time=one run. Unpaired stay solo.
    """
    for tg in twin_groups:
        machine_id = tg.machine
        groups = machine_groups.get(machine_id, [])
        if not groups:
            continue

        # Collect buckets for each twin
        buckets_a: list[SkuBucket] = []
        buckets_b: list[SkuBucket] = []
        for grp in groups:
            for bkt in grp.buckets:
                if bkt.op_id == tg.op_id1:
                    buckets_a.append(bkt)
                elif bkt.op_id == tg.op_id2:
                    buckets_b.append(bkt)

        if not buckets_a or not buckets_b:
            continue

        # Sort by EDD
        buckets_a.sort(key=lambda b: b.edd)
        buckets_b.sort(key=lambda b: b.edd)

        # Pair sequentially
        n_pairs = min(len(buckets_a), len(buckets_b))
        paired_ids: set[int] = set()
        tool = tool_map.get(tg.tool)
        oee = tool.oee if tool and tool.oee else DEFAULT_OEE

        for i in range(n_pairs):
            a = buckets_a[i]
            b = buckets_b[i]
            paired_ids.add(id(a))
            paired_ids.add(id(b))

            # Merged bucket: edd = min, qty = max
            merged_edd = min(a.edd, b.edd)
            run_qty = max(a.qty, b.qty)
            prod_qty = run_qty
            if not True and a.lt > 0:  # order_based always true in our pipeline
                prod_qty = math.ceil(run_qty / a.lt) * a.lt
            prod_min = (prod_qty / a.pH) * 60.0 / oee

            co_group_id = f"twin-{tg.op_id1}-{tg.op_id2}-{i}"

            # Modify bucket A to be the merged leader
            # Both twins get run_qty (max) — machine produces max for both
            # Surplus goes to stock (per CLAUDE.md: "Excedente → stock")
            a.edd = merged_edd
            a.prod_qty = prod_qty
            a.prod_min = prod_min
            a.is_twin_production = True
            a.twin_partner_op_id = b.op_id
            a.co_production_group_id = co_group_id
            a.twin_outputs = [
                (a.op_id, a.sku, run_qty),
                (b.op_id, b.sku, run_qty),
            ]

            # Mark B for removal (its production is covered by A)
            b.prod_min = 0
            b.is_twin_production = True
            b.twin_partner_op_id = a.op_id
            b.co_production_group_id = co_group_id

        # Remove zero-prod-min twin followers from groups
        for grp in groups:
            grp.buckets = [
                bkt for bkt in grp.buckets if not (bkt.is_twin_production and bkt.prod_min == 0)
            ]
            grp.total_prod_min = sum(bkt.prod_min for bkt in grp.buckets)

        # Remove empty groups
        machine_groups[machine_id] = [g for g in groups if g.buckets]
