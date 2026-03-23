"""Dispatch rules — section 3 of the spec.

Five priority rules: ATCS, EDD, CR, SPT, WSPT.
Tool merging and machine urgency ordering.
"""

from __future__ import annotations

import math
from collections.abc import Callable

from .constants import DAY_CAP, K1_VALUES, K2_VALUES, MAX_EDD_GAP
from .types import ToolGroup

# ── Comparator helpers ──


def _supply_boost(g: ToolGroup) -> float:
    """Max supply boost from any bucket in the group (higher = first)."""
    return 0.0  # No supply boosts in base pipeline


def _edd_sort_key(g: ToolGroup) -> tuple[float, float, float]:
    """EDD: smallest edd first, then largest prodMin first."""
    return (-_supply_boost(g), g.edd, -g.total_prod_min)


def _cr_sort_key(g: ToolGroup) -> tuple[float, float, float]:
    """CR: smallest critical ratio first."""
    cr = g.edd / max(g.total_prod_min / DAY_CAP, 0.01)
    return (-_supply_boost(g), cr, -g.total_prod_min)


def _wspt_sort_key(g: ToolGroup) -> tuple[float, float]:
    """WSPT: highest weight/time ratio first."""
    w = 1e6 if g.edd <= 0 else 1.0 / g.edd
    ratio = w / max(g.total_prod_min, 1.0)
    return (-_supply_boost(g), -ratio)


def _spt_sort_key(g: ToolGroup) -> tuple[float, float, float]:
    """SPT: shortest processing time first."""
    return (-_supply_boost(g), g.total_prod_min, g.edd)


def atcs_index(
    total_prod_min: float,
    edd: int,
    setup_min: float,
    k1: float,
    k2: float,
    p_bar: float,
    s_bar: float,
    last_tool: str | None,
    tool_id: str,
) -> float:
    """ATCS priority index I(g). Higher = schedule first."""
    p = max(total_prod_min, 1.0)
    slack = max(edd * DAY_CAP - p, 0.0)
    setup = 0.0 if last_tool == tool_id else setup_min

    term1 = 1.0 / p
    term2 = math.exp(-slack / (k1 * p_bar)) if k1 * p_bar > 0 else 1.0
    term3 = math.exp(-setup / (k2 * s_bar)) if k2 * s_bar > 0 else 1.0

    return term1 * term2 * term3


# ── Sorting ──


def sort_groups(
    groups: list[ToolGroup],
    rule: str = "EDD",
    k1: float = 1.5,
    k2: float = 0.5,
    last_tool: str | None = None,
) -> list[ToolGroup]:
    """Sort ToolGroups by dispatch rule. Returns new sorted list."""
    if rule == "ATCS":
        p_bar, s_bar = _compute_p_bar_s_bar(groups)
        return sorted(
            groups,
            key=lambda g: (
                -atcs_index(
                    g.total_prod_min,
                    g.edd,
                    g.setup_min,
                    k1,
                    k2,
                    p_bar,
                    s_bar,
                    last_tool,
                    g.tool_id,
                )
            ),
        )
    elif rule == "CR":
        return sorted(groups, key=_cr_sort_key)
    elif rule == "WSPT":
        return sorted(groups, key=_wspt_sort_key)
    elif rule == "SPT":
        return sorted(groups, key=_spt_sort_key)
    else:  # EDD (default)
        return sorted(groups, key=_edd_sort_key)


def _compute_p_bar_s_bar(groups: list[ToolGroup]) -> tuple[float, float]:
    """Average processing and setup times for ATCS normalization."""
    if not groups:
        return 1.0, 1.0
    p_bar = sum(g.total_prod_min for g in groups) / len(groups)
    s_bar = sum(g.setup_min for g in groups) / len(groups)
    return max(p_bar, 1.0), max(s_bar, 1.0)


# ── Tool merging ──


def merge_consecutive_tools(groups: list[ToolGroup]) -> list[ToolGroup]:
    """Section 3.2: Merge consecutive groups with same tool and EDD gap ≤ MAX_EDD_GAP."""
    if len(groups) <= 1:
        return groups

    merged: list[ToolGroup] = [groups[0]]
    for g in groups[1:]:
        prev = merged[-1]
        if (
            g.tool_id == prev.tool_id
            and g.machine_id == prev.machine_id
            and abs(g.edd - prev.edd) <= MAX_EDD_GAP
        ):
            # Merge: combine buckets, take max EDD
            prev.buckets.extend(g.buckets)
            prev.total_prod_min += g.total_prod_min
            prev.edd = max(prev.edd, g.edd)
        else:
            merged.append(g)

    return merged


# ── Machine urgency ordering ──


def order_machines_by_urgency(
    machine_groups: dict[str, list[ToolGroup]],
    rule: str = "EDD",
) -> list[str]:
    """Section 3.3: Order machines by their most urgent group."""

    def urgency(mid: str) -> tuple:
        groups = machine_groups[mid]
        if not groups:
            return (float("inf"),)
        best = min(groups, key=lambda g: g.edd)
        return (best.edd, -best.total_prod_min)

    return sorted(machine_groups.keys(), key=urgency)


# ── ATCS grid search ──


def grid_search_atcs(
    machine_groups: dict[str, list[ToolGroup]],
    schedule_fn: Callable[..., float],
) -> tuple[float, float, float]:
    """Section 7: 25 K1×K2 combos. Returns (best_k1, best_k2, best_score)."""
    best_k1, best_k2, best_score = 1.5, 0.5, float("inf")

    for k1 in K1_VALUES:
        for k2 in K2_VALUES:
            score = schedule_fn(k1=k1, k2=k2)
            if score < best_score:
                best_score = score
                best_k1 = k1
                best_k2 = k2

    return best_k1, best_k2, best_score
