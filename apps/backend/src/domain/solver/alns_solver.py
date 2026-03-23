# ALNS Solver — Phase 2 of the hybrid solver.
# Adaptive Large Neighbourhood Search with CP-SAT repair.
# Destroy 15-25% of ops per iteration, repair with CP-SAT sub-problems or greedy.
# Adaptive selection via roulette wheel. SA acceptance criterion.

from __future__ import annotations

import logging
import math
import random
import time
from collections import defaultdict

from .cpsat_solver import CpsatSolver
from .dispatch import _compute_p_bar_s_bar
from .schedule_state import ScheduledOperation, ScheduleState
from .schemas import (
    JobInput,
    OperationInput,
    SolverConfig,
    SolverRequest,
    TwinPairInput,
)

logger = logging.getLogger(__name__)

# ALNS parameters
DESTROY_FRAC_MIN = 0.15
DESTROY_FRAC_MAX = 0.25
SA_T_START = 100.0
SA_COOLING = 0.9995
SCORE_NEW_BEST = 3.0
SCORE_IMPROVED = 2.0
SCORE_ACCEPTED = 1.0
SCORE_REJECTED = 0.0
WEIGHT_DECAY = 0.8  # Roulette weight decay factor


class ALNSSolver:
    """Phase 2: ALNS with CP-SAT repair."""

    def __init__(self, request: SolverRequest):
        self.request = request
        self.constraints = request.constraints
        self._job_map: dict[str, JobInput] = {j.id: j for j in request.jobs}
        self._p_bar, self._s_bar = _compute_p_bar_s_bar(request)

        # Operator weights (adaptive)
        self._destroy_ops = [
            ("random", self._random_removal),
            ("worst", self._worst_removal),
            ("related", self._related_removal),
            ("critical", self._critical_path_removal),
        ]
        self._repair_ops = [
            ("cpsat", self._cpsat_repair),
            ("greedy", self._greedy_repair),
        ]
        self._destroy_weights = {name: 1.0 for name, _ in self._destroy_ops}
        self._repair_weights = {name: 1.0 for name, _ in self._repair_ops}

    def solve(
        self,
        initial: ScheduleState,
        time_budget_s: float = 15.0,
    ) -> ScheduleState:
        """Run ALNS iterations until time budget exhausted."""
        start_time = time.monotonic()
        best = initial.copy()
        best_wt = best.weighted_tardiness()
        current = initial.copy()
        current_wt = best_wt
        temperature = SA_T_START
        iteration = 0

        while time.monotonic() - start_time < time_budget_s:
            iteration += 1
            n_ops = current.n_ops()
            if n_ops == 0:
                break

            # Select operators
            destroy_name, destroy_fn = self._select_operator(
                self._destroy_ops, self._destroy_weights
            )
            repair_name, repair_fn = self._select_operator(self._repair_ops, self._repair_weights)

            # Destroy
            n_remove = random.randint(
                max(1, int(n_ops * DESTROY_FRAC_MIN)),
                max(2, int(n_ops * DESTROY_FRAC_MAX)),
            )
            candidate = current.copy()
            freed = destroy_fn(candidate, n_remove)
            if not freed:
                continue

            # Repair
            remaining_time = time_budget_s - (time.monotonic() - start_time)
            if remaining_time < 0.5:
                break
            candidate = repair_fn(candidate, freed, min(remaining_time * 0.5, 2.0))

            # Evaluate
            cand_wt = candidate.weighted_tardiness()

            # SA acceptance
            score = SCORE_REJECTED
            if cand_wt < best_wt:
                best = candidate.copy()
                best_wt = cand_wt
                current = candidate
                current_wt = cand_wt
                score = SCORE_NEW_BEST
                logger.debug(
                    "ALNS iter %d: NEW BEST wt=%.1f (destroy=%s, repair=%s)",
                    iteration,
                    best_wt,
                    destroy_name,
                    repair_name,
                )
            elif cand_wt < current_wt:
                current = candidate
                current_wt = cand_wt
                score = SCORE_IMPROVED
            elif temperature > 0.01:
                delta = cand_wt - current_wt
                accept_prob = math.exp(-delta / temperature) if temperature > 0 else 0
                if random.random() < accept_prob:
                    current = candidate
                    current_wt = cand_wt
                    score = SCORE_ACCEPTED

            # Update weights
            self._update_weight(self._destroy_weights, destroy_name, score)
            self._update_weight(self._repair_weights, repair_name, score)
            temperature *= SA_COOLING

            if best_wt == 0:
                break  # Perfect solution

        logger.info(
            "ALNS: %d iterations, best wt=%.1f, time=%.1fs",
            iteration,
            best_wt,
            time.monotonic() - start_time,
        )
        return best

    # ── Destroy operators ──

    def _random_removal(self, state: ScheduleState, n_remove: int) -> list[ScheduledOperation]:
        """Remove random ops (twin pairs removed together)."""
        all_ops = state.all_ops()
        if not all_ops:
            return []
        random.shuffle(all_ops)
        to_remove: set[str] = set()
        for op in all_ops:
            if len(to_remove) >= n_remove:
                break
            to_remove.add(op.op_id)
        return state.remove_ops(to_remove)

    def _worst_removal(self, state: ScheduleState, n_remove: int) -> list[ScheduledOperation]:
        """Remove ops with highest tardiness."""
        tardy = sorted(state.all_ops(), key=lambda o: -o.tardiness)
        to_remove: set[str] = set()
        for op in tardy:
            if len(to_remove) >= n_remove:
                break
            to_remove.add(op.op_id)
        return state.remove_ops(to_remove)

    def _related_removal(self, state: ScheduleState, n_remove: int) -> list[ScheduledOperation]:
        """Remove ops sharing machine or tool with a random seed op."""
        all_ops = state.all_ops()
        if not all_ops:
            return []
        seed = random.choice(all_ops)
        # Score relatedness: same machine = 2, same tool = 1
        scored = []
        for op in all_ops:
            r = 0
            if op.machine_id == seed.machine_id:
                r += 2
            if op.tool_id == seed.tool_id:
                r += 1
            scored.append((r, random.random(), op))
        scored.sort(key=lambda x: (-x[0], x[1]))
        to_remove: set[str] = set()
        for _, _, op in scored:
            if len(to_remove) >= n_remove:
                break
            to_remove.add(op.op_id)
        return state.remove_ops(to_remove)

    def _critical_path_removal(
        self, state: ScheduleState, n_remove: int
    ) -> list[ScheduledOperation]:
        """Remove ops on critical tardiness path (machine with most tardiness)."""
        # Find machine with highest total tardiness
        machine_tardiness: dict[str, int] = defaultdict(int)
        for ops in state.machine_ops.values():
            for op in ops:
                machine_tardiness[op.machine_id] += op.tardiness

        if not machine_tardiness:
            return self._random_removal(state, n_remove)

        worst_machine = max(machine_tardiness, key=lambda m: machine_tardiness[m])
        # Take tardy ops from worst machine first, then others
        ops_sorted = sorted(
            state.machine_ops.get(worst_machine, []),
            key=lambda o: -o.tardiness,
        )
        to_remove: set[str] = set()
        for op in ops_sorted:
            if len(to_remove) >= n_remove:
                break
            to_remove.add(op.op_id)

        # Fill remainder from other tardy ops
        if len(to_remove) < n_remove:
            for ops in state.machine_ops.values():
                for op in sorted(ops, key=lambda o: -o.tardiness):
                    if len(to_remove) >= n_remove:
                        break
                    to_remove.add(op.op_id)

        return state.remove_ops(to_remove)

    # ── Repair operators ──

    def _cpsat_repair(
        self,
        state: ScheduleState,
        freed_ops: list[ScheduledOperation],
        time_budget: float = 1.5,
    ) -> ScheduleState:
        """Build CP-SAT sub-problem for freed ops.

        Frozen ops stay fixed. Freed ops become variables.
        Solves with CpsatSolver in 1.5s.
        """
        if not freed_ops:
            return state

        # Collect freed job IDs
        freed_job_ids = {op.job_id for op in freed_ops}

        # Build mini SolverRequest with freed jobs only
        freed_jobs: list[JobInput] = []
        for jid in freed_job_ids:
            if jid in self._job_map:
                freed_jobs.append(self._job_map[jid])

        if not freed_jobs:
            return self._greedy_repair(state, freed_ops, time_budget)

        # Build blocking intervals from frozen ops (per machine)
        # We need to create a request where frozen ops are represented
        # as fixed-duration, zero-weight "blocker" jobs that consume machine time
        blocker_jobs: list[JobInput] = []
        blocker_idx = 0
        frozen_twin_pairs: list[TwinPairInput] = []

        for mid, ops in state.machine_ops.items():
            for op in ops:
                # Create a blocker job (very early deadline, zero weight)
                blocker_id = f"_blk_{blocker_idx}"
                blocker_op = OperationInput(
                    id=blocker_id,
                    machine_id=mid,
                    tool_id=op.tool_id,
                    duration_min=op.end_min - op.start_min,
                    setup_min=0,
                    operators=0,
                    calco_code=op.calco_code,
                )
                blocker_job = JobInput(
                    id=blocker_id,
                    sku="blocker",
                    due_date_min=op.end_min,  # Can't be tardy
                    weight=0.0,
                    operations=[blocker_op],
                )
                blocker_jobs.append(blocker_job)
                blocker_idx += 1

        # Build twin pairs for freed ops only
        freed_twin_pairs: list[TwinPairInput] = []
        freed_op_ids = {op.op_id for op in freed_ops}
        for pair in self.request.twin_pairs:
            if pair.op_id_a in freed_op_ids and pair.op_id_b in freed_op_ids:
                freed_twin_pairs.append(pair)

        all_jobs = freed_jobs + blocker_jobs
        mini_request = SolverRequest(
            jobs=all_jobs,
            machines=self.request.machines,
            setup_matrix=self.request.setup_matrix,
            config=SolverConfig(
                time_limit_s=max(1, int(time_budget)),
                objective="weighted_tardiness",
                num_workers=2,
                use_circuit=False,
                objective_mode="single",
                warm_start=False,
            ),
            twin_pairs=freed_twin_pairs,
            constraints=self.request.constraints,
            shifts=self.request.shifts,
            workdays=self.request.workdays,
        )

        try:
            solver = CpsatSolver()
            result = solver.solve(mini_request)

            if result.status in ("optimal", "feasible"):
                # Map result back into state
                for sop in result.schedule:
                    if sop.job_id.startswith("_blk_"):
                        continue  # Skip blockers
                    # Find the matching freed op
                    matching = [o for o in freed_ops if o.op_id == sop.op_id]
                    if not matching:
                        # Might be an alt op (_A) chosen by CP-SAT
                        matching = [o for o in freed_ops if o.job_id == sop.job_id]
                    if matching:
                        op = matching[0]
                        new_op = ScheduledOperation(
                            op_id=sop.op_id,
                            job_id=sop.job_id,
                            machine_id=sop.machine_id,
                            tool_id=sop.tool_id,
                            calco_code=op.calco_code,
                            start_min=sop.start_min,
                            end_min=sop.end_min,
                            setup_min=sop.setup_min,
                            duration_min=op.duration_min,
                            due_date_min=op.due_date_min,
                            weight=op.weight,
                            is_twin=sop.is_twin_production,
                            twin_partner_op_id=sop.twin_partner_op_id,
                            operators=op.operators,
                            alt_machine_id=op.alt_machine_id,
                        )
                        state.insert_op(new_op)
                return state
        except Exception:
            logger.warning("CP-SAT repair failed, falling back to greedy")

        return self._greedy_repair(state, freed_ops, time_budget)

    def _greedy_repair(
        self,
        state: ScheduleState,
        freed_ops: list[ScheduledOperation],
        time_budget: float = 1.0,
    ) -> ScheduleState:
        """ATCS-based greedy re-insertion of freed ops.

        Sorts by ATCS priority, inserts one by one at earliest feasible position.
        """
        from .constraint_checker import find_earliest_feasible_start

        if not freed_ops:
            return state

        # Sort freed ops by deadline urgency (EDD), then by weight
        freed_ops.sort(key=lambda o: (o.due_date_min, -o.weight))

        # Twin partner tracking
        twin_slots: dict[str, tuple[int, int, str]] = {}

        for op in freed_ops:
            # Check if twin partner already re-inserted
            partner_id = state.twin_map.get(op.op_id)
            if partner_id and partner_id in twin_slots:
                p_start, p_end, p_mid = twin_slots[partner_id]
                co_op = ScheduledOperation(
                    op_id=op.op_id,
                    job_id=op.job_id,
                    machine_id=p_mid,
                    tool_id=op.tool_id,
                    calco_code=op.calco_code,
                    start_min=p_start,
                    end_min=p_end,
                    setup_min=0,
                    duration_min=op.duration_min,
                    due_date_min=op.due_date_min,
                    weight=op.weight,
                    is_twin=True,
                    twin_partner_op_id=partner_id,
                    operators=op.operators,
                    alt_machine_id=op.alt_machine_id,
                )
                state.insert_op(co_op)
                continue

            # Try primary machine first, then alt
            machines = [op.machine_id]
            if op.alt_machine_id:
                machines.append(op.alt_machine_id)

            best_end = float("inf")
            best_start = 0
            best_setup = 0
            best_mid = op.machine_id

            for mid in machines:
                start, setup = find_earliest_feasible_start(
                    state,
                    mid,
                    op.tool_id,
                    op.calco_code,
                    op.duration_min,
                    op.setup_min,
                )
                prod_start = start + setup
                end = prod_start + op.duration_min
                if end < best_end:
                    best_end = end
                    best_start = prod_start
                    best_setup = setup
                    best_mid = mid

            new_op = ScheduledOperation(
                op_id=op.op_id,
                job_id=op.job_id,
                machine_id=best_mid,
                tool_id=op.tool_id,
                calco_code=op.calco_code,
                start_min=best_start,
                end_min=int(best_end),
                setup_min=best_setup,
                duration_min=op.duration_min,
                due_date_min=op.due_date_min,
                weight=op.weight,
                is_twin=partner_id is not None if partner_id else False,
                twin_partner_op_id=partner_id,
                operators=op.operators,
                alt_machine_id=op.alt_machine_id,
            )
            state.insert_op(new_op)

            if partner_id:
                twin_slots[op.op_id] = (best_start, int(best_end), best_mid)

        return state

    # ── Adaptive selection ──

    def _select_operator(self, operators, weights):
        """Roulette wheel selection based on weights."""
        names = [name for name, _ in operators]
        w = [max(weights[name], 0.01) for name in names]
        total = sum(w)
        r = random.random() * total
        cumulative = 0
        for i, name in enumerate(names):
            cumulative += w[i]
            if r <= cumulative:
                return operators[i]
        return operators[-1]

    def _update_weight(self, weights, name, score):
        """Update operator weight with decay."""
        weights[name] = WEIGHT_DECAY * weights[name] + (1 - WEIGHT_DECAY) * score
