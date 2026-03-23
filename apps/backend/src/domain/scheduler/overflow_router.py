"""Overflow router — sections 3-6 of the spec.

Tier 1: resolve overflow (advance + alt machine)
Tier 2: resolve tardiness (advance + alt + combo + batch)
Tier 3: resolve OTD-D failures (7 phases + multi-rule search)
Final selection: grid leveling × deadlines
"""

from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from ..scheduling.types import (
    AdvanceAction,
    Block,
    DecisionEntry,
    EngineData,
    EOp,
    MoveAction,
)
from .constants import (
    DAY_CAP,
    DISPATCH_RULES,
    MAX_OVERFLOW_ITER,
    TIER3_TARDINESS_ADDEND,
    TIER3_TARDINESS_FACTOR,
)

# ── Metrics ──


def sum_overflow(blocks: list[Block]) -> float:
    """Total overflow minutes across all overflow + infeasible blocks."""
    total = 0.0
    for b in blocks:
        if b.type == "overflow" and b.overflow_min:
            total += b.overflow_min
        elif b.type == "infeasible" and b.prod_min > 0:
            total += b.prod_min
    return total


def compute_tardiness(blocks: list[Block]) -> float:
    """Sum of prod_min for OK blocks where dayIdx > eddDay."""
    total = 0.0
    for b in blocks:
        if b.type == "ok" and b.edd_day is not None and b.day_idx > b.edd_day:
            total += b.prod_min
    return total


def compute_otd_delivery_failures(
    blocks: list[Block],
    ops: list[EOp],
) -> list[dict[str, Any]]:
    """Section 5: Count cumProd < cumDemand at demand days."""
    # Build per-op production by day
    op_prod: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    for b in blocks:
        if b.type == "ok" and b.qty > 0:
            # Twin-aware: use outputs if present
            if b.outputs:
                for out in b.outputs:
                    op_prod[out.op_id][b.day_idx] += out.qty
            else:
                op_prod[b.op_id][b.day_idx] += b.qty

    failures: list[dict[str, Any]] = []

    for op in ops:
        cum_demand = 0
        cum_prod = 0
        for day_idx, demand in enumerate(op.d):
            if demand > 0:
                cum_demand += demand
            cum_prod += op_prod.get(op.id, {}).get(day_idx, 0)
            if demand > 0 and cum_prod < cum_demand:
                failures.append(
                    {
                        "op_id": op.id,
                        "day": day_idx,
                        "shortfall": cum_demand - cum_prod,
                        "sku": op.sku,
                        "tool": op.t,
                        "machine": op.m,
                    }
                )

    return failures


def _compute_advanced_edd(edd: int, adv_days: int, workdays: list[bool]) -> int:
    """Count adv_days workdays backward from edd. Returns -1 if insufficient."""
    count = 0
    day = edd
    while count < adv_days and day > 0:
        day -= 1
        if day < len(workdays) and workdays[day]:
            count += 1
    return day if count == adv_days else -1


# ── Tier 1: Overflow ──


