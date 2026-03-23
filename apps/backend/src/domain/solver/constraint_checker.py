# Constraint Checker — pure validation functions (no CP-SAT).
# Used by Phase 1 (ATCS dispatch) and Phase 3 (Tabu) for feasibility checks.

from __future__ import annotations

from collections import defaultdict

from .schedule_state import ScheduleState
from .schemas import ConstraintConfigInput


def check_setup_crew(state: ScheduleState) -> list[tuple[str, str]]:
    """Return pairs of ops whose setups overlap. Empty = valid.

    SetupCrew constraint: max 1 setup happening at any time across factory.
    """
    # Collect all setup intervals (start, end, op_id)
    setups: list[tuple[int, int, str]] = []
    for ops in state.machine_ops.values():
        for op in ops:
            if op.setup_min > 0:
                setup_start = op.start_min - op.setup_min
                setup_end = op.start_min
                setups.append((setup_start, setup_end, op.op_id))

    setups.sort()
    violations: list[tuple[str, str]] = []
    for i in range(len(setups)):
        for j in range(i + 1, len(setups)):
            s_i, e_i, id_i = setups[i]
            s_j, e_j, id_j = setups[j]
            if s_j >= e_i:
                break  # no more overlaps for i
            violations.append((id_i, id_j))
    return violations


def check_tool_timeline(state: ScheduleState) -> list[tuple[str, str]]:
    """Return pairs of ops using same tool on different machines simultaneously.

    ToolTimeline: a tool can only be on one machine at a time.
    """
    # Group ops by tool_id (only tools spanning 2+ machines matter)
    tool_ops: dict[str, list[tuple[int, int, str, str]]] = defaultdict(list)
    for ops in state.machine_ops.values():
        for op in ops:
            tool_ops[op.tool_id].append((op.start_min, op.end_min, op.machine_id, op.op_id))

    violations: list[tuple[str, str]] = []
    for _tid, entries in tool_ops.items():
        # Only check tools on multiple machines
        machines = {e[2] for e in entries}
        if len(machines) < 2:
            continue
        entries.sort()
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                s_i, e_i, m_i, id_i = entries[i]
                s_j, e_j, m_j, id_j = entries[j]
                if s_j >= e_i:
                    break
                if m_i != m_j:
                    violations.append((id_i, id_j))
    return violations


def check_calco_timeline(state: ScheduleState) -> list[tuple[str, str]]:
    """Return pairs of ops using same calco simultaneously.

    CalcoTimeline: a calço can only be on one machine at a time.
    """
    calco_ops: dict[str, list[tuple[int, int, str]]] = defaultdict(list)
    for ops in state.machine_ops.values():
        for op in ops:
            if op.calco_code:
                calco_ops[op.calco_code].append((op.start_min, op.end_min, op.op_id))

    violations: list[tuple[str, str]] = []
    for _code, entries in calco_ops.items():
        if len(entries) < 2:
            continue
        entries.sort()
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                s_i, e_i, id_i = entries[i]
                s_j, e_j, id_j = entries[j]
                if s_j >= e_i:
                    break
                violations.append((id_i, id_j))
    return violations


def check_twin_integrity(state: ScheduleState) -> list[str]:
    """Return op_ids where twin pairs have misaligned start times."""
    violations: list[str] = []
    checked: set[str] = set()

    for ops in state.machine_ops.values():
        for op in ops:
            if not op.is_twin or op.op_id in checked:
                continue
            partner_id = op.twin_partner_op_id
            if not partner_id:
                continue
            checked.add(op.op_id)
            checked.add(partner_id)
            partner = state.get_op(partner_id)
            if partner and partner.start_min != op.start_min:
                violations.append(op.op_id)
    return violations


def is_feasible(state: ScheduleState, constraints: ConstraintConfigInput | None = None) -> bool:
    """Quick boolean: all enabled constraints satisfied?"""
    c = constraints or state.constraints
    if c.setup_crew and check_setup_crew(state):
        return False
    if c.tool_timeline and check_tool_timeline(state):
        return False
    if c.calco_timeline and check_calco_timeline(state):
        return False
    if check_twin_integrity(state):
        return False
    return True


def find_earliest_feasible_start(
    state: ScheduleState,
    machine_id: str,
    tool_id: str,
    calco_code: str | None,
    duration_min: int,
    setup_min: int,
    earliest: int = 0,
) -> tuple[int, int]:
    """Find earliest feasible start on a machine respecting constraints.

    Checks: machine availability, SetupCrew, ToolTimeline, CalcoTimeline.
    Returns (start_min, actual_setup_min).
    """
    constraints = state.constraints
    ops = state.machine_ops.get(machine_id, [])

    # Machine availability: after last op
    machine_avail = 0
    last_tool = None
    if ops:
        machine_avail = ops[-1].end_min
        last_tool = ops[-1].tool_id

    start = max(earliest, machine_avail)
    actual_setup = 0 if last_tool == tool_id else setup_min

    # Setup crew: find when crew is free
    if constraints.setup_crew and actual_setup > 0:
        setup_start = start
        setup_end = start + actual_setup
        # Collect all setups across factory
        for m_ops in state.machine_ops.values():
            for op in m_ops:
                if op.setup_min > 0:
                    s_start = op.start_min - op.setup_min
                    s_end = op.start_min
                    # Overlap?
                    if s_start < setup_end and s_end > setup_start:
                        # Push start past this setup
                        start = max(start, s_end)
                        setup_end = start + actual_setup

    prod_start = start + actual_setup

    # Tool timeline: tool must be free on all other machines
    if constraints.tool_timeline:
        for mid, m_ops in state.machine_ops.items():
            if mid == machine_id:
                continue
            for op in m_ops:
                if op.tool_id == tool_id:
                    # Does our production overlap with this op?
                    prod_end = prod_start + duration_min
                    if op.start_min < prod_end and op.end_min > prod_start:
                        prod_start = max(prod_start, op.end_min)
                        start = prod_start - actual_setup

    # Calco timeline
    if constraints.calco_timeline and calco_code:
        for m_ops in state.machine_ops.values():
            for op in m_ops:
                if op.calco_code == calco_code:
                    prod_end = prod_start + duration_min
                    if op.start_min < prod_end and op.end_min > prod_start:
                        prod_start = max(prod_start, op.end_min)
                        start = prod_start - actual_setup

    return start, actual_setup
