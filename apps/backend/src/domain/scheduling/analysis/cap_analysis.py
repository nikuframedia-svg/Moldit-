"""Capacity analysis — per-machine per-day load computation."""

from __future__ import annotations

from ..types import Block, EMachine


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