def _tier1_resolve_overflow(
    blocks: list[Block],
    engine_data: EngineData,
    schedule_fn: Callable,
    auto_moves: list[MoveAction],
    auto_advances: list[AdvanceAction],
    decisions: list[DecisionEntry],
    max_adv: int = 30,
) -> list[Block]:
    """Tier 1: Advance + alt machine for overflow blocks."""
    workdays = engine_data.workdays
    action_ids: set[str] = {m.op_id for m in auto_moves}

    for _iteration in range(MAX_OVERFLOW_ITER):
        total_ov = sum_overflow(blocks)
        if total_ov <= 0:
            break

        improved = False

        # Phase A: Advance
        overflow_blocks = [
            b
            for b in blocks
            if (b.type == "overflow" or b.type == "infeasible") and b.op_id not in action_ids
        ]
        overflow_blocks.sort(key=lambda b: -(b.overflow_min or 0))

        seen_ops: set[str] = set()
        for ob in overflow_blocks:
            if ob.op_id in seen_ops:
                continue
            seen_ops.add(ob.op_id)

            for adv_days in range(1, max_adv + 1):
                target = _compute_advanced_edd(ob.day_idx, adv_days, workdays)
                if target < 0:
                    break

                trial_advances = list(auto_advances) + [
                    AdvanceAction(op_id=ob.op_id, advance_days=adv_days, original_edd=ob.day_idx)
                ]
                new_blocks = schedule_fn(
                    moves=auto_moves,
                    advances=trial_advances,
                )
                if sum_overflow(new_blocks) < total_ov:
                    auto_advances.append(
                        AdvanceAction(
                            op_id=ob.op_id, advance_days=adv_days, original_edd=ob.day_idx
                        )
                    )
                    action_ids.add(ob.op_id)
                    blocks = new_blocks
                    improved = True
                    break

            if improved:
                break

        if improved:
            continue

        # Phase B: Alt machine
        alt_candidates = [
            b
            for b in blocks
            if b.type == "overflow" and b.has_alt and b.alt_m and b.op_id not in action_ids
        ]
        for cand in alt_candidates:
            move = MoveAction(op_id=cand.op_id, to_m=cand.alt_m)
            auto_moves.append(move)
            new_blocks = schedule_fn(moves=auto_moves, advances=auto_advances)
            if sum_overflow(new_blocks) < total_ov:
                action_ids.add(cand.op_id)
                blocks = new_blocks
                improved = True
                break
            else:
                auto_moves.pop()

        if not improved:
            break

    return blocks


# ── Tier 2: Tardiness ──


