"""Simulator -- Moldit Planner (Phase 4): What-If.

simulate() deepcopies MolditEngineData, applies mutations, re-runs schedule_all(),
and compares BEFORE vs AFTER KPIs.
"""

from __future__ import annotations

import copy
import time
from dataclasses import dataclass

from backend.scheduler.scheduler import schedule_all
from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData

from .mutations import apply_mutation


@dataclass(slots=True)
class Mutation:
    type: str
    params: dict


@dataclass(slots=True)
class DeltaReport:
    makespan_before: int
    makespan_after: int
    compliance_before: float
    compliance_after: float
    setups_before: int
    setups_after: int
    balance_before: float
    balance_after: float


@dataclass(slots=True)
class SimulateResponse:
    segments: list[SegmentoMoldit]
    score: dict
    delta: DeltaReport
    time_ms: float
    summary: list[str]


def simulate(
    engine_data: MolditEngineData,
    baseline_score: dict,
    mutations: list[Mutation],
    config=None,
) -> SimulateResponse:
    """Run what-if simulation.

    1. deepcopy(engine_data)
    2. Apply each mutation
    3. schedule_all(mutated)
    4. Build DeltaReport comparing baseline_score vs new score
    5. Generate Portuguese summary
    """
    t0 = time.perf_counter()

    # 1. Deep copy data AND config (mutations may modify config)
    mutated = copy.deepcopy(engine_data)
    sim_config = copy.deepcopy(config) if config else None

    # 2. Apply mutations
    summaries: list[str] = []
    for mut in mutations:
        msg = apply_mutation(mutated, mut.type, mut.params, config=sim_config)
        summaries.append(msg)

    # 3. Re-schedule
    try:
        result = schedule_all(mutated, config=sim_config)
    except Exception as exc:
        elapsed = (time.perf_counter() - t0) * 1000
        summaries.append(f"ERRO no scheduler: {exc}")
        empty_delta = DeltaReport(
            makespan_before=baseline_score.get("makespan_total_dias", 0),
            makespan_after=0,
            compliance_before=baseline_score.get("deadline_compliance", 0.0),
            compliance_after=0.0,
            setups_before=baseline_score.get("total_setups", 0),
            setups_after=0,
            balance_before=baseline_score.get("utilization_balance", 0.0),
            balance_after=0.0,
        )
        return SimulateResponse(
            segments=[], score={},
            delta=empty_delta, time_ms=round(elapsed, 1), summary=summaries,
        )

    # 4. Delta report
    delta = DeltaReport(
        makespan_before=baseline_score.get("makespan_total_dias", 0),
        makespan_after=result.score.get("makespan_total_dias", 0),
        compliance_before=baseline_score.get("deadline_compliance", 0.0),
        compliance_after=result.score.get("deadline_compliance", 0.0),
        setups_before=baseline_score.get("total_setups", 0),
        setups_after=result.score.get("total_setups", 0),
        balance_before=baseline_score.get("utilization_balance", 0.0),
        balance_after=result.score.get("utilization_balance", 0.0),
    )

    # 5. Summary
    summaries.append(_delta_summary(delta))

    elapsed = (time.perf_counter() - t0) * 1000

    return SimulateResponse(
        segments=result.segmentos,
        score=result.score,
        delta=delta,
        time_ms=round(elapsed, 1),
        summary=summaries,
    )


def _delta_summary(delta: DeltaReport) -> str:
    """Generate Portuguese summary of KPI changes."""
    parts: list[str] = []

    mk_diff = delta.makespan_after - delta.makespan_before
    if mk_diff != 0:
        direction = "aumentou" if mk_diff > 0 else "reduziu"
        parts.append(
            f"Makespan {direction} {abs(mk_diff)} dia(s) "
            f"({delta.makespan_before} -> {delta.makespan_after})"
        )

    comp_diff = delta.compliance_after - delta.compliance_before
    if abs(comp_diff) > 0.005:
        direction = "subiu" if comp_diff > 0 else "desceu"
        parts.append(
            f"Cumprimento {direction} "
            f"({delta.compliance_before:.1%} -> {delta.compliance_after:.1%})"
        )

    setup_diff = delta.setups_after - delta.setups_before
    if setup_diff != 0:
        sign = "+" if setup_diff > 0 else ""
        parts.append(f"Setups: {sign}{setup_diff} ({delta.setups_before} -> {delta.setups_after})")

    bal_diff = delta.balance_after - delta.balance_before
    if abs(bal_diff) > 0.01:
        direction = "melhorou" if bal_diff > 0 else "piorou"
        parts.append(
            f"Balanceamento {direction} "
            f"({delta.balance_before:.2f} -> {delta.balance_after:.2f})"
        )

    if not parts:
        return "Sem alteracoes significativas nos KPIs."

    return "Resumo: " + "; ".join(parts) + "."
