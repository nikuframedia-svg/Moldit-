"""Scheduler pipeline — port of scheduler/scheduler.ts.

Main entry point: schedule_all() runs the 16-step pipeline.
"""

from __future__ import annotations

from ..dispatch.rules import create_group_comparator, sort_and_merge_groups
from ..types import (
    AdvanceAction,
    EMachine,
    EOp,
    ETool,
    FeasibilityReport,
    MoveAction,
    ScheduleResult,
    TwinValidationReport,
    WorkforceConfig,
)
from .backward_scheduler import compute_earliest_starts
from .block_merger import merge_consecutive_blocks
from .decision_registry import DecisionRegistry
from .demand_grouper import ToolGroup, group_demand_into_buckets
from .enforce_deadlines import enforce_deadlines
from .load_leveler import level_load
from .repair_violations import repair_schedule_violations
from .slot_allocator import schedule_machines


def _order_machines_by_urgency(
    machines: list[EMachine],
    m_groups: dict[str, list[ToolGroup]],
    comparator,
) -> list[EMachine]:
    """Order machines by urgency of their first tool group."""

    def key_fn(m: EMachine):
        groups = m_groups.get(m.id, [])
        if not groups:
            return (1, 0)  # machines with no work go last
        first = groups[0]
        return (0, first["edd"])

    return sorted(machines, key=key_fn)


