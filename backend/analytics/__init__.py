"""PP1 Analytics — Spec 03 + Spec 12."""

from __future__ import annotations

from .coverage_audit import ClientCoverage, CoverageAudit, compute_coverage_audit
from .ctp import CTPResult, compute_ctp
from .expedition import (
    ExpeditionDay,
    ExpeditionEntry,
    ExpeditionKPIs,
    compute_expedition,
)
from .late_delivery import LateDeliveryReport, TardyAnalysis, analyze_late_deliveries
from .order_tracking import ClientOrders, OrderTracking, compute_order_tracking
from .replan_proposals import Proposal, ReplanReport, generate_proposals
from .stock_projection import (
    StockDay,
    StockProjection,
    build_production_by_op,
    compute_stock_projections,
)
from .workforce_forecast import WorkforceForecast, forecast_workforce

__all__ = [
    "CTPResult",
    "ClientCoverage",
    "ClientOrders",
    "CoverageAudit",
    "ExpeditionDay",
    "ExpeditionEntry",
    "ExpeditionKPIs",
    "LateDeliveryReport",
    "OrderTracking",
    "Proposal",
    "ReplanReport",
    "StockDay",
    "StockProjection",
    "TardyAnalysis",
    "WorkforceForecast",
    "analyze_late_deliveries",
    "build_production_by_op",
    "compute_coverage_audit",
    "compute_ctp",
    "compute_expedition",
    "compute_order_tracking",
    "compute_stock_projections",
    "forecast_workforce",
    "generate_proposals",
]
