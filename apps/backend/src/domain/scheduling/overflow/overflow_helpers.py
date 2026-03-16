"""Overflow shared helpers — port of overflow/overflow-helpers.ts.

Pure utility functions used across auto-replan strategies.
"""

from __future__ import annotations

from ..types import Block, EMachine


def sum_overflow(blocks: list[Block]) -> int:
    """Sum total overflow minutes across all overflow/infeasible blocks."""
    total = 0
    for b in blocks:
        if b.overflow and b.overflow_min:
            total += b.overflow_min
        elif b.type == "infeasible" and b.prod_min > 0:
            total += b.prod_min
    return total


def compute_tardiness(blocks: list[Block]) -> int:
    """Sum production minutes of blocks scheduled AFTER their deadline (tardy but type='ok')."""
    total = 0
    for b in blocks:
        if b.type == "ok" and b.edd_day is not None and b.day_idx > b.edd_day:
            total += b.prod_min
    return total


def cap_analysis(
    blocks: list[Block],
    machines: list[EMachine],
) -> dict[str, list[dict[str, int]]]:
    """Compute per-machine per-day load from blocks.

    Returns {machine_id: [{prod, setup}, ...]} indexed by day.
    """
    n_days = 0
    for b in blocks:
        if b.day_idx + 1 > n_days:
            n_days = b.day_idx + 1

    result: dict[str, list[dict[str, int]]] = {}
    for m in machines:
        days = [{"prod": 0, "setup": 0} for _ in range(n_days)]
        for b in blocks:
            if b.machine_id != m.id or b.day_idx < 0 or b.day_idx >= n_days:
                continue
            days[b.day_idx]["prod"] += b.prod_min
            days[b.day_idx]["setup"] += b.setup_min
        result[m.id] = days
    return result


def compute_advanced_edd(from_day: int, advance_days: int, workdays: list[bool]) -> int:
    """Count backward working days from `from_day`.

    Returns the target day index, or -1 if not enough working days.
    """
    target = from_day
    days_back = 0
    for d in range(from_day - 1, -1, -1):
        if not workdays or workdays[d]:
            days_back += 1
            target = d
        if days_back >= advance_days:
            break
    return target if days_back == advance_days else -1
