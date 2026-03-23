"""SchedulingService — single entry point for all scheduling operations.

All endpoints delegate to this service. Zero duplication.
Pipeline: Bridge → Factory Rules → CP-SAT Solve → Recovery → Monte Carlo → Blocks.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from ..scheduling.types import Block, DecisionEntry, EngineData, FeasibilityReport
from .bridge import engine_data_to_solver_request, solver_result_to_blocks
from .factory_rules import apply_factory_rules
from .montecarlo import monte_carlo_otd
from .post_solve import build_decisions, build_feasibility_report
from .recovery import cascading_recovery
from .router_logic import SolverRouter
from .schemas import SolverRequest, SolverResult

logger = logging.getLogger(__name__)


@dataclass
class SolveRawOutput:
    """Raw solver output — no blocks, no feasibility. Used by optimal endpoint."""

    solver_result: SolverResult
    robustness: dict[str, Any] | None = None
    recovery_used: bool = False
    recovery_level: int = 0
    rule_decisions: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class ScheduleOutput:
    """Full schedule output — blocks + feasibility + decisions + solver metadata."""

    blocks: list[Block] = field(default_factory=list)
    solver_result: SolverResult | None = None
    decisions: list[DecisionEntry] = field(default_factory=list)
    feasibility: FeasibilityReport | None = None
    robustness: dict[str, Any] | None = None
    recovery_used: bool = False
    recovery_level: int = 0
    rule_decisions: list[dict[str, Any]] = field(default_factory=list)


class SchedulingService:
    """Single scheduling service. All endpoints pass through here."""

    def schedule(
        self,
        engine_data: EngineData,
        settings: dict[str, Any],
        *,
        run_factory_rules: bool = False,
        run_recovery: bool = False,
        run_monte_carlo: bool = False,
        n_scenarios: int = 200,
        frozen_ops: list[str] | None = None,
        alt_machines: dict[str, list[str]] | None = None,
        solver_config_overrides: dict[str, Any] | None = None,
    ) -> ScheduleOutput:
        """Full pipeline: bridge → rules → solve → recovery → MC → blocks."""
        # 1. Bridge
        solver_request = engine_data_to_solver_request(engine_data, settings)

        # 1b. Apply solver config overrides (e.g., different objective for optimize)
        if solver_config_overrides:
            for k, v in solver_config_overrides.items():
                if hasattr(solver_request.config, k):
                    setattr(solver_request.config, k, v)

        # 2-5. Core solve pipeline
        raw = self._solve_core(
            solver_request,
            run_factory_rules=run_factory_rules,
            run_recovery=run_recovery,
            run_monte_carlo=run_monte_carlo,
            n_scenarios=n_scenarios,
            frozen_ops=frozen_ops,
            alt_machines=alt_machines,
        )

        # 6. Blocks + feasibility + decisions
        blocks = solver_result_to_blocks(raw.solver_result, engine_data)
        feasibility = build_feasibility_report(raw.solver_result, len(engine_data.ops))
        decisions = build_decisions(raw.solver_result)

        return ScheduleOutput(
            blocks=blocks,
            solver_result=raw.solver_result,
            decisions=decisions,
            feasibility=feasibility,
            robustness=raw.robustness,
            recovery_used=raw.recovery_used,
            recovery_level=raw.recovery_level,
            rule_decisions=raw.rule_decisions,
        )

    def solve_request(
        self,
        request: SolverRequest,
        *,
        run_factory_rules: bool = False,
        run_recovery: bool = False,
        run_monte_carlo: bool = False,
        n_scenarios: int = 200,
        frozen_ops: list[str] | None = None,
        alt_machines: dict[str, list[str]] | None = None,
    ) -> SolveRawOutput:
        """Solve from SolverRequest directly (no bridge, no blocks).

        Used by the optimal endpoint which accepts SolverRequest and
        returns raw SolverResult.
        """
        return self._solve_core(
            request,
            run_factory_rules=run_factory_rules,
            run_recovery=run_recovery,
            run_monte_carlo=run_monte_carlo,
            n_scenarios=n_scenarios,
            frozen_ops=frozen_ops,
            alt_machines=alt_machines,
        )

    def _solve_core(
        self,
        request: SolverRequest,
        *,
        run_factory_rules: bool = False,
        run_recovery: bool = False,
        run_monte_carlo: bool = False,
        n_scenarios: int = 200,
        frozen_ops: list[str] | None = None,
        alt_machines: dict[str, list[str]] | None = None,
    ) -> SolveRawOutput:
        """Shared core: factory rules → solve → recovery → Monte Carlo."""
        # Factory rules
        rule_decisions: list[dict[str, Any]] = []
        if run_factory_rules:
            rule_decisions = apply_factory_rules(request)

        # Solve
        router = SolverRouter()
        result = router.solve(request)

        # Recovery
        recovery_used = False
        recovery_level = 0
        if (
            run_recovery
            and result.total_tardiness_min > 0
            and result.status in ("optimal", "feasible", "timeout")
        ):
            logger.info(
                "Tardiness %d min — triggering cascading recovery",
                result.total_tardiness_min,
            )
            # Auto-extract alt machines from flexible _P/_A ops in the request
            effective_alt = alt_machines or _extract_alt_machines(request)
            recovered = cascading_recovery(
                request=request,
                frozen_ops=frozen_ops,
                alt_machines=effective_alt,
            )
            if recovered.weighted_tardiness < result.weighted_tardiness:
                result = recovered
                recovery_used = True
                recovery_level = int(recovered.phase_values.get("recovery_level", 0))
                logger.info("Recovery improved result (level %d)", recovery_level)

        # Monte Carlo
        robustness = None
        if run_monte_carlo and result.status in ("optimal", "feasible"):
            logger.info("Running Monte Carlo robustness (%d scenarios)", n_scenarios)
            robustness = monte_carlo_otd(
                request=request,
                n_scenarios=n_scenarios,
            )
            logger.info("Robustness: P(OTD=100%%)=%.1f%%", robustness.get("p_otd_100", 0))

        return SolveRawOutput(
            solver_result=result,
            robustness=robustness,
            recovery_used=recovery_used,
            recovery_level=recovery_level,
            rule_decisions=rule_decisions,
        )


def _extract_alt_machines(request: SolverRequest) -> dict[str, list[str]] | None:
    """Extract alt machine map from flexible _P/_A ops in the request.

    Returns machine_id → [alt_machine_id] for each machine that has
    flexible jobs pointing to an alternative.
    """
    alt_map: dict[str, set[str]] = {}
    for job in request.jobs:
        if len(job.operations) != 2:
            continue
        ops = job.operations
        if not (ops[0].id.endswith("_P") and ops[1].id.endswith("_A")):
            continue
        primary_m = ops[0].machine_id
        alt_m = ops[1].machine_id
        if primary_m != alt_m:
            alt_map.setdefault(primary_m, set()).add(alt_m)

    if not alt_map:
        return None
    return {m: sorted(alts) for m, alts in alt_map.items()}
