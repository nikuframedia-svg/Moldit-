# Tests for CP-SAT Solver + Heuristic Fallback + Router
# Conforme Contrato C4

from src.domain.solver.cpsat_solver import CpsatSolver
from src.domain.solver.heuristic_fallback import HeuristicFallback
from src.domain.solver.router_logic import SolverRouter
from src.domain.solver.schemas import (
    JobInput,
    MachineInput,
    OperationInput,
    SolverConfig,
    SolverRequest,
)


def _make_op(op_id, machine_id, tool_id="T1", duration=60, setup=15):
    return OperationInput(
        id=op_id,
        machine_id=machine_id,
        tool_id=tool_id,
        duration_min=duration,
        setup_min=setup,
        operators=1,
    )


def _make_job(job_id, sku, due_date, weight, ops):
    return JobInput(id=job_id, sku=sku, due_date_min=due_date, weight=weight, operations=ops)


def _make_request(jobs, machines, objective="weighted_tardiness", time_limit=10):
    return SolverRequest(
        jobs=jobs,
        machines=machines,
        config=SolverConfig(time_limit_s=time_limit, objective=objective, num_workers=1),
    )


class TestCpsatSolver:
    def setup_method(self):
        self.solver = CpsatSolver()

    def test_small_problem_5_ops(self):
        """2 jobs × ~2 ops on 2 machines → optimal solution."""
        jobs = [
            _make_job(
                "J1",
                "SKU1",
                200,
                1.0,
                [
                    _make_op("J1_O1", "M1", duration=50, setup=10),
                    _make_op("J1_O2", "M2", duration=40, setup=10),
                ],
            ),
            _make_job(
                "J2",
                "SKU2",
                300,
                1.0,
                [
                    _make_op("J2_O1", "M2", duration=60, setup=10),
                    _make_op("J2_O2", "M1", duration=30, setup=10),
                ],
            ),
        ]
        machines = [MachineInput(id="M1"), MachineInput(id="M2")]
        request = _make_request(jobs, machines)

        result = self.solver.solve(request)

        assert result.status in ("optimal", "feasible")
        assert result.solver_used == "cpsat"
        assert result.n_ops == 4
        assert len(result.schedule) == 4

    def test_no_overlap_constraint(self):
        """All ops on same machine → no overlapping intervals."""
        jobs = [
            _make_job("J1", "SKU1", 500, 1.0, [_make_op("J1_O1", "M1", duration=100)]),
            _make_job("J2", "SKU2", 500, 1.0, [_make_op("J2_O1", "M1", duration=100)]),
            _make_job("J3", "SKU3", 500, 1.0, [_make_op("J3_O1", "M1", duration=100)]),
        ]
        machines = [MachineInput(id="M1")]
        request = _make_request(jobs, machines)

        result = self.solver.solve(request)

        assert result.status in ("optimal", "feasible")
        # Check no overlaps
        m1_ops = sorted(result.schedule, key=lambda s: s.start_min)
        for i in range(len(m1_ops) - 1):
            assert m1_ops[i].end_min <= m1_ops[i + 1].start_min, (
                f"Overlap: {m1_ops[i].op_id} ends at {m1_ops[i].end_min} but {m1_ops[i + 1].op_id} starts at {m1_ops[i + 1].start_min}"
            )

    def test_precedence_within_job(self):
        """Operations within a job must be in order."""
        jobs = [
            _make_job(
                "J1",
                "SKU1",
                500,
                1.0,
                [
                    _make_op("J1_O1", "M1", duration=50),
                    _make_op("J1_O2", "M2", duration=50),
                    _make_op("J1_O3", "M1", duration=50),
                ],
            ),
        ]
        machines = [MachineInput(id="M1"), MachineInput(id="M2")]
        request = _make_request(jobs, machines)

        result = self.solver.solve(request)

        assert result.status in ("optimal", "feasible")
        op_map = {s.op_id: s for s in result.schedule}
        assert op_map["J1_O1"].end_min <= op_map["J1_O2"].start_min
        assert op_map["J1_O2"].end_min <= op_map["J1_O3"].start_min

    def test_makespan_objective(self):
        """Makespan objective minimizes max completion time."""
        jobs = [
            _make_job("J1", "SKU1", 1000, 1.0, [_make_op("J1_O1", "M1", duration=100, setup=0)]),
            _make_job("J2", "SKU2", 1000, 1.0, [_make_op("J2_O1", "M2", duration=100, setup=0)]),
        ]
        machines = [MachineInput(id="M1"), MachineInput(id="M2")]
        request = _make_request(jobs, machines, objective="makespan")

        result = self.solver.solve(request)

        assert result.status in ("optimal", "feasible")
        # With 2 machines, 2 parallel jobs: makespan should be ~100
        assert result.makespan_min <= 110  # Allow small margin

    def test_tardiness_objective(self):
        """Tardiness objective tracks late jobs."""
        jobs = [
            _make_job("J1", "SKU1", 50, 1.0, [_make_op("J1_O1", "M1", duration=100, setup=0)]),
        ]
        machines = [MachineInput(id="M1")]
        request = _make_request(jobs, machines, objective="tardiness")

        result = self.solver.solve(request)

        assert result.status in ("optimal", "feasible")
        # Job takes 100min but due at 50min → 50min tardy
        assert result.total_tardiness_min == 50

    def test_weighted_tardiness(self):
        """Weighted tardiness uses job weights."""
        jobs = [
            _make_job("J1", "SKU1", 50, 2.0, [_make_op("J1_O1", "M1", duration=100, setup=0)]),
        ]
        machines = [MachineInput(id="M1")]
        request = _make_request(jobs, machines, objective="weighted_tardiness")

        result = self.solver.solve(request)

        assert result.status in ("optimal", "feasible")
        # 50min tardy × weight 2.0 = 100
        assert result.weighted_tardiness == 100.0

    def test_empty_input(self):
        """0 jobs → empty schedule."""
        request = _make_request([], [MachineInput(id="M1")])
        result = self.solver.solve(request)

        assert result.status == "optimal"
        assert result.n_ops == 0
        assert len(result.schedule) == 0
        assert result.makespan_min == 0

    def test_single_machine_sequential(self):
        """All ops on 1 machine → must be sequential."""
        jobs = [
            _make_job(
                f"J{i}", f"SKU{i}", 2000, 1.0, [_make_op(f"J{i}_O1", "M1", duration=50, setup=10)]
            )
            for i in range(5)
        ]
        machines = [MachineInput(id="M1")]
        request = _make_request(jobs, machines)

        result = self.solver.solve(request)

        assert result.status in ("optimal", "feasible")
        assert len(result.schedule) == 5
        # Total = 5 × (50 + 10) = 300min
        assert result.makespan_min >= 300


