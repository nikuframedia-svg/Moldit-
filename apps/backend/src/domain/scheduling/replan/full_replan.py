"""Full replan — port of replan/full-replan.ts.

Layer 4: complete schedule regeneration with ATCS, preserves frozen zone.
Used for catastrophic disruption.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..constants import S1
from ..types import Block

DEFAULT_FROZEN_DAY_LIMIT = 5


@dataclass
class FullReplanInput:
    frozen_day_limit: int = DEFAULT_FROZEN_DAY_LIMIT


@dataclass
class FullReplanResult:
    blocks: list[Block] = field(default_factory=list)
    frozen_count: int = 0
    emergency_night_shift: bool = False


def assign_freeze_zones(
    blocks: list[Block], frozen_day_limit: int = DEFAULT_FROZEN_DAY_LIMIT
) -> list[Block]:
    """Assign freeze status to blocks based on day index.

    frozen: dayIdx < frozenDayLimit
    slushy: frozenDayLimit <= dayIdx < frozenDayLimit + 10
    liquid: dayIdx >= frozenDayLimit + 10
    """
    new_blocks = [b.model_copy(deep=True) for b in blocks]
    slushy_limit = frozen_day_limit + 10
    for b in new_blocks:
        if b.day_idx < frozen_day_limit:
            b.freeze_status = "frozen"
        elif b.day_idx < slushy_limit:
            b.freeze_status = "slushy"
        else:
            b.freeze_status = "liquid"
    return new_blocks


def replan_full(
    inp: FullReplanInput,
    schedule_fn=None,
) -> FullReplanResult:
    """Layer 4 replan: full regeneration with freeze zones.

    Args:
        inp: Full replan input (frozen day limit)
        schedule_fn: Schedule function(moves, advances) -> ScheduleResult
    """
    if not schedule_fn:
        return FullReplanResult()

    result = schedule_fn([], None)
    blocks = assign_freeze_zones(result.blocks, inp.frozen_day_limit)

    frozen_count = sum(1 for b in blocks if b.freeze_status == "frozen")
    emergency = any(b.end_min > S1 and b.shift != "Z" for b in blocks)

    return FullReplanResult(
        blocks=blocks,
        frozen_count=frozen_count,
        emergency_night_shift=emergency,
    )
