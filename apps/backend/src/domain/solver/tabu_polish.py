# Tabu Search Polish — Phase 3 of the hybrid solver.
# Disjunctive graph with N7 neighbourhood (critical path swaps).
# Tabu list prevents cycling. Aspiration overrides tabu for new bests.

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from .constraint_checker import is_feasible
from .schedule_state import ScheduleState

logger = logging.getLogger(__name__)

TABU_TENURE = 10
MAKESPAN_WEIGHT = 0.01  # Tiebreaker: weighted_tardiness + 0.01 × makespan


@dataclass
class DisjunctiveArc:
    """Arc in the disjunctive graph (machine sequencing)."""

    from_op_id: str
    to_op_id: str
    machine_id: str


class TabuPolish:
    """Phase 3: Tabu search with N7 critical path neighbourhood."""

    def solve(
        self,
        initial: ScheduleState,
        time_budget_s: float = 8.0,
    ) -> ScheduleState:
        """Run tabu search iterations until time budget exhausted."""
        start_time = time.monotonic()
        best = initial.copy()
        best_obj = self._evaluate(best)
        current = initial.copy()
        current_obj = best_obj

        tabu_list: list[tuple[str, str]] = []  # FIFO of (op_a, op_b) swapped pairs
        iteration = 0

        while time.monotonic() - start_time < time_budget_s:
            iteration += 1

            # Build disjunctive graph and find critical path
            arcs = self._build_disjunctive_graph(current)
            critical = self._find_critical_path(current, arcs)

            if not critical:
                break  # No critical arcs (perfect schedule)

            # Generate N7 moves from critical path
            moves = self._generate_n7_moves(current, critical)
            if not moves:
                break

            # Evaluate all moves, pick best non-tabu (or aspiration)
            best_move = None
            best_move_obj = float("inf")
            best_move_state = None

            for op_a_id, op_b_id, mid in moves:
                # Tabu check
                is_tabu = (op_a_id, op_b_id) in tabu_list or (op_b_id, op_a_id) in tabu_list

                candidate = self._apply_swap(current, op_a_id, op_b_id, mid)
                if candidate is None:
                    continue

                obj = self._evaluate(candidate)

                # Accept if: not tabu, or aspiration (better than global best)
                if obj < best_move_obj:
                    if not is_tabu or obj < best_obj:
                        best_move = (op_a_id, op_b_id)
                        best_move_obj = obj
                        best_move_state = candidate

            if best_move is None:
                break  # No improving moves

            # Apply best move
            current = best_move_state  # type: ignore[assignment]
            current_obj = best_move_obj

            # Update tabu list
            tabu_list.append(best_move)
            if len(tabu_list) > TABU_TENURE:
                tabu_list.pop(0)

            # Update global best
            if current_obj < best_obj:
                best = current.copy()
                best_obj = current_obj
                logger.debug("Tabu iter %d: NEW BEST obj=%.1f", iteration, best_obj)

            if best.weighted_tardiness() == 0:
                break

        logger.info(
            "Tabu: %d iterations, best obj=%.1f, time=%.1fs",
            iteration,
            best_obj,
            time.monotonic() - start_time,
        )
        return best

    def _build_disjunctive_graph(self, state: ScheduleState) -> list[DisjunctiveArc]:
        """Build machine arcs from current schedule.

        For each machine, consecutive ops form arcs.
        """
        arcs: list[DisjunctiveArc] = []
        for mid, ops in state.machine_ops.items():
            for i in range(len(ops) - 1):
                arcs.append(
                    DisjunctiveArc(
                        from_op_id=ops[i].op_id,
                        to_op_id=ops[i + 1].op_id,
                        machine_id=mid,
                    )
                )
        return arcs

    def _find_critical_path(
        self, state: ScheduleState, arcs: list[DisjunctiveArc]
    ) -> list[DisjunctiveArc]:
        """Find critical arcs — arcs where at least one endpoint is tardy.

        For tardiness minimization, the "critical path" is the chain of
        operations contributing to tardiness. We approximate by selecting
        arcs on machines where tardiness exists.
        """
        # Machines with tardiness
        tardy_machines: set[str] = set()
        for ops in state.machine_ops.values():
            for op in ops:
                if op.is_tardy:
                    tardy_machines.add(op.machine_id)

        if not tardy_machines:
            return []

        critical: list[DisjunctiveArc] = []
        for arc in arcs:
            if arc.machine_id in tardy_machines:
                critical.append(arc)
        return critical

    def _generate_n7_moves(
        self,
        state: ScheduleState,
        critical_arcs: list[DisjunctiveArc],
    ) -> list[tuple[str, str, str]]:
        """Generate N7 swap candidates: (op_a_id, op_b_id, machine_id).

        For each critical arc (i→j), propose swapping i and j.
        Skip swaps that would break twin pairs.
        """
        moves: list[tuple[str, str, str]] = []
        seen: set[tuple[str, str]] = set()

        for arc in critical_arcs:
            pair = (arc.from_op_id, arc.to_op_id)
            if pair in seen:
                continue
            seen.add(pair)

            # Don't swap twin pairs (they must stay co-located)
            op_a = state.get_op(arc.from_op_id)
            op_b = state.get_op(arc.to_op_id)
            if not op_a or not op_b:
                continue

            # Skip if either is a twin co-production (same slot as partner)
            if op_a.is_twin and op_a.twin_partner_op_id:
                partner = state.get_op(op_a.twin_partner_op_id)
                if partner and partner.start_min == op_a.start_min:
                    # op_a is co-produced — swapping would break the pair
                    # unless op_b is the partner
                    if op_b.op_id != op_a.twin_partner_op_id:
                        continue

            if op_b.is_twin and op_b.twin_partner_op_id:
                partner = state.get_op(op_b.twin_partner_op_id)
                if partner and partner.start_min == op_b.start_min:
                    if op_a.op_id != op_b.twin_partner_op_id:
                        continue

            moves.append((arc.from_op_id, arc.to_op_id, arc.machine_id))

        return moves

    def _apply_swap(
        self,
        state: ScheduleState,
        op_a_id: str,
        op_b_id: str,
        machine_id: str,
    ) -> ScheduleState | None:
        """Swap two adjacent ops on a machine.

        After swapping, recalculate start/end times for the machine
        from the swap point forward. Validate constraints.
        Returns None if infeasible.
        """
        candidate = state.copy()
        ops = candidate.machine_ops.get(machine_id, [])

        # Find positions
        idx_a = None
        idx_b = None
        for i, op in enumerate(ops):
            if op.op_id == op_a_id:
                idx_a = i
            elif op.op_id == op_b_id:
                idx_b = i

        if idx_a is None or idx_b is None:
            return None

        # Swap positions
        ops[idx_a], ops[idx_b] = ops[idx_b], ops[idx_a]

        # Re-compute start/end times from the earlier swap point forward
        start_idx = min(idx_a, idx_b)
        self._recompute_times(candidate, machine_id, start_idx)

        # Validate constraints
        if not is_feasible(candidate):
            return None

        return candidate

    def _recompute_times(
        self,
        state: ScheduleState,
        machine_id: str,
        from_idx: int = 0,
    ) -> None:
        """Recompute start/end times for a machine from from_idx forward."""
        ops = state.machine_ops.get(machine_id, [])
        if not ops:
            return

        for i in range(from_idx, len(ops)):
            op = ops[i]
            # Earliest: after previous op on this machine
            if i > 0:
                prev = ops[i - 1]
                earliest = prev.end_min
                # Setup: 0 if same tool, else op's setup_min
                setup = 0 if prev.tool_id == op.tool_id else op.setup_min
            else:
                earliest = 0
                setup = op.setup_min

            start = earliest + setup
            end = start + op.duration_min

            op.start_min = start
            op.end_min = end
            op.setup_min = setup

    def _evaluate(self, state: ScheduleState) -> float:
        """Objective: weighted_tardiness + 0.01 × makespan."""
        return state.weighted_tardiness() + MAKESPAN_WEIGHT * state.makespan()
