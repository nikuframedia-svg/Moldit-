"""Scoring wrapper — section 14 of the spec.

Thin wrapper around the existing score_schedule from analysis/.
"""

from __future__ import annotations

from typing import Any

from ..scheduling.analysis.score_schedule import score_schedule
from ..scheduling.types import Block, EngineData


def score_greedy_schedule(
    blocks: list[Block],
    engine_data: EngineData,
) -> dict[str, Any]:
    """Score a schedule using the existing multi-objective scorer.

    Returns dict with: score, otd, produced, total_demand, setup_count, cap_util, etc.
    """
    result = score_schedule(
        blocks=blocks,
        ops=engine_data.ops,
        machines=engine_data.machines,
        n_days=engine_data.n_days,
    )

    # Convert OptResult to dict
    return {
        "score": getattr(result, "score", 0),
        "otd": getattr(result, "otd", 100.0),
        "otd_delivery": getattr(result, "otd_delivery", 100.0),
        "produced": getattr(result, "produced", 0),
        "total_demand": getattr(result, "total_demand", 0),
        "setup_count": getattr(result, "setup_count", 0),
        "setup_min": getattr(result, "setup_min", 0),
        "cap_util": getattr(result, "cap_util", 0.0),
        "cap_var": getattr(result, "cap_var", 0.0),
        "tardiness_days": getattr(result, "tardiness_days", 0.0),
        "overflows": getattr(result, "overflows", 0),
        "deadline_feasible": getattr(result, "deadline_feasible", True),
    }
