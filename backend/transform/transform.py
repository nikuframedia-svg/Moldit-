"""Transform orchestrator — Spec 01 §3.

Converts RawRows → EngineData via merge, twin detection, and enrichment.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.types import EngineData, EOp, MachineInfo, RawRow

logger = logging.getLogger(__name__)

# Fallback values when no master_data is provided
_DEFAULT_GROUP = "Grandes"
_DEFAULT_DAY_CAPACITY = 1020


def transform(
    rows: list[RawRow],
    workdays: list[str],
    has_twin_col: bool,
    master_data: dict[str, Any] | None,
) -> EngineData:
    """Transform raw project plan rows into EngineData."""
    raise NotImplementedError("Moldit transform — Phase 2")


def _raw_to_eop(raw: RawRow, master_data: dict[str, Any] | None) -> EOp:
    """Convert a single RawRow to EOp with master data enrichment."""
    raise NotImplementedError("Moldit _raw_to_eop — Phase 2")


def _resolve_holidays(
    workdays: list[str], master_data: dict[str, Any] | None
) -> list[int]:
    """Convert holiday date strings from YAML to workday indices.

    Also auto-detects weekends (Saturday=5, Sunday=6) as holidays.
    """
    from datetime import date as dt_date

    indices_set: set[int] = set()

    # Auto-detect weekends
    for i, d in enumerate(workdays):
        try:
            if dt_date.fromisoformat(d).weekday() >= 5:
                indices_set.add(i)
        except ValueError:
            pass

    # Explicit holidays from YAML
    if master_data:
        holiday_dates = master_data.get("holidays", [])
        workday_set = {d: i for i, d in enumerate(workdays)}
        for h in holiday_dates:
            date_str = str(h)
            if date_str in workday_set:
                indices_set.add(workday_set[date_str])

    return sorted(indices_set)


def _build_machines(
    ops: list[EOp], master_data: dict[str, Any] | None
) -> list[MachineInfo]:
    """Build machine list from ops + YAML machine config."""
    machine_config: dict[str, dict[str, Any]] = {}
    if master_data:
        machine_config = master_data.get("machines", {})

    seen: set[str] = set()
    machines: list[MachineInfo] = []

    for op in ops:
        if op.m not in seen:
            seen.add(op.m)
            cfg = machine_config.get(op.m, {})
            group = cfg.get("group", _DEFAULT_GROUP)
            capacity = cfg.get("day_capacity_min", _DEFAULT_DAY_CAPACITY)
            machines.append(
                MachineInfo(id=op.m, group=group, day_capacity=capacity)
            )

    return machines
