"""ATCS (Apparent Tardiness Cost with Setups) dispatch rule.

Port of scheduler/atcs-dispatch.ts.
Priority = (1/p) × exp(-slack/(k1×p̄)) × exp(-setup/(k2×s̄))
Higher = schedule first.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


@dataclass
class ATCSParams:
    k1: float = 1.0  # slack sensitivity
    k2: float = 0.5  # setup sensitivity


@dataclass
class ATCSAverages:
    avg_prod_min: float
    avg_setup_min: float


def atcs_priority(
    prod_min: float,
    slack: float,
    setup_min: float,
    k1: float,
    k2: float,
    avg_prod_min: float,
    avg_setup_min: float,
    weight: float = 1.0,
) -> float:
    """Compute ATCS priority index for a group.

    Args:
        prod_min: total production time (minutes)
        slack: time remaining before deadline - processing time
        setup_min: setup time if tool changes
        k1: slack sensitivity parameter
        k2: setup sensitivity parameter
        avg_prod_min: average production time across all groups
        avg_setup_min: average setup time across all groups
        weight: job weight/priority
    """
    if prod_min <= 0:
        return 0.0

    base = weight / prod_min

    # Slack factor
    if avg_prod_min > 0 and k1 > 0:
        slack_exp = -max(slack, 0) / (k1 * avg_prod_min)
        slack_factor = math.exp(max(slack_exp, -20))
    else:
        slack_factor = 1.0

    # Setup factor
    if avg_setup_min > 0 and k2 > 0:
        setup_exp = -setup_min / (k2 * avg_setup_min)
        setup_factor = math.exp(max(setup_exp, -20))
    else:
        setup_factor = 1.0

    return base * slack_factor * setup_factor


def compute_atcs_averages(groups: list[dict[str, Any]]) -> ATCSAverages:
    """Compute average production and setup times across groups."""
    if not groups:
        return ATCSAverages(avg_prod_min=60, avg_setup_min=45)

    total_prod = sum(g.get("prodMin", 60) for g in groups)
    total_setup = sum(g.get("setupMin", 45) for g in groups)
    n = len(groups)
    return ATCSAverages(
        avg_prod_min=total_prod / n if n > 0 else 60,
        avg_setup_min=total_setup / n if n > 0 else 45,
    )


# Grid search K1/K2 values
K1_VALUES = [0.5, 1.0, 1.5, 2.0, 3.0]
K2_VALUES = [0.1, 0.25, 0.5, 0.75, 1.0]


@dataclass
class GridSearchResult:
    best_params: ATCSParams
    best_score: float
    results: list[dict]


def atcs_grid_search(
    groups: list[dict[str, Any]],
    score_fn: Any = None,
) -> GridSearchResult:
    """Grid search 5×5 for best k1, k2 combination.

    If no score function provided, uses default urgency-weighted scoring.
    """
    avgs = compute_atcs_averages(groups)
    best_params = ATCSParams()
    best_score = -float("inf")
    results: list[dict] = []

    for k1 in K1_VALUES:
        for k2 in K2_VALUES:
            # Score: sum of priorities for all groups
            total_priority = 0.0
            for g in groups:
                p = atcs_priority(
                    prod_min=g.get("prodMin", 60),
                    slack=g.get("slack", 0),
                    setup_min=g.get("setupMin", 45),
                    k1=k1,
                    k2=k2,
                    avg_prod_min=avgs.avg_prod_min,
                    avg_setup_min=avgs.avg_setup_min,
                    weight=g.get("weight", 1.0),
                )
                total_priority += p

            score = total_priority
            results.append({"k1": k1, "k2": k2, "score": score})
            if score > best_score:
                best_score = score
                best_params = ATCSParams(k1=k1, k2=k2)

    return GridSearchResult(best_params=best_params, best_score=best_score, results=results)
