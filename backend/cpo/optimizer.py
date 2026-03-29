"""CPO v3.0 Optimizer — Entry point.

Modes:
  quick  (~200ms): greedy baseline only (schedule_all passthrough)
  normal (5-15s):  Phase 0 (greedy) + Phase 1 (GA polish)
  deep   (1-3min): + surrogate pre-screening + larger population
  max    (5min+):  + MAP-Elites + full search
"""

from __future__ import annotations

import logging

from backend.config.types import FactoryConfig
from backend.scheduler.types import ScheduleResult
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)


# Mode configurations
MODE_CONFIG = {
    "quick": {
        "pop_size": 0,
        "max_gen": 0,
        "time_budget": 0.5,
        "use_surrogate": False,
        "use_archive": False,
    },
    "normal": {
        "pop_size": 20,
        "max_gen": 30,
        "time_budget": 15.0,
        "use_surrogate": False,
        "use_archive": True,
    },
    "deep": {
        "pop_size": 40,
        "max_gen": 100,
        "time_budget": 120.0,
        "use_surrogate": True,
        "use_archive": True,
    },
    "max": {
        "pop_size": 60,
        "max_gen": 300,
        "time_budget": 300.0,
        "use_surrogate": True,
        "use_archive": True,
    },
}


def optimize(
    engine_data: MolditEngineData,
    mode: str = "normal",
    config: FactoryConfig | None = None,
    seed: int | None = 42,
    audit: bool = False,
) -> ScheduleResult:
    """CPO v3.0 entry point."""
    raise NotImplementedError("Moldit CPO — Phase 3")
