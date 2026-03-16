"""Scheduling configuration — port of config/scheduling-config.ts.

Pydantic equivalent of the Zod SchedulingConfigSchema.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

ConstraintMode = Literal["hard", "disabled"]
DispatchRule = Literal["EDD", "CR", "WSPT", "SPT", "ATCS"]
Direction = Literal["forward", "backward"]
GovernanceLevel = Literal["L0", "L1", "L2", "L3", "L4", "L5"]
LotEconomicoMode = Literal["strict", "relaxed"]


class Weights(BaseModel):
    otd: float = Field(0.7, ge=0, le=1)
    setup: float = Field(0.2, ge=0, le=1)
    utilization: float = Field(0.1, ge=0, le=1)

    @model_validator(mode="after")
    def _sum_to_one(self) -> Weights:
        if abs(self.otd + self.setup + self.utilization - 1.0) > 0.001:
            raise ValueError("Weights must sum to 1.0")
        return self


class ConstraintEntry(BaseModel):
    mode: ConstraintMode = "hard"


class ConstraintsConfig(BaseModel):
    setup_crew: ConstraintEntry = Field(default_factory=lambda: ConstraintEntry(mode="hard"))
    tool_timeline: ConstraintEntry = Field(default_factory=lambda: ConstraintEntry(mode="hard"))
    calco_timeline: ConstraintEntry = Field(default_factory=lambda: ConstraintEntry(mode="hard"))
    operator_pool: ConstraintEntry = Field(default_factory=lambda: ConstraintEntry(mode="hard"))


class ATCSParams(BaseModel):
    k1: float = Field(1.0, ge=0.1, le=5)
    k2: float = Field(0.5, ge=0.01, le=2)


class RuleCondition(BaseModel):
    field: str
    operator: Literal[">", "<", ">=", "<=", "==", "!="]
    value: float
    action: str


class L2Rules(BaseModel):
    rules: list[RuleCondition] = Field(default_factory=list)


class Formula(BaseModel):
    name: str
    expression: str
    variables: list[str] = Field(default_factory=list)


class L3Formulas(BaseModel):
    formulas: list[Formula] = Field(default_factory=list)


class ConceptDefinition(BaseModel):
    name: str
    formula: str
    threshold: float | None = None


class L4Definitions(BaseModel):
    definitions: list[ConceptDefinition] = Field(default_factory=list)


class ApprovalRule(BaseModel):
    action: str
    required_level: GovernanceLevel
    approvers: list[str] = Field(default_factory=list)


class L5Governance(BaseModel):
    default_level: GovernanceLevel = "L1"
    approval_rules: list[ApprovalRule] = Field(default_factory=list)


class StrategyStep(BaseModel):
    dispatch_rule: DispatchRule
    condition: str | None = None
    max_iterations: int = Field(1, gt=0)


class L6Strategy(BaseModel):
    steps: list[StrategyStep] = Field(default_factory=list)
    fallback_rule: DispatchRule = "ATCS"


class SchedulingConfig(BaseModel):
    """Main scheduling configuration — port of SchedulingConfigSchema."""

    version: int = Field(2, gt=0)
    weights: Weights = Field(default_factory=Weights)
    dispatch_rule: DispatchRule = "ATCS"
    direction: Direction = "forward"
    frozen_horizon_days: int = Field(5, ge=0, le=30)
    lot_economico_mode: LotEconomicoMode = "relaxed"
    emergency_night_shift: bool = False
    constraints: ConstraintsConfig = Field(default_factory=ConstraintsConfig)
    atcs_params: ATCSParams | None = None
    sa_iterations: int = Field(10_000, ge=0, le=100_000)
    l2_rules: L2Rules | None = None
    l3_formulas: L3Formulas | None = None
    l4_definitions: L4Definitions | None = None
    l5_governance: L5Governance | None = None
    l6_strategy: L6Strategy | None = None


DEFAULT_SCHEDULING_CONFIG = SchedulingConfig()


# ── Policy presets ──

POLICY_MAX_OTD = {
    "weights": {"otd": 0.9, "setup": 0.05, "utilization": 0.05},
    "dispatch_rule": "EDD",
    "emergency_night_shift": True,
}

POLICY_MIN_SETUPS = {
    "weights": {"otd": 0.3, "setup": 0.6, "utilization": 0.1},
    "dispatch_rule": "ATCS",
    "lot_economico_mode": "strict",
}

POLICY_BALANCED = {
    "weights": {"otd": 0.5, "setup": 0.3, "utilization": 0.2},
    "dispatch_rule": "ATCS",
}

POLICY_URGENT = {
    "weights": {"otd": 0.8, "setup": 0.1, "utilization": 0.1},
    "dispatch_rule": "ATCS",
    "emergency_night_shift": True,
    "frozen_horizon_days": 2,
    "sa_iterations": 2000,
}

POLICY_INCOMPOL_STANDARD = {
    "weights": {"otd": 0.7, "setup": 0.2, "utilization": 0.1},
    "dispatch_rule": "ATCS",
    "direction": "forward",
    "frozen_horizon_days": 5,
    "lot_economico_mode": "relaxed",
    "emergency_night_shift": False,
    "sa_iterations": 10_000,
    "l5_governance": {
        "default_level": "L1",
        "approval_rules": [
            {"action": "edit_plan_frozen", "required_level": "L4"},
            {"action": "edit_plan_slushy", "required_level": "L3"},
            {"action": "enable_night_shift", "required_level": "L4"},
            {"action": "override_priority", "required_level": "L3"},
        ],
    },
}


def validate_config(raw: dict) -> SchedulingConfig:
    """Parse and validate a scheduling config dict."""
    return SchedulingConfig(**raw)


def migrate_config(old: dict, from_version: int) -> SchedulingConfig:
    """Migrate config from older versions."""
    if from_version < 1 or not isinstance(old, dict):
        return DEFAULT_SCHEDULING_CONFIG
    if from_version == 1:
        old["version"] = 2
    return SchedulingConfig(**old)
