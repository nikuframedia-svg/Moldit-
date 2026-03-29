"""CP-SAT surgical polisher -- Moldit Planner.

Pass-through stub. Full CP-SAT polishing will be implemented in a future phase.
"""

from __future__ import annotations

from backend.config.types import FactoryConfig
from backend.scheduler.types import ScheduleResult
from backend.types import MolditEngineData


def cpsat_polish(
    result: ScheduleResult,
    data: MolditEngineData,
    config: FactoryConfig | None = None,
) -> ScheduleResult:
    """Pass-through: returns result unchanged."""
    return result
