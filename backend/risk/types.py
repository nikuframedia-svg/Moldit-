"""Risk assessment types — Moldit Planner."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class OpRisk:
    op_id: int
    molde: str
    machine_id: str
    edd: int
    completion_day: int
    slack_days: int
    slack_min: float
    risk_score: float          # 0.0 (safe) to 1.0 (critical)
    risk_level: str            # "low" | "medium" | "high" | "critical"
    binding_constraint: str    # "capacity" | "crew" | "none"


@dataclass(slots=True)
class MachineRisk:
    machine_id: str
    peak_utilization: float    # max utilisation in a single day (0-1)
    avg_utilization: float
    critical_op_count: int     # ops with slack < 2 days on this machine
    bottleneck_score: float    # 0-1


@dataclass(slots=True)
class HeatmapCell:
    machine_id: str
    day_idx: int
    utilization: float         # 0-1
    min_slack_min: float       # min slack of active ops (-1 if none)
    risk_level: str            # "low" | "medium" | "high" | "critical"


@dataclass(slots=True)
class RiskResult:
    # Tier 1 (always present)
    health_score: int          # 0-100 (100 = safe)
    op_risks: list[OpRisk]
    machine_risks: list[MachineRisk]
    heatmap: list[HeatmapCell]
    critical_count: int
    top_risks: list[OpRisk]   # top 5 riskiest
    bottleneck: str            # machine_id

    # Tier 2 (if surrogate trained)
    surrogate_otd_prob: float | None
    surrogate_confidence: str | None

    # Tier 3 (if Monte Carlo cached)
    mc_otd_p50: float | None
    mc_otd_p80: float | None
    mc_otd_p95: float | None
    mc_tardy_expected: float | None
    mc_runs: int | None
