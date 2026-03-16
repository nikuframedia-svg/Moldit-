"""Demand grouper (Phase 1) — port of scheduler/demand-grouper.ts.

Groups operations into tool-groups with delivery buckets.
"""

from __future__ import annotations

import math
from typing import Any, TypedDict

from ..constants import BUCKET_WINDOW, DEFAULT_OEE
from ..types import AdvanceAction, EOp, ETool, MoveAction, TwinGroup
from .backward_scheduler import EarliestStartEntry

# ── Internal types (dicts for performance, not Pydantic) ──


class SkuBucket(TypedDict, total=False):
    op_id: str
    sku: str
    nm: str
    atr: int
    total_qty: int
    prod_qty: int
    prod_min: float
    edd: int
    operators: int
    stk: int
    lt: int
    mp: str | None
    blocked: bool
    reason: str | None
    has_alt: bool
    alt_m: str | None
    moved: bool
    orig_m: str
    earliest_start: int | None
    is_twin_production: bool
    co_production_group_id: str | None
    twin_outputs: list[dict[str, Any]] | None


class ToolGroup(TypedDict, total=False):
    tool_id: str
    machine_id: str
    edd: int
    setup_min: float
    total_prod_min: float
    skus: list[SkuBucket]
    tool: ETool


# ── Helpers ──


def _apply_advance_override(
    edd: int,
    op_id: str,
    advance_overrides: list[AdvanceAction] | None,
    workdays: list[bool] | None,
) -> int:
    """Shift EDD earlier by advance override working days."""
    if not advance_overrides:
        return edd
    adv = None
    for a in advance_overrides:
        if a.op_id == op_id and a.target_edd == edd:
            adv = a
            break
    if adv is None:
        for a in advance_overrides:
            if a.op_id == op_id and a.target_edd is None:
                adv = a
                break
    if adv is None or adv.advance_days <= 0:
        return edd

    new_edd = edd
    days_back = 0
    for d in range(edd - 1, -1, -1):
        is_work = not workdays or workdays[d]
        if is_work:
            days_back += 1
            new_edd = d
        if days_back >= adv.advance_days:
            break
    return max(0, new_edd)


def _mk_sku_bucket(
    op: EOp,
    tool: ETool,
    acc_qty: int,
    edd: int,
    mv: MoveAction | None,
    t_down: bool,
    m_down: bool,
    earliest_start: int | None = None,
    oee: float = DEFAULT_OEE,
    skip_lot_economic: bool = False,
) -> SkuBucket:
    lt = tool.lt
    prod_qty = (
        acc_qty if skip_lot_economic else (math.ceil(acc_qty / lt) * lt if lt > 0 else acc_qty)
    )
    effective_oee = tool.oee if tool.oee is not None else oee
    prod_min = ((prod_qty / tool.pH) * 60) / effective_oee
    return SkuBucket(
        op_id=op.id,
        sku=op.sku,
        nm=op.nm,
        atr=0,
        total_qty=acc_qty,
        prod_qty=prod_qty,
        prod_min=prod_min,
        edd=edd,
        operators=tool.op,
        stk=op.stk if op.stk is not None else tool.stk,
        lt=tool.lt,
        mp=tool.mp,
        blocked=t_down or m_down,
        reason="tool_down" if t_down else ("machine_down" if m_down else None),
        moved=mv is not None,
        has_alt=bool(tool.alt and tool.alt != "-"),
        alt_m=tool.alt if tool.alt != "-" else None,
        orig_m=op.m,
        earliest_start=earliest_start,
    )


# ── Main export ──


