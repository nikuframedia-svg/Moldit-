"""Validate schedule — port of analysis/validate-schedule.ts.

Post-schedule constraint validation: tool uniqueness, setup crew, overcapacity, deadline misses.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..constants import DAY_CAP
from ..types import Block, EMachine, EOp, ETool, MoveAction

MINUTES_PER_DAY = 1440


@dataclass
class AffectedOp:
    op_id: str
    tool_id: str
    machine_id: str
    day_idx: int


@dataclass
class ScheduleViolation:
    id: str
    type: str  # TOOL_UNIQUENESS, SETUP_CREW_OVERLAP, MACHINE_OVERCAPACITY, DEADLINE_MISS
    severity: str  # critical, high, medium, low
    title: str
    detail: str
    affected_ops: list[AffectedOp] = field(default_factory=list)
    suggested_fix: str | None = None
    action: MoveAction | None = None


@dataclass
class ValidationSummary:
    tool_conflicts: int = 0
    setup_overlaps: int = 0
    machine_overcapacity: int = 0
    efficiency_warnings: int = 0
    deadline_misses: int = 0
    twin_blocks: int = 0
    twin_groups: int = 0


@dataclass
class ScheduleValidationReport:
    valid: bool = True
    violations: list[ScheduleViolation] = field(default_factory=list)
    summary: ValidationSummary = field(default_factory=ValidationSummary)


def _get_block_production_for_op(blocks: list[Block], op_id: str) -> int:
    total = 0
    for b in blocks:
        if b.type != "ok" or b.qty <= 0:
            continue
        if b.op_id == op_id:
            total += b.qty
        if b.outputs:
            for out in b.outputs:
                if out.op_id == op_id:
                    total += out.qty
    return total


def validate_schedule(
    blocks: list[Block],
    machines: list[EMachine],
    tool_map: dict[str, ETool],
    ops: list[EOp],
    third_shift: bool = False,
    n_days: int | None = None,
) -> ScheduleValidationReport:
    """Validate a schedule for constraint violations."""
    violations: list[ScheduleViolation] = []
    v_idx = 0

    ok_blocks = [b for b in blocks if b.type == "ok"]
    e_day_cap = MINUTES_PER_DAY if third_shift else DAY_CAP

    # ── Check 1: Tool uniqueness ──
    tools_used: dict[str, list[Block]] = {}
    for b in ok_blocks:
        if b.tool_id not in tools_used:
            tools_used[b.tool_id] = []
        tools_used[b.tool_id].append(b)

    for tool_id, t_blocks in tools_used.items():
        for i in range(len(t_blocks)):
            for j in range(i + 1, len(t_blocks)):
                bi, bj = t_blocks[i], t_blocks[j]
                if bi.machine_id == bj.machine_id:
                    continue
                a_s = bi.day_idx * MINUTES_PER_DAY + (
                    bi.setup_s if bi.setup_s is not None else bi.start_min
                )
                a_e = bi.day_idx * MINUTES_PER_DAY + bi.end_min
                b_s = bj.day_idx * MINUTES_PER_DAY + (
                    bj.setup_s if bj.setup_s is not None else bj.start_min
                )
                b_e = bj.day_idx * MINUTES_PER_DAY + bj.end_min
                if a_s < b_e and b_s < a_e:
                    v_idx += 1
                    violations.append(
                        ScheduleViolation(
                            id=f"V-{v_idx}",
                            type="TOOL_UNIQUENESS",
                            severity="critical",
                            title=f"Tool {tool_id} on 2 machines simultaneously",
                            detail=f"{bi.machine_id} and {bj.machine_id} overlap",
                            affected_ops=[
                                AffectedOp(
                                    op_id=bi.op_id,
                                    tool_id=tool_id,
                                    machine_id=bi.machine_id,
                                    day_idx=bi.day_idx,
                                ),
                                AffectedOp(
                                    op_id=bj.op_id,
                                    tool_id=tool_id,
                                    machine_id=bj.machine_id,
                                    day_idx=bj.day_idx,
                                ),
                            ],
                        )
                    )

    # ── Check 2: Setup crew overlaps ──
    setup_slots = []
    for b in ok_blocks:
        if b.setup_s is not None and b.setup_e is not None:
            setup_slots.append(
                {
                    "start": b.day_idx * MINUTES_PER_DAY + b.setup_s,
                    "end": b.day_idx * MINUTES_PER_DAY + b.setup_e,
                    "machine": b.machine_id,
                    "block": b,
                }
            )

    for i in range(len(setup_slots)):
        for j in range(i + 1, len(setup_slots)):
            si, sj = setup_slots[i], setup_slots[j]
            if si["machine"] == sj["machine"]:
                continue
            if si["start"] < sj["end"] and sj["start"] < si["end"]:
                v_idx += 1
                violations.append(
                    ScheduleViolation(
                        id=f"V-{v_idx}",
                        type="SETUP_CREW_OVERLAP",
                        severity="high",
                        title="Simultaneous setups on different machines",
                        detail=f"{si['machine']} and {sj['machine']}",
                        affected_ops=[
                            AffectedOp(
                                op_id=si["block"].op_id,
                                tool_id=si["block"].tool_id,
                                machine_id=si["machine"],
                                day_idx=si["block"].day_idx,
                            ),
                            AffectedOp(
                                op_id=sj["block"].op_id,
                                tool_id=sj["block"].tool_id,
                                machine_id=sj["machine"],
                                day_idx=sj["block"].day_idx,
                            ),
                        ],
                    )
                )

    # ── Check 3: Machine overcapacity ──
    for m in machines:
        day_totals: dict[int, int] = {}
        for b in ok_blocks:
            if b.machine_id != m.id:
                continue
            total = b.end_min - b.start_min
            if b.setup_s is not None and b.setup_e is not None:
                total += b.setup_e - b.setup_s
            day_totals[b.day_idx] = day_totals.get(b.day_idx, 0) + total

        for di, total in day_totals.items():
            if total > e_day_cap:
                v_idx += 1
                violations.append(
                    ScheduleViolation(
                        id=f"V-{v_idx}",
                        type="MACHINE_OVERCAPACITY",
                        severity="high",
                        title=f"{m.id} overcapacity on day {di}",
                        detail=f"{total} min > {e_day_cap} min capacity",
                    )
                )

    # ── Check 4: Deadline misses ──
    ops_by_tool: dict[str, list[EOp]] = {}
    for op in ops:
        if op.t not in ops_by_tool:
            ops_by_tool[op.t] = []
        ops_by_tool[op.t].append(op)

    for tool_id, tool_ops in ops_by_tool.items():
        tool_demand = sum(sum(max(v, 0) for v in op.d) + max(op.atr, 0) for op in tool_ops)
        tool_produced = sum(_get_block_production_for_op(blocks, op.id) for op in tool_ops)
        if tool_demand > 0 and tool_produced < tool_demand:
            v_idx += 1
            tool = tool_map.get(tool_id)
            fix = f"Move to {tool.alt}" if tool and tool.alt and tool.alt != "-" else None
            violations.append(
                ScheduleViolation(
                    id=f"V-{v_idx}",
                    type="DEADLINE_MISS",
                    severity="critical",
                    title=f"Demand not met for {tool_id}",
                    detail=f"Produced {tool_produced} of {tool_demand} ({tool_demand - tool_produced} short)",
                    suggested_fix=fix,
                )
            )

    # ── Twin summary ──
    twin_ok = [b for b in ok_blocks if b.is_twin_production]
    twin_group_ids = set(b.co_production_group_id for b in twin_ok if b.co_production_group_id)

    summary = ValidationSummary(
        tool_conflicts=sum(1 for v in violations if v.type == "TOOL_UNIQUENESS"),
        setup_overlaps=sum(1 for v in violations if v.type == "SETUP_CREW_OVERLAP"),
        machine_overcapacity=sum(1 for v in violations if v.type == "MACHINE_OVERCAPACITY"),
        deadline_misses=sum(1 for v in violations if v.type == "DEADLINE_MISS"),
        twin_blocks=len(twin_ok),
        twin_groups=len(twin_group_ids),
    )

    is_valid = not any(v.severity in ("critical", "high") for v in violations)

    return ScheduleValidationReport(valid=is_valid, violations=violations, summary=summary)
