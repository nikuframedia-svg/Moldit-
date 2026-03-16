"""Tier 3: Resolve OTD-Delivery failures — port of overflow/tier3-otd-delivery.ts.

Multi-phase approach: advance, move, combo, batch, computed, global, tool contention.
"""

from __future__ import annotations

from ..constants import DAY_CAP, DEFAULT_OEE, MAX_AUTO_MOVES
from ..scheduler.otd_delivery import OtdDeliveryFailure, compute_otd_delivery_failures
from ..types import AdvanceAction, Block, ETool, MoveAction
from .overflow_helpers import compute_advanced_edd, compute_tardiness
from .tier_types import TierContext, TierState


def _collect_fails(
    otd_count: int,
    otd_failures: list[OtdDeliveryFailure],
    exclude_ids: set[str],
) -> list[tuple[str, int, int]]:
    """Collect fails grouped by op, sorted by shortfall desc.

    Returns [(op_id, day, shortfall), ...].
    """
    by_op: dict[str, tuple[int, int]] = {}  # op_id -> (day, shortfall)
    for f in otd_failures:
        ex = by_op.get(f.op_id)
        if not ex or f.shortfall > ex[1]:
            by_op[f.op_id] = (f.day, f.shortfall)

    return sorted(
        [(op_id, day, sf) for op_id, (day, sf) in by_op.items() if op_id not in exclude_ids],
        key=lambda x: x[2],
        reverse=True,
    )


def _is_acceptable(
    new_otd_count: int,
    prev_otd_count: int,
    new_blocks: list[Block],
    tardiness_budget: int,
) -> bool:
    if new_otd_count >= prev_otd_count:
        return False
    if compute_tardiness(new_blocks) > tardiness_budget:
        return False
    return True