def group_demand_into_buckets(
    ops: list[EOp],
    m_st: dict[str, str],
    t_st: dict[str, str],
    moves: list[MoveAction],
    tool_map: dict[str, ETool],
    workdays: list[bool] | None,
    n_days: int,
    earliest_starts: dict[str, EarliestStartEntry] | None = None,
    advance_overrides: list[AdvanceAction] | None = None,
    twin_groups: list[TwinGroup] | None = None,
    order_based: bool = False,
    oee: float = DEFAULT_OEE,
    third_shift: bool = False,
) -> dict[str, list[ToolGroup]]:
    """Groups operations into tool-groups with delivery buckets.

    Returns dict[machine_id, list[ToolGroup]].
    """
    m_groups: dict[str, list[ToolGroup]] = {}

    def add_to_group(eff_m: str, tool: ETool, sb: SkuBucket) -> None:
        if eff_m not in m_groups:
            m_groups[eff_m] = []
        # Find or create ToolGroup for this tool + EDD
        for grp in m_groups[eff_m]:
            if grp["tool_id"] == tool.id and grp["edd"] == sb["edd"]:
                grp["skus"].append(sb)
                grp["total_prod_min"] += sb["prod_min"]
                return
        new_grp: ToolGroup = {
            "tool_id": tool.id,
            "machine_id": eff_m,
            "edd": sb["edd"],
            "setup_min": tool.sH * 60,
            "total_prod_min": sb["prod_min"],
            "skus": [sb],
            "tool": tool,
        }
        m_groups[eff_m].append(new_grp)

    for op in ops:
        tool = tool_map.get(op.t)
        if not tool:
            continue

        mv = next((v for v in moves if v.op_id == op.id), None)
        eff_m = mv.to_m if mv else op.m
        total_qty = sum(max(v, 0) for v in op.d) + max(op.atr, 0)
        if total_qty <= 0:
            continue
        if tool.pH <= 0:
            continue

        # Tool/machine down (binary, no timelines in Python port for now)
        t_down = t_st.get(op.t) == "down"
        m_down = m_st.get(eff_m) == "down"

        es_entry = earliest_starts.get(op.id) if earliest_starts else None

        # Backlog
        if op.atr > 0:
            sb = _mk_sku_bucket(
                op,
                tool,
                op.atr,
                0,
                mv,
                t_down,
                m_down,
                es_entry.earliest_day_idx if es_entry else None,
                oee,
                bool(order_based),
            )
            sb["atr"] = op.atr
            add_to_group(eff_m, tool, sb)

        # Split daily demand into buckets
        has_lt = tool.lt > 0
        acc_qty = 0
        bucket_last_day = -1
        bucket_work_days = 0

        for i in range(n_days):
            day_qty = max(op.d[i] if i < len(op.d) else 0, 0)
            is_work = not workdays or workdays[i]
            if day_qty <= 0:
                continue

            bucket_last_day = i
            acc_qty += day_qty
            if is_work:
                bucket_work_days += 1

            # Check if this is the last demand day
            is_last_demand = all(v <= 0 for v in op.d[i + 1 :])

            should_emit = (
                order_based
                or is_last_demand
                or (has_lt and acc_qty >= tool.lt)
                or (not has_lt and bucket_work_days >= BUCKET_WINDOW)
            )

            if should_emit and acc_qty > 0:
                edd = _apply_advance_override(bucket_last_day, op.id, advance_overrides, workdays)
                sb = _mk_sku_bucket(
                    op,
                    tool,
                    acc_qty,
                    edd,
                    mv,
                    t_down,
                    m_down,
                    es_entry.earliest_day_idx if es_entry else None,
                    oee,
                    bool(order_based),
                )
                add_to_group(eff_m, tool, sb)
                acc_qty = 0
                bucket_last_day = -1
                bucket_work_days = 0

        # Flush remaining
        if acc_qty > 0 and bucket_last_day >= 0:
            flush_edd = _apply_advance_override(bucket_last_day, op.id, advance_overrides, workdays)
            sb = _mk_sku_bucket(
                op,
                tool,
                acc_qty,
                flush_edd,
                mv,
                t_down,
                m_down,
                es_entry.earliest_day_idx if es_entry else None,
                oee,
                bool(order_based),
            )
            add_to_group(eff_m, tool, sb)

    # Demand conservation check
    for op in ops:
        tool = tool_map.get(op.t)
        if not tool or tool.pH <= 0:
            continue
        expected = sum(max(v, 0) for v in op.d) + max(op.atr, 0)
        if expected <= 0:
            continue
        bucketed = 0
        for groups in m_groups.values():
            for g in groups:
                for sk in g["skus"]:
                    if sk["op_id"] == op.id:
                        bucketed += sk["total_qty"]
        if bucketed != expected:
            raise ValueError(
                f"[demand-grouper] Conservation violation: op={op.id} expected={expected} bucketed={bucketed}"
            )

    # Post-process: merge twin pairs
    if twin_groups:
        _merge_twin_buckets(m_groups, twin_groups, oee, bool(order_based))

    return m_groups