class TestHeuristicFallback:
    def setup_method(self):
        self.solver = HeuristicFallback()

    def test_heuristic_basic(self):
        """Heuristic produces valid schedule."""
        jobs = [
            _make_job("J1", "SKU1", 200, 1.0, [_make_op("J1_O1", "M1", duration=60)]),
            _make_job("J2", "SKU2", 300, 2.0, [_make_op("J2_O1", "M1", duration=60)]),
        ]
        machines = [MachineInput(id="M1")]
        request = _make_request(jobs, machines)

        result = self.solver.solve(request)

        assert result.solver_used == "heuristic"
        assert result.status == "feasible"
        assert len(result.schedule) == 2

    def test_heuristic_empty(self):
        """Empty input → empty schedule."""
        request = _make_request([], [MachineInput(id="M1")])
        result = self.solver.solve(request)

        assert result.n_ops == 0
        assert result.status == "optimal"

    def test_heuristic_multi_machine(self):
        """Heuristic handles multiple machines."""
        jobs = [
            _make_job("J1", "SKU1", 200, 1.0, [_make_op("J1_O1", "M1", duration=60)]),
            _make_job("J2", "SKU2", 200, 1.0, [_make_op("J2_O1", "M2", duration=60)]),
        ]
        machines = [MachineInput(id="M1"), MachineInput(id="M2")]
        request = _make_request(jobs, machines)

        result = self.solver.solve(request)

        assert len(result.schedule) == 2
        machines_used = {s.machine_id for s in result.schedule}
        assert machines_used == {"M1", "M2"}


class TestSolverRouter:
    def setup_method(self):
        self.router = SolverRouter()

    def test_router_small_uses_cpsat(self):
        """<50 ops → CP-SAT."""
        jobs = [
            _make_job("J1", "SKU1", 500, 1.0, [_make_op("J1_O1", "M1", duration=60)])
            for _ in range(5)
        ]
        # Fix unique IDs
        for i, j in enumerate(jobs):
            j.id = f"J{i}"
            j.operations[0].id = f"J{i}_O1"

        machines = [MachineInput(id="M1")]
        request = _make_request(jobs, machines)

        result = self.router.solve(request)
        assert result.solver_used == "cpsat"

    def test_router_large_uses_heuristic(self):
        """>200 ops → heuristic fallback."""
        jobs = []
        for i in range(210):
            jobs.append(
                _make_job(
                    f"J{i}",
                    f"SKU{i}",
                    50000,
                    1.0,
                    [_make_op(f"J{i}_O1", f"M{i % 5}", duration=10, setup=2)],
                )
            )
        machines = [MachineInput(id=f"M{i}") for i in range(5)]
        request = _make_request(jobs, machines, time_limit=5)

        result = self.router.solve(request)
        assert result.solver_used == "heuristic"
        assert result.n_ops == 210

    def test_router_empty(self):
        """0 jobs → handled gracefully."""
        request = _make_request([], [MachineInput(id="M1")])
        result = self.router.solve(request)
        assert result.n_ops == 0
        assert result.status == "optimal"
