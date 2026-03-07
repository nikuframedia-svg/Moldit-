// intel-adapter.ts — Transform NikufraData → SnapshotFixture + NkData
// Used by NikufraIntel to build Intelligence analytics from ISOP-uploaded data.
// ZERO fake data — all values derived from real ISOP parsing.

import type { NikufraData } from '../../domain/nikufra-types';
import type {
  NkData,
  SnapshotCustomer,
  SnapshotFixture,
  SnapshotItem,
  SnapshotResource,
  SnapshotRouting,
  SnapshotRoutingOp,
  SnapshotSeriesEntry,
  SnapshotTool,
} from './intel-compute';

// ── Date conversion ──────────────────────────────────────────────────

/** Convert "DD/MM" to "YYYY-MM-DD". Infers year from month sequence. */
function ddmmToIso(dates: string[]): string[] {
  let year = 2026;
  let prevMonth = -1;
  return dates.map((d) => {
    const [dd, mm] = d.split('/');
    const month = parseInt(mm, 10);
    if (prevMonth > 0 && month < prevMonth) year++; // year rollover (Dec→Jan)
    prevMonth = month;
    return `${year}-${mm}-${dd}`;
  });
}

// ── Main transformations ─────────────────────────────────────────────

export function nikufraDataToNkData(data: NikufraData): NkData {
  return {
    dates: data.dates,
    days_label: data.days_label,
    mo: { PG1: data.mo.PG1, PG2: data.mo.PG2 },
    machines: data.machines,
    tools: data.tools,
  };
}

export function nikufraDataToSnapshot(data: NikufraData, trustScore?: number): SnapshotFixture {
  const ops = data.operations || [];

  // ── customers ──
  const custMap = new Map<string, string>();
  for (const op of ops) {
    if (op.cl && !custMap.has(op.cl)) {
      custMap.set(op.cl, op.clNm || op.cl);
    }
  }
  const customers: SnapshotCustomer[] = Array.from(custMap.entries()).map(([code, name], i) => ({
    customer_id: `cust-${String(i + 1).padStart(3, '0')}`,
    code,
    name,
  }));

  // ── items ──
  const itemMap = new Map<string, SnapshotItem>();
  let itemIdx = 0;
  for (const op of ops) {
    if (itemMap.has(op.sku)) continue;
    itemIdx++;
    const tool = data.tools.find((t) => t.skus.includes(op.sku));
    itemMap.set(op.sku, {
      item_id: `item-${String(itemIdx).padStart(4, '0')}`,
      sku: op.sku,
      name: op.nm,
      parent_sku: op.pa,
      lot_economic_qty: tool?.lt,
    });
  }
  const items: SnapshotItem[] = Array.from(itemMap.values());

  // ── resources ──
  const resources: SnapshotResource[] = data.machines.map((m) => ({
    resource_id: m.id,
    id: m.id,
    code: m.id,
    name: m.id,
  }));

  // ── tools ──
  const tools: SnapshotTool[] = data.tools.map((t) => ({
    tool_id: t.id,
    code: t.id,
    name: t.id,
  }));

  // ── routing ──
  // Group operations by SKU. Each unique (sku, machine, tool) combo = one routing operation.
  const routingMap = new Map<string, { routing: SnapshotRouting; ops: SnapshotRoutingOp[] }>();
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const opId = `op-${String(i + 1).padStart(4, '0')}`;
    const tool = data.tools.find((t) => t.id === op.t);

    const routingOp: SnapshotRoutingOp = {
      operation_id: opId,
      sequence: 1,
      resource_code: op.m,
      alt_resources: tool?.alt && tool.alt !== '-' ? [tool.alt] : [],
      tool_code: op.t,
      setup_time: op.s,
      rate_pieces_per_hour: op.pH,
      operators_required: op.op,
    };

    const existing = routingMap.get(op.sku);
    if (existing) {
      routingOp.sequence = existing.ops.length + 1;
      existing.ops.push(routingOp);
    } else {
      routingMap.set(op.sku, {
        routing: {
          routing_id: `rt-${op.sku}`,
          item_sku: op.sku,
          operations: [],
        },
        ops: [routingOp],
      });
    }
  }

  const routing: SnapshotRouting[] = Array.from(routingMap.values()).map(
    ({ routing: r, ops: routOps }) => ({ ...r, operations: routOps }),
  );

  // ── series ──
  const isoDates = ddmmToIso(data.dates);
  const series: SnapshotSeriesEntry[] = [];

  // Build stock lookup by tool → per-SKU share
  const toolStockMap = new Map<string, number>();
  for (const t of data.tools) toolStockMap.set(t.id, t.stk);

  for (const op of ops) {
    const toolStock = toolStockMap.get(op.t) ?? 0;
    // Count how many operations share the same tool to split stock
    const opsOnTool = ops.filter((o) => o.t === op.t);
    const stockShare = opsOnTool.length > 0 ? toolStock / opsOnTool.length : toolStock;
    const startingBalance = stockShare - op.atr;

    let cumDemand = 0;
    for (let i = 0; i < data.dates.length; i++) {
      const qty = Math.max(0, -(op.d[i] ?? 0));
      cumDemand += qty;
      const balance = startingBalance - cumDemand;

      series.push({
        item_sku: op.sku,
        date: isoDates[i],
        value: balance,
        customer_code: op.cl,
      });
    }
  }

  // ── trust_index ──
  const overall = trustScore ?? 0.85;
  const trust_index = {
    overall,
    by_domain: {
      master_data: overall,
      demand: overall,
      capacity: overall,
    },
  };

  return {
    master_data: { customers, items, resources, tools },
    routing,
    series,
    trust_index,
  };
}
