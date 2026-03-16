"""Core types — port of types/*.ts.

Pydantic models for all scheduling data structures.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# ── Frozen enums (do NOT change) ──

InfeasibilityReason = Literal[
    "SETUP_CREW_EXHAUSTED",
    "OPERATOR_CAPACITY",
    "TOOL_CONFLICT",
    "CALCO_CONFLICT",
    "DEADLINE_VIOLATION",
    "MACHINE_DOWN",
    "CAPACITY_OVERFLOW",
    "DATA_MISSING",
    "MACHINE_PARTIAL_DOWN",
    "TOOL_DOWN_TEMPORAL",
    "SHIPPING_CUTOFF_VIOLATION",
]

RemediationType = Literal[
    "THIRD_SHIFT",
    "EXTRA_OPERATORS",
    "OVERTIME",
    "SPLIT_OPERATION",
    "ADVANCE_PRODUCTION",
    "TRANSFER_ALT_MACHINE",
    "FORMAL_RISK_ACCEPTANCE",
]

DecisionType = Literal[
    "BACKWARD_SCHEDULE",
    "LOAD_LEVEL",
    "OVERFLOW_ROUTE",
    "ADVANCE_PRODUCTION",
    "DATA_MISSING",
    "INFEASIBILITY_DECLARED",
    "DEADLINE_CONSTRAINT",
    "OPERATOR_REALLOCATION",
    "ALTERNATIVE_MACHINE",
    "TOOL_DOWN",
    "MACHINE_DOWN",
    "FAILURE_DETECTED",
    "FAILURE_MITIGATION",
    "FAILURE_UNRECOVERABLE",
    "SHIPPING_CUTOFF",
    "PRODUCTION_START",
    "CAPACITY_COMPUTATION",
    "SCORING_DECISION",
    "OPERATOR_CAPACITY_WARNING",
    "AUTO_REPLAN_ADVANCE",
    "AUTO_REPLAN_MOVE",
    "AUTO_REPLAN_SPLIT",
    "AUTO_REPLAN_OVERTIME",
    "AUTO_REPLAN_THIRD_SHIFT",
    "TWIN_VALIDATION_ANOMALY",
    "WORKFORCE_FORECAST_D1",
    "WORKFORCE_COVERAGE_MISSING",
    "LABOR_GROUP_UNMAPPED",
    "SCHEDULE_REPAIR",
]

ReplanStrategyType = Literal[
    "ADVANCE_PRODUCTION",
    "MOVE_ALT_MACHINE",
    "THIRD_SHIFT",
    "OVERTIME",
    "SPLIT_OPERATION",
]

StartReason = Literal[
    "urgency_slack_critical",
    "density_heavy_load",
    "free_window_available",
    "setup_reduction",
    "future_load_relief",
    "deficit_elimination",
]

ShiftId = Literal["X", "Y", "Z"]
BlockType = Literal["ok", "blocked", "overflow", "infeasible"]

TwinAnomalyCode = Literal[
    "self_reference",
    "one_way_link",
    "counterpart_missing",
    "machine_mismatch",
    "tool_mismatch",
    "rate_mismatch",
    "people_mismatch",
]


# ── Engine data models ──


class EMachine(BaseModel):
    id: str
    area: str
    focus: bool = True


class ETool(BaseModel):
    id: str
    m: str  # primary machine
    alt: str = "-"  # alternative machine
    sH: float = 0.75  # setup hours
    pH: int = 100  # pieces per hour
    op: int = 1  # operators required
    lt: int = 0  # lot economic quantity
    stk: int = 0  # current stock
    mp: str | None = None  # material part code
    nm: str = ""  # tool name
    calco: str | None = None  # calco code
    setup_source: str | None = None  # 'isop' | 'master' | 'default'
    oee: float | None = None  # OEE override


class EOp(BaseModel):
    id: str
    t: str  # tool code
    m: str  # machine code
    sku: str
    nm: str = ""
    atr: int = 0  # backlog
    d: list[int] = Field(default_factory=list)  # daily demand quantities
    lt_days: int | None = None  # Prz.Fabrico working days
    cl: str | None = None  # customer code
    cl_nm: str | None = None  # customer name
    pa: str | None = None  # parent SKU
    stk: int | None = None  # per-SKU stock
    wip: int | None = None  # per-SKU WIP
    shipping_day_idx: int | None = None
    shipping_buffer_hours: int | None = None
    twin: str | None = None  # twin SKU reference


class TwinAnomalyEntry(BaseModel):
    op_id: str
    sku: str
    twin_sku: str
    code: str  # TwinAnomalyCode
    detail: str
    machine: str
    tool: str
    counterpart_machine: str | None = None
    counterpart_tool: str | None = None


class TwinGroup(BaseModel):
    op_id1: str
    op_id2: str
    sku1: str
    sku2: str
    machine: str
    tool: str
    pH: int
    operators: int
    lot_economic_differs: bool = False
    lead_time_differs: bool = False


class TwinValidationReport(BaseModel):
    total_twin_refs: int = 0
    valid_groups: int = 0
    invalid_refs: int = 0
    anomalies: list[TwinAnomalyEntry] = Field(default_factory=list)
    by_code: dict[str, int] = Field(default_factory=dict)
    twin_groups: list[TwinGroup] = Field(default_factory=list)


class LaborWindow(BaseModel):
    start: int
    end: int
    capacity: int


class WorkforceConfig(BaseModel):
    labor_groups: dict[str, list[LaborWindow]] = Field(default_factory=dict)
    machine_to_labor_group: dict[str, str] = Field(default_factory=dict)


class EngineData(BaseModel):
    """Core engine input — port of EngineData interface."""

    machines: list[EMachine] = Field(default_factory=list)
    tools: list[ETool] = Field(default_factory=list)
    ops: list[EOp] = Field(default_factory=list)
    dates: list[str] = Field(default_factory=list)
    dnames: list[str] = Field(default_factory=list)
    tool_map: dict[str, ETool] = Field(default_factory=dict)
    focus_ids: list[str] = Field(default_factory=list)
    workdays: list[bool] = Field(default_factory=list)
    mo: dict[str, list[int]] | None = None
    n_days: int = 0
    third_shift: bool = False
    m_st: dict[str, str] = Field(default_factory=dict)  # machine status
    t_st: dict[str, str] = Field(default_factory=dict)  # tool status
    twin_groups: list[TwinGroup] = Field(default_factory=list)
    twin_validation_report: TwinValidationReport | None = None
    workforce_config: WorkforceConfig | None = None
    order_based: bool = False
    pre_start_days: int | None = None

    model_config = {"arbitrary_types_allowed": True}


# ── Block and actions ──


class TwinOutput(BaseModel):
    op_id: str
    sku: str
    qty: int


class Block(BaseModel):
    """A scheduled production block — port of Block interface."""

    op_id: str
    tool_id: str
    sku: str = ""
    nm: str = ""
    machine_id: str
    orig_m: str = ""
    day_idx: int = 0
    edd_day: int | None = None
    qty: int = 0
    prod_min: int = 0
    setup_min: int = 0
    operators: int = 1
    blocked: bool = False
    reason: str | None = None
    moved: bool = False
    has_alt: bool = False
    alt_m: str | None = None
    mp: str | None = None
    stk: int = 0
    lt: int = 0
    atr: int = 0
    start_min: int = 0
    end_min: int = 0
    setup_s: int | None = None
    setup_e: int | None = None
    type: BlockType = "ok"
    shift: ShiftId = "X"
    overflow: bool = False
    overflow_min: int | None = None
    below_min_batch: bool = False
    earliest_start: int | None = None
    is_leveled: bool = False
    is_advanced: bool = False
    advanced_by_days: int | None = None
    infeasibility_reason: str | None = None
    infeasibility_detail: str | None = None
    has_data_gap: bool = False
    data_gap_detail: str | None = None
    operator_warning: bool = False
    failure_event_id: str | None = None
    effective_capacity_factor: float | None = None
    latest_finish_abs: int | None = None
    start_reason: str | None = None
    is_system_replanned: bool = False
    replan_strategy: str | None = None
    replan_decision_id: str | None = None
    is_overtime: bool = False
    overtime_min: int | None = None
    is_split_part: bool = False
    split_from_machine: str | None = None
    is_twin_production: bool = False
    co_production_group_id: str | None = None
    outputs: list[TwinOutput] | None = None
    freeze_status: str | None = None
    pre_start: bool = False
    pre_start_reason: str | None = None


class MoveAction(BaseModel):
    op_id: str
    to_m: str


class AdvanceAction(BaseModel):
    op_id: str
    advance_days: int
    original_edd: int
    target_edd: int | None = None


class OvertimeAction(BaseModel):
    machine_id: str
    day_idx: int
    extra_min: int


class SplitAction(BaseModel):
    op_id: str
    fraction: float
    to_machine: str


# ── Decision entry ──


class DecisionEntry(BaseModel):
    id: str
    timestamp: float = 0
    type: str  # DecisionType
    op_id: str | None = None
    tool_id: str | None = None
    machine_id: str | None = None
    day_idx: int | None = None
    shift: ShiftId | None = None
    detail: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)
    replan_strategy: str | None = None
    alternatives: list[dict] | None = None
    reversible: bool = True


# ── Feasibility ──


class InfeasibilityEntry(BaseModel):
    op_id: str
    tool_id: str
    machine_id: str
    reason: str  # InfeasibilityReason
    detail: str
    attempted_alternatives: list[str] = Field(default_factory=list)
    suggestion: str = ""
    day_idx: int | None = None
    shift: ShiftId | None = None


class FeasibilityReport(BaseModel):
    total_ops: int = 0
    feasible_ops: int = 0
    infeasible_ops: int = 0
    entries: list[InfeasibilityEntry] = Field(default_factory=list)
    by_reason: dict[str, int] = Field(default_factory=dict)
    feasibility_score: float = 1.0
    remediations: list[dict] = Field(default_factory=list)
    deadline_feasible: bool = True


# ── Schedule result ──


class ScheduleResult(BaseModel):
    """Output of the scheduling pipeline."""

    blocks: list[Block] = Field(default_factory=list)
    moves: list[MoveAction] = Field(default_factory=list)
    advances: list[AdvanceAction] = Field(default_factory=list)
    decisions: list[DecisionEntry] = Field(default_factory=list)
    feasibility: FeasibilityReport | None = None
    mrp: dict | None = None
    score: dict | None = None
    overtime_actions: list[OvertimeAction] = Field(default_factory=list)
    split_actions: list[SplitAction] = Field(default_factory=list)
