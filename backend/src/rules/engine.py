"""Rule evaluation engine for PP1 scheduling rules."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from src.rules.catalogue import validate_action, validate_condition
from src.rules.models import Action, Condition, Rule


@dataclass
class RuleContext:
    """Context object passed to rule evaluation — contains SKU data and schedule state."""

    sku: str = ""
    stock: int = 0
    coverage_days: int = 0
    has_atraso: bool = False
    qty: int = 0
    economic_lot: int = 0
    machine_load_pct: int = 0
    twin_ref: str | None = None
    client: str = ""
    days_to_deadline: int = 999
    tool: str = ""
    refs_on_machine: list[str] = field(default_factory=list)


def evaluate_condition(condition: Condition, ctx: RuleContext) -> bool:
    """Evaluate a single condition against context. Returns True if condition is met."""
    validate_condition(condition)
    t = condition.type
    p = condition.params

    if t == "coverage_days_gt":
        return ctx.coverage_days > p["days"]
    if t == "coverage_days_lt":
        return ctx.coverage_days < p["days"]
    if t == "stock_gt":
        return ctx.stock > p["qty"]
    if t == "stock_eq_zero":
        return ctx.stock == 0
    if t == "has_atraso":
        return ctx.has_atraso
    if t == "qty_lt_lot":
        return ctx.qty < ctx.economic_lot
    if t == "machine_load_gt":
        return ctx.machine_load_pct > p["pct"]
    if t == "same_material_as":
        return ctx.sku in p["refs"]
    if t == "is_twin":
        return ctx.twin_ref is not None
    if t == "client_is":
        return ctx.client == p["client"]
    if t == "days_to_deadline_lt":
        return ctx.days_to_deadline < p["days"]
    if t == "tool_is":
        return ctx.tool == p["tool"]

    raise ValueError(f"Unhandled condition type: {t!r}")  # pragma: no cover


def apply_action(action: Action, ctx: RuleContext) -> dict:
    """Apply an action and return the result dict describing what to do."""
    validate_action(action)
    t = action.type
    p = action.params

    if t == "skip_scheduling":
        return {"action": "skip_scheduling", "sku": ctx.sku}
    if t == "priority_boost":
        return {"action": "priority_boost", "sku": ctx.sku, "boost": p["boost"]}
    if t == "force_machine":
        return {"action": "force_machine", "sku": ctx.sku, "machine": p["machine"]}
    if t == "group_with":
        return {"action": "group_with", "sku": ctx.sku, "machine": p["machine"]}
    if t == "set_min_lot":
        return {"action": "set_min_lot", "sku": ctx.sku, "qty": p["qty"]}
    if t == "alert_red":
        return {"action": "alert_red", "sku": ctx.sku, "msg": p["msg"]}
    if t == "alert_yellow":
        return {"action": "alert_yellow", "sku": ctx.sku, "msg": p["msg"]}
    if t == "suppress_alert":
        return {"action": "suppress_alert", "sku": ctx.sku}
    if t == "use_alternative":
        return {"action": "use_alternative", "sku": ctx.sku}
    if t == "set_buffer_days":
        return {"action": "set_buffer_days", "sku": ctx.sku, "days": p["days"]}

    raise ValueError(f"Unhandled action type: {t!r}")  # pragma: no cover


def evaluate_rules(rules: list[Rule], ctx: RuleContext) -> list[dict]:
    """Evaluate all active rules against context, return list of actions to apply.

    Rules are sorted by priority (lower first) and only active rules are evaluated.
    """
    results: list[dict] = []
    sorted_rules = sorted((r for r in rules if r.active), key=lambda r: r.priority)
    for rule in sorted_rules:
        if evaluate_condition(rule.condition, ctx):
            result = apply_action(rule.action, ctx)
            result["rule_id"] = rule.id
            result["rule_name"] = rule.name
            results.append(result)
    return results


def load_definitions(path: Path) -> dict:
    """Load and validate factory definitions from YAML."""
    with open(path) as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError("YAML root must be a mapping")
    return data
