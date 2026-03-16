"""Block factory functions — port of scheduler/block-factories.ts.

Creates blocked, overflow, and infeasible Block instances.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..constants import S0
from ..types import Block

if TYPE_CHECKING:
    from .demand_grouper import SkuBucket, ToolGroup


def mk_blocked(sk: SkuBucket, grp: ToolGroup, di: int, reason: str) -> Block:
    return Block(
        op_id=sk["op_id"],
        tool_id=grp["tool_id"],
        sku=sk["sku"],
        nm=sk["nm"],
        machine_id=grp["machine_id"],
        orig_m=sk["orig_m"],
        day_idx=di,
        edd_day=sk["edd"],
        qty=0,
        prod_min=0,
        setup_min=0,
        operators=sk["operators"],
        blocked=True,
        reason=reason,
        moved=sk["moved"],
        has_alt=sk["has_alt"],
        alt_m=sk.get("alt_m"),
        mp=sk.get("mp"),
        stk=sk.get("stk", 0),
        lt=sk.get("lt", 0),
        atr=sk.get("atr", 0),
        start_min=S0,
        end_min=S0,
        type="blocked",
        shift="X",
    )


def mk_overflow(sk: SkuBucket, grp: ToolGroup, di: int, of_min: float) -> Block:
    return Block(
        op_id=sk["op_id"],
        tool_id=grp["tool_id"],
        sku=sk["sku"],
        nm=sk["nm"],
        machine_id=grp["machine_id"],
        orig_m=sk["orig_m"],
        day_idx=di,
        edd_day=sk["edd"],
        qty=0,
        prod_min=int(sk["prod_min"]),
        setup_min=0,
        operators=sk["operators"],
        blocked=False,
        moved=sk["moved"],
        has_alt=sk["has_alt"],
        alt_m=sk.get("alt_m"),
        mp=sk.get("mp"),
        stk=sk.get("stk", 0),
        lt=sk.get("lt", 0),
        atr=sk.get("atr", 0),
        start_min=S0,
        end_min=S0,
        type="overflow",
        shift="X",
        overflow=True,
        overflow_min=int(of_min),
    )


def mk_infeasible(
    sk: SkuBucket,
    grp: ToolGroup,
    di: int,
    reason: str,
    detail: str,
) -> Block:
    return Block(
        op_id=sk["op_id"],
        tool_id=grp["tool_id"],
        sku=sk["sku"],
        nm=sk["nm"],
        machine_id=grp["machine_id"],
        orig_m=sk["orig_m"],
        day_idx=di,
        edd_day=sk["edd"],
        qty=0,
        prod_min=int(sk["prod_min"]),
        setup_min=0,
        operators=sk["operators"],
        blocked=False,
        moved=sk["moved"],
        has_alt=sk["has_alt"],
        alt_m=sk.get("alt_m"),
        mp=sk.get("mp"),
        stk=sk.get("stk", 0),
        lt=sk.get("lt", 0),
        atr=sk.get("atr", 0),
        start_min=S0,
        end_min=S0,
        type="infeasible",
        shift="X",
        infeasibility_reason=reason,
        infeasibility_detail=detail,
    )
