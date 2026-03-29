"""Scheduler entry point — Moldit Planner.

Pipeline (stubbed — Phase 3 will implement Moldit-specific dispatch):
  Phase 1: priority ordering  — operations sorted by urgency/critical path
  Phase 2: dispatch           — assign operations to machines + time slots
  Phase 3: scoring            — KPI computation
"""

from __future__ import annotations

import logging

from backend.config.types import FactoryConfig
from backend.scheduler.types import ScheduleResult
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)


def schedule_all(
    data: MolditEngineData,
    audit: bool = False,
    config: FactoryConfig | None = None,
) -> ScheduleResult:
    """Run the full scheduling pipeline."""
    raise NotImplementedError("Moldit scheduler pipeline — Phase 3")
