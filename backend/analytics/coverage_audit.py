"""Coverage Audit — Spec 12 §9.

Per-client coverage summary. Aggregates expedition + stock projection.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.scheduler.types import SegmentoMoldit as Segment


from backend.types import MolditEngineData as EngineData


class Lot:  # noqa: D101
    """Legacy stub — removed in Phase 2."""


@dataclass(slots=True)
class ClientCoverage:
    client: str
    total_orders: int
    covered_orders: int
    coverage_pct: float
    at_risk_orders: int
    avg_days_early: float
    worst_sku: str | None


@dataclass(slots=True)
class CoverageAudit:
    overall_coverage_pct: float
    overall_fill_rate: float
    clients: list[ClientCoverage]
    stockout_count: int
    health_score: int  # 0-100
    summary: str


def compute_coverage_audit(
    segments: list[Segment],
    lots: list[Lot],
    engine_data: EngineData,
) -> CoverageAudit:
    """Aggregate expedition + stock projection into per-client coverage."""
    raise NotImplementedError("Moldit coverage audit — Phase 2")
