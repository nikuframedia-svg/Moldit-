"""Dispatch rules — EDD, CR, WSPT, SPT, ATCS.

Port of scheduler/dispatch-rules.ts.
"""

from __future__ import annotations

from collections.abc import Callable

from .atcs import ATCSParams, atcs_priority, compute_atcs_averages


def create_group_comparator(
    rule: str,
    supply_boosts: dict[str, float] | None = None,
    atcs_params: ATCSParams | None = None,
    groups: list[dict] | None = None,
) -> Callable[[dict, dict], int]:
    """Create a comparison function for sorting groups by dispatch rule.

    Returns comparator: negative if a < b (a first), positive if a > b (b first).
    """
    boosts = supply_boosts or {}

    # Pre-compute ATCS averages if needed
    avgs = None
    if rule == "ATCS" and groups:
        avgs = compute_atcs_averages(groups)

    params = atcs_params or ATCSParams()

    def _cmp(a: dict, b: dict) -> int:
        # Supply boost always wins
        ba = boosts.get(a.get("toolId", ""), 0)
        bb = boosts.get(b.get("toolId", ""), 0)
        if ba != bb:
            return -1 if ba > bb else 1

        if rule == "EDD":
            # Earliest due date first
            ea = a.get("edd", 9999)
            eb = b.get("edd", 9999)
            return -1 if ea < eb else (1 if ea > eb else 0)

        if rule == "CR":
            # Critical ratio: lower = more urgent
            cra = _critical_ratio(a)
            crb = _critical_ratio(b)
            return -1 if cra < crb else (1 if cra > crb else 0)

        if rule == "SPT":
            # Shortest processing time first
            pa = a.get("prodMin", 0)
            pb = b.get("prodMin", 0)
            return -1 if pa < pb else (1 if pa > pb else 0)

        if rule == "WSPT":
            # Weighted SPT: higher weight/time first
            wa = _wspt(a)
            wb = _wspt(b)
            return -1 if wa > wb else (1 if wa < wb else 0)

        if rule == "ATCS":
            # ATCS priority: higher first
            avg_prod = avgs.avg_prod_min if avgs else 60
            avg_setup = avgs.avg_setup_min if avgs else 45
            pa = atcs_priority(
                a.get("prodMin", 60),
                a.get("slack", 0),
                a.get("setupMin", 45),
                params.k1,
                params.k2,
                avg_prod,
                avg_setup,
                a.get("weight", 1.0),
            )
            pb = atcs_priority(
                b.get("prodMin", 60),
                b.get("slack", 0),
                b.get("setupMin", 45),
                params.k1,
                params.k2,
                avg_prod,
                avg_setup,
                b.get("weight", 1.0),
            )
            return -1 if pa > pb else (1 if pa < pb else 0)

        # Default: EDD
        ea = a.get("edd", 9999)
        eb = b.get("edd", 9999)
        return -1 if ea < eb else (1 if ea > eb else 0)

    return _cmp


def _critical_ratio(g: dict) -> float:
    """CR = time remaining / processing time. Lower = more urgent."""
    prod = g.get("prodMin", 1)
    if prod <= 0:
        return 0.0
    slack = g.get("slack", 0)
    return max(slack, 0) / prod


def _wspt(g: dict) -> float:
    """WSPT = weight / processing time. Higher = schedule first."""
    prod = g.get("prodMin", 1)
    if prod <= 0:
        return float("inf")
    return g.get("weight", 1.0) / prod


def sort_groups(groups: list[dict], comparator: Callable[[dict, dict], int]) -> list[dict]:
    """Sort groups using comparator."""
    import functools

    return sorted(groups, key=functools.cmp_to_key(comparator))


def _get_key(g: dict, *keys: str):
    """Get value from dict trying multiple key names (camelCase and snake_case)."""
    for k in keys:
        if k in g:
            return g[k]
    return None


def merge_consecutive_tools(groups: list[dict], max_edd_gap: int = 5) -> list[dict]:
    """Merge consecutive groups with same tool to reduce setups.

    Supports both camelCase (toolId) and snake_case (tool_id) keys.
    """
    if len(groups) <= 1:
        return groups

    merged: list[dict] = [groups[0]]
    for g in groups[1:]:
        prev = merged[-1]
        g_tool = _get_key(g, "toolId", "tool_id")
        p_tool = _get_key(prev, "toolId", "tool_id")
        g_mach = _get_key(g, "machineId", "machine_id")
        p_mach = _get_key(prev, "machineId", "machine_id")
        if (
            g_tool == p_tool
            and g_mach == p_mach
            and abs(g.get("edd", 0) - prev.get("edd", 0)) <= max_edd_gap
        ):
            # Merge: combine quantities, keep earlier EDD
            prev["qty"] = prev.get("qty", 0) + g.get("qty", 0)
            prod_key = "prodMin" if "prodMin" in prev else "total_prod_min"
            prev[prod_key] = prev.get(prod_key, 0) + g.get(prod_key, 0)
            prev["edd"] = min(prev.get("edd", 9999), g.get("edd", 9999))
            if "buckets" in prev and "buckets" in g:
                prev["buckets"] = prev["buckets"] + g["buckets"]
            if "skus" in prev and "skus" in g:
                prev["skus"] = prev["skus"] + g["skus"]
        else:
            merged.append(g)
    return merged


def sort_and_merge_groups(
    groups: list[dict],
    rule: str = "ATCS",
    max_edd_gap: int = 5,
    supply_boosts: dict[str, float] | None = None,
    atcs_params: ATCSParams | None = None,
    disable_tool_merge: bool = False,
) -> list[dict]:
    """Full pipeline: sort → tool merge → return."""
    cmp = create_group_comparator(rule, supply_boosts, atcs_params, groups)
    sorted_groups = sort_groups(groups, cmp)
    if disable_tool_merge:
        return sorted_groups
    return merge_consecutive_tools(sorted_groups, max_edd_gap)
