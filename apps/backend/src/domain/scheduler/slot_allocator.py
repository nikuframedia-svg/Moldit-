"""Slot allocator — section 4 of the spec.

Core scheduling loop: places ToolGroups onto machine timelines
respecting all 4 constraints (SetupCrew, ToolTimeline, CalcoTimeline, OperatorPool).
"""

from __future__ import annotations

import math
from typing import Any

from ..scheduling.constraints import CalcoTimeline, OperatorPool, SetupCrew, ToolTimeline
from ..scheduling.types import Block, DecisionEntry, EngineData, TwinOutput
from .constants import MAX_SETUP_ATTEMPTS, MINUTES_PER_DAY, S0, S1, S2, T1
from .dispatch_rules import merge_consecutive_tools, order_machines_by_urgency, sort_groups
from .types import MachineCursor, SkuBucket, ToolGroup

# ── Time helpers ──


def to_abs(day: int, minute: int) -> int:
    """Convert (dayIdx, minuteInDay) to absolute minute from day 0."""
    return day * MINUTES_PER_DAY + minute


def from_abs(abs_min: int) -> tuple[int, int]:
    """Convert absolute minute → (dayIdx, minuteInDay)."""
    return divmod(abs_min, MINUTES_PER_DAY)


def cur_shift(minute: int) -> str:
    """Determine shift from minute within day."""
    if minute < T1:
        return "X"
    elif minute < S1:
        return "Y"
    return "Z"


def shift_end(minute: int, third_shift: bool) -> int:
    """End of current shift."""
    if minute < T1:
        return T1
    if minute < S1:
        return S1
    return S2 if third_shift else S1


# ── Cursor operations ──


def _first_workday(workdays: list[bool]) -> int:
    """Find first workday index."""
    for i, wd in enumerate(workdays):
        if wd:
            return i
    return 0


def _next_workday(day: int, workdays: list[bool]) -> int:
    """Find next workday after day."""
    for i in range(day + 1, len(workdays)):
        if workdays[i]:
            return i
    return -1  # no more workdays


def _advance_cursor(cursor: MachineCursor, workdays: list[bool]) -> bool:
    """Advance cursor to next available slot. Returns False if no capacity left."""
    if cursor.minute >= cursor.day_end:
        nwd = _next_workday(cursor.day, workdays)
        if nwd < 0:
            return False
        cursor.day = nwd
        cursor.minute = S0
    return True


def _push_shift(cursor: MachineCursor, workdays: list[bool]) -> bool:
    """Push to next shift boundary or next workday."""
    if cursor.minute < T1:
        cursor.minute = T1
        return True
    if cursor.minute < S1:
        if cursor.third_shift:
            cursor.minute = S1
            return True
        nwd = _next_workday(cursor.day, workdays)
        if nwd < 0:
            return False
        cursor.day = nwd
        cursor.minute = S0
        return True
    # Already past S1 (Z shift)
    nwd = _next_workday(cursor.day, workdays)
    if nwd < 0:
        return False
    cursor.day = nwd
    cursor.minute = S0
    return True


# ── Main scheduling function ──


