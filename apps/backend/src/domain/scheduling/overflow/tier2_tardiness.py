"""Tier 2: Resolve TARDINESS — port of overflow/tier2-tardiness.ts.

Blocks scheduled after their EDD. Uses advance + alt machine.
Constraint: never re-introduce overflow.
"""

from __future__ import annotations

from ..constants import MAX_AUTO_MOVES
from ..types import AdvanceAction
from .overflow_helpers import compute_advanced_edd, compute_tardiness, sum_overflow
from .tier_types import TierContext, TierState


def run_tier2(
    state: TierState,
    ctx: TierContext,
    pre_tier1_tardy_ops: set[str],
) -> None:
    """Tier 2: resolve tardiness (blocks scheduled after their EDD).

    Mutates `state` in place.
    """
    user_moves = ctx.user_moves
    m_st = ctx.m_st
    workdays = ctx.workdays
    twin_partner_map = ctx.twin_partner_map
    run_schedule = ctx.run_schedule

    # Refresh tardy set: include ops that became tardy after Tier 1
    for b in state.blocks:
        if b.type == "ok" and b.edd_day is not None and b.day_idx > b.edd_day:
            pre_tier1_tardy_ops.add(b.op_id)

    total_tardiness = compute_tardiness(state.blocks)

    for _t2 in range(MAX_AUTO_MOVES):
        if total_tardiness <= 0:
            break
        if len(state.auto_moves) + len(state.auto_advances) >= MAX_AUTO_MOVES:
            break

        moved_ids = set([m.op_id for m in user_moves] + [m.op_id for m in state.auto_moves])
        advanced_ids = set(a.op_id for a in state.auto_advances)

        tardy_blocks = sorted(
            [
                b
                for b in state.blocks
                if b.type == "ok"
                and b.edd_day is not None
                and b.day_idx > b.edd_day
                and b.op_id in pre_tier1_tardy_ops
                and b.op_id not in moved_ids
            ],
            key=lambda b: b.prod_min,
            reverse=True,
        )

        if not tardy_blocks:
            break

        tardy_improved = False

        # ── Phase A: Try ADVANCING tardy ops on same machine ──
        seen_tardy_ops: set[str] = set()
        for ob in tardy_blocks:
            if ob.op_id in seen_tardy_ops:
                continue
            seen_tardy_ops.add(ob.op_id)
            if ob.op_id in advanced_ids:
                continue  # already advanced, skip to Phase B/C

            ob_edd = ob.edd_day  # type: ignore[assignment]

            for adv_days in range(1, 31):
                target_day = compute_advanced_edd(ob_edd, adv_days, workdays)
                if target_day < 0:
                    break

                trial = list(state.auto_advances) + [
                    AdvanceAction(op_id=ob.op_id, advance_days=adv_days, original_edd=ob_edd)
                ]
                all_moves = list(user_moves) + list(state.auto_moves)
                new_result = run_schedule(all_moves, trial)
                new_tardiness = compute_tardiness(new_result.blocks)

                if new_tardiness < total_tardiness and sum_overflow(new_result.blocks) == 0:
                    state.auto_advances.append(
                        AdvanceAction(op_id=ob.op_id, advance_days=adv_days, original_edd=ob_edd)
                    )
                    state.blocks = new_result.blocks
                    state.sched_result = new_result
                    total_tardiness = new_tardiness
                    tardy_improved = True

                    # Mark blocks as advanced
                    for b in state.blocks:
                        if b.op_id == ob.op_id and b.type == "ok":
                            b.is_advanced = True
                            b.advanced_by_days = adv_days

                    break  # success

            if tardy_improved:
                break  # restart loop

        # ── Phase B: Alt machine for tardy ops ──
        if not tardy_improved:
            alt_groups: dict[str, list[str]] = {}
            seen_batch: set[str] = set()
            for ob in tardy_blocks:
                if ob.op_id in seen_batch:
                    continue
                seen_batch.add(ob.op_id)
                if not ob.has_alt or not ob.alt_m or m_st.get(ob.alt_m) == "down":
                    continue
                alt_m = ob.alt_m
                if alt_m not in alt_groups:
                    alt_groups[alt_m] = []
                alt_groups[alt_m].append(ob.op_id)

            for alt_m, op_ids in alt_groups.items():
                # Twin-aware: include twin partners
                batch_op_ids = set(op_ids)
                for op_id in op_ids:
                    tp = twin_partner_map.get(op_id)
                    if tp and tp not in moved_ids:
                        batch_op_ids.add(tp)
                expanded_op_ids = list(batch_op_ids)

                # Try batch move
                if len(expanded_op_ids) > 1:
                    from ..types import MoveAction as MA

                    batch_moves = [MA(op_id=oid, to_m=alt_m) for oid in expanded_op_ids]
                    state.auto_moves.extend(batch_moves)
                    all_moves = list(user_moves) + list(state.auto_moves)
                    adv = state.auto_advances if state.auto_advances else None
                    nr = run_schedule(all_moves, adv)
                    nt = compute_tardiness(nr.blocks)
                    if nt < total_tardiness and sum_overflow(nr.blocks) == 0:
                        state.blocks = nr.blocks
                        state.sched_result = nr
                        total_tardiness = nt
                        tardy_improved = True
                    else:
                        del state.auto_moves[-len(batch_moves) :]

                # Fall back to individual moves
                if not tardy_improved:
                    for op_id in op_ids:
                        tp = twin_partner_map.get(op_id)
                        tp_already_moved = tp in moved_ids or tp in op_ids if tp else True
                        state.auto_moves.append(MA(op_id=op_id, to_m=alt_m))
                        if tp and not tp_already_moved:
                            state.auto_moves.append(MA(op_id=tp, to_m=alt_m))
                        all_moves = list(user_moves) + list(state.auto_moves)
                        adv = state.auto_advances if state.auto_advances else None
                        nr = run_schedule(all_moves, adv)
                        nt = compute_tardiness(nr.blocks)
                        if nt < total_tardiness and sum_overflow(nr.blocks) == 0:
                            state.blocks = nr.blocks
                            state.sched_result = nr
                            total_tardiness = nt
                            tardy_improved = True
                            break
                        else:
                            state.auto_moves.pop()
                            if tp and not tp_already_moved:
                                state.auto_moves.pop()

                if tardy_improved:
                    break

        # ── Phase C: Combined MOVE + ADVANCE ──
        if not tardy_improved:
            seen_c: set[str] = set()
            for ob in tardy_blocks:
                if ob.op_id in seen_c:
                    continue
                seen_c.add(ob.op_id)
                if not ob.has_alt or not ob.alt_m or m_st.get(ob.alt_m) == "down":
                    continue
                alt_m = ob.alt_m
                ob_edd = ob.edd_day  # type: ignore[assignment]

                tp_c = twin_partner_map.get(ob.op_id)
                tp_c_already_moved = tp_c in moved_ids if tp_c else True

                from ..types import MoveAction as MA

                for adv_days in range(1, 31):
                    target_day = compute_advanced_edd(ob_edd, adv_days, workdays)
                    if target_day < 0:
                        break

                    state.auto_moves.append(MA(op_id=ob.op_id, to_m=alt_m))
                    if tp_c and not tp_c_already_moved:
                        state.auto_moves.append(MA(op_id=tp_c, to_m=alt_m))
                    trial_adv = list(state.auto_advances) + [
                        AdvanceAction(op_id=ob.op_id, advance_days=adv_days, original_edd=ob_edd)
                    ]
                    all_moves = list(user_moves) + list(state.auto_moves)
                    nr = run_schedule(all_moves, trial_adv)
                    nt = compute_tardiness(nr.blocks)

                    if nt < total_tardiness and sum_overflow(nr.blocks) == 0:
                        state.auto_advances.append(
                            AdvanceAction(
                                op_id=ob.op_id, advance_days=adv_days, original_edd=ob_edd
                            )
                        )
                        state.blocks = nr.blocks
                        state.sched_result = nr
                        total_tardiness = nt
                        tardy_improved = True

                        for b in state.blocks:
                            if b.op_id == ob.op_id and b.type == "ok":
                                b.is_advanced = True
                                b.advanced_by_days = adv_days
                        break
                    else:
                        state.auto_moves.pop()
                        if tp_c and not tp_c_already_moved:
                            state.auto_moves.pop()

                if tardy_improved:
                    break

        # ── Phase D: BATCH advance all tardy ops ──
        if not tardy_improved:
            batch_ops: dict[str, int] = {}
            for ob in tardy_blocks:
                if (
                    ob.op_id not in batch_ops
                    and ob.op_id not in advanced_ids
                    and ob.edd_day is not None
                ):
                    batch_ops[ob.op_id] = ob.edd_day

            if len(batch_ops) > 1:
                for adv_days in range(1, 6):
                    batch_advances: list[AdvanceAction] = []
                    for op_id, edd in batch_ops.items():
                        target_day = compute_advanced_edd(edd, adv_days, workdays)
                        if target_day >= 0:
                            batch_advances.append(
                                AdvanceAction(op_id=op_id, advance_days=adv_days, original_edd=edd)
                            )

                    if len(batch_advances) < 2:
                        continue

                    trial = list(state.auto_advances) + batch_advances
                    all_moves = list(user_moves) + list(state.auto_moves)
                    new_result = run_schedule(all_moves, trial)
                    new_tardiness = compute_tardiness(new_result.blocks)

                    if new_tardiness < total_tardiness and sum_overflow(new_result.blocks) == 0:
                        state.auto_advances.extend(batch_advances)
                        state.blocks = new_result.blocks
                        state.sched_result = new_result
                        total_tardiness = new_tardiness
                        tardy_improved = True

                        for b in state.blocks:
                            if b.op_id in batch_ops and b.type == "ok":
                                b.is_advanced = True
                                b.advanced_by_days = adv_days
                        break

        if not tardy_improved:
            break
