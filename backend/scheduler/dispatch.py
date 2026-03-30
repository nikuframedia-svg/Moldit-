"""Phase 3 — Dispatch: Moldit Planner.

Greedy forward scheduler: priority queue -> machine assignment -> timeline dispatch.
"""

from __future__ import annotations

import logging
from collections import defaultdict, deque

from backend.config.types import FactoryConfig
from backend.scheduler.types import OperatorAlert, SegmentoMoldit
from backend.types import Maquina, Molde, Operacao

logger = logging.getLogger(__name__)

# Day starts at 7:00
_DAY_START_H = 7.0


def _parse_deadline_week(deadline: str) -> int:
    """Parse deadline like 'S15' -> 15, 'S18' -> 18. Returns 999 if empty/unknown."""
    if not deadline:
        return 999
    d = deadline.strip().upper()
    if d.startswith("S") and d[1:].isdigit():
        return int(d[1:])
    return 999


def build_priority_queue(
    ops: list[Operacao],
    dag: dict[int, list[int]],
    dag_rev: dict[int, list[int]],
    moldes: list[Molde],
    caminho_critico: list[int],
) -> list[int]:
    """Build a topologically-sorted priority queue of operation IDs.

    Sort key: (topo_layer, deadline_week, critical_path_flag, -work_restante_h).
    Conditional ops are pushed to the end (layer=9999).
    """
    crit_set = set(caminho_critico)

    # Map molde -> deadline week
    molde_deadline: dict[str, int] = {}
    for m in moldes:
        molde_deadline[m.id] = _parse_deadline_week(m.deadline)

    # Kahn's algorithm for topological layers
    all_ids = {op.id for op in ops}
    in_degree: dict[int, int] = {oid: 0 for oid in all_ids}
    for oid in all_ids:
        in_degree[oid] = len([p for p in dag_rev.get(oid, []) if p in all_ids])

    layer: dict[int, int] = {}
    queue: deque[int] = deque()
    for oid in all_ids:
        if in_degree[oid] == 0:
            queue.append(oid)

    current_layer = 0
    while queue:
        next_queue: deque[int] = deque()
        for oid in queue:
            layer[oid] = current_layer
            for succ in dag.get(oid, []):
                if succ not in in_degree:
                    continue
                in_degree[succ] -= 1
                if in_degree[succ] == 0:
                    next_queue.append(succ)
        queue = next_queue
        current_layer += 1

    # Assign remaining (cyclic / orphan) to max layer
    for oid in all_ids:
        if oid not in layer:
            layer[oid] = current_layer

    # Build priority tuples — skip completed ops, add urgency tiers
    priority: list[tuple[tuple[int, int, int, int, float], int]] = []
    for op in ops:
        if op.work_restante_h <= 0:
            continue  # skip completed ops entirely
        oid = op.id
        if op.e_condicional:
            tl = 9999
        else:
            tl = layer.get(oid, 9999)
        dl = molde_deadline.get(op.molde, 999)
        # Urgency tier: tighter deadlines get priority on shared resources
        urgency = 0 if dl <= 15 else (1 if dl <= 20 else 2)
        crit = -1 if oid in crit_set else 0
        work = -op.work_restante_h
        priority.append(((tl, urgency, dl, crit, work), oid))

    priority.sort(key=lambda x: x[0])
    return [oid for _, oid in priority]


def assign_machines(
    ops_by_id: dict[int, Operacao],
    priority_queue: list[int],
    compat: dict[str, list[str]],
    machines: dict[str, Maquina],
    config: FactoryConfig,
) -> dict[int, str]:
    """Assign each operation to a machine. Returns {op_id: machine_id}.

    Rules:
    - If op.recurso is set and exists -> use it directly.
    - If op.recurso starts with '//' -> map to virtual 2a placa machine.
    - Otherwise: pick least-loaded compatible machine, respecting bancada dedication.
    """
    load_h: dict[str, float] = defaultdict(float)
    assignment: dict[int, str] = {}

    bancada_ded = config.bancada_dedicacao or {}
    machine_set = set(machines.keys())

    for op_id in priority_queue:
        op = ops_by_id.get(op_id)
        if op is None:
            continue
        if op.work_restante_h <= 0:
            continue

        assigned: str | None = None

        # Direct resource assignment
        if op.recurso and op.recurso != "?":
            resource = op.recurso.strip()
            # 2a placa: "// FE31 - MasterMill" — use directly (config uses same name)
            if resource.startswith("//"):
                if resource in machine_set:
                    assigned = resource
                else:
                    logger.warning(
                        "Op %d: 2a placa '%s' no matching virtual machine",
                        op_id, resource,
                    )
            elif resource in machine_set:
                assigned = resource
            else:
                logger.debug(
                    "Op %d: recurso '%s' not in machine list, trying compat",
                    op_id, resource,
                )

        # Compatibility-based assignment (bancada dedication = preference, not hard filter)
        if assigned is None:
            candidates = compat.get(op.codigo, [])
            preferred: list[str] = []
            fallback: list[str] = []
            for mid in candidates:
                if mid not in machine_set:
                    continue
                m = machines[mid]
                # Bancada dedication: prefer dedicated machines, but allow fallback
                if m.grupo == "Bancada" and mid in bancada_ded:
                    ded = bancada_ded[mid]
                    if isinstance(ded, dict) and op.molde in ded:
                        preferred.append(mid)
                    else:
                        fallback.append(mid)
                else:
                    preferred.append(mid)

            valid = preferred if preferred else fallback
            if valid:
                # Pick least-loaded
                assigned = min(valid, key=lambda mid: load_h[mid])
            else:
                if not op.e_condicional:
                    logger.debug(
                        "Op %d (codigo=%s): no compatible machine found",
                        op_id, op.codigo,
                    )

        if assigned is not None:
            assignment[op_id] = assigned
            load_h[assigned] += op.work_restante_h

    return assignment