def _tier2_resolve_tardiness(
    blocks: list[Block],
    engine_data: EngineData,
    schedule_fn: Callable,
    auto_moves: list[MoveAction],
    auto_advances: list[AdvanceAction],
    decisions: list[DecisionEntry],
    max_adv: int = 30,
) -> list[Block]:
    """Tier 2: Advance + alt + combo + batch for tardy blocks."""
    workdays = engine_data.workdays
    moved_ids: set[str] = {m.op_id for m in auto_moves}
    advanced_ids: set[str] = {a.op_id for a in auto_advances}

    total_tardiness = compute_tardiness(blocks)
    if total_tardiness <= 0:
        return blocks

    # Phase A: Advance on same machine
    tardy_blocks = [
        b
        for b in blocks
        if b.type == "ok"
        and b.edd_day is not None
        and b.day_idx > b.edd_day
        and b.op_id not in moved_ids
    ]
    tardy_blocks.sort(key=lambda b: -b.prod_min)

    seen: set[str] = set()
    for tb in tardy_blocks:
        if tb.op_id in seen or tb.op_id in advanced_ids:
            continue
        seen.add(tb.op_id)

        for adv_days in range(1, max_adv + 1):
            target = _compute_advanced_edd(tb.edd_day, adv_days, workdays)
            if target < 0:
                break
            trial = list(auto_advances) + [
                AdvanceAction(op_id=tb.op_id, advance_days=adv_days, original_edd=tb.edd_day)
            ]
            new_blocks = schedule_fn(moves=auto_moves, advances=trial)
            new_tard = compute_tardiness(new_blocks)
            if new_tard < total_tardiness and sum_overflow(new_blocks) <= 0:
                auto_advances.append(
                    AdvanceAction(op_id=tb.op_id, advance_days=adv_days, original_edd=tb.edd_day)
                )
                advanced_ids.add(tb.op_id)
                blocks = new_blocks
                total_tardiness = new_tard
                break

    # Phase B: Alt machine
    tardy_with_alt = [
        b
        for b in blocks
        if b.type == "ok"
        and b.edd_day is not None
        and b.day_idx > b.edd_day
        and b.has_alt
        and b.alt_m
        and b.op_id not in moved_ids
    ]
    for tb in tardy_with_alt:
        move = MoveAction(op_id=tb.op_id, to_m=tb.alt_m)
        auto_moves.append(move)
        new_blocks = schedule_fn(moves=auto_moves, advances=auto_advances)
        new_tard = compute_tardiness(new_blocks)
        if new_tard < total_tardiness and sum_overflow(new_blocks) <= 0:
            moved_ids.add(tb.op_id)
            blocks = new_blocks
            total_tardiness = new_tard
        else:
            auto_moves.pop()

    # Phase C: Move + advance combo
    remaining_tardy = [
        b
        for b in blocks
        if b.type == "ok"
        and b.edd_day is not None
        and b.day_idx > b.edd_day
        and b.has_alt
        and b.alt_m
        and b.op_id not in moved_ids
    ]
    for tb in remaining_tardy:
        for adv_days in range(1, max_adv + 1):
            move = MoveAction(op_id=tb.op_id, to_m=tb.alt_m)
            advance = AdvanceAction(
                op_id=tb.op_id,
                advance_days=adv_days,
                original_edd=tb.edd_day,
            )
            auto_moves.append(move)
            trial_adv = list(auto_advances) + [advance]
            new_blocks = schedule_fn(moves=auto_moves, advances=trial_adv)
            new_tard = compute_tardiness(new_blocks)
            if new_tard < total_tardiness and sum_overflow(new_blocks) <= 0:
                auto_advances.append(advance)
                blocks = new_blocks
                total_tardiness = new_tard
                break
            else:
                auto_moves.pop()
        # Keep move if combo was accepted (auto_moves still has it)

    # Phase D: Batch advance
    batch_ops = [
        b.op_id
        for b in blocks
        if b.type == "ok"
        and b.edd_day is not None
        and b.day_idx > b.edd_day
        and b.op_id not in moved_ids
        and b.op_id not in advanced_ids
    ]
    batch_ops = list(set(batch_ops))
    if len(batch_ops) > 1:
        for adv_days in range(1, min(6, max_adv + 1)):
            trial = list(auto_advances)
            valid = 0
            for op_id in batch_ops:
                # Find a tardy block for this op to get edd
                for b in blocks:
                    if b.op_id == op_id and b.edd_day is not None:
                        target = _compute_advanced_edd(b.edd_day, adv_days, workdays)
                        if target >= 0:
                            trial.append(
                                AdvanceAction(
                                    op_id=op_id,
                                    advance_days=adv_days,
                                    original_edd=b.edd_day,
                                )
                            )
                            valid += 1
                        break
            if valid >= 2:
                new_blocks = schedule_fn(moves=auto_moves, advances=trial)
                new_tard = compute_tardiness(new_blocks)
                if new_tard < total_tardiness and sum_overflow(new_blocks) <= 0:
                    auto_advances.clear()
                    auto_advances.extend(trial)
                    blocks = new_blocks
                    total_tardiness = new_tard
                    break

    return blocks


# ── Tier 3: OTD-D ──


