"""Score schedule — port of analysis/score-schedule.ts.

Multi-objective KPI scoring. Score is a negative cost (higher = better).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ..constants import DAY_CAP, OTD_TOLERANCE
from ..types import Block, EMachine, EOp

DEFAULT_WEIGHTS = {
    "tardiness": 100.0,
    "setup_count": 10.0,
    "setup_time": 1.0,
    "setup_balance": 30.0,
    "churn": 5.0,
    "overflow": 50.0,
    "below_min_batch": 5.0,
    "capacity_variance": 20.0,
    "setup_density": 15.0,
}


@dataclass
class WorkforceDemandEntry:
    machine_id: str
    day_idx: int
    shift: str
    operators: int


@dataclass
class OptResult:
    score: float = 0
    otd: float = 100.0
    otd_delivery: float = 100.0
    produced: int = 0
    total_demand: int = 0
    lost_pcs: int = 0
    setup_count: int = 0
    setup_min: int = 0
    peak_ops: int = 0
    over_ops: int = 0
    overflows: int = 0
    cap_util: float = 0
    cap_var: float = 0
    tardiness_days: float = 0
    setup_by_shift: dict[str, int] = field(default_factory=lambda: {"X": 0, "Y": 0, "Z": 0})
    deadline_feasible: bool = True
    cap_by_machine: dict = field(default_factory=dict)
    workforce_demand: list[WorkforceDemandEntry] = field(default_factory=list)
    blocks: list[Block] = field(default_factory=list)


def _get_block_production_for_op(blocks: list[Block], op_id: str) -> int:
    """Twin-aware production for an op (includes twin outputs)."""
    total = 0
    for b in blocks:
        if b.type != "ok" or b.qty <= 0:
            continue
        if b.op_id == op_id:
            total += b.qty
        if b.outputs:
            for out in b.outputs:
                if out.op_id == op_id:
                    total += out.qty
    return total


def score_schedule(
    blocks: list[Block],
    ops: list[EOp],
    machines: list[EMachine],
    weights: dict[str, float] | None = None,
    baseline_blocks: list[Block] | None = None,
    n_days: int | None = None,
) -> OptResult:
    """Score a schedule. Returns OptResult with KPIs and weighted score."""
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    if n_days is None:
        n_days = max((b.day_idx + 1 for b in blocks), default=1)

    # ── Demand + Production ──
    total_demand = 0
    total_produced = 0
    for op in ops:
        d = sum(max(v, 0) for v in op.d) + max(op.atr, 0)
        total_demand += d
        total_produced += _get_block_production_for_op(blocks, op.id)

    lost_pcs = max(0, total_demand - total_produced)
    otd = (
        min(100.0, max(0.0, 100.0 - (lost_pcs / total_demand * 100.0)))
        if total_demand > 0
        else 100.0
    )
    deadline_feasible = lost_pcs <= 0

    # ── OTD-Delivery (per-day cumulative) ──
    otd_d_on_time = 0
    otd_d_total = 0
    for op in ops:
        cum_demand = 0
        cum_prod = 0
        prod_by_day: dict[int, int] = {}
        for b in blocks:
            if b.type != "ok" or b.qty <= 0:
                continue
            if b.op_id == op.id:
                prod_by_day[b.day_idx] = prod_by_day.get(b.day_idx, 0) + b.qty
            if b.outputs:
                for out in b.outputs:
                    if out.op_id == op.id:
                        prod_by_day[b.day_idx] = prod_by_day.get(b.day_idx, 0) + out.qty

        for d in range(len(op.d)):
            dd = max(op.d[d], 0) if d < len(op.d) else 0
            if dd <= 0:
                continue
            cum_demand += dd
            for pd in range(d + 1):
                if pd in prod_by_day:
                    cum_prod += prod_by_day.pop(pd, 0)
            otd_d_total += 1
            if cum_prod >= cum_demand * OTD_TOLERANCE:
                otd_d_on_time += 1

    otd_delivery = (otd_d_on_time / otd_d_total * 100.0) if otd_d_total > 0 else 100.0

    # ── Setups ──
    setup_count = sum(1 for b in blocks if b.setup_s is not None and b.type == "ok")
    setup_min_val = sum(b.setup_min for b in blocks if b.type == "ok")
    setup_by_shift = {"X": 0, "Y": 0, "Z": 0}
    for b in blocks:
        if b.setup_s is not None and b.type == "ok":
            setup_by_shift[b.shift] = setup_by_shift.get(b.shift, 0) + 1

    # Setup balance
    sx, sy, sz = setup_by_shift["X"], setup_by_shift["Y"], setup_by_shift.get("Z", 0)
    if sz > 0:
        setup_balance = (abs(sx - sy) + abs(sy - sz) + abs(sx - sz)) / 3.0
    else:
        setup_balance = abs(sx - sy)

    # ── Overflows + Tardiness ──
    overflows = sum(1 for b in blocks if b.overflow)
    tardiness_days = sum(
        (b.overflow_min or 0) / DAY_CAP for b in blocks if b.overflow and b.overflow_min
    )

    # ── Capacity ──
    utils: list[float] = []
    cap_by_machine: dict[str, list[dict]] = {}
    for m in machines:
        days = [{"prod": 0, "setup": 0} for _ in range(n_days)]
        for b in blocks:
            if b.machine_id != m.id or b.day_idx < 0 or b.day_idx >= n_days:
                continue
            if b.type == "ok":
                days[b.day_idx]["prod"] += b.prod_min
                days[b.day_idx]["setup"] += b.setup_min
        cap_by_machine[m.id] = days
        for day in days:
            u = (day["prod"] + day["setup"]) / DAY_CAP if DAY_CAP > 0 else 0
            utils.append(u)

    u_mean = sum(utils) / len(utils) if utils else 0
    u_var = sum((u - u_mean) ** 2 for u in utils) / len(utils) if utils else 0

    # ── Setup density ──
    density_map: dict[str, int] = {}
    for b in blocks:
        if b.setup_s is not None and b.type == "ok":
            key = f"{b.machine_id}:{b.day_idx}:{b.shift}"
            density_map[key] = density_map.get(key, 0) + 1
    max_setup_density = max(density_map.values()) if density_map else 0

    # ── Churn ──
    churn_norm = 0.0
    move_count = sum(1 for b in blocks if b.moved and b.type == "ok")
    if baseline_blocks:
        baseline_map = {
            (b.op_id, b.day_idx, b.machine_id): b for b in baseline_blocks if b.type == "ok"
        }
        churn_real = 0
        for b in blocks:
            if b.type != "ok":
                continue
            base = baseline_map.get((b.op_id, b.day_idx, b.machine_id))
            if base:
                churn_real += abs(b.start_min - base.start_min)
        churn_norm = churn_real / 60.0
    else:
        churn_norm = float(move_count)

    # ── Below min batch ──
    below_min_count = sum(1 for b in blocks if b.below_min_batch and b.type == "ok")

    # ── Score ──
    if deadline_feasible:
        score = -(
            w["tardiness"] * tardiness_days
            + w["setup_count"] * setup_count
            + w["setup_time"] * setup_min_val
            + w["setup_balance"] * setup_balance
            + w["churn"] * churn_norm
            + w["overflow"] * overflows
            + w["below_min_batch"] * below_min_count
            + w["capacity_variance"] * u_var
            + w["setup_density"] * max_setup_density
        )
    else:
        score = float("-inf")

    return OptResult(
        score=score,
        otd=round(otd, 2),
        otd_delivery=round(otd_delivery, 2),
        produced=total_produced,
        total_demand=total_demand,
        lost_pcs=lost_pcs,
        setup_count=setup_count,
        setup_min=setup_min_val,
        peak_ops=0,
        over_ops=0,
        overflows=overflows,
        cap_util=round(u_mean, 4),
        cap_var=round(u_var, 4),
        tardiness_days=round(tardiness_days, 2),
        setup_by_shift=setup_by_shift,
        deadline_feasible=deadline_feasible,
        cap_by_machine=cap_by_machine,
        workforce_demand=[],
        blocks=blocks,
    )
