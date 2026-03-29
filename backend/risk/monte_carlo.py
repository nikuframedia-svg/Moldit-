"""Tier 3 -- Monte Carlo Risk: Moldit Planner (Phase 4).

Latin Hypercube Sampling with perturbation of work_h and setup_h.
Requires scipy and numpy (optional dependencies).
"""

from __future__ import annotations

import copy
import math
from collections.abc import Callable
from typing import Any

from backend.types import MolditEngineData

# Distribution parameters for Moldit (mold production)
WORK_CV = 0.20    # Lognormal CV 20% for work_h
SETUP_CV = 0.30   # Lognormal CV 30% for setup_h


def monte_carlo_risk(
    engine_data: MolditEngineData,
    schedule_fn: Callable[[MolditEngineData], Any],
    n_samples: int = 500,
    seed: int = 42,
) -> dict:
    """Run Monte Carlo risk simulation via Latin Hypercube Sampling.

    Each sample perturbs work_h (Lognormal CV=20%) and setup_h (Lognormal CV=30%).
    work_restante_h is recalculated from perturbed work_h and progresso.

    Args:
        engine_data: Base schedule input.
        schedule_fn: Scheduling function (schedule_all).
        n_samples: Number of LHS samples.
        seed: Random seed for reproducibility.

    Returns:
        Dict with percentile statistics for makespan and compliance.

    Raises:
        ImportError: If scipy/numpy are not installed.
    """
    try:
        import numpy as np
        from scipy.stats import lognorm
        from scipy.stats.qmc import LatinHypercube
    except ImportError as exc:
        raise ImportError(
            "Monte Carlo requer scipy e numpy: "
            "pip install scipy numpy"
        ) from exc

    # Dimensions: 1 for global work_h factor + 1 per machine group for setup_h
    groups = sorted({m.grupo for m in engine_data.maquinas})
    n_dims = 1 + len(groups)  # work_h global + setup per group

    sampler = LatinHypercube(d=max(n_dims, 1), seed=seed)
    samples = sampler.random(n=n_samples)

    makespan_results: list[int] = []
    compliance_results: list[float] = []

    sigma_work = math.sqrt(math.log(1 + WORK_CV**2))
    sigma_setup = math.sqrt(math.log(1 + SETUP_CV**2))

    machines_by_group: dict[str, set[str]] = {}
    for m in engine_data.maquinas:
        machines_by_group.setdefault(m.grupo, set()).add(m.id)

    for i in range(n_samples):
        mutated = copy.deepcopy(engine_data)

        # Perturb work_h (column 0)
        work_factor = float(lognorm.ppf(max(samples[i, 0], 0.001), s=sigma_work))
        for op in mutated.operacoes:
            op.work_h *= work_factor
            op.work_restante_h = op.work_h * (1.0 - op.progresso / 100.0)

        # Perturb setup_h per machine group (columns 1..n_groups)
        for j, group in enumerate(groups):
            col = j + 1
            if col < n_dims:
                setup_factor = float(lognorm.ppf(max(samples[i, col], 0.001), s=sigma_setup))
                group_machines = machines_by_group.get(group, set())
                for m in mutated.maquinas:
                    if m.id in group_machines:
                        m.setup_h *= setup_factor

        try:
            result = schedule_fn(mutated)
            makespan_results.append(result.score.get("makespan_total_dias", 999))
            compliance_results.append(result.score.get("deadline_compliance", 0.0))
        except Exception:
            makespan_results.append(999)
            compliance_results.append(0.0)

    mk_arr = np.array(makespan_results)
    comp_arr = np.array(compliance_results)

    return {
        "makespan_p50": round(float(np.percentile(mk_arr, 50)), 1),
        "makespan_p80": round(float(np.percentile(mk_arr, 80)), 1),
        "makespan_p95": round(float(np.percentile(mk_arr, 95)), 1),
        "compliance_p50": round(float(np.percentile(comp_arr, 50)), 4),
        "compliance_p80": round(float(np.percentile(comp_arr, 20)), 4),
        "compliance_p95": round(float(np.percentile(comp_arr, 5)), 4),
        "compliance_mean": round(float(np.mean(comp_arr)), 4),
        "n_samples": n_samples,
    }