def _tier3_resolve_otd_delivery(
    blocks: list[Block],
    engine_data: EngineData,
    schedule_fn: Callable,
    auto_moves: list[MoveAction],
    auto_advances: list[AdvanceAction],
    decisions: list[DecisionEntry],
    max_adv: int = 30,
) -> list[Block]:
    """Tier 3: 7 phases to resolve OTD-D failures."""
    workdays = engine_data.workdays
    ops = engine_data.ops

    pre_tardiness = compute_tardiness(blocks)
    tardiness_budget = max(
        pre_tardiness * TIER3_TARDINESS_FACTOR,
        pre_tardiness + TIER3_TARDINESS_ADDEND,
    )

    failures = compute_otd_delivery_failures(blocks, ops)
    if not failures:
        return blocks

    prev_count = len(failures)

    def acceptable(new_blocks: list[Block]) -> bool:
        new_fails = compute_otd_delivery_failures(new_blocks, ops)
        if len(new_fails) >= prev_count:
            return False
        return compute_tardiness(new_blocks) <= tardiness_budget

    # Phase A: Advance individual
    for fail in sorted(failures, key=lambda f: -f["shortfall"]):
        op_id = fail["op_id"]
        existing = next((a.advance_days for a in auto_advances if a.op_id == op_id), 0)
        for add_days in range(1, max_adv + 1):
            total_adv = existing + add_days
            trial = [a for a in auto_advances if a.op_id != op_id]
            trial.append(
                AdvanceAction(
                    op_id=op_id,
                    advance_days=total_adv,
                    original_edd=fail["day"],
                )
            )
            new_blocks = schedule_fn(moves=auto_moves, advances=trial)
            if acceptable(new_blocks):
                auto_advances.clear()
                auto_advances.extend(trial)
                blocks = new_blocks
                failures = compute_otd_delivery_failures(blocks, ops)
                prev_count = len(failures)
                break

    if not failures:
        return blocks

    # Phase B: Move to alt
    for fail in failures:
        op_id = fail["op_id"]
        # Find if op has alt
        alt_block = next(
            (b for b in blocks if b.op_id == op_id and b.has_alt and b.alt_m),
            None,
        )
        if not alt_block:
            continue
        move = MoveAction(op_id=op_id, to_m=alt_block.alt_m)
        auto_moves.append(move)
        new_blocks = schedule_fn(moves=auto_moves, advances=auto_advances)
        if acceptable(new_blocks):
            blocks = new_blocks
            failures = compute_otd_delivery_failures(blocks, ops)
            prev_count = len(failures)
        else:
            auto_moves.pop()

    if not failures:
        return blocks

    # Phase C: Move + advance combo
    for fail in failures:
        op_id = fail["op_id"]
        alt_block = next(
            (b for b in blocks if b.op_id == op_id and b.has_alt and b.alt_m),
            None,
        )
        if not alt_block:
            continue
        for adv_days in range(1, max_adv + 1):
            move = MoveAction(op_id=op_id, to_m=alt_block.alt_m)
            trial = [a for a in auto_advances if a.op_id != op_id]
            trial.append(
                AdvanceAction(
                    op_id=op_id,
                    advance_days=adv_days,
                    original_edd=fail["day"],
                )
            )
            auto_moves.append(move)
            new_blocks = schedule_fn(moves=auto_moves, advances=trial)
            if acceptable(new_blocks):
                auto_advances.clear()
                auto_advances.extend(trial)
                blocks = new_blocks
                failures = compute_otd_delivery_failures(blocks, ops)
                prev_count = len(failures)
                break
            else:
                auto_moves.pop()

    if not failures:
        return blocks

    # Phase D: Batch advance
    batch_ops = list({f["op_id"] for f in failures})
    if len(batch_ops) > 1:
        for adv_days in range(1, max_adv + 1):
            trial = [a for a in auto_advances if a.op_id not in batch_ops]
            valid = 0
            for op_id in batch_ops:
                f = next(f for f in failures if f["op_id"] == op_id)
                trial.append(
                    AdvanceAction(
                        op_id=op_id,
                        advance_days=adv_days,
                        original_edd=f["day"],
                    )
                )
                valid += 1
            if valid >= 2:
                new_blocks = schedule_fn(moves=auto_moves, advances=trial)
                if acceptable(new_blocks):
                    auto_advances.clear()
                    auto_advances.extend(trial)
                    blocks = new_blocks
                    failures = compute_otd_delivery_failures(blocks, ops)
                    prev_count = len(failures)
                    break

    if not failures:
        return blocks

    # Phase E: Computed advance (capacity-based)
    tool_map = engine_data.tool_map
    for fail in failures:
        op_id = fail["op_id"]
        tool = tool_map.get(fail.get("tool", ""))
        if not tool:
            continue
        oee = tool.oee or 0.66
        daily_cap = tool.pH * oee * DAY_CAP / 60.0
        if daily_cap <= 0:
            continue
        needed_days = math.ceil(fail["shortfall"] / daily_cap) + 2
        existing = next((a.advance_days for a in auto_advances if a.op_id == op_id), 0)
        total_days = min(existing + needed_days, max_adv)
        trial = [a for a in auto_advances if a.op_id != op_id]
        trial.append(
            AdvanceAction(
                op_id=op_id,
                advance_days=total_days,
                original_edd=fail["day"],
            )
        )
        new_blocks = schedule_fn(moves=auto_moves, advances=trial)
        if acceptable(new_blocks):
            auto_advances.clear()
            auto_advances.extend(trial)
            blocks = new_blocks
            failures = compute_otd_delivery_failures(blocks, ops)
            prev_count = len(failures)

    return blocks


