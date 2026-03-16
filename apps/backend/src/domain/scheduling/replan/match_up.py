"""Match-up replan — port of replan/match-up.ts.

Layer 2: finds match-up point where schedule converges, reschedules with ATCS.
Used for 30 min <= delay <= 2h.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..constants import S1
from ..types import Block


@dataclass
class MatchUpInput:
    perturbed_op_id: str
    delay_min: int
    machine_id: str
    original_blocks: list[Block]
    # schedule_input params would be passed to schedule_all


@dataclass
class MatchUpResult:
    blocks: list[Block] = field(default_factory=list)
    match_up_day: int = 0
    rescheduled_ops: list[str] = field(default_factory=list)
    emergency_night_shift: bool = False


def find_match_up_point(
    original_blocks: list[Block],
    machine_id: str,
    perturbation_day: int,
    n_days: int,
) -> int:
    """Find the day where the new schedule converges with the original."""
    m_blocks = [b for b in original_blocks if b.machine_id == machine_id and b.type == "ok"]
    if not m_blocks:
        return perturbation_day + 1

    max_day = max(b.day_idx for b in m_blocks)
    return min(max_day + 1, n_days - 1)


def replan_match_up(
    blocks: list[Block],
    inp: MatchUpInput,
    schedule_fn=None,
) -> MatchUpResult:
    """Layer 2 replan: match-up point + ATCS reschedule.

    Args:
        blocks: Current schedule blocks
        inp: Match-up input parameters
        schedule_fn: Optional function(moves, advances) -> ScheduleResult
            If not provided, returns blocks unchanged with metadata
    """
    # Find perturbed block day
    pert_day = 0
    for b in blocks:
        if b.op_id == inp.perturbed_op_id:
            pert_day = b.day_idx
            break

    n_days = max((b.day_idx + 1 for b in blocks), default=1)
    match_up_day = find_match_up_point(inp.original_blocks, inp.machine_id, pert_day, n_days)

    # Find affected ops in [pert_day, match_up_day] window
    affected_ops: set[str] = set()
    for b in blocks:
        if (
            b.machine_id == inp.machine_id
            and pert_day <= b.day_idx <= match_up_day
            and b.type != "blocked"
            and b.freeze_status != "frozen"
        ):
            affected_ops.add(b.op_id)

    if not affected_ops:
        return MatchUpResult(blocks=blocks, match_up_day=match_up_day)

    # If schedule_fn provided, re-run with ATCS
    if schedule_fn:
        result = schedule_fn([], None)
        emergency = any(
            b.machine_id == inp.machine_id and b.end_min > S1 and b.shift != "Z"
            for b in result.blocks
        )
        return MatchUpResult(
            blocks=result.blocks,
            match_up_day=match_up_day,
            rescheduled_ops=list(affected_ops),
            emergency_night_shift=emergency,
        )

    return MatchUpResult(
        blocks=blocks,
        match_up_day=match_up_day,
        rescheduled_ops=list(affected_ops),
    )