def _is_workday(day_offset: int, ref_weekday: int, holiday_offsets: set[int]) -> bool:
    """Check if a day offset is a working day (not weekend, not holiday)."""
    weekday = (ref_weekday + day_offset) % 7
    if weekday >= 5:  # Saturday=5, Sunday=6
        return False
    if day_offset in holiday_offsets:
        return False
    return True


def _next_workday(
    day: int, ref_weekday: int, holiday_offsets: set[int],
) -> int:
    """Advance to the next working day (inclusive of current day)."""
    while not _is_workday(day, ref_weekday, holiday_offsets):
        day += 1
    return day


def _compute_holiday_offsets(
    holidays: list[str],
    ref_date_str: str,
) -> tuple[set[int], int]:
    """Convert ISO holiday dates to day offsets from reference date.

    Returns (set of holiday offsets, weekday of reference date 0=Mon).
    """
    import datetime as _dt

    if ref_date_str:
        try:
            ref = _dt.date.fromisoformat(ref_date_str)
        except ValueError:
            ref = _dt.date.today()
    else:
        ref = _dt.date.today()

    ref_weekday = ref.weekday()  # 0=Monday

    offsets: set[int] = set()
    for h in holidays:
        try:
            hd = _dt.date.fromisoformat(h)
            delta = (hd - ref).days
            if delta >= 0:
                offsets.add(delta)
        except (ValueError, TypeError):
            continue

    return offsets, ref_weekday


