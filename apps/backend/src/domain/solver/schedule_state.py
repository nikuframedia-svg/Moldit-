# ScheduleState — central mutable data structure for the hybrid solver.
# All 3 phases (ATCS dispatch, ALNS, Tabu) operate on this structure.

from __future__ import annotations

import copy
import logging
from dataclasses import dataclass, field

from .schemas import (
    ConstraintConfigInput,
    ScheduledOp,
    SolverRequest,
    SolverResult,
)

logger = logging.getLogger(__name__)

DAY_CAP = 1020
SHIFT_LEN = 510  # 8.5h shift


@dataclass
class ScheduledOperation:
    """One scheduled operation within ScheduleState."""

    op_id: str
    job_id: str
    machine_id: str
    tool_id: str
    calco_code: str | None
    start_min: int
    end_min: int
    setup_min: int
    duration_min: int
    due_date_min: int
    weight: float
    is_twin: bool
    twin_partner_op_id: str | None
    operators: int
    # Flex metadata
    alt_machine_id: str | None = None

    @property
    def tardiness(self) -> int:
        return max(0, self.end_min - self.due_date_min)

    @property
    def is_tardy(self) -> bool:
        return self.tardiness > 0

    @property
    def shift(self) -> str:
        return "X" if (self.start_min % DAY_CAP) < SHIFT_LEN else "Y"


@dataclass
class ScheduleState:
    """Full mutable schedule. Machine → sorted list of ops."""

    machine_ops: dict[str, list[ScheduledOperation]] = field(default_factory=dict)
    twin_map: dict[str, str] = field(default_factory=dict)
    constraints: ConstraintConfigInput = field(default_factory=ConstraintConfigInput)
    # Job metadata for scoring
    _job_weights: dict[str, float] = field(default_factory=dict)

    def weighted_tardiness(self) -> float:
        total = 0.0
        for ops in self.machine_ops.values():
            for op in ops:
                if op.tardiness > 0:
                    total += self._job_weights.get(op.job_id, 1.0) * op.tardiness
        return total

    def total_tardiness(self) -> int:
        total = 0
        for ops in self.machine_ops.values():
            for op in ops:
                total += op.tardiness
        return total

    def makespan(self) -> int:
        ms = 0
        for ops in self.machine_ops.values():
            if ops:
                ms = max(ms, ops[-1].end_min)
        return ms

    def n_ops(self) -> int:
        return sum(len(ops) for ops in self.machine_ops.values())

    def tardy_ops(self) -> list[ScheduledOperation]:
        result = []
        for ops in self.machine_ops.values():
            for op in ops:
                if op.is_tardy:
                    result.append(op)
        return result

    def all_ops(self) -> list[ScheduledOperation]:
        result = []
        for ops in self.machine_ops.values():
            result.extend(ops)
        return result

    def get_op(self, op_id: str) -> ScheduledOperation | None:
        for ops in self.machine_ops.values():
            for op in ops:
                if op.op_id == op_id:
                    return op
        return None

    def remove_ops(self, op_ids: set[str]) -> list[ScheduledOperation]:
        """Remove ops by op_id. Twin partners are auto-included.

        Returns the removed ops.
        """
        # Expand with twin partners
        expanded: set[str] = set()
        for oid in op_ids:
            expanded.add(oid)
            partner = self.twin_map.get(oid)
            if partner:
                expanded.add(partner)

        removed: list[ScheduledOperation] = []
        for mid in list(self.machine_ops.keys()):
            kept: list[ScheduledOperation] = []
            for op in self.machine_ops[mid]:
                if op.op_id in expanded:
                    removed.append(op)
                else:
                    kept.append(op)
            self.machine_ops[mid] = kept
        return removed

    def insert_op(self, op: ScheduledOperation) -> None:
        """Insert an op into its machine's timeline (sorted by start_min)."""
        mid = op.machine_id
        if mid not in self.machine_ops:
            self.machine_ops[mid] = []
        ops = self.machine_ops[mid]
        # Binary insert to maintain sort
        lo, hi = 0, len(ops)
        while lo < hi:
            m = (lo + hi) // 2
            if ops[m].start_min < op.start_min:
                lo = m + 1
            else:
                hi = m
        ops.insert(lo, op)

    def last_tool_on_machine(self, machine_id: str) -> str | None:
        ops = self.machine_ops.get(machine_id, [])
        return ops[-1].tool_id if ops else None

    def machine_end_time(self, machine_id: str) -> int:
        ops = self.machine_ops.get(machine_id, [])
        return ops[-1].end_min if ops else 0

    def copy(self) -> ScheduleState:
        """Deep copy of the schedule state."""
        return ScheduleState(
            machine_ops={
                mid: [copy.copy(op) for op in ops] for mid, ops in self.machine_ops.items()
            },
            twin_map=dict(self.twin_map),
            constraints=self.constraints.model_copy(),
            _job_weights=dict(self._job_weights),
        )

    def to_solver_result(self, solve_time: float) -> SolverResult:
        """Convert to SolverResult for downstream consumption."""
        schedule: list[ScheduledOp] = []
        for ops in self.machine_ops.values():
            for op in ops:
                schedule.append(
                    ScheduledOp(
                        op_id=op.op_id,
                        job_id=op.job_id,
                        machine_id=op.machine_id,
                        tool_id=op.tool_id,
                        start_min=op.start_min,
                        end_min=op.end_min,
                        setup_min=op.setup_min,
                        is_tardy=op.is_tardy,
                        tardiness_min=op.tardiness,
                        is_twin_production=op.is_twin,
                        twin_partner_op_id=op.twin_partner_op_id,
                        shift=op.shift,
                    )
                )

        wt = self.weighted_tardiness()
        tt = self.total_tardiness()
        ms = self.makespan()

        return SolverResult(
            schedule=schedule,
            makespan_min=ms,
            total_tardiness_min=tt,
            weighted_tardiness=wt,
            solver_used="hybrid",
            solve_time_s=round(solve_time, 3),
            status="optimal" if tt == 0 else "feasible",
            objective_value=wt,
            n_ops=self.n_ops(),
            phase_values={},
        )

    @staticmethod
    def from_request(request: SolverRequest) -> ScheduleState:
        """Create empty state with metadata from request."""
        # Build twin map
        twin_map: dict[str, str] = {}
        for pair in request.twin_pairs:
            twin_map[pair.op_id_a] = pair.op_id_b
            twin_map[pair.op_id_b] = pair.op_id_a

        # Job weights
        job_weights = {j.id: j.weight for j in request.jobs}

        # Initialize empty machine timelines
        machine_ops: dict[str, list[ScheduledOperation]] = {}
        for m in request.machines:
            machine_ops[m.id] = []

        return ScheduleState(
            machine_ops=machine_ops,
            twin_map=twin_map,
            constraints=request.constraints,
            _job_weights=job_weights,
        )