def schedule_machines(
    machine_groups: dict[str, list[ToolGroup]],
    engine_data: EngineData,
    settings: dict[str, Any] | None = None,
    rule: str = "EDD",
    k1: float = 1.5,
    k2: float = 0.5,
    trace: list[dict[str, Any]] | None = None,
) -> tuple[list[Block], list[DecisionEntry]]:
    """Section 4: Schedule all machines. Returns (blocks, decisions)."""
    settings = settings or {}
    workdays = engine_data.workdays
    third_shift = engine_data.third_shift
    tool_map = engine_data.tool_map

    blocks: list[Block] = []
    decisions: list[DecisionEntry] = []

    # Initialize constraints
    setup_crew = SetupCrew()
    tool_tl = ToolTimeline()
    calco_tl = CalcoTimeline()
    op_pool = OperatorPool(engine_data.workforce_config)

    # Order machines by urgency
    machine_order = order_machines_by_urgency(machine_groups, rule)

    for mid in machine_order:
        groups = machine_groups.get(mid, [])
        if not groups:
            continue

        # Sort groups by dispatch rule
        sorted_groups = sort_groups(groups, rule, k1, k2)
        sorted_groups = merge_consecutive_tools(sorted_groups)

        # Initialize cursor
        cursor = MachineCursor(
            machine_id=mid,
            day=_first_workday(workdays),
            minute=S0,
            third_shift=third_shift,
        )

        for grp in sorted_groups:
            if not _advance_cursor(cursor, workdays):
                # No capacity: all buckets overflow
                for bkt in grp.buckets:
                    blocks.append(_mk_overflow(bkt, cursor.day, bkt.prod_min))
                    if trace is not None:
                        trace.append(
                            {
                                "type": "overflow",
                                "op_id": bkt.op_id,
                                "machine": mid,
                                "overflow_min": round(bkt.prod_min, 1),
                                "reason": "no capacity left in horizon",
                            }
                        )
                continue

            # Setup (if tool changes)
            setup_ok = True
            setup_s_val: int | None = None
            setup_e_val: int | None = None
            if grp.tool_id != cursor.last_tool and grp.setup_min > 0:
                setup_ok = _place_setup(
                    cursor,
                    grp,
                    setup_crew,
                    tool_tl,
                    workdays,
                )
                if not setup_ok:
                    for bkt in grp.buckets:
                        blocks.append(
                            _mk_infeasible(
                                bkt,
                                cursor.day,
                                "SETUP_CREW_EXHAUSTED",
                                "Could not place setup within 12 attempts",
                            )
                        )
                        if trace is not None:
                            trace.append(
                                {
                                    "type": "constraint_block",
                                    "op_id": bkt.op_id,
                                    "machine": mid,
                                    "constraint": "setup_crew",
                                    "detail": f"setup for tool {grp.tool_id} failed after 12 attempts",
                                }
                            )
                    continue
                # Setup placed: record positions
                setup_dur = int(math.ceil(grp.setup_min))
                setup_s_val = to_abs(cursor.day, cursor.minute - setup_dur)
                setup_e_val = to_abs(cursor.day, cursor.minute)

            cursor.last_tool = grp.tool_id

            # Production per SKU
            is_first = True
            for bkt in grp.buckets:
                prod_blocks = _allocate_production(
                    bkt,
                    cursor,
                    tool_tl,
                    calco_tl,
                    op_pool,
                    workdays,
                    setup_s_val if is_first else None,
                    setup_e_val if is_first else None,
                    int(math.ceil(grp.setup_min)) if is_first else 0,
                    trace=trace,
                )
                blocks.extend(prod_blocks)
                is_first = False

    return blocks, decisions


def _place_setup(
    cursor: MachineCursor,
    grp: ToolGroup,
    setup_crew: SetupCrew,
    tool_tl: ToolTimeline,
    workdays: list[bool],
) -> bool:
    """Section 4.4: Place setup for a tool group. Returns True if successful."""
    setup_dur = int(math.ceil(grp.setup_min))

    for _attempt in range(MAX_SETUP_ATTEMPTS):
        if not _advance_cursor(cursor, workdays):
            return False

        sh_end = shift_end(cursor.minute, cursor.third_shift)
        if setup_dur > sh_end - cursor.minute:
            if not _push_shift(cursor, workdays):
                return False
            continue

        abs_start = to_abs(cursor.day, cursor.minute)
        abs_end = to_abs(cursor.day, sh_end)

        # SetupCrew: max 1 setup at a time
        slot = setup_crew.find_next_available(abs_start, setup_dur, abs_end)
        if slot == -1:
            if not _push_shift(cursor, workdays):
                return False
            continue

        # ToolTimeline: tool not on another machine
        t_slot = tool_tl.find_next_available(
            grp.tool_id,
            slot,
            setup_dur,
            abs_end,
            cursor.machine_id,
        )
        if t_slot == -1:
            if not _push_shift(cursor, workdays):
                return False
            continue

        if t_slot > slot:
            # Tool available later — adjust cursor
            _, new_min = from_abs(t_slot)
            cursor.minute = new_min
            continue

        # Book
        setup_crew.book(slot, slot + setup_dur, cursor.machine_id)
        tool_tl.book(grp.tool_id, slot, slot + setup_dur, cursor.machine_id)
        _, new_min = from_abs(slot + setup_dur)
        cursor.day, _ = from_abs(slot + setup_dur)
        cursor.minute = new_min
        return True

    return False


