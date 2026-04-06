"""Risk Assessment — Moldit Planner.

Three tiers:
  Tier 1: Slack analytics (<50ms) — always computed
  Tier 2: Surrogate model (<100ms) — if model trained
  Tier 3: Monte Carlo LHS (~3s) — if cache passed or run on demand
"""

from __future__ import annotations

from backend.scheduler.types import SegmentoMoldit as Segment
from backend.types import MolditEngineData as EngineData

from .heatmap import compute_heatmap
from .slack_analytics import (
    compute_health_score,
    compute_machine_risks,
    compute_op_risks,
)
from .surrogate import extract_features, predict_risk
from .types import RiskResult

__all__ = [
    "compute_risk",
    "RiskResult",
]


def compute_risk(
    segments: list[Segment],
    engine_data: EngineData,
    mc_cache: dict | None = None,
) -> RiskResult:
    """Compute risk assessment (Tier 1 always, Tier 2/3 if available).

    Args:
        segments: Schedule segments from dispatch.
        engine_data: Full engine input data.
        mc_cache: Pre-computed Monte Carlo results.

    Returns:
        RiskResult with all tiers populated as available.
    """
    # Tier 1: Slack analytics (always)
    op_risks = compute_op_risks(segments, engine_data)
    machine_risks = compute_machine_risks(segments, op_risks, engine_data)
    health = compute_health_score(op_risks, machine_risks)
    heatmap = compute_heatmap(segments, op_risks, engine_data)

    critical_count = sum(1 for lr in op_risks if lr.risk_level == "critical")
    top_risks = sorted(op_risks, key=lambda lr: -lr.risk_score)[:5]
    bottleneck = (
        max(machine_risks, key=lambda mr: mr.peak_utilization).machine_id
        if machine_risks
        else ""
    )

    # Tier 2: Surrogate (if trained)
    surrogate_otd: float | None = None
    surrogate_conf: str | None = None
    features = extract_features(op_risks, machine_risks, engine_data)
    prediction = predict_risk(features)
    if prediction:
        surrogate_otd, surrogate_conf = prediction

    # Tier 3: Monte Carlo (if cached)
    mc_otd_p50: float | None = None
    mc_otd_p80: float | None = None
    mc_otd_p95: float | None = None
    mc_tardy: float | None = None
    mc_runs: int | None = None
    if mc_cache:
        mc_otd_p50 = mc_cache.get("otd_p50")
        mc_otd_p80 = mc_cache.get("otd_p80")
        mc_otd_p95 = mc_cache.get("otd_p95")
        mc_tardy = mc_cache.get("tardy_mean")
        mc_runs = mc_cache.get("n_samples")

    return RiskResult(
        health_score=health,
        op_risks=op_risks,
        machine_risks=machine_risks,
        heatmap=heatmap,
        critical_count=critical_count,
        top_risks=top_risks,
        bottleneck=bottleneck,
        surrogate_otd_prob=surrogate_otd,
        surrogate_confidence=surrogate_conf,
        mc_otd_p50=mc_otd_p50,
        mc_otd_p80=mc_otd_p80,
        mc_otd_p95=mc_otd_p95,
        mc_tardy_expected=mc_tardy,
        mc_runs=mc_runs,
    )
