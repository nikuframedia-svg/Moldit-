"""MRP engine — port of mrp/mrp-engine.ts.

Classic MRP netting: gross requirements → net requirements → planned orders.
Twin-aware: grossReq = max(A, B), backlog = max(atrA, atrB).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from ..constants import DAY_CAP, DEFAULT_OEE
from ..types import EngineData, EOp, ETool, TwinGroup


@dataclass
class MRPDayBucket:
    day_index: int
    date_label: str = ""
    day_name: str = ""
    gross_requirement: int = 0
    scheduled_receipts: int = 0
    projected_available: int = 0
    net_requirement: int = 0
    planned_order_receipt: int = 0
    planned_order_release: int = 0


@dataclass
class MRPSkuRecord:
    sku: str
    name: str = ""
    op_id: str = ""
    tool_code: str = ""
    machine: str = ""
    alt_machine: str = ""
    customer: str = ""
    twin: str = ""
    stock: int = 0
    wip: int = 0
    backlog: int = 0
    coverage_days: float = 0
    stockout_day: int | None = None
    buckets: list[MRPDayBucket] = field(default_factory=list)


@dataclass
class MRPRecord:
    tool_code: str
    skus: list[str] = field(default_factory=list)
    machine: str = ""
    alt_machine: str = ""
    stock: int = 0
    backlog: int = 0
    lead_days: int = 0
    stockout_day: int | None = None
    coverage_days: float = 0
    buckets: list[MRPDayBucket] = field(default_factory=list)
    sku_records: list[MRPSkuRecord] = field(default_factory=list)


@dataclass
class RCCPEntry:
    machine: str
    area: str = ""
    day_index: int = 0
    date_label: str = ""
    available_min: int = DAY_CAP
    required_setup_min: int = 0
    required_prod_min: int = 0
    required_total_min: int = 0
    utilization: float = 0
    overloaded: bool = False
    planned_tools: list[str] = field(default_factory=list)


@dataclass
class MRPSummary:
    tools_with_backlog: int = 0
    tools_with_stockout: int = 0
    total_planned_qty: int = 0
    total_gross_req: int = 0
    bottleneck_machine: str = ""
    bottleneck_day: int = 0
    max_utilization: float = 0
    avg_utilization: float = 0


@dataclass
class MRPResult:
    records: list[MRPRecord] = field(default_factory=list)
    rccp: list[RCCPEntry] = field(default_factory=list)
    summary: MRPSummary = field(default_factory=MRPSummary)


def compute_tool_mrp(
    tool: ETool,
    ops: list[EOp],
    num_days: int,
    dates: list[str],
    dnames: list[str],
    twin_groups: list[TwinGroup] | None = None,
    order_based: bool = False,
) -> MRPRecord:
    """MRP netting for a single tool."""
    oee = tool.oee if tool.oee else DEFAULT_OEE
    pH = tool.pH
    lot = tool.lt if tool.lt and tool.lt > 0 else 0

    # Find twin pairs for this tool
    twin_map: dict[str, str] = {}
    if twin_groups:
        for tg in twin_groups:
            if tg.sku1 in [o.sku for o in ops] and tg.sku2 in [o.sku for o in ops]:
                twin_map[tg.sku1] = tg.sku2
                twin_map[tg.sku2] = tg.sku1

    # Build gross requirements (twin-aware: max, not sum)
    gross_req = [0] * num_days
    paired: set[str] = set()
    for op in ops:
        if op.sku in paired:
            continue
        twin_sku = twin_map.get(op.sku)
        twin_op = next((o for o in ops if o.sku == twin_sku), None) if twin_sku else None
        for d in range(min(len(op.d), num_days)):
            a = max(op.d[d], 0) if d < len(op.d) else 0
            b = max(twin_op.d[d], 0) if twin_op and d < len(twin_op.d) else 0
            gross_req[d] += max(a, b) if twin_op else a
        if twin_sku:
            paired.add(op.sku)
            paired.add(twin_sku)

    # Backlog: max for twins, sum for solo
    total_backlog = 0
    paired_bl: set[str] = set()
    for op in ops:
        if op.sku in paired_bl:
            continue
        twin_sku = twin_map.get(op.sku)
        twin_op = next((o for o in ops if o.sku == twin_sku), None) if twin_sku else None
        if twin_op:
            total_backlog += max(op.atr, twin_op.atr)
            paired_bl.add(op.sku)
            paired_bl.add(twin_sku)
        else:
            total_backlog += max(op.atr, 0)

    stock = tool.stk
    setup_min = int(tool.sH * 60)

    # Netting loop
    projected = stock - total_backlog
    buckets: list[MRPDayBucket] = []
    stockout_day: int | None = None
    total_planned = 0

    for d in range(num_days):
        gr = gross_req[d]
        projected -= gr
        net_req = 0
        por = 0  # planned order receipt
        porl = 0  # planned order release

        if projected < 0:
            net_req = abs(projected)
            if order_based or lot <= 0:
                por = net_req
            else:
                por = max(lot, math.ceil(net_req / lot) * lot) if lot > 0 else net_req
            projected += por
            total_planned += por

            # Lead time for release day
            if pH > 0:
                prod_min = (por / pH * 60) / oee
                lead_days = max(1, math.ceil((setup_min + prod_min) / DAY_CAP))
            else:
                lead_days = 1
            release_day = max(0, d - lead_days)
            porl = por

        if stockout_day is None and projected < 0:
            stockout_day = d

        dl = dates[d] if d < len(dates) else ""
        dn = dnames[d] if d < len(dnames) else ""
        buckets.append(
            MRPDayBucket(
                day_index=d,
                date_label=dl,
                day_name=dn,
                gross_requirement=gr,
                projected_available=projected,
                net_requirement=net_req,
                planned_order_receipt=por,
                planned_order_release=porl,
            )
        )

    # Coverage days
    coverage = 0.0
    cum_demand = 0
    net_stock = stock - total_backlog
    for d in range(num_days):
        gr = gross_req[d]
        if gr <= 0:
            continue
        cum_demand += gr
        if cum_demand <= net_stock:
            coverage = d + 1
        else:
            if cum_demand - gr < net_stock:
                frac = (net_stock - (cum_demand - gr)) / gr if gr > 0 else 0
                coverage = d + frac
            break

    # Per-SKU breakdown
    sku_records: list[MRPSkuRecord] = []
    for op in ops:
        op_stock = op.stk if op.stk is not None else 0
        op_wip = op.wip if op.wip is not None else 0
        sku_records.append(
            MRPSkuRecord(
                sku=op.sku,
                name=op.nm,
                op_id=op.id,
                tool_code=tool.id,
                machine=tool.m,
                alt_machine=tool.alt if tool.alt != "-" else "",
                customer=op.cl or "",
                twin=op.twin or "",
                stock=op_stock,
                wip=op_wip,
                backlog=max(op.atr, 0),
                coverage_days=coverage,
                stockout_day=stockout_day,
            )
        )

    return MRPRecord(
        tool_code=tool.id,
        skus=[op.sku for op in ops],
        machine=tool.m,
        alt_machine=tool.alt if tool.alt != "-" else "",
        stock=stock,
        backlog=total_backlog,
        lead_days=max(1, math.ceil((setup_min + (total_planned / pH * 60) / oee) / DAY_CAP))
        if pH > 0 and total_planned > 0
        else 0,
        stockout_day=stockout_day,
        coverage_days=coverage,
        buckets=buckets,
        sku_records=sku_records,
    )


def compute_mrp(
    engine: EngineData,
    capacity_overrides: dict[str, list[int]] | None = None,
) -> MRPResult:
    """Main MRP computation — runs netting for all tools, builds RCCP."""
    records: list[MRPRecord] = []
    rccp_map: dict[str, list[dict[str, int]]] = {}  # machine -> [{setup, prod}, ...]

    # Group ops by tool
    ops_by_tool: dict[str, list[EOp]] = {}
    for op in engine.ops:
        if op.t not in ops_by_tool:
            ops_by_tool[op.t] = []
        ops_by_tool[op.t].append(op)

    for tool_id, ops in ops_by_tool.items():
        tool = engine.tool_map.get(tool_id)
        if not tool:
            continue
        rec = compute_tool_mrp(
            tool,
            ops,
            engine.n_days,
            engine.dates,
            engine.dnames,
            twin_groups=engine.twin_groups,
            order_based=engine.order_based,
        )
        records.append(rec)

        # Accumulate RCCP on primary machine
        m_id = tool.m
        if m_id not in rccp_map:
            rccp_map[m_id] = [{"setup": 0, "prod": 0} for _ in range(engine.n_days)]

        oee = tool.oee if tool.oee else DEFAULT_OEE
        setup_min = int(tool.sH * 60)
        release_days_used: set[int] = set()
        for b in rec.buckets:
            if b.planned_order_release > 0 and tool.pH > 0:
                prod_min = int((b.planned_order_release / tool.pH * 60) / oee)
                d = b.day_index
                if d < engine.n_days:
                    rccp_map[m_id][d]["prod"] += prod_min
                    if d not in release_days_used:
                        rccp_map[m_id][d]["setup"] += setup_min
                        release_days_used.add(d)

    # Build RCCP entries
    rccp: list[RCCPEntry] = []
    machine_map = {m.id: m for m in engine.machines}
    for m_id, days in rccp_map.items():
        m = machine_map.get(m_id)
        for d, day in enumerate(days):
            avail = (
                capacity_overrides.get(m_id, [DAY_CAP] * engine.n_days)[d]
                if capacity_overrides
                else DAY_CAP
            )
            total = day["setup"] + day["prod"]
            util = total / avail if avail > 0 else 0
            rccp.append(
                RCCPEntry(
                    machine=m_id,
                    area=m.area if m else "",
                    day_index=d,
                    date_label=engine.dates[d] if d < len(engine.dates) else "",
                    available_min=avail,
                    required_setup_min=day["setup"],
                    required_prod_min=day["prod"],
                    required_total_min=total,
                    utilization=util,
                    overloaded=total > avail,
                )
            )

    # Summary
    summary = _compute_mrp_summary(records, rccp)

    return MRPResult(records=records, rccp=rccp, summary=summary)


def _compute_mrp_summary(records: list[MRPRecord], rccp: list[RCCPEntry]) -> MRPSummary:
    tools_backlog = sum(1 for r in records if r.backlog > 0)
    tools_stockout = sum(1 for r in records if r.stockout_day is not None)
    total_planned = sum(sum(b.planned_order_receipt for b in r.buckets) for r in records)
    total_gross = sum(sum(b.gross_requirement for b in r.buckets) for r in records)

    max_util = 0.0
    bn_machine = ""
    bn_day = 0
    total_util = 0.0
    for e in rccp:
        total_util += e.utilization
        if e.utilization > max_util:
            max_util = e.utilization
            bn_machine = e.machine
            bn_day = e.day_index

    return MRPSummary(
        tools_with_backlog=tools_backlog,
        tools_with_stockout=tools_stockout,
        total_planned_qty=total_planned,
        total_gross_req=total_gross,
        bottleneck_machine=bn_machine,
        bottleneck_day=bn_day,
        max_utilization=max_util,
        avg_utilization=total_util / len(rccp) if rccp else 0,
    )
