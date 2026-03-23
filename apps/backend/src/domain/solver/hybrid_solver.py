# Hybrid Solver — 3-phase orchestrator.
# Phase 1: ATCS Dispatch (<100ms)
# Phase 2: ALNS with CP-SAT Repair (60% budget)
# Phase 3: Tabu Search Polish (35% budget)
# Target: <30s for 1000 ops, 100% OTD-D.

from __future__ import annotations

import logging
import time

from .alns_solver import ALNSSolver
from .dispatch import atcs_dispatch
from .schemas import SolverRequest, SolverResult
from .tabu_polish import TabuPolish

logger = logging.getLogger(__name__)


class HybridSolver:
    """3-Phase Hybrid Solver."""

    def solve(self, request: SolverRequest) -> SolverResult:
        start_time = time.monotonic()

        # Time budget allocation
        total_budget = request.config.time_limit_s
        p2_budget = total_budget * 0.60
        p3_budget = total_budget * 0.35

        # ── Phase 1: ATCS Dispatch ──
        state = atcs_dispatch(request)
        p1_time = time.monotonic() - start_time
        p1_wt = state.weighted_tardiness()
        p1_tardy = len(state.tardy_ops())
        logger.info(
            "Hybrid P1 (ATCS): wt=%.1f, tardy=%d, time=%.3fs",
            p1_wt,
            p1_tardy,
            p1_time,
        )

        # ── Phase 2: ALNS ──
        p2_time = 0.0
        p2_wt = p1_wt
        if (p1_wt > 0 or p2_budget > 2.0) and p2_budget > 0.5:
            alns = ALNSSolver(request)
            state = alns.solve(state, time_budget_s=p2_budget)
            p2_time = time.monotonic() - start_time - p1_time
            p2_wt = state.weighted_tardiness()
            p2_tardy = len(state.tardy_ops())
            logger.info(
                "Hybrid P2 (ALNS): wt=%.1f, tardy=%d, time=%.3fs",
                p2_wt,
                p2_tardy,
                p2_time,
            )

        # ── Phase 3: Tabu Search ──
        p3_time = 0.0
        remaining = total_budget - (time.monotonic() - start_time)
        if remaining > 1.0:
            tabu = TabuPolish()
            state = tabu.solve(state, time_budget_s=min(remaining - 0.5, p3_budget))
            p3_time = time.monotonic() - start_time - p1_time - p2_time
            p3_tardy = len(state.tardy_ops())
            logger.info(
                "Hybrid P3 (Tabu): wt=%.1f, tardy=%d, time=%.3fs",
                state.weighted_tardiness(),
                p3_tardy,
                p3_time,
            )

        total_time = time.monotonic() - start_time
        result = state.to_solver_result(solve_time=total_time)
        result.solver_used = "hybrid"
        result.phase_values = {
            "phase1_atcs_tardiness": p1_wt,
            "phase2_alns_tardiness": p2_wt,
            "phase3_final_tardiness": state.weighted_tardiness(),
            "phase1_time_s": round(p1_time, 3),
            "phase2_time_s": round(p2_time, 3),
            "phase3_time_s": round(p3_time, 3),
        }
        return result
