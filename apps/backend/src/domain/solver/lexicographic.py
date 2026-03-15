# Lexicographic 3-Phase Solver (S-02)
# Phase 1: Minimize total weighted tardiness (hard deadlines first, soft fallback)
# Phase 2: Maximize JIT (push jobs close to deadline, fixing tardiness bound)
# Phase 3: Minimize setups (fixing JIT, only meaningful with circuit mode)
#
# Uses CP-SAT model rebuilding with hint transfer between phases.

from __future__ import annotations

import time
from collections import defaultdict

from ortools.sat.python import cp_model

from .cpsat_constraints import (
    add_setup_crew_constraint,
    analyse_operator_pool,
    apply_calco_timeline,
    apply_tool_timeline,
    build_twin_merged_intervals,
)
from .schemas import ScheduledOp, SolverRequest, SolverResult
from .setup_sequencing import add_machine_circuit
from .warm_start import add_edd_hints, pick_best_heuristic


class LexicographicSolver:
    """3-phase lexicographic solver.

    Phase 1 (40% time): Minimize weighted tardiness
    Phase 2 (30% time): Maximize sum(start_vars) for JIT (fix tardiness <= phase1)
    Phase 3 (30% time): Minimize number of setups (fix JIT >= phase2)
    """

    def solve(self, request: SolverRequest) -> SolverResult:
        total_start = time.monotonic()
        time_budget = request.config.time_limit_s

        # Time allocation per phase
        t1 = max(int(time_budget * 0.40), 5)
        t2 = max(int(time_budget * 0.30), 5)
        t3 = max(int(time_budget * 0.30), 5)

        # Phase 1: minimize tardiness
        p1_result, p1_schedule = self._phase1(request, t1)
        if p1_result.status == "infeasible":
            return p1_result

        phase_values = {"phase1_tardiness": p1_result.objective_value}

        # Phase 2: maximize JIT with tardiness bound
        p2_result, p2_schedule = self._phase2(request, t2, p1_result.weighted_tardiness)
        if p2_result.status in ("infeasible", "timeout"):
            # Fallback to phase 1 result
            p2_result = p1_result
            p2_schedule = p1_schedule

        phase_values["phase2_jit"] = p2_result.objective_value

        # Phase 3: minimize setups with JIT bound
        p3_result, p3_schedule = self._phase3(
            request, t3, p1_result.weighted_tardiness, p2_result, p2_schedule
        )
        if p3_result.status in ("infeasible", "timeout"):
            p3_result = p2_result

        phase_values["phase3_setups"] = p3_result.objective_value

        total_time = time.monotonic() - total_start
        p3_result.solve_time_s = round(total_time, 3)
        p3_result.solver_used = "cpsat_lexicographic"
        p3_result.phase_values = phase_values
        return p3_result

    def _build_model(
        self, request: SolverRequest
    ) -> tuple[
        cp_model.CpModel,
        dict[str, tuple],
        dict[str, list],
        list,
        dict[str, list[dict]],
        dict[str, int],
        int,
    ]:
        """Build CP-SAT model (shared across phases). Returns model and variable maps."""
        model = cp_model.CpModel()

        all_ops = []
        for job in request.jobs:
            for op in job.operations:
                all_ops.append((job, op))

        n_ops = len(all_ops)
        if n_ops == 0:
            return model, {}, defaultdict(list), [], {}, {}, 0

        horizon = sum(op.duration_min + op.setup_min for _, op in all_ops)
        horizon = max(horizon, max(j.due_date_min for j in request.jobs) + 1)

        use_circuit = request.config.use_circuit

        twin_op_ids = set()
        for pair in request.twin_pairs:
            twin_op_ids.add(pair.op_id_a)
            twin_op_ids.add(pair.op_id_b)

        op_vars: dict[str, tuple] = {}
        machine_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
        setup_intervals: list[cp_model.IntervalVar] = []
        op_tool_map: dict[str, str] = {}
        op_calco_map: dict[str, str | None] = {}
        op_machine_map: dict[str, str] = {}
        op_full_intervals: dict[str, cp_model.IntervalVar] = {}
        machine_jobs: dict[str, list[dict]] = defaultdict(list)
        prod_durations: dict[str, int] = {}

        for job, op in all_ops:
            suffix = f"_{op.id}"
            is_twin = op.id in twin_op_ids

            start_var = model.NewIntVar(0, horizon, f"start{suffix}")
            end_var = model.NewIntVar(0, horizon, f"end{suffix}")

            if use_circuit:
                setup_iv = None
                prod_iv = None
                full_iv = None

                if not is_twin:
                    machine_jobs[op.machine_id].append(
                        {
                            "job_id": op.id,
                            "tool": op.tool_id,
                            "setup_default": op.setup_min,
                        }
                    )
                    prod_durations[op.id] = op.duration_min

                    max_setup = max(op.setup_min, 90)
                    size_var = model.NewIntVar(
                        op.duration_min, op.duration_min + max_setup, f"sz{suffix}"
                    )
                    full_iv = model.NewIntervalVar(
                        start_var, size_var, end_var, f"interval{suffix}"
                    )
                    op_full_intervals[op.id] = full_iv
            else:
                if is_twin:
                    setup_iv = None
                    prod_iv = None
                    full_iv = None
                elif op.setup_min > 0:
                    total_duration = op.duration_min + op.setup_min
                    setup_end = model.NewIntVar(0, horizon, f"setup_end{suffix}")
                    setup_iv = model.NewIntervalVar(
                        start_var, op.setup_min, setup_end, f"setup_iv{suffix}"
                    )
                    prod_iv = model.NewIntervalVar(
                        setup_end, op.duration_min, end_var, f"prod_iv{suffix}"
                    )
                    setup_intervals.append(setup_iv)
                    full_iv = model.NewIntervalVar(
                        start_var, total_duration, end_var, f"interval{suffix}"
                    )
                    machine_intervals[op.machine_id].append(full_iv)
                else:
                    setup_iv = None
                    prod_iv = model.NewIntervalVar(
                        start_var, op.duration_min, end_var, f"prod_iv{suffix}"
                    )
                    full_iv = model.NewIntervalVar(
                        start_var, op.duration_min, end_var, f"interval{suffix}"
                    )
                    machine_intervals[op.machine_id].append(full_iv)

            op_vars[op.id] = (start_var, end_var, setup_iv, prod_iv, full_iv, job, op)
            op_tool_map[op.id] = op.tool_id
            op_calco_map[op.id] = op.calco_code
            op_machine_map[op.id] = op.machine_id

        # Twin co-production
        twin_merged, _ = build_twin_merged_intervals(model, request.twin_pairs, op_vars, horizon)
        for _pair_key, (merged_iv, machine_id, pair) in twin_merged.items():
            machine_intervals[machine_id].append(merged_iv)
            op_full_intervals[pair.op_id_a] = merged_iv

        # Precedence
        for job in request.jobs:
            for i in range(len(job.operations) - 1):
                op_curr = job.operations[i]
                op_next = job.operations[i + 1]
                _, end_curr, _, _, _, _, _ = op_vars[op_curr.id]
                start_next, _, _, _, _, _, _ = op_vars[op_next.id]
                model.Add(end_curr <= start_next)

        # Machine sequencing
        circuit_setup_intervals: list[cp_model.IntervalVar] = []
        if use_circuit:
            start_vars_map = {oid: op_vars[oid][0] for oid in op_vars}
            end_vars_map = {oid: op_vars[oid][1] for oid in op_vars}

            for mid, jobs_list in machine_jobs.items():
                _arcs, sivs = add_machine_circuit(
                    model=model,
                    machine_id=mid,
                    jobs=jobs_list,
                    start_vars=start_vars_map,
                    end_vars=end_vars_map,
                    prod_durations=prod_durations,
                    setup_matrix=request.setup_matrix,
                    default_setup=45,
                    horizon=horizon,
                )
                circuit_setup_intervals.extend(sivs)

            constraints = request.constraints
            if constraints.setup_crew and circuit_setup_intervals:
                add_setup_crew_constraint(model, circuit_setup_intervals)
        else:
            for machine_id, intervals in machine_intervals.items():
                if len(intervals) > 1:
                    model.AddNoOverlap(intervals)

            constraints = request.constraints
            if constraints.setup_crew and setup_intervals:
                add_setup_crew_constraint(model, setup_intervals)

        # Factory constraints
        constraints = request.constraints
        if constraints.tool_timeline:
            apply_tool_timeline(model, op_tool_map, op_full_intervals, op_machine_map)
        if constraints.calco_timeline:
            apply_calco_timeline(model, op_calco_map, op_full_intervals)

        return (
            model,
            op_vars,
            machine_intervals,
            circuit_setup_intervals,
            machine_jobs,
            prod_durations,
            horizon,
        )

    def _phase1(
        self, request: SolverRequest, time_limit: int
    ) -> tuple[SolverResult, list[ScheduledOp]]:
        """Phase 1: Minimize weighted tardiness."""
        model, op_vars, _, _, _, _, horizon = self._build_model(request)

        if not op_vars:
            empty = SolverResult(
                schedule=[],
                makespan_min=0,
                total_tardiness_min=0,
                weighted_tardiness=0.0,
                solver_used="cpsat_lex_p1",
                solve_time_s=0.0,
                status="optimal",
                objective_value=0.0,
                n_ops=0,
            )
            return empty, []

        # Warm-start with heuristic
        heuristic_schedule = pick_best_heuristic(request)
        add_edd_hints(model, heuristic_schedule, op_vars)

        # Objective: minimize weighted tardiness
        weighted_tardy_terms = []
        for job in request.jobs:
            last_op = job.operations[-1]
            _, end_var, _, _, _, _, _ = op_vars[last_op.id]
            tardy = model.NewIntVar(0, horizon, f"tardy_{job.id}")
            model.Add(tardy >= end_var - job.due_date_min)
            model.Add(tardy >= 0)
            scaled_weight = int(job.weight * 100)
            weighted_tardy = model.NewIntVar(0, horizon * scaled_weight, f"wtardy_{job.id}")
            model.Add(weighted_tardy == tardy * scaled_weight)
            weighted_tardy_terms.append(weighted_tardy)

        model.Minimize(sum(weighted_tardy_terms))

        return self._solve_and_extract(model, op_vars, request, time_limit)

    def _phase2(
        self, request: SolverRequest, time_limit: int, max_tardiness: float
    ) -> tuple[SolverResult, list[ScheduledOp]]:
        """Phase 2: Maximize JIT (push starts late) with tardiness bound."""
        model, op_vars, _, _, _, _, horizon = self._build_model(request)

        if not op_vars:
            empty = SolverResult(
                schedule=[],
                makespan_min=0,
                total_tardiness_min=0,
                weighted_tardiness=0.0,
                solver_used="cpsat_lex_p2",
                solve_time_s=0.0,
                status="optimal",
                objective_value=0.0,
                n_ops=0,
            )
            return empty, []

        # Warm-start
        heuristic_schedule = pick_best_heuristic(request)
        add_edd_hints(model, heuristic_schedule, op_vars)

        # Constraint: weighted tardiness <= phase1 best (with 5% tolerance)
        weighted_tardy_terms = []
        for job in request.jobs:
            last_op = job.operations[-1]
            _, end_var, _, _, _, _, _ = op_vars[last_op.id]
            tardy = model.NewIntVar(0, horizon, f"tardy_{job.id}")
            model.Add(tardy >= end_var - job.due_date_min)
            model.Add(tardy >= 0)
            scaled_weight = int(job.weight * 100)
            weighted_tardy = model.NewIntVar(0, horizon * scaled_weight, f"wtardy_{job.id}")
            model.Add(weighted_tardy == tardy * scaled_weight)
            weighted_tardy_terms.append(weighted_tardy)

        # Allow 5% tolerance on tardiness bound
        tardiness_bound = int(max_tardiness * 100 * 1.05) + 1
        model.Add(sum(weighted_tardy_terms) <= tardiness_bound)

        # Objective: maximize sum of start times (JIT = start as late as possible)
        start_sum = []
        for op_id, (start_var, _, _, _, _, _, _) in op_vars.items():
            start_sum.append(start_var)
        model.Maximize(sum(start_sum))

        return self._solve_and_extract(model, op_vars, request, time_limit)

    def _phase3(
        self,
        request: SolverRequest,
        time_limit: int,
        max_tardiness: float,
        p2_result: SolverResult,
        p2_schedule: list[ScheduledOp],
    ) -> tuple[SolverResult, list[ScheduledOp]]:
        """Phase 3: Minimize makespan (proxy for fewer setups) with tardiness bound."""
        model, op_vars, _, _, _, _, horizon = self._build_model(request)

        if not op_vars:
            empty = SolverResult(
                schedule=[],
                makespan_min=0,
                total_tardiness_min=0,
                weighted_tardiness=0.0,
                solver_used="cpsat_lex_p3",
                solve_time_s=0.0,
                status="optimal",
                objective_value=0.0,
                n_ops=0,
            )
            return empty, []

        # Warm-start with phase 2 solution
        if p2_schedule:
            add_edd_hints(model, p2_schedule, op_vars)

        # Constraint: weighted tardiness <= phase1 best
        weighted_tardy_terms = []
        for job in request.jobs:
            last_op = job.operations[-1]
            _, end_var, _, _, _, _, _ = op_vars[last_op.id]
            tardy = model.NewIntVar(0, horizon, f"tardy_{job.id}")
            model.Add(tardy >= end_var - job.due_date_min)
            model.Add(tardy >= 0)
            scaled_weight = int(job.weight * 100)
            weighted_tardy = model.NewIntVar(0, horizon * scaled_weight, f"wtardy_{job.id}")
            model.Add(weighted_tardy == tardy * scaled_weight)
            weighted_tardy_terms.append(weighted_tardy)

        tardiness_bound = int(max_tardiness * 100 * 1.05) + 1
        model.Add(sum(weighted_tardy_terms) <= tardiness_bound)

        # Objective: minimize makespan (compact schedule = fewer idle gaps = fewer setups)
        makespan_var = model.NewIntVar(0, horizon, "makespan")
        for op_id, (_, end_var, _, _, _, _, _) in op_vars.items():
            model.Add(makespan_var >= end_var)
        model.Minimize(makespan_var)

        return self._solve_and_extract(model, op_vars, request, time_limit)

    def _solve_and_extract(
        self,
        model: cp_model.CpModel,
        op_vars: dict[str, tuple],
        request: SolverRequest,
        time_limit: int,
    ) -> tuple[SolverResult, list[ScheduledOp]]:
        """Solve model and extract schedule."""
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit
        solver.parameters.num_workers = request.config.num_workers

        status = solver.Solve(model)

        status_map = {
            cp_model.OPTIMAL: "optimal",
            cp_model.FEASIBLE: "feasible",
            cp_model.INFEASIBLE: "infeasible",
            cp_model.MODEL_INVALID: "infeasible",
            cp_model.UNKNOWN: "timeout",
        }
        status_str = status_map.get(status, "timeout")

        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return SolverResult(
                schedule=[],
                makespan_min=0,
                total_tardiness_min=0,
                weighted_tardiness=0.0,
                solver_used="cpsat_lexicographic",
                solve_time_s=0.0,
                status=status_str,
                objective_value=0.0,
                n_ops=len(op_vars),
            ), []

        # Extract
        job_due_dates = {j.id: j.due_date_min for j in request.jobs}
        job_weights = {j.id: j.weight for j in request.jobs}
        op_to_job: dict[str, str] = {}
        for job in request.jobs:
            for op in job.operations:
                op_to_job[op.id] = job.id

        twin_lookup: dict[str, str] = {}
        for pair in request.twin_pairs:
            twin_lookup[pair.op_id_a] = pair.op_id_b
            twin_lookup[pair.op_id_b] = pair.op_id_a

        schedule: list[ScheduledOp] = []
        makespan = 0
        total_tardiness = 0
        weighted_tardiness = 0.0

        for op_id, (start_var, end_var, _, _, _, job, op) in op_vars.items():
            start_val = solver.Value(start_var)
            end_val = solver.Value(end_var)
            job_id = op_to_job[op_id]
            due_date = job_due_dates[job_id]

            makespan = max(makespan, end_val)
            is_last_op = op_id == job.operations[-1].id
            tardiness = max(0, end_val - due_date) if is_last_op else 0

            if is_last_op:
                total_tardiness += tardiness
                weighted_tardiness += job_weights[job_id] * tardiness

            schedule.append(
                ScheduledOp(
                    op_id=op_id,
                    job_id=job_id,
                    machine_id=op.machine_id,
                    tool_id=op.tool_id,
                    start_min=start_val,
                    end_min=end_val,
                    setup_min=op.setup_min,
                    is_tardy=tardiness > 0 if is_last_op else False,
                    tardiness_min=tardiness,
                    is_twin_production=op_id in twin_lookup,
                    twin_partner_op_id=twin_lookup.get(op_id),
                )
            )

        schedule.sort(key=lambda s: (s.machine_id, s.start_min))

        result = SolverResult(
            schedule=schedule,
            makespan_min=makespan,
            total_tardiness_min=total_tardiness,
            weighted_tardiness=round(weighted_tardiness, 2),
            solver_used="cpsat_lexicographic",
            solve_time_s=0.0,
            status=status_str,
            objective_value=float(solver.ObjectiveValue()),
            n_ops=len(op_vars),
        )

        # Operator pool analysis
        if request.constraints.operator_pool:
            schedule_dicts = [
                {
                    "op_id": s.op_id,
                    "machine_id": s.machine_id,
                    "start_min": s.start_min,
                    "end_min": s.end_min,
                }
                for s in schedule
            ]
            result.operator_warnings = analyse_operator_pool(schedule_dicts, request)

        return result, schedule
