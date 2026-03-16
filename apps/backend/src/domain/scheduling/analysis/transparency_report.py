"""Transparency report — port of analysis/transparency-report.ts.

Per-order justifications explaining WHY operations are scheduled when/where.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..constants import DAY_CAP, DEFAULT_OEE
from ..types import Block, DecisionEntry, EOp, ETool, InfeasibilityEntry


@dataclass
class OrderJustification:
    op_id: str
    sku: str = ""
    initial_stock: int = 0
    initial_deficit: int = 0
    pH: int = 0
    oee: float = DEFAULT_OEE
    capacity_pcs_per_day: float = 0
    allocated_hours_per_day: float = 0
    start_reason: str = "free_window_available"
    feasible: bool = True
    total_produced: int = 0
    total_demand: int = 0
    is_twin_production: bool = False
    twin_partner_sku: str | None = None


@dataclass
class FailureJustification:
    op_id: str
    sku: str = ""
    constraints_violated: list[str] = field(default_factory=list)
    first_impossible_moment: int = 0
    missing_capacity_hours: float = 0
    missing_capacity_pieces: int = 0
    suggestions: list[str] = field(default_factory=list)


@dataclass
class CapacityLogEntry:
    op_id: str
    tool_id: str = ""
    machine_id: str = ""
    oee_value: float = DEFAULT_OEE
    oee_source: str = "default"
    pieces_per_hour: int = 0
    available_hours_per_day: float = 0
    resulting_capacity_pcs_per_day: float = 0
    work_content_hours: float = 0
    days_required: float = 0


@dataclass
class TransparencyReport:
    order_justifications: list[OrderJustification] = field(default_factory=list)
    failure_justifications: list[FailureJustification] = field(default_factory=list)
    capacity_log: list[CapacityLogEntry] = field(default_factory=list)


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


def _determine_start_reason(
    blocks: list[Block],
    op: EOp,
    demand: int,
) -> str:
    """Determine why production started when it did."""
    # Deficit at start (backlog)
    if op.atr > 0:
        return "deficit_elimination"

    # Check if any block is leveled
    for b in blocks:
        if b.op_id == op.id and b.type == "ok" and b.is_leveled:
            return "future_load_relief"

    return "free_window_available"


def build_transparency_report(
    blocks: list[Block],
    ops: list[EOp],
    tool_map: dict[str, ETool],
    infeasibilities: list[InfeasibilityEntry] | None = None,
    decisions: list[DecisionEntry] | None = None,
) -> TransparencyReport:
    """Build transparency report with per-order justifications."""
    infeas = infeasibilities or []
    infeas_op_ids = set(e.op_id for e in infeas)

    order_justifications: list[OrderJustification] = []
    failure_justifications: list[FailureJustification] = []
    capacity_log: list[CapacityLogEntry] = []

    for op in ops:
        demand = sum(max(v, 0) for v in op.d) + max(op.atr, 0)
        if demand <= 0:
            continue

        tool = tool_map.get(op.t)
        pH = tool.pH if tool else 0
        oee = tool.oee if tool and tool.oee else DEFAULT_OEE

        if op.id in infeas_op_ids:
            # Failure justification
            entry = next((e for e in infeas if e.op_id == op.id), None)
            effective_pH = pH * oee if pH > 0 else 0
            produced = _get_block_production_for_op(blocks, op.id)
            missing_pcs = max(0, demand - produced)
            missing_hours = missing_pcs / effective_pH if effective_pH > 0 else 0

            suggestions = []
            if entry and entry.suggestion:
                suggestions = [s.strip() for s in entry.suggestion.split(";")]

            failure_justifications.append(
                FailureJustification(
                    op_id=op.id,
                    sku=op.sku,
                    constraints_violated=[entry.reason] if entry else [],
                    missing_capacity_hours=round(missing_hours, 2),
                    missing_capacity_pieces=missing_pcs,
                    suggestions=suggestions,
                )
            )
        else:
            # Order justification
            produced = _get_block_production_for_op(blocks, op.id)
            ok_blocks = [b for b in blocks if b.op_id == op.id and b.type == "ok"]
            total_prod_min = sum(b.prod_min for b in ok_blocks)
            days_with_prod = len(set(b.day_idx for b in ok_blocks))
            alloc_hours = (total_prod_min / days_with_prod / 60.0) if days_with_prod > 0 else 0
            cap_pcs_day = pH * oee * (DAY_CAP / 60.0) if pH > 0 else 0
            start_reason = _determine_start_reason(blocks, op, demand)

            is_twin = any(b.is_twin_production and b.type == "ok" for b in ok_blocks)

            order_justifications.append(
                OrderJustification(
                    op_id=op.id,
                    sku=op.sku,
                    initial_stock=op.stk if op.stk else 0,
                    initial_deficit=max(op.atr, 0),
                    pH=pH,
                    oee=oee,
                    capacity_pcs_per_day=round(cap_pcs_day, 1),
                    allocated_hours_per_day=round(alloc_hours, 2),
                    start_reason=start_reason,
                    total_produced=produced,
                    total_demand=demand,
                    is_twin_production=is_twin,
                )
            )

        # Capacity log entry
        if tool and pH > 0:
            oee_source = "tool" if tool.oee else "default"
            cap_pcs = pH * oee * (DAY_CAP / 60.0)
            work_hours = demand / (pH * oee) if pH * oee > 0 else 0
            days_req = work_hours / (DAY_CAP / 60.0) if DAY_CAP > 0 else 0

            capacity_log.append(
                CapacityLogEntry(
                    op_id=op.id,
                    tool_id=op.t,
                    machine_id=op.m,
                    oee_value=oee,
                    oee_source=oee_source,
                    pieces_per_hour=pH,
                    available_hours_per_day=DAY_CAP / 60.0,
                    resulting_capacity_pcs_per_day=round(cap_pcs, 1),
                    work_content_hours=round(work_hours, 2),
                    days_required=round(days_req, 2),
                )
            )

    return TransparencyReport(
        order_justifications=order_justifications,
        failure_justifications=failure_justifications,
        capacity_log=capacity_log,
    )
