from __future__ import annotations

# Solver Router — routes to Hybrid (large) or CP-SAT (small).
# n_ops > 50: HybridSolver (ATCS → ALNS → Tabu)
# n_ops ≤ 50: CpsatSolver (optimal in seconds)
from .cpsat_solver import CpsatSolver
from .hybrid_solver import HybridSolver
from .schemas import SolverRequest, SolverResult


class SolverRouter:
    """Routes scheduling requests to the appropriate solver."""

    def __init__(self):
        self.cpsat = CpsatSolver()
        self.hybrid = HybridSolver()

    def solve(self, request: SolverRequest) -> SolverResult:
        n_ops = sum(len(j.operations) for j in request.jobs)

        if n_ops == 0:
            return self.cpsat.solve(request)

        # Hybrid for larger problems (>50 ops)
        if n_ops > 50:
            return self.hybrid.solve(request)

        # CP-SAT for small problems — optimal in seconds
        if n_ops > 150:
            request.config.use_circuit = False

        # Auto-tune time limits for small problems
        if request.config.time_limit_s == 60:
            if n_ops < 100:
                request.config.time_limit_s = 5
            elif n_ops <= 200:
                request.config.time_limit_s = 30

        return self.cpsat.solve(request)
