"""Right-shift replan — port of replan/right-shift.ts.

Layer 1: propagates delay forward to all subsequent blocks on same machine.
Fastest, no resequencing. Used for delays < 30 minutes.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..constants import S1, S2
from ..types import Block


@dataclass
class RightShiftInput:
    perturbed_op_id: str
    delay_min: int
    machine_id: str


@dataclass
class RightShiftResult:
    blocks: list[Block] = field(default_factory=list)
    affected_ops: list[str] = field(default_factory=list)
    total_propagated_delay: int = 0
    has_overflow: bool = False
    emergency_night_shift: bool = False


def replan_right_shift(
    blocks: list[Block],
    inp: RightShiftInput,
) -> RightShiftResult:
    """Propagate delay forward on same machine."""
    # Deep copy blocks
    new_blocks = [b.model_copy(deep=True) for b in blocks]

    # Filter + sort machine blocks chronologically
    m_blocks = sorted(
        [b for b in new_blocks if b.machine_id == inp.machine_id and b.type != "blocked"],
        key=lambda b: b.day_idx * 1440 + b.start_min,
    )

    # Find perturbed block
    perturbed_idx = -1
    for i, b in enumerate(m_blocks):
        if b.op_id == inp.perturbed_op_id:
            perturbed_idx = i
            break

    if perturbed_idx < 0 or inp.delay_min <= 0:
        return RightShiftResult(blocks=new_blocks)

    affected: set[str] = set()
    has_overflow = False
    emergency = False
    delay = inp.delay_min

    for b in m_blocks[perturbed_idx:]:
        b.start_min += delay
        b.end_min += delay
        if b.setup_s is not None and b.setup_e is not None:
            b.setup_s += delay
            b.setup_e += delay
        affected.add(b.op_id)

        # Check overflow
        day_end = S2 if b.shift == "Z" else S1
        if b.end_min > day_end:
            b.overflow = True
            b.overflow_min = b.end_min - day_end
            has_overflow = True
            if b.end_min > S2:
                emergency = True

    return RightShiftResult(
        blocks=new_blocks,
        affected_ops=list(affected),
        total_propagated_delay=delay,
        has_overflow=has_overflow,
        emergency_night_shift=emergency,
    )