def run_tier3(
    state: TierState,
    ctx: TierContext,
    tool_map: dict[str, ETool] | None = None,
) -> None:
    """Tier 3: resolve OTD-delivery failures (cumProd < cumDemand at demand day).

    Mutates `state` in place.
    """
    ops = ctx.ops
    user_moves = ctx.user_moves
    m_st = ctx.m_st
    workdays = ctx.workdays
    twin_partner_map = ctx.twin_partner_map
    run_schedule = ctx.run_schedule
    run_bulk = ctx.run_schedule_with_leveling or run_schedule

    otd_count, otd_failures = compute_otd_delivery_failures(state.blocks, ops)
    if otd_count == 0:
        return

    pre_tardiness = compute_tardiness(state.blocks)
    tardiness_budget = max(int(pre_tardiness * 1.50), pre_tardiness + 500)

    # ── Main loop: untargeted advances ──
    for _t3 in range(MAX_AUTO_MOVES):
        if otd_count <= 0:
            break
        if len(state.auto_moves) + len(state.auto_advances) >= MAX_AUTO_MOVES:
            break

        moved_ids = set([m.op_id for m in user_moves] + [m.op_id for m in state.auto_moves])
        sorted_fails = _collect_fails(otd_count, otd_failures, moved_ids)
        if not sorted_fails:
            break

        otd_improved = False

        # Phase A: Advance (untargeted)
        for op_id, info_day, info_shortfall in sorted_fails:
            existing_idx = -1
            existing_days = 0
            for i, a in enumerate(state.auto_advances):
                if a.op_id == op_id:
                    existing_idx = i
                    existing_days = a.advance_days
                    break

            for add_days in range(1, 31):
                total_adv_days = existing_days + add_days
                if compute_advanced_edd(info_day, total_adv_days, workdays) < 0:
                    break

                trial = [a for a in state.auto_advances if a.op_id != op_id] + [
                    AdvanceAction(op_id=op_id, advance_days=total_adv_days, original_edd=info_day)
                ]
                all_moves = list(user_moves) + list(state.auto_moves)
                nr = run_schedule(all_moves, trial)
                new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)

                if _is_acceptable(new_otd_count, otd_count, nr.blocks, tardiness_budget):
                    if existing_idx >= 0:
                        del state.auto_advances[existing_idx]
                    state.auto_advances.append(
                        AdvanceAction(
                            op_id=op_id, advance_days=total_adv_days, original_edd=info_day
                        )
                    )
                    state.blocks = nr.blocks
                    state.sched_result = nr
                    otd_count = new_otd_count
                    otd_failures = new_otd_failures
                    otd_improved = True
                    for b in state.blocks:
                        if b.op_id == op_id and b.type == "ok":
                            b.is_advanced = True
                            b.advanced_by_days = total_adv_days
                    break

            if otd_improved:
                break

        # Phase B: Move to alt machine
        if not otd_improved:
            for op_id, info_day, info_shortfall in sorted_fails:
                ob = next(
                    (b for b in state.blocks if b.op_id == op_id and b.has_alt and b.alt_m),
                    None,
                )
                if not ob or not ob.alt_m or m_st.get(ob.alt_m) == "down":
                    continue
                tp = twin_partner_map.get(op_id)
                tp_moved = tp in moved_ids if tp else True
                state.auto_moves.append(MoveAction(op_id=op_id, to_m=ob.alt_m))
                if tp and not tp_moved:
                    state.auto_moves.append(MoveAction(op_id=tp, to_m=ob.alt_m))
                all_moves = list(user_moves) + list(state.auto_moves)
                adv = state.auto_advances if state.auto_advances else None
                nr = run_schedule(all_moves, adv)
                new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)
                if _is_acceptable(new_otd_count, otd_count, nr.blocks, tardiness_budget):
                    state.blocks = nr.blocks
                    state.sched_result = nr
                    otd_count = new_otd_count
                    otd_failures = new_otd_failures
                    otd_improved = True
                    break
                state.auto_moves.pop()
                if tp and not tp_moved:
                    state.auto_moves.pop()

        # Phase C: Move + advance combo
        if not otd_improved:
            for op_id, info_day, info_shortfall in sorted_fails:
                ob = next(
                    (b for b in state.blocks if b.op_id == op_id and b.has_alt and b.alt_m),
                    None,
                )
                if not ob or not ob.alt_m or m_st.get(ob.alt_m) == "down":
                    continue
                tp = twin_partner_map.get(op_id)
                tp_moved = tp in moved_ids if tp else True
                for adv_days in range(1, 31):
                    if compute_advanced_edd(info_day, adv_days, workdays) < 0:
                        break
                    state.auto_moves.append(MoveAction(op_id=op_id, to_m=ob.alt_m))
                    if tp and not tp_moved:
                        state.auto_moves.append(MoveAction(op_id=tp, to_m=ob.alt_m))
                    trial_adv = list(state.auto_advances) + [
                        AdvanceAction(op_id=op_id, advance_days=adv_days, original_edd=info_day)
                    ]
                    all_moves = list(user_moves) + list(state.auto_moves)
                    nr = run_schedule(all_moves, trial_adv)
                    new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)
                    if _is_acceptable(new_otd_count, otd_count, nr.blocks, tardiness_budget):
                        state.auto_advances.append(
                            AdvanceAction(op_id=op_id, advance_days=adv_days, original_edd=info_day)
                        )
                        state.blocks = nr.blocks
                        state.sched_result = nr
                        otd_count = new_otd_count
                        otd_failures = new_otd_failures
                        otd_improved = True
                        break
                    state.auto_moves.pop()
                    if tp and not tp_moved:
                        state.auto_moves.pop()
                if otd_improved:
                    break

        # Phase D: Batch advance (simultaneous, untargeted)
        if not otd_improved:
            batch_ops = {op_id: day for op_id, day, _ in sorted_fails}
            if len(batch_ops) > 1:
                for adv_days in range(1, 61):
                    ba: list[AdvanceAction] = []
                    for op_id, day in batch_ops.items():
                        existing_a = next(
                            (a for a in state.auto_advances if a.op_id == op_id), None
                        )
                        td = (existing_a.advance_days if existing_a else 0) + adv_days
                        if compute_advanced_edd(day, td, workdays) >= 0:
                            ba.append(AdvanceAction(op_id=op_id, advance_days=td, original_edd=day))
                    if len(ba) < 2:
                        continue
                    ids = set(a.op_id for a in ba)
                    trial = [a for a in state.auto_advances if a.op_id not in ids] + ba
                    all_moves = list(user_moves) + list(state.auto_moves)
                    nr = run_bulk(all_moves, trial)
                    new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)
                    if _is_acceptable(new_otd_count, otd_count, nr.blocks, tardiness_budget):
                        state.auto_advances = [a for a in state.auto_advances if a.op_id not in ids]
                        state.auto_advances.extend(ba)
                        state.blocks = nr.blocks
                        state.sched_result = nr
                        otd_count = new_otd_count
                        otd_failures = new_otd_failures
                        otd_improved = True
                        break

        # Phase E: Computed advance (capacity-based)
        if not otd_improved and tool_map:
            for op_id, info_day, info_shortfall in sorted_fails:
                op = next((o for o in ops if o.id == op_id), None)
                tool = tool_map.get(op.t) if op else None
                if not tool or tool.pH <= 0:
                    continue
                needed_days = min(
                    int(info_shortfall / (tool.pH * DEFAULT_OEE * (DAY_CAP / 60))) + 3, 60
                )
                e_idx = -1
                for i, a in enumerate(state.auto_advances):
                    if a.op_id == op_id:
                        e_idx = i
                        break
                total_days = (
                    state.auto_advances[e_idx].advance_days if e_idx >= 0 else 0
                ) + needed_days
                if compute_advanced_edd(info_day, total_days, workdays) < 0:
                    continue
                trial = [a for a in state.auto_advances if a.op_id != op_id] + [
                    AdvanceAction(op_id=op_id, advance_days=total_days, original_edd=info_day)
                ]
                all_moves = list(user_moves) + list(state.auto_moves)
                nr = run_bulk(all_moves, trial)
                new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)
                if _is_acceptable(new_otd_count, otd_count, nr.blocks, tardiness_budget):
                    if e_idx >= 0:
                        del state.auto_advances[e_idx]
                    state.auto_advances.append(
                        AdvanceAction(op_id=op_id, advance_days=total_days, original_edd=info_day)
                    )
                    state.blocks = nr.blocks
                    state.sched_result = nr
                    otd_count = new_otd_count
                    otd_failures = new_otd_failures
                    otd_improved = True
                    break

                # Fallback: move + computed advance
                ob = next(
                    (b for b in state.blocks if b.op_id == op_id and b.has_alt and b.alt_m),
                    None,
                )
                if ob and ob.alt_m and m_st.get(ob.alt_m) != "down":
                    tp = twin_partner_map.get(op_id)
                    tp_m = tp in moved_ids if tp else True
                    state.auto_moves.append(MoveAction(op_id=op_id, to_m=ob.alt_m))
                    if tp and not tp_m:
                        state.auto_moves.append(MoveAction(op_id=tp, to_m=ob.alt_m))
                    nr2 = run_bulk(all_moves + state.auto_moves[-2:], trial)
                    n_otd2, n_fail2 = compute_otd_delivery_failures(nr2.blocks, ops)
                    if _is_acceptable(n_otd2, otd_count, nr2.blocks, tardiness_budget):
                        if e_idx >= 0:
                            del state.auto_advances[e_idx]
                        state.auto_advances.append(
                            AdvanceAction(
                                op_id=op_id, advance_days=total_days, original_edd=info_day
                            )
                        )
                        state.blocks = nr2.blocks
                        state.sched_result = nr2
                        otd_count = n_otd2
                        otd_failures = n_fail2
                        otd_improved = True
                        break
                    state.auto_moves.pop()
                    if tp and not tp_m:
                        state.auto_moves.pop()

        if not otd_improved:
            break

    # ── Phase F: Global advance for all ops ──
    if otd_count > 0 and tool_map:
        moved_ids = set([m.op_id for m in user_moves] + [m.op_id for m in state.auto_moves])
        sorted_fails = _collect_fails(otd_count, otd_failures, moved_ids)

        if sorted_fails:
            ga: list[AdvanceAction] = []
            for op in ops:
                last_dd = 0
                for d in range(len(op.d) - 1, -1, -1):
                    if op.d[d] > 0:
                        last_dd = d
                        break
                e_days = 0
                for a in state.auto_advances:
                    if a.op_id == op.id:
                        e_days = a.advance_days
                        break
                wd = 0
                for d in range(min(last_dd + 1, len(workdays))):
                    if not workdays or workdays[d]:
                        wd += 1
                if max(e_days, wd) > e_days:
                    ga.append(
                        AdvanceAction(
                            op_id=op.id, advance_days=max(e_days, wd), original_edd=last_dd
                        )
                    )

            if ga:
                ids = set(a.op_id for a in ga)
                trial = [a for a in state.auto_advances if a.op_id not in ids] + ga
                all_moves = list(user_moves) + list(state.auto_moves)
                nr = run_bulk(all_moves, trial)
                new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)
                if _is_acceptable(new_otd_count, otd_count, nr.blocks, tardiness_budget):
                    state.auto_advances = [a for a in state.auto_advances if a.op_id not in ids]
                    state.auto_advances.extend(ga)
                    state.blocks = nr.blocks
                    state.sched_result = nr
                    otd_count = new_otd_count
                    otd_failures = new_otd_failures

        # Phase G: Tool contention
        if otd_count > 0:
            post_f_count, post_f_failures = compute_otd_delivery_failures(state.blocks, ops)
            post_f_fails = _collect_fails(post_f_count, post_f_failures, moved_ids)
            t_groups: dict[str, list[tuple[str, int, int]]] = {}
            for op_id, day, sf in post_f_fails:
                op = next((o for o in ops if o.id == op_id), None)
                if op:
                    if op.t not in t_groups:
                        t_groups[op.t] = []
                    t_groups[op.t].append((op_id, day, sf))

            for tool_id, group in t_groups.items():
                if len(group) < 2:
                    continue
                op0 = next((o for o in ops if o.id == group[0][0]), None)
                tool = tool_map.get(op0.t) if op0 else None
                if (
                    not tool
                    or not hasattr(tool, "alt")
                    or not tool.alt
                    or tool.alt == "-"
                    or m_st.get(tool.alt) == "down"
                ):
                    continue
                alt_m = tool.alt

                tm = list(state.auto_moves)
                half = len(group) // 2 + (1 if len(group) % 2 else 0)
                for op_id, _, _ in group[half:]:
                    if not any(m.op_id == op_id for m in tm):
                        tm.append(MoveAction(op_id=op_id, to_m=alt_m))
                        tp = twin_partner_map.get(op_id)
                        if tp and tp not in moved_ids and not any(m.op_id == tp for m in tm):
                            tm.append(MoveAction(op_id=tp, to_m=alt_m))

                ta = [
                    AdvanceAction(
                        op_id=a.op_id, advance_days=a.advance_days, original_edd=a.original_edd
                    )
                    for a in state.auto_advances
                ]
                d_cap = tool.pH * DEFAULT_OEE * (DAY_CAP / 60)
                for op_id, day, sf in group:
                    ex = next((a for a in ta if a.op_id == op_id), None)
                    td = (ex.advance_days if ex else 0) + min(int(sf / d_cap) + 3, 70)
                    if compute_advanced_edd(day, td, workdays) >= 0:
                        if ex:
                            ex.advance_days = td
                            ex.original_edd = day
                        else:
                            ta.append(AdvanceAction(op_id=op_id, advance_days=td, original_edd=day))

                all_moves = list(user_moves) + tm
                nr = run_bulk(all_moves, ta)
                new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)
                if _is_acceptable(new_otd_count, otd_count, nr.blocks, tardiness_budget):
                    state.auto_moves = tm
                    state.auto_advances = ta
                    state.blocks = nr.blocks
                    state.sched_result = nr
                    otd_count = new_otd_count
                    otd_failures = new_otd_failures

    # ── Phase H: TARGETED per-bucket advance with relaxed budget ──
    if otd_count > 0 and otd_count <= 10 and tool_map:
        relaxed_budget = max(tardiness_budget * 3, pre_tardiness + 5000)
        moved_ids2 = set([m.op_id for m in user_moves] + [m.op_id for m in state.auto_moves])
        remain_fails = _collect_fails(otd_count, otd_failures, moved_ids2)

        # Try targeted advance for each remaining failure individually
        for _pass in range(3):
            if otd_count <= 0:
                break
            ind_fails = _collect_fails(otd_count, otd_failures, moved_ids2)
            for op_id, info_day, info_shortfall in ind_fails:
                for adv_days in range(1, 81):
                    if compute_advanced_edd(info_day, adv_days, workdays) < 0:
                        break
                    trial = list(state.auto_advances) + [
                        AdvanceAction(op_id=op_id, advance_days=adv_days, original_edd=info_day)
                    ]
                    all_moves = list(user_moves) + list(state.auto_moves)
                    nr = run_bulk(all_moves, trial)
                    new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)
                    if new_otd_count < otd_count and compute_tardiness(nr.blocks) <= relaxed_budget:
                        state.auto_advances = trial
                        state.blocks = nr.blocks
                        state.sched_result = nr
                        otd_count = new_otd_count
                        otd_failures = new_otd_failures
                        break
                if otd_count == 0:
                    break

        # Try simultaneous targeted advance of all remaining failures
        if otd_count > 0:
            for adv_days in range(1, 81):
                ba2: list[AdvanceAction] = []
                for op_id, info_day, _ in remain_fails:
                    if compute_advanced_edd(info_day, adv_days, workdays) >= 0:
                        ba2.append(
                            AdvanceAction(op_id=op_id, advance_days=adv_days, original_edd=info_day)
                        )
                if not ba2:
                    continue
                trial = list(state.auto_advances) + ba2
                all_moves = list(user_moves) + list(state.auto_moves)
                nr = run_bulk(all_moves, trial)
                new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)
                if new_otd_count < otd_count and compute_tardiness(nr.blocks) <= relaxed_budget:
                    state.auto_advances = trial
                    state.blocks = nr.blocks
                    state.sched_result = nr
                    otd_count = new_otd_count
                    otd_failures = new_otd_failures
                    if otd_count == 0:
                        break

        # Try move + targeted advance combo for remaining failures with alt machines
        if otd_count > 0:
            remain_fails2 = _collect_fails(otd_count, otd_failures, moved_ids2)
            for op_id, info_day, _ in remain_fails2:
                ob = next(
                    (b for b in state.blocks if b.op_id == op_id and b.has_alt and b.alt_m),
                    None,
                )
                if not ob or not ob.alt_m or m_st.get(ob.alt_m) == "down":
                    continue
                tp = twin_partner_map.get(op_id)
                tp_moved = tp in moved_ids2 if tp else True
                for adv_days in range(0, 61):
                    if adv_days > 0 and compute_advanced_edd(info_day, adv_days, workdays) < 0:
                        break
                    tm = list(state.auto_moves) + [MoveAction(op_id=op_id, to_m=ob.alt_m)]
                    if tp and not tp_moved:
                        tm.append(MoveAction(op_id=tp, to_m=ob.alt_m))
                    ta = (
                        list(state.auto_advances)
                        + [AdvanceAction(op_id=op_id, advance_days=adv_days, original_edd=info_day)]
                        if adv_days > 0
                        else state.auto_advances
                    )
                    all_moves = list(user_moves) + tm
                    nr = run_bulk(all_moves, ta if ta else None)
                    new_otd_count, new_otd_failures = compute_otd_delivery_failures(nr.blocks, ops)
                    if new_otd_count < otd_count and compute_tardiness(nr.blocks) <= relaxed_budget:
                        state.auto_moves = tm
                        state.auto_advances = ta
                        state.blocks = nr.blocks
                        state.sched_result = nr
                        otd_count = new_otd_count
                        otd_failures = new_otd_failures
                        break
                if otd_count == 0:
                    break
