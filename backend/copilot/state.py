"""Copilot state — Moldit Planner.

Singleton holding the current schedule, engine data, config, and rules.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

from backend.audit.store import AuditStore
from backend.config.types import FactoryConfig
from backend.scheduler.types import ScheduleResult, SegmentoMoldit as Segment

logger = logging.getLogger(__name__)

_STATE_PATH = "data/copilot_state.json"


@dataclass
class CopilotState:
    """Mutable copilot session state."""

    # Core data (populated via load or externally)
    engine_data: object | None = None  # MolditEngineData (avoid circular import)
    config: FactoryConfig | None = None

    # Schedule results
    segments: list[Segment] = field(default_factory=list)
    score: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    # Journal
    journal_entries: list[dict] | None = None

    # DQA
    trust_index: object | None = None

    # Pre-computed analytics (refreshed on every schedule update)
    risk_result: object | None = None
    late_deliveries: object | None = None
    stress_map: list | None = None
    operator_alerts: list | None = None

    # Audit
    schedule_id: str = ""
    audit_store: AuditStore | None = None

    # Learning optimization info
    learning_info: dict | None = None

    # User rules
    rules: list[dict] = field(default_factory=list)

    # Simulation revert snapshot
    saved_schedule: ScheduleResult | None = None

    def save_current(self) -> None:
        """Save current schedule for revert after simulation apply."""
        self.saved_schedule = ScheduleResult(
            segmentos=list(self.segments),
            score=dict(self.score),
            warnings=list(self.warnings),
            alerts=list(self.operator_alerts or []),
            time_ms=0,
            audit_trail=None,
            journal=self.journal_entries,
        )

    def update_schedule(self, result: ScheduleResult) -> None:
        """Update state from a ScheduleResult. Saves audit trail if present."""
        self.segments = result.segmentos
        self.score = result.score
        self.warnings = result.warnings
        self.journal_entries = result.journal
        self.operator_alerts = result.alerts

        if result.audit_trail:
            if not self.audit_store:
                self.audit_store = AuditStore()
            self.schedule_id = self.audit_store.save_trail(
                result.audit_trail, result.score,
            )

        # Pre-compute all analytics
        self._refresh_analytics()

        # Persist schedule snapshot for restart survival
        self._save_snapshot()

    def _refresh_analytics(self) -> None:
        """Pre-compute all analytics over current segments.

        Each analytics is isolated — a failure in one does not block the others.
        """
        if self.engine_data is None or not self.segments:
            return

        from backend.analytics.late_delivery import analyze_late_deliveries
        from backend.risk import compute_risk

        analytics = [
            ("risk_result", lambda: compute_risk(self.segments, self.engine_data)),
            ("late_deliveries", lambda: analyze_late_deliveries(
                self.segments, self.engine_data, self.config,
            )),
        ]

        for name, fn in analytics:
            try:
                setattr(self, name, fn())
            except Exception:
                logger.exception("Failed to compute %s", name)

    def _save_snapshot(self) -> None:
        """Persist current schedule to JSON for restart survival (P4)."""
        from dataclasses import asdict
        try:
            from datetime import datetime
            snapshot = {
                "segmentos": [asdict(s) for s in self.segments],
                "score": self.score,
                "warnings": self.warnings,
                "timestamp": datetime.now().isoformat(),
            }
            p = Path("data/schedule_snapshot.json")
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w") as f:
                json.dump(snapshot, f, ensure_ascii=False)
        except Exception:
            logger.exception("Failed to save schedule snapshot")

    def load_snapshot(self) -> bool:
        """Load schedule snapshot from disk. Returns True if loaded."""
        p = Path("data/schedule_snapshot.json")
        if not p.exists():
            return False
        try:
            with open(p) as f:
                data = json.load(f)
            self.segments = [
                Segment(**s) for s in data.get("segmentos", [])
            ]
            self.score = data.get("score", {})
            self.warnings = data.get("warnings", [])
            logger.info(
                "Loaded schedule snapshot: %d segments, score=%s",
                len(self.segments), self.score.get("weighted_score", "?"),
            )
            return True
        except Exception:
            logger.exception("Failed to load schedule snapshot")
            return False

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
