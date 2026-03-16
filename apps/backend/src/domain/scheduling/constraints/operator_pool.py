"""OperatorPool constraint — capacidade operadores por turno/área.

Port of constraints/operator-pool.ts.
Mode: ADVISORY — warns but never blocks.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..types import WorkforceConfig


@dataclass
class OperatorCheckResult:
    has_capacity: bool
    current_usage: int
    capacity: int
    shortage: int
    labor_group: str
    is_warning: bool


DEFAULT_LABOR_GROUPS: dict[str, list[dict]] = {
    "Grandes": [
        {"start": 420, "end": 930, "capacity": 6},
        {"start": 930, "end": 960, "capacity": 6},
        {"start": 960, "end": 1440, "capacity": 5},
    ],
    "Medias": [
        {"start": 420, "end": 930, "capacity": 9},
        {"start": 930, "end": 960, "capacity": 8},
        {"start": 960, "end": 1440, "capacity": 4},
    ],
}

DEFAULT_MACHINE_TO_GROUP: dict[str, str] = {
    "PRM019": "Grandes",
    "PRM031": "Grandes",
    "PRM039": "Grandes",
    "PRM043": "Grandes",
    "PRM042": "Medias",
}


class OperatorPool:
    """Labor group operator capacity — advisory, never blocks."""

    def __init__(self, config: WorkforceConfig | None = None) -> None:
        if config and config.labor_groups:
            self._labor_groups = {
                g: [{"start": w.start, "end": w.end, "capacity": w.capacity} for w in windows]
                for g, windows in config.labor_groups.items()
            }
            self._machine_map = dict(config.machine_to_labor_group)
        else:
            self._labor_groups = DEFAULT_LABOR_GROUPS
            self._machine_map = dict(DEFAULT_MACHINE_TO_GROUP)

        # Usage tracking: (day, window_start, labor_group) → {machine → peak_operators}
        self._usage: dict[tuple[int, int, str], dict[str, int]] = {}

    def get_labor_group(self, machine_id: str) -> str:
        return self._machine_map.get(machine_id, "")

    def check_capacity(
        self,
        day_idx: int,
        start_min: int,
        end_min: int,
        operators: int,
        machine_id: str,
    ) -> OperatorCheckResult:
        """Check if adding operators would exceed capacity."""
        group = self.get_labor_group(machine_id)
        if not group:
            return OperatorCheckResult(
                has_capacity=True,
                current_usage=0,
                capacity=99,
                shortage=0,
                labor_group="",
                is_warning=False,
            )

        windows = self._labor_groups.get(group, [])
        worst_shortage = 0
        worst_cap = 99
        worst_usage = 0

        for w in windows:
            if start_min >= w["end"] or end_min <= w["start"]:
                continue
            cap = w["capacity"]
            key = (day_idx, w["start"], group)
            machine_usage = self._usage.get(key, {})
            total = sum(machine_usage.values())
            new_total = total + operators
            shortage = max(new_total - cap, 0)
            if shortage > worst_shortage:
                worst_shortage = shortage
                worst_cap = cap
                worst_usage = total

        return OperatorCheckResult(
            has_capacity=worst_shortage == 0,
            current_usage=worst_usage,
            capacity=worst_cap,
            shortage=worst_shortage,
            labor_group=group,
            is_warning=worst_shortage > 0,
        )

    def book(
        self,
        day_idx: int,
        start_min: int,
        end_min: int,
        operators: int,
        machine_id: str,
    ) -> None:
        """Record operator usage."""
        group = self.get_labor_group(machine_id)
        if not group:
            return
        windows = self._labor_groups.get(group, [])
        for w in windows:
            if start_min >= w["end"] or end_min <= w["start"]:
                continue
            key = (day_idx, w["start"], group)
            if key not in self._usage:
                self._usage[key] = {}
            current = self._usage[key].get(machine_id, 0)
            self._usage[key][machine_id] = max(current, operators)

    def get_current_usage(self, day_idx: int, window_start: int, labor_group: str) -> int:
        key = (day_idx, window_start, labor_group)
        machine_usage = self._usage.get(key, {})
        return sum(machine_usage.values())

    def clear(self) -> None:
        self._usage.clear()
