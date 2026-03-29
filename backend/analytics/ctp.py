"""CTP — Capable to Promise — Spec 03 §2.

"Can we fit N more pieces of SKU X by day D?"
Uses REAL capacity (DAY_CAP - minutes already used in segments).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.config.types import FactoryConfig
from backend.scheduler.constants import DAY_CAP, DEFAULT_OEE
from backend.scheduler.types import Segment
from backend.types import EngineData


@dataclass(slots=True)
class CTPResult:
    feasible: bool
    sku: str
    qty_requested: int
    latest_day: int | None  # latest day to start (JIT)
    machine: str | None
    confidence: str  # "high" | "medium" | "low"
    slack_min: float
    reason: str | None


def compute_ctp(
    sku: str,
    qty: int,
    deadline_day: int,
    segments: list[Segment],
    engine_data: EngineData,
    config: FactoryConfig | None = None,
) -> CTPResult:
    """CTP based on REAL free capacity from schedule segments."""
    day_cap = config.day_capacity_min if config else DAY_CAP
    oee_default = config.oee_default if config else DEFAULT_OEE

    # Find op for SKU
    op = next((o for o in engine_data.ops if o.sku == sku), None)
    if op is None:
        return CTPResult(
            feasible=False, sku=sku, qty_requested=qty,
            latest_day=None, machine=None, confidence="low",
            slack_min=0, reason=f"SKU {sku} não encontrado",
        )

    if op.pH <= 0:
        return CTPResult(
            feasible=False, sku=sku, qty_requested=qty,
            latest_day=None, machine=op.m, confidence="low",
            slack_min=0, reason="pH = 0, cadência desconhecida",
        )

    oee = op.oee or oee_default
    required_min = op.sH * 60 + (qty / op.pH) * 60 / oee

    # Build used capacity per (machine, day) from segments
    cap_used: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for seg in segments:
        cap_used[seg.machine_id][seg.day_idx] += seg.prod_min + seg.setup_min

    n_days = engine_data.n_days
    holidays = set(engine_data.holidays)

    def _find_slot(machine_id: str) -> int | None:
        """Scan backwards from deadline, accumulate free capacity (JIT)."""
        accumulated = 0.0
        for d in range(min(deadline_day, n_days - 1), -1, -1):
            if d in holidays:
                continue
            used = cap_used.get(machine_id, {}).get(d, 0)
            free = max(0, day_cap - used)
            accumulated += free
            if accumulated >= required_min:
                return d
        return None

    # Try primary machine
    machines = [op.m]
    if op.alt:
        machines.append(op.alt)

    for machine in machines:
        day = _find_slot(machine)
        if day is not None and day <= deadline_day:
            # Total free capacity from slot start to deadline
            total_free = 0.0
            for d in range(day, min(deadline_day + 1, n_days)):
                if d in holidays:
                    continue
                used = cap_used.get(machine, {}).get(d, 0)
                total_free += max(0, day_cap - used)
            slack = total_free - required_min
            confidence = (
                "high" if slack > day_cap * 0.3
                else "medium" if slack > day_cap * 0.1
                else "low"
            )
            return CTPResult(
                feasible=True, sku=sku, qty_requested=qty,
                latest_day=day, machine=machine,
                confidence=confidence, slack_min=max(0, slack),
                reason=None,
            )

    return CTPResult(
        feasible=False, sku=sku, qty_requested=qty,
        latest_day=None, machine=None, confidence="low",
        slack_min=0,
        reason=f"Sem capacidade em {' ou '.join(machines)} até dia {deadline_day}",
    )
