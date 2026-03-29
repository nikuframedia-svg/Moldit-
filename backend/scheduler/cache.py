"""Idempotency cache — Moldit Planner.

Will be rewritten in Phase 3.
"""

from __future__ import annotations

from backend.scheduler.types import ScheduleResult


def get_cached(*args, **kwargs) -> ScheduleResult | None:  # type: ignore[no-untyped-def]
    """Stub — Phase 3."""
    return None


def cache_result(*args, **kwargs) -> None:  # type: ignore[no-untyped-def]
    """Stub — Phase 3."""
