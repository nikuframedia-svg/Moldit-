# Perturbation models for Monte Carlo robustness (S-05)
# Generates perturbed SolverRequest instances with stochastic durations/setups/breakdowns.

from __future__ import annotations

import random

from .schemas import SolverRequest


def perturb_request(
    request: SolverRequest,
    rng: random.Random,
    duration_cv: float = 0.10,
    setup_cv: float = 0.20,
    breakdown_rate: float = 0.005,
    breakdown_duration_range: tuple[int, int] = (30, 120),
) -> SolverRequest:
    """Create a perturbed copy of the request for Monte Carlo simulation.

    Perturbations:
    - Production duration: Normal(mean=original, cv=duration_cv)
    - Setup time: Normal(mean=original, cv=setup_cv)
    - Machine breakdowns: Bernoulli per op, adds random downtime

    Args:
        request: Original request
        rng: Random instance (seeded for reproducibility)
        duration_cv: Coefficient of variation for production duration
        setup_cv: Coefficient of variation for setup time
        breakdown_rate: Probability of breakdown per operation
        breakdown_duration_range: (min, max) minutes for breakdown duration
    """
    req = request.model_copy(deep=True)

    for job in req.jobs:
        for op in job.operations:
            # Perturb duration
            if op.duration_min > 0 and duration_cv > 0:
                sigma = op.duration_min * duration_cv
                new_dur = rng.gauss(op.duration_min, sigma)
                op.duration_min = max(1, int(round(new_dur)))

            # Perturb setup
            if op.setup_min > 0 and setup_cv > 0:
                sigma = op.setup_min * setup_cv
                new_setup = rng.gauss(op.setup_min, sigma)
                op.setup_min = max(0, int(round(new_setup)))

            # Random breakdown
            if rng.random() < breakdown_rate:
                bd_min, bd_max = breakdown_duration_range
                breakdown_time = rng.randint(bd_min, bd_max)
                op.duration_min += breakdown_time

    return req
