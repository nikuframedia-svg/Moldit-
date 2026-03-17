"""Shared types for overflow tier functions — port of overflow/tier-types.ts."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from ..types import AdvanceAction, Block, EOp, MoveAction, ScheduleResult

# RunScheduleFn: (moves, advances?) -> ScheduleResult
RunScheduleFn = Callable[..., ScheduleResult]


@dataclass
class TierState:
    """Mutable state threaded through tier functions."""

    blocks: list[Block]
    sched_result: ScheduleResult
    auto_moves: list[MoveAction] = field(default_factory=list)
    auto_advances: list[AdvanceAction] = field(default_factory=list)


@dataclass
class TierContext:
    """Shared context passed to tier functions."""

    ops: list[EOp]
    user_moves: list[MoveAction]
    m_st: dict[str, str]
    workdays: list[bool]
    twin_partner_map: dict[str, str]
    third_shift: bool = False
    run_schedule: RunScheduleFn = None  # type: ignore[assignment]
    run_schedule_with_leveling: RunScheduleFn | None = None
