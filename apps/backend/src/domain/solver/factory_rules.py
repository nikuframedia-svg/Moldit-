"""Factory rules — YAML-based rules applied to SolverRequest before solving.

Extracted from api/v1/optimal.py (FINAL-04).
Supports material_affinity rules + copilot in-memory rules.
"""

from __future__ import annotations

import logging
from pathlib import Path

from ..copilot.state import copilot_state
from .schemas import SolverRequest

logger = logging.getLogger(__name__)

RULES_PATH = Path(__file__).resolve().parents[2] / "data" / "rules" / "incompol_rules.yaml"


def load_factory_rules() -> list[dict]:
    """Load factory rules from YAML. Falls back to empty list on error."""
    try:
        import yaml

        if RULES_PATH.exists():
            with open(RULES_PATH) as f:
                data = yaml.safe_load(f)
            return data.get("rules", []) if data else []
    except Exception as e:
        logger.warning("Failed to load factory rules: %s", e)
    return []


def apply_factory_rules(request: SolverRequest) -> list[dict]:
    """Apply factory rules to solver request. Returns list of rule application decisions."""
    rules = load_factory_rules()
    # Also include copilot in-memory rules
    if hasattr(copilot_state, "_rules") and copilot_state._rules:
        rules.extend(copilot_state._rules)

    applied: list[dict] = []
    for rule in rules:
        if not rule.get("active", True):
            continue

        if rule.get("type") == "material_affinity":
            target_skus = set(rule.get("skus", []))
            target_machine = rule.get("machine")
            if not target_skus or not target_machine:
                continue

            for job in request.jobs:
                # Check if any SKU part matches (handles "SKU1+SKU2" twin merged names)
                sku_parts = job.sku.split("+")
                if any(s in target_skus for s in sku_parts):
                    old_machine = job.operations[0].machine_id if job.operations else "?"
                    if old_machine != target_machine:
                        for op in job.operations:
                            op.machine_id = target_machine
                        applied.append(
                            {
                                "type": "RULE_APPLIED",
                                "op_id": job.operations[0].id if job.operations else job.id,
                                "machine_id": target_machine,
                                "detail": (
                                    f"Regra '{rule.get('name', rule['id'])}': "
                                    f"{job.sku} movido {old_machine} → {target_machine}"
                                ),
                            }
                        )
    return applied
