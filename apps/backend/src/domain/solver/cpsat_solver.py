# CP-SAT Solver — OR-Tools wrapper
# Conforme CLAUDE.md Camada 3: CP-SAT server-side (OR-Tools, 5-60s)
# <50 jobs: solução óptima. 50-200: time limit 30-60s. >200: fallback Camada 1.

import time
from collections import defaultdict

from ortools.sat.python import cp_model

from .schemas import ScheduledOp, SolverRequest, SolverResult


class CpsatSolver:
    """
    Wrapper para o solver CP-SAT do OR-Tools.

    Suporta 3 objectivos: makespan, tardiness, weighted_tardiness.
    Constraints: precedência (intra-job), NoOverlap (por máquina).
    """

    def solve(self, request: SolverRequest) -> SolverResult:
        start_time = time.monotonic()
        model = cp_model.CpModel()

        all_ops = []
        for job in request.jobs:
            for op in job.operations:
                all_ops.append((job, op))

        n_ops = len(all_ops)

        if n_ops == 0:
            return SolverResult(
                schedule=[],
                makespan_min=0,
                total_tardiness_min=0,
                weighted_tardiness=0.0,
                solver_used="cpsat",
                solve_time_s=0.0,
                status="optimal",
                objective_value=0.0,
                n_ops=0,
            )

        # 1. Calculate horizon (upper bound for all times)
        horizon = sum(op.duration_min + op.setup_min for _, op in all_ops)
        horizon = max(horizon, max(j.due_date_min for j in request.jobs) + 1)

        # 2. Create variables for each operation
        op_vars = {}  # op.id → (start, end, interval, job, op)
        machine_intervals = defaultdict(list)  # machine_id → [(interval, op_id)]

        for job, op in all_ops:
            suffix = f"_{op.id}"
            total_duration = op.duration_min + op.setup_min

            start_var = model.NewIntVar(0, horizon, f"start{suffix}")
            end_var = model.NewIntVar(0, horizon, f"end{suffix}")
            interval_var = model.NewIntervalVar(
                start_var, total_duration, end_var, f"interval{suffix}"
            )

            op_vars[op.id] = (start_var, end_var, interval_var, job, op)
            machine_intervals[op.machine_id].append((interval_var, op.id))

        # 3. Precedence constraints (within each job)
        for job in request.jobs:
            for i in range(len(job.operations) - 1):
                op_curr = job.operations[i]
                op_next = job.operations[i + 1]
                _, end_curr, _, _, _ = op_vars[op_curr.id]
                start_next, _, _, _, _ = op_vars[op_next.id]
                model.Add(end_curr <= start_next)

        # 4. NoOverlap per machine
        for machine_id, intervals in machine_intervals.items():
            interval_list = [iv for iv, _ in intervals]
            if len(interval_list) > 1:
                model.AddNoOverlap(interval_list)

        # 5. Objective
        objective = request.config.objective

        if objective == "makespan":
            makespan_var = model.NewIntVar(0, horizon, "makespan")
            for op_id, (_, end_var, _, _, _) in op_vars.items():
                model.Add(makespan_var >= end_var)
            model.Minimize(makespan_var)

        elif objective == "tardiness":
            tardiness_vars = []
            for job in request.jobs:
                last_op = job.operations[-1]
                _, end_var, _, _, _ = op_vars[last_op.id]
                tardy = model.NewIntVar(0, horizon, f"tardy_{job.id}")
                model.Add(tardy >= end_var - job.due_date_min)
                model.Add(tardy >= 0)
                tardiness_vars.append(tardy)
            model.Minimize(sum(tardiness_vars))

        else:  # weighted_tardiness
            # Use scaled weights (multiply by 100 to keep integer arithmetic)
            weighted_tardy_terms = []
            for job in request.jobs:
                last_op = job.operations[-1]
                _, end_var, _, _, _ = op_vars[last_op.id]
                tardy = model.NewIntVar(0, horizon, f"tardy_{job.id}")
                model.Add(tardy >= end_var - job.due_date_min)
                model.Add(tardy >= 0)
                scaled_weight = int(job.weight * 100)
                weighted_tardy = model.NewIntVar(0, horizon * scaled_weight, f"wtardy_{job.id}")
                model.Add(weighted_tardy == tardy * scaled_weight)
                weighted_tardy_terms.append(weighted_tardy)
            model.Minimize(sum(weighted_tardy_terms))

        # 6. Solve
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = request.config.time_limit_s
        solver.parameters.num_workers = request.config.num_workers

        status = solver.Solve(model)

        solve_time = time.monotonic() - start_time

        # 7. Map status
        status_map = {
            cp_model.OPTIMAL: "optimal",
            cp_model.FEASIBLE: "feasible",
            cp_model.INFEASIBLE: "infeasible",
            cp_model.MODEL_INVALID: "infeasible",
            cp_model.UNKNOWN: "timeout",
        }
        status_str = status_map.get(status, "timeout")

        # 8. Extract solution
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return self._extract_solution(solver, op_vars, request, solve_time, status_str, n_ops)
        else:
            return SolverResult(
                schedule=[],
                makespan_min=0,
                total_tardiness_min=0,
                weighted_tardiness=0.0,
                solver_used="cpsat",
                solve_time_s=round(solve_time, 3),
                status=status_str,
                objective_value=0.0,
                n_ops=n_ops,
            )

    def _extract_solution(
        self, solver, op_vars, request, solve_time, status_str, n_ops
    ) -> SolverResult:
        """Extract solution from solved model."""
        schedule = []
        job_due_dates = {j.id: j.due_date_min for j in request.jobs}
        job_weights = {j.id: j.weight for j in request.jobs}

        # Build op_id → job_id map
        op_to_job = {}
        for job in request.jobs:
            for op in job.operations:
                op_to_job[op.id] = job.id

        makespan = 0
        total_tardiness = 0
        weighted_tardiness = 0.0

        for op_id, (start_var, end_var, _, job, op) in op_vars.items():
            start_val = solver.Value(start_var)
            end_val = solver.Value(end_var)
            job_id = op_to_job[op_id]
            due_date = job_due_dates[job_id]

            makespan = max(makespan, end_val)

            # Tardiness is only for the last op of each job
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
                )
            )

        # Sort by start time
        schedule.sort(key=lambda s: (s.machine_id, s.start_min))

        return SolverResult(
            schedule=schedule,
            makespan_min=makespan,
            total_tardiness_min=total_tardiness,
            weighted_tardiness=round(weighted_tardiness, 2),
            solver_used="cpsat",
            solve_time_s=round(solve_time, 3),
            status=status_str,
            objective_value=float(solver.ObjectiveValue()),
            n_ops=n_ops,
        )