def schedule_all(
    *,
    ops: list[EOp],
    m_st: dict[str, str],
    t_st: dict[str, str],
    moves: list[MoveAction],
    machines: list[EMachine],
    tool_map: dict[str, ETool],
    workdays: list[bool],
    n_days: int,
    workforce_config: WorkforceConfig | None = None,
    rule: str = "EDD",
    third_shift: bool = False,
    enable_leveling: bool = True,
    enforce_deadlines_enabled: bool = True,
    advance_overrides: list[AdvanceAction] | None = None,
    twin_validation_report: TwinValidationReport | None = None,
    order_based: bool = False,
    overtime_map: dict[str, dict[int, int]] | None = None,
    disable_tool_merge: bool = False,
) -> ScheduleResult:
    """Run the full scheduling pipeline.

    Pipeline (16 steps):
    1. Twin validation recording
    2-4. (Shipping/work-content/deficit — skipped in initial port)
    5. Backward scheduling
    6. (Scoring — skipped in initial port)
    7. Demand grouping
    8. Sort & merge groups
    9. Machine ordering
    10. Slot allocation (Phase 2)
    11. Load leveling
    12. Block merging
    13. Repair violations
    14. Enforce deadlines
    15. Feasibility report
    16. (Workforce forecast — future)
    """
    registry = DecisionRegistry()

    # ── Step 1: Record twin validation anomalies ──
    if twin_validation_report:
        for a in twin_validation_report.anomalies:
            registry.record(
                type="TWIN_VALIDATION_ANOMALY",
                op_id=a.op_id,
                tool_id=a.tool,
                machine_id=a.machine,
                detail=a.detail,
                metadata={"code": a.code, "sku": a.sku, "twinSku": a.twin_sku},
            )

    # Guard: empty inputs
    if not ops or not machines:
        return ScheduleResult(
            blocks=[],
            decisions=registry.get_all(),
            feasibility=FeasibilityReport(
                total_ops=0, feasible_ops=0, infeasible_ops=0, feasibility_score=1.0
            ),
        )

    # ── Step 5: Backward scheduling ──
    earliest_starts = compute_earliest_starts(ops, workdays, n_days, registry)

    # ── Step 7: Demand grouping ──
    twin_groups = twin_validation_report.twin_groups if twin_validation_report else None
    m_groups = group_demand_into_buckets(
        ops,
        m_st,
        t_st,
        moves,
        tool_map,
        workdays,
        n_days,
        earliest_starts=earliest_starts,
        advance_overrides=advance_overrides,
        twin_groups=twin_groups,
        order_based=order_based,
        third_shift=third_shift,
    )

    # ── Step 8: Sort + merge groups per machine ──
    for m_id in list(m_groups.keys()):
        m_groups[m_id] = sort_and_merge_groups(
            m_groups[m_id], rule, disable_tool_merge=disable_tool_merge
        )

    # ── Step 9: Machine ordering ──
    comparator = create_group_comparator(rule)
    mach_order = _order_machines_by_urgency(machines, m_groups, comparator)

    # ── Step 10: Slot allocation ──
    raw_blocks, infeasibilities = schedule_machines(
        m_groups=m_groups,
        mach_order=mach_order,
        m_st=m_st,
        workdays=workdays,
        workforce_config=workforce_config,
        n_days=n_days,
        third_shift=third_shift,
        registry=registry,
        overtime_map=overtime_map,
    )

    # ── Step 11: Load leveling ──
    if enable_leveling and earliest_starts:
        leveled_blocks = level_load(raw_blocks, machines, workdays, earliest_starts, registry)
    else:
        leveled_blocks = raw_blocks

    # ── Step 12: Block merging ──
    merged_blocks = merge_consecutive_blocks(leveled_blocks)

    # ── Step 13: Repair violations ──
    repaired_blocks, setup_repairs, capacity_repairs = repair_schedule_violations(
        merged_blocks,
        third_shift,
        overtime_map,
    )
    if setup_repairs > 0 or capacity_repairs > 0:
        registry.record(
            type="SCHEDULE_REPAIR",
            detail=f"Post-scheduling repair: {setup_repairs} setup overlaps, {capacity_repairs} overcapacity days",
            metadata={"setupRepairs": setup_repairs, "capacityRepairs": capacity_repairs},
        )

    # ── Step 14: Enforce deadlines ──
    if enforce_deadlines_enabled:
        deadline_inf, remediations = enforce_deadlines(
            ops,
            repaired_blocks,
            tool_map,
            m_st,
            t_st,
            third_shift,
        )
        infeasibilities.extend(deadline_inf)
    else:
        remediations = []

    # ── Step 15: Feasibility report ──
    scheduled_ops = set()
    infeasible_ops = set()
    for b in repaired_blocks:
        if b.type == "ok" and b.qty > 0:
            scheduled_ops.add(b.op_id)
        if b.type == "infeasible":
            infeasible_ops.add(b.op_id)

    total_ops = len(set(op.id for op in ops))
    feasibility_score = scheduled_ops.__len__() / max(total_ops, 1)

    by_reason: dict[str, int] = {}
    for entry in infeasibilities:
        by_reason[entry.reason] = by_reason.get(entry.reason, 0) + 1

    feasibility = FeasibilityReport(
        total_ops=total_ops,
        feasible_ops=len(scheduled_ops),
        infeasible_ops=len(infeasible_ops),
        entries=infeasibilities,
        by_reason=by_reason,
        feasibility_score=feasibility_score,
        remediations=[
            {"type": r.type, "opId": r.op_id, "description": r.description} for r in remediations
        ],
        deadline_feasible=len(remediations) == 0,
    )

    return ScheduleResult(
        blocks=repaired_blocks,
        decisions=registry.get_all(),
        feasibility=feasibility,
        moves=moves,
        advances=advance_overrides or [],
    )


def schedule_from_engine_data(
    engine_data,
    m_st: dict[str, str] | None = None,
    t_st: dict[str, str] | None = None,
    moves: list[MoveAction] | None = None,
    *,
    rule: str = "EDD",
    enable_leveling: bool = True,
) -> ScheduleResult:
    """Convenience wrapper accepting EngineData directly."""
    return schedule_all(
        ops=engine_data.ops,
        m_st=m_st or engine_data.m_st,
        t_st=t_st or engine_data.t_st,
        moves=moves or [],
        machines=engine_data.machines,
        tool_map=engine_data.tool_map,
        workdays=engine_data.workdays,
        n_days=engine_data.n_days,
        workforce_config=engine_data.workforce_config,
        rule=rule,
        third_shift=engine_data.third_shift,
        enable_leveling=enable_leveling,
        twin_validation_report=engine_data.twin_validation_report,
        order_based=engine_data.order_based,
    )