# ── Main entry point ──


def auto_route_overflow(
    blocks: list[Block],
    engine_data: EngineData,
    settings: dict[str, Any],
    schedule_fn: Callable,
    trace: list[dict[str, Any]] | None = None,
) -> tuple[list[Block], list[MoveAction], list[AdvanceAction], list[DecisionEntry]]:
    """Sections 3-6: Full overflow routing — Tiers 1-3 + multi-rule search."""
    auto_moves: list[MoveAction] = []
    auto_advances: list[AdvanceAction] = []
    decisions: list[DecisionEntry] = []
    max_adv = engine_data.n_days  # No point advancing beyond horizon

    pre_overflow = sum_overflow(blocks)
    pre_tardiness = compute_tardiness(blocks)

    # Tier 1: Resolve overflow
    blocks = _tier1_resolve_overflow(
        blocks,
        engine_data,
        schedule_fn,
        auto_moves,
        auto_advances,
        decisions,
        max_adv=max_adv,
    )

    if trace is not None:
        trace.append(
            {
                "type": "tier1_done",
                "overflow_before": round(pre_overflow, 1),
                "overflow_after": round(sum_overflow(blocks), 1),
                "moves": [{"op_id": m.op_id, "to": m.to_m} for m in auto_moves],
                "advances": [{"op_id": a.op_id, "days": a.advance_days} for a in auto_advances],
            }
        )

    # Tier 2: Resolve tardiness
    blocks = _tier2_resolve_tardiness(
        blocks,
        engine_data,
        schedule_fn,
        auto_moves,
        auto_advances,
        decisions,
        max_adv=max_adv,
    )

    if trace is not None:
        trace.append(
            {
                "type": "tier2_done",
                "tardiness_before": round(pre_tardiness, 1),
                "tardiness_after": round(compute_tardiness(blocks), 1),
                "moves": [{"op_id": m.op_id, "to": m.to_m} for m in auto_moves],
                "advances": [{"op_id": a.op_id, "days": a.advance_days} for a in auto_advances],
            }
        )

    # Tier 3: Resolve OTD-D (try multiple dispatch rules)
    best_blocks = blocks
    best_failures = len(compute_otd_delivery_failures(blocks, engine_data.ops))
    best_moves = list(auto_moves)
    best_advances = list(auto_advances)
    best_rule = "ATCS"

    if best_failures > 0:
        for rule in DISPATCH_RULES:
            trial_moves = list(auto_moves)
            trial_advances = list(auto_advances)

            # Re-schedule with this rule
            trial_blocks = schedule_fn(
                moves=trial_moves,
                advances=trial_advances,
                rule=rule,
            )

            # Run Tier 3 on trial
            trial_blocks = _tier3_resolve_otd_delivery(
                trial_blocks,
                engine_data,
                schedule_fn,
                trial_moves,
                trial_advances,
                decisions,
                max_adv=max_adv,
            )

            n_fails = len(compute_otd_delivery_failures(trial_blocks, engine_data.ops))
            if n_fails < best_failures:
                best_failures = n_fails
                best_blocks = trial_blocks
                best_moves = trial_moves
                best_advances = trial_advances
                best_rule = rule
                if n_fails == 0:
                    break

    if trace is not None:
        trace.append(
            {
                "type": "tier3_done",
                "rules_tried": list(DISPATCH_RULES)
                if best_failures > 0 or best_rule != "ATCS"
                else [],
                "best_rule": best_rule,
                "failures_after": best_failures,
            }
        )

    return best_blocks, best_moves, best_advances, decisions
