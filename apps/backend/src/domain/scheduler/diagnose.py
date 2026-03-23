"""Scheduler diagnostics — run scheduler with tracing, build report.

Usage:
    from .diagnose import diagnose
    report = diagnose(engine_data)
    print(json.dumps(report, indent=2))
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

from ..scheduling.types import EngineData
from .constants import DAY_CAP
from .overflow_router import compute_otd_delivery_failures, compute_tardiness, sum_overflow
from .scheduler import schedule_all


def diagnose(
    engine_data: EngineData,
    settings: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Run scheduler with tracing enabled, return diagnostic report."""
    trace: list[dict[str, Any]] = []

    t0 = time.perf_counter()
    result = schedule_all(engine_data, settings=settings, trace=trace)
    elapsed_ms = (time.perf_counter() - t0) * 1000

    blocks = result.blocks
    ops = engine_data.ops
    workdays = engine_data.workdays
    n_workdays = sum(1 for w in workdays if w)

    # ── Summary ──
    total_demand_pcs = sum(sum(max(v, 0) for v in op.d) + op.atr for op in ops)
    tool_map = engine_data.tool_map
    total_demand_min = 0.0
    for op in ops:
        tool = tool_map.get(op.t)
        if tool and tool.pH > 0:
            oee = tool.oee or 0.66
            pcs = sum(max(v, 0) for v in op.d) + op.atr
            total_demand_min += (pcs / tool.pH) * 60.0 / oee

    ok_blocks = [b for b in blocks if b.type == "ok"]
    overflow_blocks = [b for b in blocks if b.type in ("overflow", "infeasible")]
    otd_failures = compute_otd_delivery_failures(blocks, ops)

    summary = {
        "n_ops": len(ops),
        "n_machines": len(engine_data.machines),
        "n_days": engine_data.n_days,
        "workdays": n_workdays,
        "total_demand_pcs": total_demand_pcs,
        "total_demand_min": round(total_demand_min, 1),
        "twin_groups": len(engine_data.twin_groups),
        "solve_time_ms": round(elapsed_ms, 1),
        "blocks": len(ok_blocks),
        "overflow_blocks": len(overflow_blocks),
        "overflow_min": round(sum_overflow(blocks), 1),
        "tardiness_min": round(compute_tardiness(blocks), 1),
        "otd_d_failures": len(otd_failures),
    }

    # ── Grid search (from trace) ──
    grid_search = {}
    for t_entry in trace:
        if t_entry.get("type") == "grid_search":
            grid_search = {
                "best": t_entry["best"],
                "worst": t_entry["worst"],
                "zero_overflow_count": t_entry["zero_overflow_count"],
            }
            break

    # ── Overflow routing (from trace) ──
    overflow_routing = {}
    for t_entry in trace:
        if t_entry.get("type") == "tier1_done":
            overflow_routing["tier1"] = {
                "overflow_before": t_entry["overflow_before"],
                "overflow_after": t_entry["overflow_after"],
                "moves": t_entry["moves"],
                "advances": t_entry["advances"],
            }
        elif t_entry.get("type") == "tier2_done":
            overflow_routing["tier2"] = {
                "tardiness_before": t_entry["tardiness_before"],
                "tardiness_after": t_entry["tardiness_after"],
                "moves": t_entry["moves"],
                "advances": t_entry["advances"],
            }
        elif t_entry.get("type") == "tier3_done":
            overflow_routing["tier3"] = {
                "rules_tried": t_entry["rules_tried"],
                "best_rule": t_entry["best_rule"],
                "failures_after": t_entry["failures_after"],
            }

    # ── Per-machine summary ──
    per_machine: dict[str, dict[str, Any]] = {}
    machine_capacity = n_workdays * DAY_CAP

    # Collect block data per machine
    m_prod: dict[str, float] = defaultdict(float)
    m_setup: dict[str, float] = defaultdict(float)
    m_blocks: dict[str, int] = defaultdict(int)
    m_setups: dict[str, int] = defaultdict(int)
    m_overflow: dict[str, float] = defaultdict(float)
    m_day_used: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))

    for b in blocks:
        mid = b.machine_id
        if b.type == "ok":
            m_prod[mid] += b.prod_min
            m_setup[mid] += b.setup_min
            m_blocks[mid] += 1
            if b.setup_min > 0:
                m_setups[mid] += 1
            m_day_used[mid][b.day_idx] += b.prod_min + b.setup_min
        elif b.type in ("overflow", "infeasible") and b.overflow_min:
            m_overflow[mid] += b.overflow_min

    for m in engine_data.machines:
        mid = m.id
        prod = m_prod.get(mid, 0)
        setup = m_setup.get(mid, 0)
        total_used = prod + setup
        util_pct = round(total_used / machine_capacity * 100, 1) if machine_capacity > 0 else 0
        idle = max(machine_capacity - total_used, 0)

        # Gaps > 30 min (free slots within workdays)
        gaps: list[dict[str, Any]] = []
        day_used = m_day_used.get(mid, {})
        for day_idx, is_work in enumerate(workdays):
            if not is_work:
                continue
            used = day_used.get(day_idx, 0)
            free = DAY_CAP - used
            if free > 30:
                gaps.append({"day": day_idx, "free_min": round(free, 1)})

        per_machine[mid] = {
            "blocks": m_blocks.get(mid, 0),
            "prod_min": round(prod, 1),
            "setup_min": round(setup, 1),
            "util_pct": util_pct,
            "setups": m_setups.get(mid, 0),
            "overflow_min": round(m_overflow.get(mid, 0), 1),
            "idle_min": round(idle, 1),
            "gaps": gaps,
        }

    # ── Per-op summary ──
    per_op: dict[str, dict[str, Any]] = {}

    # Build demand per op
    op_demand: dict[str, int] = {}
    for op in ops:
        op_demand[op.id] = sum(max(v, 0) for v in op.d) + op.atr

    # Build production per op (twin-aware)
    op_produced: dict[str, int] = defaultdict(int)
    op_blocks_count: dict[str, int] = defaultdict(int)
    op_days: dict[str, set[int]] = defaultdict(set)
    op_machines: dict[str, set[str]] = defaultdict(set)
    op_overflow: dict[str, float] = defaultdict(float)
    op_moved: dict[str, bool] = {}
    op_tardy: dict[str, bool] = {}

    for b in blocks:
        if b.type == "ok" and b.qty > 0:
            if b.outputs:
                for out in b.outputs:
                    op_produced[out.op_id] += out.qty
            else:
                op_produced[b.op_id] += b.qty
            op_blocks_count[b.op_id] += 1
            op_days[b.op_id].add(b.day_idx)
            op_machines[b.op_id].add(b.machine_id)
            if b.moved:
                op_moved[b.op_id] = True
            if b.edd_day is not None and b.day_idx > b.edd_day:
                op_tardy[b.op_id] = True
        elif b.type in ("overflow", "infeasible") and b.overflow_min:
            op_overflow[b.op_id] += b.overflow_min

    for op in ops:
        demand = op_demand.get(op.id, 0)
        produced = op_produced.get(op.id, 0)
        overprod = (produced / demand - 1.0) if demand > 0 else 0.0

        per_op[op.id] = {
            "sku": op.sku,
            "machine": op.m,
            "demand_pcs": demand,
            "produced_pcs": produced,
            "blocks": op_blocks_count.get(op.id, 0),
            "days": sorted(op_days.get(op.id, set())),
            "overflow_min": round(op_overflow.get(op.id, 0), 1),
            "moved": op_moved.get(op.id, False),
            "tardy": op_tardy.get(op.id, False),
            "overproduction_pct": round(overprod * 100, 1),
        }

    # ── Alerts ──
    alerts: list[dict[str, Any]] = []

    # Overproduction alerts (produced > demand × 1.5)
    for op in ops:
        demand = op_demand.get(op.id, 0)
        produced = op_produced.get(op.id, 0)
        if demand > 0 and produced > demand * 1.5:
            alerts.append(
                {
                    "type": "overproduction",
                    "op_id": op.id,
                    "sku": op.sku,
                    "demand": demand,
                    "produced": produced,
                    "ratio": round(produced / demand, 2),
                }
            )

    # Machine utilization alerts
    for mid, info in per_machine.items():
        if info["util_pct"] >= 95:
            alerts.append(
                {
                    "type": "high_util",
                    "machine": mid,
                    "util_pct": info["util_pct"],
                }
            )
        elif info["util_pct"] <= 25 and info["blocks"] > 0:
            alerts.append(
                {
                    "type": "idle_machine",
                    "machine": mid,
                    "util_pct": info["util_pct"],
                    "free_min": info["idle_min"],
                }
            )

    # ── Trace (only actionable entries) ──
    actionable_trace = [
        t_entry
        for t_entry in trace
        if t_entry.get("type") in ("overflow", "constraint_block", "move", "advance")
    ]

    return {
        "summary": summary,
        "grid_search": grid_search,
        "overflow_routing": overflow_routing,
        "per_machine": per_machine,
        "per_op": per_op,
        "alerts": alerts,
        "trace": actionable_trace,
    }