def _allocate_production(
    bkt: SkuBucket,
    cursor: MachineCursor,
    tool_tl: ToolTimeline,
    calco_tl: CalcoTimeline,
    op_pool: OperatorPool,
    workdays: list[bool],
    setup_s: int | None,
    setup_e: int | None,
    setup_min_val: int,
    trace: list[dict[str, Any]] | None = None,
) -> list[Block]:
    """Section 4.5: Allocate production time for one SKU bucket."""
    result: list[Block] = []
    rem = bkt.prod_min
    q_rem = bkt.prod_qty
    ppm = bkt.prod_qty / max(bkt.prod_min, 0.01)  # pieces per minute
    is_first = True
    twin_assigned: dict[str, int] = {}  # track assigned twin output qty per op

    # Ensure at least 1 minute for tiny production (e.g., 5 pcs at pH=1441)
    if 0 < rem < 1.0:
        rem = 1.0

    while rem > 0.5:  # tolerance for float rounding
        if not _advance_cursor(cursor, workdays):
            break

        sh_end_val = shift_end(cursor.minute, cursor.third_shift)
        raw_avail = sh_end_val - cursor.minute
        if raw_avail <= 0:
            if not _push_shift(cursor, workdays):
                break
            continue

        avail = raw_avail  # capF handled via machine timelines if present

        # CalcoTimeline
        if bkt.calco:
            abs_start = to_abs(cursor.day, cursor.minute)
            abs_end = to_abs(cursor.day, sh_end_val)
            cs = calco_tl.find_next_available(
                bkt.calco, abs_start, math.ceil(min(rem, avail)), abs_end
            )
            if cs == -1:
                cursor.minute = sh_end_val
                continue
            if cs > abs_start:
                _, cursor.minute = from_abs(cs)
                continue

        # ToolTimeline
        alloc = math.ceil(min(rem, avail))
        if alloc <= 0:
            # Fractional remainder — treat as done
            break
        abs_start = to_abs(cursor.day, cursor.minute)
        abs_end = to_abs(cursor.day, sh_end_val)
        t_slot = tool_tl.find_next_available(
            bkt.tool_id,
            abs_start,
            alloc,
            abs_end,
            cursor.machine_id,
        )
        if t_slot == -1:
            cursor.minute = sh_end_val
            continue
        if t_slot > abs_start:
            _, cursor.minute = from_abs(t_slot)
            continue

        # OperatorPool (advisory)
        op_warning = False
        op_check = op_pool.check_capacity(
            cursor.day,
            cursor.minute,
            cursor.minute + alloc,
            bkt.operators,
            cursor.machine_id,
        )
        if op_check.is_warning:
            op_warning = True

        # Compute qty
        if rem <= alloc + 0.5:
            b_qty = q_rem
        else:
            b_qty = round(alloc * ppm)

        # Book constraints
        tool_tl.book(bkt.tool_id, abs_start, abs_start + alloc, cursor.machine_id)
        if bkt.calco:
            calco_tl.book(bkt.calco, abs_start, abs_start + alloc, cursor.machine_id)
        op_pool.book(
            cursor.day, cursor.minute, cursor.minute + alloc, bkt.operators, cursor.machine_id
        )

        # Build twin outputs — proportional to sub-block qty
        twin_outputs = None
        if bkt.is_twin_production and bkt.twin_outputs:
            if rem <= alloc + 0.5:
                # Last sub-block: remainder = total - already assigned
                twin_outputs = [
                    TwinOutput(op_id=to[0], sku=to[1], qty=to[2] - twin_assigned.get(to[0], 0))
                    for to in bkt.twin_outputs
                ]
            else:
                scale = b_qty / max(bkt.prod_qty, 1)
                twin_outputs = [
                    TwinOutput(op_id=to[0], sku=to[1], qty=round(to[2] * scale))
                    for to in bkt.twin_outputs
                ]
            # Track assigned quantities
            for tout in twin_outputs:
                twin_assigned[tout.op_id] = twin_assigned.get(tout.op_id, 0) + tout.qty

        blk = Block(
            op_id=bkt.op_id,
            tool_id=bkt.tool_id,
            sku=bkt.sku,
            nm=bkt.nm,
            machine_id=cursor.machine_id,
            orig_m=bkt.machine_id,
            day_idx=cursor.day,
            start_min=cursor.minute,
            end_min=cursor.minute + alloc,
            shift=cur_shift(cursor.minute),
            qty=b_qty,
            prod_min=alloc,
            setup_min=setup_min_val if is_first else 0,
            setup_s=setup_s if is_first else None,
            setup_e=setup_e if is_first else None,
            operators=bkt.operators,
            edd_day=bkt.edd,
            type="ok",
            has_alt=bkt.has_alt,
            alt_m=bkt.alt_m,
            mp=bkt.mp,
            stk=bkt.stk,
            lt=bkt.lt,
            atr=bkt.atr,
            overflow=False,
            overflow_min=0,
            below_min_batch=bkt.lt > 0 and b_qty < bkt.lt,
            is_twin_production=bkt.is_twin_production,
            co_production_group_id=bkt.co_production_group_id,
            outputs=twin_outputs,
            operator_warning=op_warning,
            moved=cursor.machine_id != bkt.machine_id,
        )

        result.append(blk)
        rem -= alloc
        q_rem -= b_qty
        cursor.minute += alloc
        is_first = False

    # Remaining → overflow
    if rem > 0.5:
        result.append(_mk_overflow(bkt, cursor.day, rem))
        if trace is not None:
            trace.append(
                {
                    "type": "overflow",
                    "op_id": bkt.op_id,
                    "machine": cursor.machine_id,
                    "overflow_min": round(rem, 1),
                    "reason": "insufficient shift capacity",
                }
            )

    return result


