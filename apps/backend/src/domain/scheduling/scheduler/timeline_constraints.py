"""Timeline constraints for slot allocator — port of scheduler/timeline-constraints.ts.

Calco timeline, tool timeline, and local operator pool helpers.
"""

from __future__ import annotations

from ..constraints.operator_pool import OperatorPool
from ..types import WorkforceConfig


class CalcoTimeline:
    """HARD constraint — calco can only be in 1 place at a time (NO same-machine exception)."""

    def __init__(self) -> None:
        self._timelines: dict[str, list[dict]] = {}

    def find_next_available(
        self,
        calco_code: str,
        earliest: int,
        duration: int,
        shift_end: int,
    ) -> int:
        slots = self._timelines.get(calco_code)
        if not slots:
            return earliest
        candidate = earliest
        changed = True
        iters = 0
        while changed and iters < 1000:
            changed = False
            iters += 1
            for s in slots:
                if candidate < s["end"] and candidate + duration > s["start"]:
                    candidate = s["end"]
                    changed = True
        return candidate if candidate + duration <= shift_end else -1

    def book(self, calco_code: str, start: int, end: int, machine_id: str) -> None:
        if calco_code not in self._timelines:
            self._timelines[calco_code] = []
        self._timelines[calco_code].append({"start": start, "end": end, "machineId": machine_id})


class ToolTimelineSA:
    """HARD constraint — tool can only be on 1 machine at a time (same-machine reuse OK)."""

    def __init__(self) -> None:
        self._timelines: dict[str, list[dict]] = {}

    def find_next_available(
        self,
        tool_id: str,
        earliest: int,
        duration: int,
        shift_end: int,
        machine_id: str,
    ) -> int:
        slots = self._timelines.get(tool_id)
        if not slots:
            return earliest
        candidate = earliest
        changed = True
        iters = 0
        while changed and iters < 1000:
            changed = False
            iters += 1
            for s in slots:
                if s["machineId"] == machine_id:
                    continue  # same machine OK
                if candidate < s["end"] and candidate + duration > s["start"]:
                    candidate = s["end"]
                    changed = True
        return candidate if candidate + duration <= shift_end else -1

    def book(self, tool_id: str, start: int, end: int, machine_id: str) -> None:
        if tool_id not in self._timelines:
            self._timelines[tool_id] = []
        self._timelines[tool_id].append({"start": start, "end": end, "machineId": machine_id})


class SetupCrewSA:
    """HARD constraint — max 1 setup at a time (factory-wide, exclusive)."""

    def __init__(self) -> None:
        self._booked: list[dict] = []

    def find_next_available(self, earliest: int, duration: int, shift_end: int) -> int:
        candidate = earliest
        changed = True
        iters = 0
        while changed and iters < 200:
            changed = False
            iters += 1
            for s in self._booked:
                if candidate < s["end"] and candidate + duration > s["start"]:
                    candidate = s["end"]
                    changed = True
        return candidate if candidate + duration <= shift_end else -1

    def book(self, start: int, end: int, machine_id: str) -> None:
        self._booked.append({"start": start, "end": end, "machineId": machine_id})


def create_local_operator_pool(config: WorkforceConfig | None) -> OperatorPool | None:
    """Create an operator pool from workforce config (advisory only)."""
    if not config:
        return None
    return OperatorPool(config)