def dispatch_timeline(
    ops_by_id: dict[int, Operacao],
    priority_queue: list[int],
    assignments: dict[int, str],
    dag_rev: dict[int, list[int]],
    machines: dict[str, Maquina],
    config: FactoryConfig,
    ref_date: str = "",
    holidays: list[str] | None = None,
) -> list[SegmentoMoldit]:
    """Dispatch operations onto a timeline. Returns list of SegmentoMoldit.

    Uses greedy forward scheduling: each op starts at max(predecessor_finish, machine_available).
    Multi-day operations span across working days. Holidays and weekends are skipped.
    """
    holiday_list = holidays if holidays is not None else config.holidays
    holiday_offsets, ref_weekday = _compute_holiday_offsets(holiday_list, ref_date)

    # Track availability: (day, hour)
    machine_available: dict[str, tuple[int, float]] = {}
    op_finish: dict[int, tuple[int, float]] = {}

    segments: list[SegmentoMoldit] = []

    for op_id in priority_queue:
        if op_id not in assignments:
            continue

        op = ops_by_id.get(op_id)
        if op is None:
            continue

        work = op.work_restante_h
        if work <= 0:
            continue

        machine_id = assignments[op_id]
        machine = machines.get(machine_id)
        if machine is None:
            continue

        regime_h = machine.regime_h
        setup_h = machine.setup_h

        # Calculate earliest start from predecessors
        # Skip conditional predecessors (they don't block successors)
        pred_finish = (0, _DAY_START_H)
        for pred_id in dag_rev.get(op_id, []):
            pred_op = ops_by_id.get(pred_id)
            if pred_op is not None and pred_op.e_condicional:
                continue
            pf = op_finish.get(pred_id)
            if pf is not None and pf > pred_finish:
                pred_finish = pf

        # Machine availability
        mach_avail = machine_available.get(machine_id, (0, _DAY_START_H))

        # Earliest start = max of pred finish and machine available
        earliest = max(pred_finish, mach_avail)
        current_day, current_hour = earliest

        # Advance to next working day if needed
        current_day = _next_workday(current_day, ref_weekday, holiday_offsets)

        # External resources: schedule in one segment
        if regime_h == 0:
            seg = SegmentoMoldit(
                op_id=op_id,
                molde=op.molde,
                maquina_id=machine_id,
                dia=current_day,
                inicio_h=current_hour,
                fim_h=current_hour + work,
                duracao_h=work,
                setup_h=0.0,
                e_2a_placa=op.e_2a_placa,
                e_continuacao=False,
            )
            segments.append(seg)
            # External doesn't block the machine (infinite capacity)
            end_day = current_day + max(1, int(work / 8))
            op_finish[op_id] = (end_day, _DAY_START_H)
            continue

        # Normal scheduling: fill day by day
        day_end_h = _DAY_START_H + regime_h
        remaining = work
        first_segment = True

        while remaining > 0.01:
            # Ensure we are on a workday
            current_day = _next_workday(current_day, ref_weekday, holiday_offsets)

            # Clamp current_hour to day boundaries
            if current_hour < _DAY_START_H:
                current_hour = _DAY_START_H
            if current_hour >= day_end_h:
                current_day += 1
                current_day = _next_workday(current_day, ref_weekday, holiday_offsets)
                current_hour = _DAY_START_H

            available_today = day_end_h - current_hour
            if available_today <= 0.01:
                current_day += 1
                current_day = _next_workday(current_day, ref_weekday, holiday_offsets)
                current_hour = _DAY_START_H
                continue

            # Add setup on first segment
            seg_setup = 0.0
            if first_segment and setup_h > 0:
                seg_setup = setup_h
                if seg_setup >= available_today:
                    # Setup takes the rest of today
                    current_hour += seg_setup
                    if current_hour >= day_end_h:
                        current_day += 1
                        current_day = _next_workday(
                            current_day, ref_weekday, holiday_offsets,
                        )
                        current_hour = _DAY_START_H
                    available_today = day_end_h - current_hour
                    # Setup already accounted for, mark as done but don't re-add
                else:
                    current_hour += seg_setup
                    available_today -= seg_setup
                first_segment = False

            hours_this = min(remaining, available_today)
            if hours_this <= 0.01:
                current_day += 1
                current_day = _next_workday(current_day, ref_weekday, holiday_offsets)
                current_hour = _DAY_START_H
                continue

            seg = SegmentoMoldit(
                op_id=op_id,
                molde=op.molde,
                maquina_id=machine_id,
                dia=current_day,
                inicio_h=current_hour,
                fim_h=current_hour + hours_this,
                duracao_h=hours_this,
                setup_h=seg_setup,
                e_2a_placa=op.e_2a_placa,
                e_continuacao=(not first_segment) and (seg_setup == 0.0),
            )
            segments.append(seg)
            first_segment = False

            remaining -= hours_this
            current_hour += hours_this

            if remaining > 0.01:
                current_day += 1
                current_day = _next_workday(current_day, ref_weekday, holiday_offsets)
                current_hour = _DAY_START_H

        # Update availability
        machine_available[machine_id] = (current_day, current_hour)
        op_finish[op_id] = (current_day, current_hour)

    return segments


def compute_operator_alerts(
    segmentos: list[SegmentoMoldit],
    machines: dict[str, Maquina],
    config: FactoryConfig,
) -> list[OperatorAlert]:
    """Compute operator overload alerts per day and machine group.

    Alert when a group's total scheduled hours on a day exceeds
    regime_h * number_of_machines_in_group.
    """
    # Count machines per group
    group_machines: dict[str, list[str]] = defaultdict(list)
    group_regime: dict[str, int] = {}
    for mid, m in machines.items():
        if not mid.startswith("//"):  # Skip virtual machines
            group_machines[m.grupo].append(mid)
            group_regime[m.grupo] = m.regime_h

    # Sum hours per (group, day)
    hours_by_group_day: dict[tuple[str, int], float] = defaultdict(float)
    for seg in segmentos:
        m = machines.get(seg.maquina_id)
        if m is None:
            continue
        hours_by_group_day[(m.grupo, seg.dia)] += seg.duracao_h

    alerts: list[OperatorAlert] = []
    for (group, day), total_h in sorted(hours_by_group_day.items()):
        n_machines = len(group_machines.get(group, []))
        regime = group_regime.get(group, 16)
        if regime == 0:
            continue  # External, skip
        capacity = regime * n_machines
        if total_h > capacity:
            alerts.append(OperatorAlert(
                dia=day,
                grupo_maquina=group,
                horas_necessarias=round(total_h, 1),
                horas_disponiveis=round(capacity, 1),
                deficit_h=round(total_h - capacity, 1),
            ))

    return alerts
