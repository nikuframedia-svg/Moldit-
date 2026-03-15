"""Tests for C-03: Rules Engine + Definitions YAML."""

from pathlib import Path

import pytest

from src.rules.catalogue import validate_action, validate_condition
from src.rules.engine import RuleContext, apply_action, evaluate_condition, evaluate_rules, load_definitions
from src.rules.models import Action, Condition, Rule

YAML_PATH = Path(__file__).resolve().parent.parent / "src" / "definitions" / "incompol.yaml"


# ── 1. Francisco test (INVIOLABLE) ──────────────────────────────────────────


def test_francisco_F3_material_affinity():
    """Load incompol.yaml. Rule 'francisco_mp_262_170' exists and is active.
    When applied to context with matching ref, action returns machine override PRM019."""
    defs = load_definitions(YAML_PATH)
    raw_rules = defs["rules"]

    # Find the rule
    francisco_rule = None
    for r in raw_rules:
        if r["id"] == "francisco_mp_262_170":
            francisco_rule = Rule(**r)
            break

    assert francisco_rule is not None, "Rule francisco_mp_262_170 not found in YAML"
    assert francisco_rule.active is True
    assert francisco_rule.created_by == "francisco"

    # Evaluate with matching SKU
    ctx = RuleContext(sku="1092262X100")
    results = evaluate_rules([francisco_rule], ctx)

    assert len(results) == 1
    assert results[0]["action"] == "group_with"
    assert results[0]["machine"] == "PRM019"
    assert results[0]["rule_id"] == "francisco_mp_262_170"


# ── 2. Condition evaluation TRUE ────────────────────────────────────────────


def test_rule_evaluation_true():
    """coverage_days_gt with days=14, context with 20 days -> True."""
    cond = Condition(type="coverage_days_gt", params={"days": 14})
    ctx = RuleContext(coverage_days=20)
    assert evaluate_condition(cond, ctx) is True


# ── 3. Condition evaluation FALSE ───────────────────────────────────────────


def test_rule_evaluation_false():
    """coverage_days_gt with days=14, context with 5 days -> False."""
    cond = Condition(type="coverage_days_gt", params={"days": 14})
    ctx = RuleContext(coverage_days=5)
    assert evaluate_condition(cond, ctx) is False


# ── 4. Action execution ─────────────────────────────────────────────────────


def test_action_execution():
    """force_machine with machine='PRM031' returns override."""
    action = Action(type="force_machine", params={"machine": "PRM031"})
    ctx = RuleContext(sku="TEST_SKU")
    result = apply_action(action, ctx)

    assert result["action"] == "force_machine"
    assert result["machine"] == "PRM031"
    assert result["sku"] == "TEST_SKU"


# ── 5. Invalid condition rejected ───────────────────────────────────────────


def test_invalid_condition_rejected():
    """condition type 'invented_thing' -> ValueError."""
    cond = Condition(type="invented_thing", params={})
    with pytest.raises(ValueError, match="Unknown condition type"):
        validate_condition(cond)


# ── 6. Invalid action rejected ──────────────────────────────────────────────


def test_invalid_action_rejected():
    """action type 'invented_thing' -> ValueError."""
    action = Action(type="invented_thing", params={})
    with pytest.raises(ValueError, match="Unknown action type"):
        validate_action(action)


# ── 7. YAML loads ───────────────────────────────────────────────────────────


def test_yaml_loads():
    """incompol.yaml loads without errors."""
    defs = load_definitions(YAML_PATH)
    assert "factory" in defs
    assert defs["factory"]["name"] == "Incompol"
    assert "machines" in defs
    assert "tools" in defs
    assert "shifts" in defs
    assert "constraints" in defs
    assert "scheduling" in defs
    assert "alerts" in defs
    assert "rules" in defs


# ── 8. YAML machines complete ───────────────────────────────────────────────


def test_yaml_machines_complete():
    """5 machines present (PRM020 excluded from active machines)."""
    defs = load_definitions(YAML_PATH)
    machines = defs["machines"]
    expected = {"PRM019", "PRM031", "PRM039", "PRM042", "PRM043"}
    assert expected.issubset(set(machines.keys()))
    assert "PRM020" not in machines, "PRM020 is out of use and should not be in active machines"


# ── 9. YAML tools complete ─────────────────────────────────────────────────


def test_yaml_tools_complete():
    """At least 40 tools present (should be 44 from nikufra_data.json)."""
    defs = load_definitions(YAML_PATH)
    tools = defs["tools"]
    assert len(tools) >= 40, f"Expected at least 40 tools, got {len(tools)}"
    # Verify some key tools exist
    assert "BFP080" in tools
    assert "DYE025" in tools
    assert "VUL111" in tools
    # Verify tool structure
    sample = tools["BFP080"]
    assert "setup_hours" in sample
    assert "rate" in sample
    assert "operators" in sample
    assert "machine" in sample
    assert "skus" in sample


# ── 10. Rule serialization round-trip ───────────────────────────────────────


def test_rule_serialization():
    """Rule -> JSON -> Rule round-trip."""
    rule = Rule(
        id="test_rule",
        name="Test Rule",
        description="A test rule for serialization",
        condition=Condition(type="coverage_days_gt", params={"days": 10}),
        action=Action(type="skip_scheduling", params={}),
        active=True,
        priority=5,
        created_by="copilot",
    )
    json_str = rule.model_dump_json()
    restored = Rule.model_validate_json(json_str)

    assert restored.id == rule.id
    assert restored.name == rule.name
    assert restored.condition.type == rule.condition.type
    assert restored.condition.params == rule.condition.params
    assert restored.action.type == rule.action.type
    assert restored.active == rule.active
    assert restored.priority == rule.priority
    assert restored.created_by == rule.created_by
