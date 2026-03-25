"""Copilot state — Spec 10.

Singleton holding the current schedule, engine data, config, and rules.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from backend.audit.store import AuditStore
from backend.config.types import FactoryConfig
from backend.scheduler.types import Lot, ScheduleResult, Segment

logger = logging.getLogger(__name__)

_STATE_PATH = "data/copilot_state.json"


@dataclass
class CopilotState:
    """Mutable copilot session state."""

    # Core data (populated via load_isop or externally)
    engine_data: object | None = None  # EngineData (avoid circular import)
    config: FactoryConfig | None = None

    # Schedule results
    segments: list[Segment] = field(default_factory=list)
    lots: list[Lot] = field(default_factory=list)
    score: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    # Journal (Spec 12)
    journal_entries: list[dict] | None = None

    # DQA (Spec 12)
    trust_index: object | None = None

    # Pre-computed analytics (refreshed on every schedule update)
    stock_projections: list | None = None
    expedition: object | None = None
    risk_result: object | None = None
    late_deliveries: object | None = None
    coverage: object | None = None
    order_tracking: list | None = None

    # Audit
    schedule_id: str = ""
    audit_store: AuditStore | None = None

    # User rules
    rules: list[dict] = field(default_factory=list)

    def update_schedule(self, result: ScheduleResult) -> None:
        """Update state from a ScheduleResult. Saves audit trail if present."""
        self.segments = result.segments
        self.lots = result.lots
        self.score = result.score
        self.warnings = result.warnings
        self.journal_entries = result.journal

        if result.audit_trail:
            if not self.audit_store:
                self.audit_store = AuditStore()
            self.schedule_id = self.audit_store.save_trail(
                result.audit_trail, result.score,
            )

        # Pre-compute all analytics
        self._refresh_analytics()

    def _refresh_analytics(self) -> None:
        """Pre-compute all analytics over current segments/lots."""
        if self.engine_data is None or not self.segments:
            return

        from backend.analytics.coverage_audit import compute_coverage_audit
        from backend.analytics.expedition import compute_expedition
        from backend.analytics.late_delivery import analyze_late_deliveries
        from backend.analytics.order_tracking import compute_order_tracking
        from backend.analytics.stock_projection import compute_stock_projections
        from backend.risk import compute_risk

        try:
            self.expedition = compute_expedition(self.segments, self.lots, self.engine_data)
            self.stock_projections = compute_stock_projections(self.segments, self.lots, self.engine_data)
            self.order_tracking = compute_order_tracking(self.segments, self.lots, self.engine_data)
            self.risk_result = compute_risk(self.segments, self.lots, self.engine_data)
            self.late_deliveries = analyze_late_deliveries(
                self.segments, self.lots, self.engine_data, self.config,
            )
            self.coverage = compute_coverage_audit(self.segments, self.lots, self.engine_data)
        except Exception:
            logger.exception("Failed to refresh analytics")

    def add_rule(self, rule: dict) -> str:
        """Add a user rule. Returns rule id."""
        rule_id = f"rule_{len(self.rules) + 1}"
        rule["id"] = rule_id
        self.rules.append(rule)
        self._save_rules()
        return rule_id

    def remove_rule(self, rule_id: str) -> bool:
        """Remove a rule by id. Returns True if found."""
        before = len(self.rules)
        self.rules = [r for r in self.rules if r.get("id") != rule_id]
        if len(self.rules) < before:
            self._save_rules()
            return True
        return False

    def _save_rules(self) -> None:
        """Persist rules to JSON file."""
        p = Path(_STATE_PATH)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w") as f:
            json.dump({"rules": self.rules}, f, ensure_ascii=False, indent=2)

    def _load_rules(self) -> None:
        """Load rules from JSON file if exists."""
        p = Path(_STATE_PATH)
        if p.exists():
            with open(p) as f:
                data = json.load(f)
            self.rules = data.get("rules", [])


# Singleton instance
state = CopilotState()
