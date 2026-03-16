"""ConstraintManager — unified wrapper for 4 constraints.

Port of constraints/constraint-manager.ts.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..config import ConstraintsConfig, SchedulingConfig
from ..types import WorkforceConfig
from .calco_timeline import CalcoTimeline
from .operator_pool import OperatorCheckResult, OperatorPool
from .setup_crew import SetupCrew
from .tool_timeline import ToolTimeline


@dataclass
class ConstraintResult:
    proceed: bool
    adjusted_time: int
    was_delayed: bool
    detail: str = ""


class ConstraintManager:
    """Wraps 4 constraints. Respects hard/disabled per config."""

    def __init__(
        self,
        config: SchedulingConfig | None = None,
        workforce_config: WorkforceConfig | None = None,
    ) -> None:
        self.setup_crew = SetupCrew()
        self.tool_timeline = ToolTimeline()
        self.calco_timeline = CalcoTimeline()
        self.operator_pool = OperatorPool(workforce_config)

        cc = config.constraints if config else ConstraintsConfig()
        self._modes = {
            "setupCrew": cc.setup_crew.mode,
            "toolTimeline": cc.tool_timeline.mode,
            "calcoTimeline": cc.calco_timeline.mode,
            "operatorPool": cc.operator_pool.mode,
        }

    def get_mode(self, name: str) -> str:
        return self._modes.get(name, "hard")

    def set_mode(self, name: str, mode: str) -> None:
        self._modes[name] = mode

    # ── Setup crew ──

    def check_setup(
        self,
        earliest: int,
        duration: int,
        shift_end: int,
        machine_id: str,
    ) -> ConstraintResult:
        if self._modes["setupCrew"] == "disabled" or duration <= 0:
            return ConstraintResult(proceed=True, adjusted_time=earliest, was_delayed=False)
        r = self.setup_crew.check(earliest, duration, shift_end, machine_id)
        if r.has_conflict:
            if r.available_at < 0:
                return ConstraintResult(
                    proceed=False,
                    adjusted_time=-1,
                    was_delayed=True,
                    detail=f"Setup crew conflict with {r.conflict_with}, no room in shift",
                )
            return ConstraintResult(
                proceed=True,
                adjusted_time=r.available_at,
                was_delayed=True,
                detail=f"Setup delayed to {r.available_at} (conflict with {r.conflict_with})",
            )
        return ConstraintResult(proceed=True, adjusted_time=earliest, was_delayed=False)

    def book_setup(self, start: int, end: int, machine_id: str) -> None:
        if self._modes["setupCrew"] != "disabled":
            self.setup_crew.book(start, end, machine_id)

    # ── Tool timeline ──

    def check_tool(
        self,
        tool_id: str,
        start: int,
        end: int,
        machine_id: str,
    ) -> ConstraintResult:
        if self._modes["toolTimeline"] == "disabled":
            return ConstraintResult(proceed=True, adjusted_time=start, was_delayed=False)
        r = self.tool_timeline.check(tool_id, start, end, machine_id)
        if not r.is_available:
            return ConstraintResult(
                proceed=True,
                adjusted_time=r.available_at,
                was_delayed=True,
                detail=f"Tool {tool_id} conflict with {r.conflicting_machines}",
            )
        return ConstraintResult(proceed=True, adjusted_time=start, was_delayed=False)

    def book_tool(self, tool_id: str, start: int, end: int, machine_id: str) -> None:
        if self._modes["toolTimeline"] != "disabled":
            self.tool_timeline.book(tool_id, start, end, machine_id)

    # ── Calco timeline ──

    def check_calco(
        self,
        calco_code: str | None,
        start: int,
        end: int,
    ) -> ConstraintResult:
        if self._modes["calcoTimeline"] == "disabled" or not calco_code:
            return ConstraintResult(proceed=True, adjusted_time=start, was_delayed=False)
        r = self.calco_timeline.check(calco_code, start, end)
        if not r.is_available:
            return ConstraintResult(
                proceed=True,
                adjusted_time=r.available_at,
                was_delayed=True,
                detail=f"Calco {calco_code} conflict with {r.conflict_machine}",
            )
        return ConstraintResult(proceed=True, adjusted_time=start, was_delayed=False)

    def book_calco(self, calco_code: str | None, start: int, end: int, machine_id: str) -> None:
        if self._modes["calcoTimeline"] != "disabled" and calco_code:
            self.calco_timeline.book(calco_code, start, end, machine_id)

    # ── Operator pool ──

    def check_operators(
        self,
        day_idx: int,
        start_min: int,
        end_min: int,
        operators: int,
        machine_id: str,
    ) -> OperatorCheckResult:
        if self._modes["operatorPool"] == "disabled":
            return OperatorCheckResult(
                has_capacity=True,
                current_usage=0,
                capacity=99,
                shortage=0,
                labor_group="",
                is_warning=False,
            )
        return self.operator_pool.check_capacity(day_idx, start_min, end_min, operators, machine_id)

    def book_operators(
        self,
        day_idx: int,
        start_min: int,
        end_min: int,
        operators: int,
        machine_id: str,
    ) -> None:
        if self._modes["operatorPool"] != "disabled":
            self.operator_pool.book(day_idx, start_min, end_min, operators, machine_id)

    # ── Utilities ──

    def reset(self) -> None:
        self.setup_crew.clear()
        self.tool_timeline.clear()
        self.calco_timeline.clear()
        self.operator_pool.clear()
