"""Slot allocator (Phase 2) — port of scheduler/slot-allocator.ts.

Core shift-by-shift, minute-by-minute allocation engine.
ALL constraints are HARD (except operator pool which is advisory).
Operations NEVER silently disappear.
"""

from __future__ import annotations

from ..constants import DAY_CAP, S0, S1, S2, T1
from ..types import Block, EMachine, InfeasibilityEntry, ShiftId, TwinOutput, WorkforceConfig
from ..utils import to_abs
from .block_factories import mk_blocked, mk_infeasible, mk_overflow
from .decision_registry import DecisionRegistry
from .demand_grouper import ToolGroup
from .timeline_constraints import (
    CalcoTimeline,
    SetupCrewSA,
    ToolTimelineSA,
    create_local_operator_pool,
)


def schedule_machines(
    *,
    m_groups: dict[str, list[ToolGroup]],
    mach_order: list[EMachine],
    m_st: dict[str, str],
    workdays: list[bool] | None,
    workforce_config: WorkforceConfig | None,
    n_days: int,
    third_shift: bool = False,
    registry: DecisionRegistry,
    overtime_map: dict[str, dict[int, int]] | None = None,
) -> tuple[list[Block], list[InfeasibilityEntry]]:
    """Phase 2: Schedule tool-group batches onto machines.

    Returns (blocks, infeasibilities).
    """
    blocks: list[Block] = []
    infeasibilities: list[InfeasibilityEntry] = []
    pool = create_local_operator_pool(workforce_config)
    setup_crew = SetupCrewSA()
    calco_tl = CalcoTimeline()
    tool_tl = ToolTimelineSA()

    # Working day indices
    w_days: list[int] = []
    for d in range(n_days):
        if not workdays or workdays[d]:
            w_days.append(d)
    if not w_days:
        return blocks, infeasibilities

    def next_w_day(d: int) -> int:
        try:
            idx = w_days.index(d)
            return w_days[idx + 1] if idx + 1 < len(w_days) else -1
        except ValueError:
            return -1

    base_day_end = S2 if third_shift else S1

    for mach in mach_order:
        m_id = mach.id
        groups = m_groups.get(m_id)
        if not groups:
            continue

        mach_ot = overtime_map.get(m_id) if overtime_map else None

        def get_day_end(day_idx: int) -> int:
            return base_day_end + (mach_ot.get(day_idx, 0) if mach_ot else 0)

        # Machine blanket-down
        if m_st.get(m_id) == "down":
            for g in groups:
                for sk in g["skus"]:
                    blocks.append(mk_blocked(sk, g, w_days[0], "machine_down"))
            continue

        c_day = w_days[0]
        c_min = S0
        last_tool: str | None = None

        def advance() -> bool:
            nonlocal c_day, c_min
            if c_min >= get_day_end(c_day):
                nd = next_w_day(c_day)
                if nd < 0:
                    return False
                c_day = nd
                c_min = S0
            return c_day < n_days

        def push_shift() -> bool:
            nonlocal c_day, c_min
            if c_min < T1:
                c_min = T1
                return True
            if c_min < S1 and third_shift:
                c_min = S1
                return True
            nd = next_w_day(c_day)
            if nd < 0:
                return False
            c_day = nd
            c_min = S0
            return True

        def cur_sh_end() -> int:
            if c_min < T1:
                return T1
            if c_min < S1:
                return S1
            return get_day_end(c_day)

        def cur_shift() -> ShiftId:
            if c_min < T1:
                return "X"
            if c_min < S1:
                return "Y"
            return "Z"

        for grp in groups:
            if not advance():
                # Overflow remaining
                for sk in grp["skus"]:
                    if sk.get("blocked"):
                        blocks.append(
                            mk_blocked(sk, grp, w_days[-1], sk.get("reason") or "tool_down")
                        )
                    else:
                        blocks.append(
                            mk_overflow(sk, grp, w_days[-1], grp["setup_min"] + sk["prod_min"])
                        )
                continue

            # Blocked tools
            if any(sk.get("blocked") for sk in grp["skus"]):
                for sk in grp["skus"]:
                    if sk.get("blocked"):
                        blocks.append(mk_blocked(sk, grp, c_day, sk.get("reason") or "tool_down"))
                continue

            # ── SETUP ──
            setup_s: int | None = None
            setup_e: int | None = None

            if grp["tool_id"] != last_tool and grp["setup_min"] > 0:
                placed = False
                saved_day = c_day
                saved_min = c_min
                setup_dur = int(grp["setup_min"])

                for _att in range(12):
                    if placed:
                        break
                    if not advance():
                        break
                    sh_end = cur_sh_end()

                    if setup_dur > sh_end - c_min:
                        if not push_shift():
                            break
                        continue

                    abs_start = to_abs(c_day, c_min)
                    abs_end = to_abs(c_day, sh_end)

                    # SetupCrew HARD
                    slot = setup_crew.find_next_available(abs_start, setup_dur, abs_end)
                    if slot == -1:
                        if not push_shift():
                            break
                        continue

                    # ToolTimeline HARD
                    tool_slot = tool_tl.find_next_available(
                        grp["tool_id"], slot, setup_dur, abs_end, m_id
                    )
                    if tool_slot == -1:
                        if not push_shift():
                            break
                        continue
                    if tool_slot > slot:
                        c_day = tool_slot // 1440
                        c_min = tool_slot % 1440
                        continue

                    c_day = slot // 1440
                    c_min = slot % 1440
                    setup_s = c_min
                    setup_e = c_min + setup_dur
                    setup_crew.book(slot, slot + setup_dur, m_id)
                    tool_tl.book(grp["tool_id"], slot, slot + setup_dur, m_id)
                    c_min = setup_e
                    placed = True

                if not placed:
                    c_day = saved_day
                    c_min = saved_min
                    for sk in grp["skus"]:
                        entry = InfeasibilityEntry(
                            op_id=sk["op_id"],
                            tool_id=grp["tool_id"],
                            machine_id=m_id,
                            reason="SETUP_CREW_EXHAUSTED",
                            detail=f"Setup for tool {grp['tool_id']} on {m_id}: no setup crew slot",
                            attempted_alternatives=["Tried 12 shift/day combinations"],
                            day_idx=saved_day,
                        )
                        infeasibilities.append(entry)
                        registry.record(
                            type="INFEASIBILITY_DECLARED",
                            op_id=sk["op_id"],
                            tool_id=grp["tool_id"],
                            machine_id=m_id,
                            day_idx=saved_day,
                            detail=entry.detail,
                            metadata={"reason": "SETUP_CREW_EXHAUSTED"},
                        )
                        blocks.append(
                            mk_infeasible(sk, grp, saved_day, "SETUP_CREW_EXHAUSTED", entry.detail)
                        )
                    continue

            # ── PRODUCTION per SKU ──
            total_sku_prod_min = sum(sk["prod_min"] for sk in grp["skus"])
            est_rem_days = len([d for d in w_days if d >= c_day])
            est_capacity = est_rem_days * DAY_CAP - max(0, c_min - S0)
            needs_proportional = len(grp["skus"]) > 1 and total_sku_prod_min > est_capacity

            first_sku = True
            for sk in grp["skus"]:
                rem = sk["prod_min"]
                q_rem = sk["prod_qty"]
                is_first = first_sku
                first_sku = False
                ppm = sk["prod_qty"] / sk["prod_min"] if sk["prod_min"] > 0 else 0
                twin_q_rem = (
                    [t["total_qty"] for t in sk["twin_outputs"]]
                    if sk.get("is_twin_production") and sk.get("twin_outputs")
                    else None
                )

                alloc_budget = float("inf")
                if needs_proportional and total_sku_prod_min > 0:
                    fraction = sk["prod_min"] / total_sku_prod_min
                    alloc_budget = max(1, int(fraction * est_capacity))
                total_allocated = 0

                while rem > 0 and total_allocated < alloc_budget:
                    if not advance():
                        break
                    sh_end = cur_sh_end()
                    raw_avail = sh_end - c_min
                    if raw_avail <= 0:
                        if not push_shift():
                            break
                        continue

                    avail = raw_avail

                    # Operator pool ADVISORY (skip for now — pool check would go here)

                    # CalcoTimeline HARD
                    alloc = min(rem, avail, alloc_budget - total_allocated)
                    calco = grp["tool"].calco
                    if calco:
                        abs_calco = to_abs(c_day, c_min)
                        abs_calco_end = to_abs(c_day, cur_sh_end())
                        cs = calco_tl.find_next_available(
                            calco, abs_calco, int(alloc), abs_calco_end
                        )
                        if cs == -1:
                            c_min = cur_sh_end()
                            continue
                        if cs > abs_calco:
                            c_day = cs // 1440
                            c_min = cs % 1440
                            alloc = min(rem, cur_sh_end() - c_min)

                    if alloc <= 0:
                        c_min = sh_end
                        continue

                    # ToolTimeline HARD
                    abs_p = to_abs(c_day, c_min)
                    t_slot = tool_tl.find_next_available(
                        grp["tool_id"], abs_p, int(alloc), to_abs(c_day, sh_end), m_id
                    )
                    if t_slot == -1:
                        c_min = sh_end
                        continue
                    if t_slot > abs_p:
                        c_day = t_slot // 1440
                        c_min = t_slot % 1440
                        alloc = min(rem, cur_sh_end() - c_min)
                        if alloc <= 0:
                            continue

                    if alloc <= 0:
                        break

                    # Book resources and emit block
                    alloc_int = int(alloc)
                    b_qty = q_rem if rem <= alloc else round(alloc * ppm)
                    if pool:
                        pool.book(c_day, c_min, c_min + alloc_int, sk["operators"], m_id)
                    if calco:
                        calco_tl.book(
                            calco, to_abs(c_day, c_min), to_abs(c_day, c_min + alloc_int), m_id
                        )
                    tool_tl.book(
                        grp["tool_id"], to_abs(c_day, c_min), to_abs(c_day, c_min + alloc_int), m_id
                    )

                    shift = cur_shift()

                    block = Block(
                        op_id=sk["op_id"],
                        tool_id=grp["tool_id"],
                        sku=sk["sku"],
                        nm=sk["nm"],
                        machine_id=m_id,
                        orig_m=sk["orig_m"],
                        day_idx=c_day,
                        edd_day=sk["edd"],
                        qty=b_qty,
                        prod_min=alloc_int,
                        setup_min=int(grp["setup_min"]) if is_first else 0,
                        operators=sk["operators"],
                        blocked=False,
                        moved=sk["moved"],
                        has_alt=sk["has_alt"],
                        alt_m=sk.get("alt_m"),
                        mp=sk.get("mp"),
                        stk=sk.get("stk", 0),
                        lt=sk.get("lt", 0),
                        atr=sk.get("atr", 0),
                        start_min=c_min,
                        end_min=c_min + alloc_int,
                        setup_s=setup_s if is_first else None,
                        setup_e=setup_e if is_first else None,
                        type="ok",
                        shift=shift,
                        below_min_batch=sk.get("lt", 0) > 0 and sk["prod_qty"] < sk.get("lt", 0),
                        earliest_start=sk.get("earliest_start"),
                    )

                    # Twin co-production
                    if (
                        sk.get("is_twin_production")
                        and sk.get("twin_outputs")
                        and twin_q_rem is not None
                    ):
                        block.is_twin_production = True
                        block.co_production_group_id = sk.get("co_production_group_id")
                        outputs = []
                        for idx, t in enumerate(sk["twin_outputs"]):
                            out_qty = min(b_qty, twin_q_rem[idx])
                            twin_q_rem[idx] -= out_qty
                            outputs.append(TwinOutput(op_id=t["op_id"], sku=t["sku"], qty=out_qty))
                        block.outputs = outputs

                    blocks.append(block)
                    is_first = False
                    rem -= alloc
                    q_rem -= b_qty
                    c_min += alloc_int
                    total_allocated += alloc_int

                # Remaining → overflow
                if rem > 0:
                    of_block = mk_overflow(sk, grp, w_days[-1], rem)
                    if sk.get("is_twin_production") and sk.get("twin_outputs"):
                        of_block.is_twin_production = True
                        of_block.co_production_group_id = sk.get("co_production_group_id")
                        of_block.outputs = [
                            TwinOutput(op_id=t["op_id"], sku=t["sku"], qty=0)
                            for t in sk["twin_outputs"]
                        ]
                    blocks.append(of_block)

            last_tool = grp["tool_id"]

    return blocks, infeasibilities
