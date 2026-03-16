"""Auto-route overflow — 3-tier overflow resolver.

Port of overflow/auto-route-overflow.ts (452 LOC).
Tier 1: resolve overflow (advance + alt machine routing).
Tier 2: resolve tardiness (advance + alt + combo + batch).
Tier 3: resolve OTD-delivery failures (multi-rule search).
"""

from __future__ import annotations

from ..constants import (
    ALT_UTIL_THRESHOLD,
    DAY_CAP,
    MAX_AUTO_MOVES,
    MAX_OVERFLOW_ITER,
    S0,
    S2,
)
from ..scheduler.otd_delivery import compute_otd_delivery_failures
from ..scheduler.pipeline import schedule_all
from ..types import (
    AdvanceAction,
    EMachine,
    EOp,
    ETool,
    MoveAction,
    ScheduleResult,
    TwinValidationReport,
    WorkforceConfig,
)
from .overflow_helpers import (
    cap_analysis,
    compute_advanced_edd,
    sum_overflow,
)
from .tier2_tardiness import run_tier2
from .tier3_otd_delivery import run_tier3
from .tier_types import TierContext, TierState


def auto_route_overflow(
    *,
    ops: list[EOp],
    m_st: dict[str, str],
    t_st: dict[str, str],
    user_moves: list[MoveAction],
    machines: list[EMachine],
    tool_map: dict[str, ETool],
    workdays: list[bool],
    n_days: int,
    workforce_config: WorkforceConfig | None = None,
    rule: str = "EDD",
    supply_boosts: dict[str, dict] | None = None,
    third_shift: bool = False,
    constraint_config: dict | None = None,
    twin_validation_report: TwinValidationReport | None = None,
    dates: list[str] | None = None,
    order_based: bool | None = None,
    max_tier: int = 4,
) -> dict:
    """Run 3-tier overflow resolution.

    Returns dict with: blocks, auto_moves, auto_advances, decisions, feasibility.
    """
    # Build twin partner map
    twin_partner_map: dict[str, str] = {}
    if twin_validation_report and twin_validation_report.twin_groups:
        for tg in twin_validation_report.twin_groups:
            twin_partner_map[tg.op_id1] = tg.op_id2
            twin_partner_map[tg.op_id2] = tg.op_id1

    base_params = dict(
        ops=ops,
        m_st=m_st,
        t_st=t_st,
        machines=machines,
        tool_map=tool_map,
        workdays=workdays,
        n_days=n_days,
        workforce_config=workforce_config,
        rule=rule,
        third_shift=third_shift,
        twin_validation_report=twin_validation_report,
        order_based=order_based if order_based is not None else False,
    )

    def run_schedule(
        moves: list[MoveAction],
        advances: list[AdvanceAction] | None = None,
    ) -> ScheduleResult:
        return schedule_all(
            **base_params,
            moves=moves,
            enable_leveling=False,
            advance_overrides=advances,
        )

    def run_schedule_with_leveling(
        moves: list[MoveAction],
        advances: list[AdvanceAction] | None = None,
    ) -> ScheduleResult:
        return schedule_all(
            **base_params,
            moves=moves,
            enable_leveling=True,
            advance_overrides=advances,
        )

    sched_result = run_schedule(user_moves)
    blocks = sched_result.blocks
    total_overflow_min = sum_overflow(blocks)

    auto_moves: list[MoveAction] = []
    auto_advances: list[AdvanceAction] = []

    hard_cap = S2 - S0 if third_shift else DAY_CAP

    pre_tier1_tardy_ops: set[str] = set()
    for b in blocks:
        if b.type == "ok" and b.edd_day is not None and b.day_idx > b.edd_day:
            pre_tier1_tardy_ops.add(b.op_id)

    # ═══ TIER 1: Resolve OVERFLOW ═══
    if total_overflow_min > 0:
        max_steps = MAX_AUTO_MOVES * MAX_OVERFLOW_ITER

        for _step in range(max_steps):
            if len(auto_moves) + len(auto_advances) >= MAX_AUTO_MOVES:
                break

            cap = cap_analysis(blocks, machines)
            action_ids = set(
                [m.op_id for m in user_moves]
                + [m.op_id for m in auto_moves]
                + [a.op_id for a in auto_advances]
            )

            all_overflow_blocks = sorted(
                [
                    b
                    for b in blocks
                    if (
                        (b.overflow and b.overflow_min is not None and b.overflow_min > 0)
                        or (b.type == "infeasible" and b.prod_min > 0)
                    )
                    and b.op_id not in action_ids
                ],
                key=lambda b: (b.overflow_min or 0) if b.overflow else b.prod_min,
                reverse=True,
            )

            if not all_overflow_blocks:
                break

            moved = False
            seen_ops: set[str] = set()

            # Phase A: Advance production
            for ob in all_overflow_blocks:
                if ob.op_id in seen_ops:
                    continue
                seen_ops.add(ob.op_id)

                m_id = ob.machine_id
                m_days = cap.get(m_id)
                if not m_days:
                    continue

                for adv_days in range(1, 200):
                    target_day = compute_advanced_edd(ob.day_idx, adv_days, workdays)
                    if target_day < 0:
                        break
                    trial = list(auto_advances) + [
                        AdvanceAction(
                            op_id=ob.op_id, advance_days=adv_days, original_edd=ob.day_idx
                        )
                    ]
                    new_result = run_schedule(list(user_moves) + list(auto_moves), trial)
                    new_overflow = sum_overflow(new_result.blocks)

                    if new_overflow < total_overflow_min:
                        auto_advances.append(
                            AdvanceAction(
                                op_id=ob.op_id, advance_days=adv_days, original_edd=ob.day_idx
                            )
                        )
                        blocks = new_result.blocks
                        sched_result = new_result
                        total_overflow_min = new_overflow
                        moved = True

                        for b in blocks:
                            if b.op_id == ob.op_id and b.type == "ok":
                                b.is_advanced = True
                                b.advanced_by_days = adv_days
                        break

                if moved:
                    break

            # Phase B: Alt machine routing
            if not moved:
                alt_candidates = [
                    b
                    for b in all_overflow_blocks
                    if b.has_alt
                    and b.alt_m
                    and b.op_id not in action_ids
                    and m_st.get(b.alt_m) != "down"
                ]

                seen_ops_alt: set[str] = set()
                for ob in alt_candidates:
                    if ob.op_id in seen_ops_alt:
                        continue
                    seen_ops_alt.add(ob.op_id)

                    alt_m = ob.alt_m
                    if not alt_m:
                        continue
                    alt_days = cap.get(alt_m)
                    if not alt_days:
                        continue

                    w_day_count = sum(1 for w in workdays if w) if workdays else n_days
                    alt_total_used = sum(d["prod"] + d["setup"] for d in alt_days)
                    alt_util = (
                        alt_total_used / (w_day_count * hard_cap)
                        if w_day_count * hard_cap > 0
                        else 1.0
                    )
                    if alt_util > ALT_UTIL_THRESHOLD:
                        continue

                    alt_remaining = w_day_count * hard_cap - alt_total_used
                    if alt_remaining < 30:
                        continue

                    twin_partner = twin_partner_map.get(ob.op_id)
                    twin_already_moved = twin_partner in action_ids if twin_partner else True

                    auto_moves.append(MoveAction(op_id=ob.op_id, to_m=alt_m))
                    if twin_partner and not twin_already_moved:
                        auto_moves.append(MoveAction(op_id=twin_partner, to_m=alt_m))

                    new_result = run_schedule(
                        list(user_moves) + list(auto_moves),
                        auto_advances if auto_advances else None,
                    )
                    new_overflow = sum_overflow(new_result.blocks)

                    if new_overflow < total_overflow_min:
                        blocks = new_result.blocks
                        sched_result = new_result
                        total_overflow_min = new_overflow
                        moved = True
                        break
                    else:
                        auto_moves.pop()
                        if twin_partner and not twin_already_moved:
                            auto_moves.pop()

            if not moved:
                break
            if total_overflow_min == 0:
                break

    # Build TierState for Tier 2/3
    tier_state = TierState(
        blocks=blocks,
        sched_result=sched_result,
        auto_moves=auto_moves,
        auto_advances=auto_advances,
    )
    tier_ctx = TierContext(
        ops=ops,
        user_moves=user_moves,
        m_st=m_st,
        workdays=workdays,
        twin_partner_map=twin_partner_map,
        third_shift=third_shift,
        run_schedule=run_schedule,
        run_schedule_with_leveling=run_schedule_with_leveling,
    )

    # ═══ TIER 2: Resolve TARDINESS ═══
    if max_tier >= 2:
        run_tier2(tier_state, tier_ctx, pre_tier1_tardy_ops)

    # ═══ TIER 3: OTD-Delivery via multi-rule search ═══
    if max_tier >= 3:
        all_rules = ["EDD", "ATCS", "CR", "SPT", "WSPT"]
        best_otd_d_count = compute_otd_delivery_failures(tier_state.blocks, ops)[0]
        best_rule_state: TierState | None = None

        for try_rule in all_rules:

            def mk_sched(lvl: bool, r: str = try_rule):
                def fn(
                    moves: list[MoveAction], advances: list[AdvanceAction] | None = None
                ) -> ScheduleResult:
                    return schedule_all(
                        **{**base_params, "rule": r},
                        moves=moves,
                        enable_leveling=lvl,
                        advance_overrides=advances,
                    )

                return fn

            ts = TierState(
                blocks=tier_state.blocks,
                sched_result=tier_state.sched_result,
                auto_moves=list(tier_state.auto_moves),
                auto_advances=[
                    AdvanceAction(
                        op_id=a.op_id, advance_days=a.advance_days, original_edd=a.original_edd
                    )
                    for a in tier_state.auto_advances
                ],
            )

            # Fresh schedule with this rule
            all_moves = list(user_moves) + list(ts.auto_moves)
            adv = ts.auto_advances if ts.auto_advances else None
            fresh = mk_sched(False)(all_moves, adv)
            ts.blocks = fresh.blocks
            ts.sched_result = fresh

            rule_ctx = TierContext(
                ops=ops,
                user_moves=user_moves,
                m_st=m_st,
                workdays=workdays,
                twin_partner_map=twin_partner_map,
                third_shift=third_shift,
                run_schedule=mk_sched(False),
                run_schedule_with_leveling=mk_sched(True),
            )
            run_tier3(ts, rule_ctx, tool_map)

            cnt = compute_otd_delivery_failures(ts.blocks, ops)[0]
            if cnt < best_otd_d_count:
                best_otd_d_count = cnt
                best_rule_state = ts
            if best_otd_d_count == 0:
                break

        if best_rule_state:
            tier_state.blocks = best_rule_state.blocks
            tier_state.sched_result = best_rule_state.sched_result
            tier_state.auto_moves = best_rule_state.auto_moves
            tier_state.auto_advances = best_rule_state.auto_advances

    # ═══ Final grid: leveling × deadlines ═══
    final_moves = list(user_moves) + list(tier_state.auto_moves)
    final_advances = tier_state.auto_advances if tier_state.auto_advances else None
    common_params = {
        **base_params,
        "moves": final_moves,
        "advance_overrides": final_advances,
    }

    final_result = schedule_all(
        **common_params, enable_leveling=False, enforce_deadlines_enabled=False
    )
    best_otd_d = compute_otd_delivery_failures(final_result.blocks, ops)[0]

    for enable_leveling in [False, True]:
        for enforce_dl in [False, True]:
            if not enable_leveling and not enforce_dl:
                continue
            candidate = schedule_all(
                **common_params,
                enable_leveling=enable_leveling,
                enforce_deadlines_enabled=enforce_dl,
            )
            candidate_otd_d = compute_otd_delivery_failures(candidate.blocks, ops)[0]
            if candidate_otd_d < best_otd_d:
                final_result = candidate
                best_otd_d = candidate_otd_d

    # ── Post-grid OTD-D repair ──
    if best_otd_d > 0 and best_otd_d <= 5:
        fail_count, fail_list = compute_otd_delivery_failures(final_result.blocks, ops)
        fail_ops = set(f.op_id for f in fail_list)
        boosted_supply = dict(supply_boosts or {})
        for op_id in fail_ops:
            boosted_supply[op_id] = {"boost": 10}

        for adv_days in range(0, 41):
            extra_advances: list[AdvanceAction] = []
            if adv_days > 0:
                for f in fail_list:
                    existing = 0
                    for a in tier_state.auto_advances:
                        if a.op_id == f.op_id:
                            existing = a.advance_days
                            break
                    td = existing + adv_days
                    if compute_advanced_edd(f.day, td, workdays) >= 0:
                        extra_advances.append(
                            AdvanceAction(op_id=f.op_id, advance_days=td, original_edd=f.day)
                        )

            boost_advances = list(final_advances) if final_advances else []
            for ea in extra_advances:
                idx = next((i for i, a in enumerate(boost_advances) if a.op_id == ea.op_id), -1)
                if idx >= 0:
                    boost_advances[idx] = ea
                else:
                    boost_advances.append(ea)

            boost_params = {
                **common_params,
                "advance_overrides": boost_advances if boost_advances else None,
            }

            for enable_leveling in [False, True]:
                for enforce_dl in [False, True]:
                    candidate = schedule_all(
                        **boost_params,
                        enable_leveling=enable_leveling,
                        enforce_deadlines_enabled=enforce_dl,
                    )
                    candidate_otd_d = compute_otd_delivery_failures(candidate.blocks, ops)[0]
                    if candidate_otd_d < best_otd_d:
                        final_result = candidate
                        best_otd_d = candidate_otd_d
                        if best_otd_d == 0:
                            break
                if best_otd_d == 0:
                    break
            if best_otd_d == 0:
                break

    # Mark advanced blocks in final result
    adv_map = {a.op_id: a.advance_days for a in tier_state.auto_advances}
    for b in final_result.blocks:
        adv_days_val = adv_map.get(b.op_id)
        if adv_days_val is not None and b.type == "ok":
            b.is_advanced = True
            b.advanced_by_days = adv_days_val

    return {
        "blocks": final_result.blocks,
        "auto_moves": tier_state.auto_moves,
        "auto_advances": tier_state.auto_advances,
        "decisions": final_result.decisions,
        "feasibility": final_result.feasibility,
    }