# ── Twin merge (inline port of twin-merge.ts) ──


def _merge_twin_buckets(
    m_groups: dict[str, list[ToolGroup]],
    twin_groups: list[TwinGroup],
    oee: float,
    skip_lot_economic: bool = False,
) -> None:
    """Merge twin SkuBucket pairs into co-production buckets (mutates in-place)."""
    for tg in twin_groups:
        canonical_id = "|".join(sorted([tg.sku1, tg.sku2]))

        for machine_id in list(m_groups.keys()):
            groups = m_groups[machine_id]

            # Collect ALL buckets for each twin SKU
            buckets_a: list[tuple[SkuBucket, ToolGroup]] = []
            buckets_b: list[tuple[SkuBucket, ToolGroup]] = []

            for grp in groups:
                if grp["tool_id"] != tg.tool:
                    continue
                for sk in grp["skus"]:
                    if sk["sku"] == tg.sku1 and sk["op_id"] == tg.op_id1:
                        buckets_a.append((sk, grp))
                    elif sk["sku"] == tg.sku2 and sk["op_id"] == tg.op_id2:
                        buckets_b.append((sk, grp))

            if not buckets_a or not buckets_b:
                continue

            # Sort by EDD ascending
            buckets_a.sort(key=lambda x: x[0]["edd"])
            buckets_b.sort(key=lambda x: x[0]["edd"])

            pair_count = min(len(buckets_a), len(buckets_b))
            for i in range(pair_count):
                a, grp_a = buckets_a[i]
                b, grp_b = buckets_b[i]

                # Remove originals
                grp_a["skus"] = [sk for sk in grp_a["skus"] if sk is not a]
                grp_b["skus"] = [sk for sk in grp_b["skus"] if sk is not b]

                # Co-production
                run_qty = max(a["total_qty"], b["total_qty"])
                tool = grp_a["tool"]
                lt = tool.lt
                prod_qty = (
                    run_qty
                    if skip_lot_economic
                    else (math.ceil(run_qty / lt) * lt if lt > 0 else run_qty)
                )
                effective_oee = tool.oee if tool.oee is not None else oee
                prod_min = ((prod_qty / tool.pH) * 60) / effective_oee
                merged_edd = min(a["edd"], b["edd"])

                primary = a if a["sku"] < b["sku"] else b
                merged: SkuBucket = {**primary}
                merged["total_qty"] = run_qty
                merged["prod_qty"] = prod_qty
                merged["prod_min"] = prod_min
                merged["is_twin_production"] = True
                merged["co_production_group_id"] = canonical_id
                merged["twin_outputs"] = [
                    {
                        "op_id": a["op_id"],
                        "sku": a["sku"],
                        "nm": a["nm"],
                        "total_qty": a["total_qty"],
                        "atr": a.get("atr", 0),
                    },
                    {
                        "op_id": b["op_id"],
                        "sku": b["sku"],
                        "nm": b["nm"],
                        "total_qty": b["total_qty"],
                        "atr": b.get("atr", 0),
                    },
                ]
                merged["edd"] = merged_edd
                merged["atr"] = max(a.get("atr", 0), b.get("atr", 0))

                # Add to correct group
                target_grp = None
                for g in groups:
                    if g["tool_id"] == tg.tool and g["edd"] == merged_edd:
                        target_grp = g
                        break
                if target_grp is None:
                    target_grp = {
                        "tool_id": tg.tool,
                        "machine_id": machine_id,
                        "edd": merged_edd,
                        "setup_min": tool.sH * 60,
                        "total_prod_min": 0.0,
                        "skus": [],
                        "tool": tool,
                    }
                    groups.append(target_grp)
                target_grp["skus"].append(merged)

            # Cleanup
            m_groups[machine_id] = [g for g in groups if g["skus"]]
            for g in m_groups[machine_id]:
                g["total_prod_min"] = sum(sk["prod_min"] for sk in g["skus"])
