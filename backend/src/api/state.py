"""Global application state — in-memory singleton."""

from __future__ import annotations

from pathlib import Path

import yaml


class AppState:
    """In-memory state for the loaded ISOP, schedule, and config."""

    def __init__(self):
        self.isop_data = None  # ISOPData from parser
        self.schedule: dict | None = None  # Gantt response from transform
        self.alerts: list[dict] | None = None  # Alert dicts
        self._config: dict | None = None

    def get_config(self) -> dict:
        """Load factory config from YAML (cached)."""
        if self._config is None:
            config_path = Path("src/definitions/incompol.yaml")
            if config_path.exists():
                with open(config_path) as f:
                    self._config = yaml.safe_load(f)
            else:
                self._config = {}
        return self._config

    def set_config(self, config: dict) -> None:
        """Update config in memory."""
        self._config = config

    def get_rules(self) -> list[dict]:
        """Get active rules from config."""
        config = self.get_config()
        return config.get("rules", [])

    def add_rule(self, rule: dict) -> None:
        """Add a rule to config."""
        config = self.get_config()
        if "rules" not in config:
            config["rules"] = []
        config["rules"].append(rule)

    def remove_rule(self, rule_id: str) -> bool:
        """Remove a rule by ID. Returns True if found."""
        config = self.get_config()
        rules = config.get("rules", [])
        original_len = len(rules)
        config["rules"] = [r for r in rules if r.get("id") != rule_id]
        return len(config["rules"]) < original_len


app_state = AppState()