# ── Block factories ──


def _mk_overflow(bkt: SkuBucket, day: int, overflow_min: float) -> Block:
    """Section 19: Create overflow block."""
    return Block(
        op_id=bkt.op_id,
        tool_id=bkt.tool_id,
        sku=bkt.sku,
        nm=bkt.nm,
        machine_id=bkt.machine_id,
        orig_m=bkt.machine_id,
        day_idx=day,
        start_min=0,
        end_min=0,
        shift="X",
        qty=0,
        prod_min=0,
        setup_min=0,
        operators=bkt.operators,
        edd_day=bkt.edd,
        type="overflow",
        overflow=True,
        overflow_min=int(math.ceil(overflow_min)),
        has_alt=bkt.has_alt,
        alt_m=bkt.alt_m,
        mp=bkt.mp,
        stk=bkt.stk,
        lt=bkt.lt,
        atr=bkt.atr,
    )


def _mk_infeasible(
    bkt: SkuBucket,
    day: int,
    reason: str,
    detail: str,
) -> Block:
    """Section 19: Create infeasible block."""
    return Block(
        op_id=bkt.op_id,
        tool_id=bkt.tool_id,
        sku=bkt.sku,
        nm=bkt.nm,
        machine_id=bkt.machine_id,
        orig_m=bkt.machine_id,
        day_idx=day,
        start_min=0,
        end_min=0,
        shift="X",
        qty=0,
        prod_min=0,
        setup_min=0,
        operators=bkt.operators,
        edd_day=bkt.edd,
        type="infeasible",
        infeasibility_reason=reason,
        infeasibility_detail=detail,
        has_alt=bkt.has_alt,
        alt_m=bkt.alt_m,
        mp=bkt.mp,
        stk=bkt.stk,
        lt=bkt.lt,
        atr=bkt.atr,
    )
