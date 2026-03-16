"""Partial replan — port of replan/partial-replan.ts.

Layer 3: dependency graph propagation, reschedule affected ops only.
Used for delay > 2h.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..constants import S1
from ..types import Block, EOp, ETool


@dataclass
class PartialReplanInput:
    event_type: str  # 'breakdown' | 'rush_order' | 'material_shortage'
    machine_id: str | None = None
    affected_op_ids: list[str] = field(default_factory=list)


@dataclass
class PartialReplanResult:
    blocks: list[Block] = field(default_factory=list)
    rescheduled_ops: list[str] = field(default_factory=list)
    frozen_ops: list[str] = field(default_factory=list)
    emergency_night_shift: bool = False


def propagate_impact(
    affected_op_ids: list[str],
    all_ops: list[EOp],
    tool_map: dict[str, ETool],
    blocks: list[Block],
    machine_id: str | None = None,
) -> set[str]:
    """Build transitive closure of affected operations.

    Machine impact: all ops on that machine.
    Tool impact: ops sharing tools with affected ops on shared machines.
    """
    affected = set(affected_op_ids)

    # Machine impact
    if machine_id:
        for op in all_ops:
            if op.m == machine_id:
                affected.add(op.id)
        for b in blocks:
            if b.machine_id == machine_id:
                affected.add(b.op_id)

    # Tool impact (transitive)
    affected_tools: set[str] = set()
    affected_machines: set[str] = set()
    for op in all_ops:
        if op.id in affected:
            affected_tools.add(op.t)
            affected_machines.add(op.m)

    for op in all_ops:
        if op.id not in affected and op.t in affected_tools and op.m in affected_machines:
            affected.add(op.id)

    return affected


def replan_partial(
    blocks: list[Block],
    inp: PartialReplanInput,
    all_ops: list[EOp],
    tool_map: dict[str, ETool],
    schedule_fn=None,
) -> PartialReplanResult:
    """Layer 3 replan: impact propagation + selective reschedule.

    Args:
        blocks: Current blocks
        inp: Partial replan input
        all_ops: All operations
        tool_map: Tool definitions
        schedule_fn: Optional schedule function
    """
    affected = propagate_impact(
        inp.affected_op_ids,
        all_ops,
        tool_map,
        blocks,
        inp.machine_id,
    )
    frozen_ops = [op.id for op in all_ops if op.id not in affected]

    if schedule_fn:
        result = schedule_fn([], None)
        # Assign freeze status
        for b in result.blocks:
            if b.op_id in affected:
                b.freeze_status = "liquid"
            else:
                b.freeze_status = "frozen"

        emergency = any(
            b.op_id in affected and b.end_min > S1 and b.shift != "Z" for b in result.blocks
        )
        return PartialReplanResult(
            blocks=result.blocks,
            rescheduled_ops=list(affected),
            frozen_ops=frozen_ops,
            emergency_night_shift=emergency,
        )

    # Without schedule_fn, just annotate freeze status
    new_blocks = [b.model_copy(deep=True) for b in blocks]
    for b in new_blocks:
        b.freeze_status = "liquid" if b.op_id in affected else "frozen"

    return PartialReplanResult(
        blocks=new_blocks,
        rescheduled_ops=list(affected),
        frozen_ops=frozen_ops,
    )
