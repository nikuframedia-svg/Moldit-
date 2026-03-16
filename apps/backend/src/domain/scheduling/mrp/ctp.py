"""CTP — Capable-To-Promise.

Port of mrp/mrp-ctp.ts. Determines if a new order can be fulfilled by target day.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..constants import DAY_CAP, DEFAULT_OEE
from ..types import EngineData
from .mrp_engine import MRPResult


@dataclass
class CTPInput:
    tool_code: str
    quantity: int
    target_day: int


@dataclass
class CTPCapDay:
    day_index: int
    existing_load: int = 0
    new_order_load: int = 0
    capacity: int = DAY_CAP


@dataclass
class CTPResult:
    feasible: bool = False
    tool_code: str = ""
    machine: str = ""
    required_min: int = 0
    available_min_on_day: int = 0
    capacity_slack: int = 0
    earliest_feasible_day: int | None = None
    confidence: str = "low"
    reason: str = ""
    capacity_timeline: list[CTPCapDay] = field(default_factory=list)


def compute_ctp(
    inp: CTPInput,
    mrp: MRPResult,
    engine: EngineData,
) -> CTPResult:
    """Compute Capable-To-Promise for a new order."""
    tool = engine.tool_map.get(inp.tool_code)
    if not tool:
        return CTPResult(
            tool_code=inp.tool_code,
            reason=f"Tool {inp.tool_code} not found",
        )

    oee = tool.oee if tool.oee else DEFAULT_OEE
    pH = tool.pH
    if pH <= 0:
        return CTPResult(
            tool_code=inp.tool_code,
            machine=tool.m,
            reason="Tool has zero production rate",
        )

    setup_min = int(tool.sH * 60)
    prod_min = int((inp.quantity / pH * 60) / oee)
    total_required = setup_min + prod_min

    # Build capacity timeline from RCCP
    cap_by_day: dict[int, int] = {}
    for e in mrp.rccp:
        if e.machine == tool.m:
            cap_by_day[e.day_index] = e.required_total_min

    timeline: list[CTPCapDay] = []
    for d in range(engine.n_days):
        existing = cap_by_day.get(d, 0)
        timeline.append(CTPCapDay(day_index=d, existing_load=existing, capacity=DAY_CAP))

    # Find earliest feasible day (consecutive accumulation)
    earliest: int | None = None
    accumulated = 0
    for d in range(engine.n_days):
        avail = DAY_CAP - timeline[d].existing_load
        if avail <= 0:
            accumulated = 0
            continue
        accumulated += avail
        if accumulated >= total_required:
            earliest = d
            break

    # Fallback: try alt machine
    if earliest is None and tool.alt and tool.alt != "-":
        alt_cap: dict[int, int] = {}
        for e in mrp.rccp:
            if e.machine == tool.alt:
                alt_cap[e.day_index] = e.required_total_min
        accumulated = 0
        for d in range(engine.n_days):
            existing = alt_cap.get(d, 0)
            avail = DAY_CAP - existing
            if avail <= 0:
                accumulated = 0
                continue
            accumulated += avail
            if accumulated >= total_required:
                earliest = d
                break

    feasible = earliest is not None and earliest <= inp.target_day

    # Confidence
    if earliest is not None and earliest < len(timeline):
        remaining = DAY_CAP - timeline[earliest].existing_load - total_required
        ratio = remaining / DAY_CAP if DAY_CAP > 0 else 0
        if ratio > 0.30:
            confidence = "high"
        elif ratio > 0.10:
            confidence = "medium"
        else:
            confidence = "low"
    else:
        confidence = "low"

    avail_on_target = (
        DAY_CAP - (cap_by_day.get(inp.target_day, 0)) if inp.target_day < engine.n_days else 0
    )

    # Mark new order load
    if earliest is not None:
        for cd in timeline:
            if cd.day_index == earliest:
                cd.new_order_load = min(total_required, DAY_CAP - cd.existing_load)

    reason = (
        "Capacidade disponível"
        if feasible
        else (
            f"Primeiro dia possível: {earliest}"
            if earliest is not None
            else "Sem capacidade no horizonte"
        )
    )

    return CTPResult(
        feasible=feasible,
        tool_code=inp.tool_code,
        machine=tool.m,
        required_min=total_required,
        available_min_on_day=avail_on_target,
        capacity_slack=avail_on_target - total_required,
        earliest_feasible_day=earliest,
        confidence=confidence,
        reason=reason,
        capacity_timeline=timeline,
    )
