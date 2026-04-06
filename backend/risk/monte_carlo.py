"""Tier 3 -- Monte Carlo Risk: Moldit Planner (Phase 4).

Latin Hypercube Sampling with perturbation of work_h and setup_h.
Supports calibrated distributions from real execution data (Module A).
Requires scipy and numpy (optional dependencies).
"""

from __future__ import annotations

import copy
import math
import random
from collections.abc import Callable
from typing import Any

from backend.types import MolditEngineData

# Default distribution parameters (used when no calibration data)
WORK_CV = 0.20    # Lognormal CV 20% for work_h
SETUP_CV = 0.30   # Lognormal CV 30% for setup_h


def monte_carlo_risk(
    engine_data: MolditEngineData,
    schedule_fn: Callable[[MolditEngineData], Any],
    n_samples: int = 500,
    seed: int = 42,
    calibration: dict | None = None,
    reliability: dict | None = None,
    ml_distributions: dict | None = None,
) -> dict:
    """Run Monte Carlo risk simulation via Latin Hypercube Sampling.

    When calibration/reliability data is provided (from Module A),
    uses per-operation-type distributions instead of fixed CVs.

    Args:
        engine_data: Base schedule input.
        schedule_fn: Scheduling function (schedule_all).
        n_samples: Number of LHS samples.
        seed: Random seed for reproducibility.
        calibration: {codigo: CalibrationFactor} from real execution data.
        reliability: {maquina_id: MachineReliability} from machine events.
        ml_distributions: {op_id: (predicted_h, p10, p90)} from M1.
            When provided, uses ML-learned distributions per operation
            instead of fixed CVs or calibration-only perturbation.

    Returns:
        Dict with percentile statistics for makespan and compliance.
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
    n_dims = 1 + len(groups)

    sampler = LatinHypercube(d=max(n_dims, 1), seed=seed)
    samples = sampler.random(n=n_samples)

    makespan_results: list[int] = []
    compliance_results: list[float] = []

    sigma_work = math.sqrt(math.log(1 + WORK_CV**2))
    sigma_setup = math.sqrt(math.log(1 + SETUP_CV**2))

    machines_by_group: dict[str, set[str]] = {}
    for m in engine_data.maquinas:
        machines_by_group.setdefault(m.grupo, set()).add(m.id)

    rng = random.Random(seed)

    for i in range(n_samples):
        mutated = copy.deepcopy(engine_data)

        # ── Perturb work_h ───────────────────────────────────────
        if ml_distributions:
            # ML-learned per-operation distributions (highest fidelity)
            for op in mutated.operacoes:
                ml_dist = ml_distributions.get(op.id)
                if ml_dist:
                    predicted_h, p10, p90 = ml_dist
                    # Estimate std from quantile spread: P90-P10 ≈ 2.56σ
                    ml_std = max((p90 - p10) / 2.56, 0.1)
                    op.work_h = max(0.5, rng.gauss(predicted_h, ml_std))
                else:
                    # Fallback to calibration or fixed CV
                    factor = calibration.get(op.codigo) if calibration else None
                    if factor and factor.confianca >= 0.5:
                        work_factor = max(0.3, rng.gauss(factor.ratio_media, factor.ratio_std))
                    else:
                        work_factor = float(lognorm.ppf(
                            max(samples[i, 0], 0.001), s=sigma_work,
                        ))
                    op.work_h *= work_factor
                op.work_restante_h = op.work_h * (1.0 - op.progresso / 100.0)
        elif calibration:
            # Per-operation calibrated perturbation
            for op in mutated.operacoes:
                factor = calibration.get(op.codigo)
                if factor and factor.confianca >= 0.5:
                    work_factor = rng.gauss(factor.ratio_media, factor.ratio_std)
                    work_factor = max(0.3, work_factor)
                else:
                    work_factor = float(lognorm.ppf(
                        max(samples[i, 0], 0.001), s=sigma_work,
                    ))
                op.work_h *= work_factor
                op.work_restante_h = op.work_h * (1.0 - op.progresso / 100.0)
        else:
            # Global fallback (original behaviour)
            work_factor = float(lognorm.ppf(
                max(samples[i, 0], 0.001), s=sigma_work,
            ))
            for op in mutated.operacoes:
                op.work_h *= work_factor
                op.work_restante_h = op.work_h * (1.0 - op.progresso / 100.0)

        # ── Perturb setup_h per machine group ────────────────────
        for j, group in enumerate(groups):
            col = j + 1
            if col < n_dims:
                setup_factor = float(lognorm.ppf(
                    max(samples[i, col], 0.001), s=sigma_setup,
                ))
                group_machines = machines_by_group.get(group, set())
                for m in mutated.maquinas:
                    if m.id in group_machines:
                        m.setup_h *= setup_factor

        # ── Inject machine downtime from reliability data ────────
        if reliability:
            for m in mutated.maquinas:
                rel = reliability.get(m.id)
                if rel and rng.random() > rel.uptime_pct:
                    # Machine fails: add MTTR to all ops on this machine
                    downtime_h = rng.expovariate(1.0 / max(rel.mttr_h, 0.5))
                    for op in mutated.operacoes:
                        if op.recurso == m.id:
                            op.work_h += downtime_h
                            op.work_restante_h = op.work_h * (
                                1.0 - op.progresso / 100.0
                            )

        try:
            result = schedule_fn(mutated)
            makespan_results.append(
                result.score.get("makespan_total_dias", 999),
            )
            compliance_results.append(
                result.score.get("deadline_compliance", 0.0),
            )
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
        "compliance_p80": round(float(np.percentile(comp_arr, 80)), 4),
        "compliance_p95": round(float(np.percentile(comp_arr, 95)), 4),
        "compliance_mean": round(float(np.mean(comp_arr)), 4),
        "n_samples": n_samples,
        "calibrated": calibration is not None,
        "ml_enhanced": ml_distributions is not None,
    }
