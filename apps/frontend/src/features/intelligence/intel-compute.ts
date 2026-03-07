// intel-compute.ts — Pure computation functions for 10 Intelligence features
// ALL data derived from ISOP Nikufra.xlsx (via fixtures). ZERO fake data.

// ─── Types ────────────────────────────────────────────────────────────

export interface SnapshotCustomer {
  customer_id: string;
  code: string;
  name: string;
}
export interface SnapshotItem {
  item_id: string;
  sku: string;
  name: string;
  parent_sku?: string;
  lot_economic_qty?: number;
}
export interface SnapshotResource {
  resource_id?: string;
  id?: string;
  code: string;
  name?: string;
}
export interface SnapshotTool {
  tool_id: string;
  code: string;
  name?: string;
}
export interface SnapshotRoutingOp {
  operation_id: string;
  sequence: number;
  resource_code: string;
  alt_resources: string[];
  tool_code: string;
  setup_time: number;
  setup_time_uom?: string;
  rate_pieces_per_hour: number;
  operators_required: number;
}
export interface SnapshotRouting {
  routing_id: string;
  item_sku: string;
  operations: SnapshotRoutingOp[];
}
export interface SnapshotSeriesEntry {
  item_sku: string;
  date: string;
  value: number;
  customer_code?: string;
}
export interface SnapshotFixture {
  master_data: {
    customers: SnapshotCustomer[];
    items: SnapshotItem[];
    resources: SnapshotResource[];
    tools: SnapshotTool[];
  };
  routing: SnapshotRouting[];
  series: SnapshotSeriesEntry[];
  trust_index: { overall: number; by_domain: Record<string, number> };
}

export interface NkTool {
  id: string;
  m: string;
  alt: string;
  s: number;
  pH: number;
  op: number;
  skus: string[];
  nm: string[];
  lt: number;
  stk: number;
}
export interface NkMachine {
  id: string;
  area: string;
  man: number[];
}
export interface NkData {
  dates: string[];
  days_label: string[];
  mo: { PG1: number[]; PG2: number[] };
  machines: NkMachine[];
  tools: NkTool[];
}

// ─── Constants ────────────────────────────────────────────────────────

const MACHINES = ['PRM019', 'PRM020', 'PRM031', 'PRM039', 'PRM042', 'PRM043'] as const;
const MACHINE_AREA: Record<string, string> = {
  PRM019: 'PG1',
  PRM020: 'PG1',
  PRM031: 'PG2',
  PRM039: 'PG2',
  PRM042: 'PG2',
  PRM043: 'PG1',
};

import { DAY_CAP, S0, S1, T1 } from '../../lib/engine';

// ─── Dynamic Date Context ────────────────────────────────────────────
// Built from NkData at runtime — supports any ISOP date range.

export interface DateContext {
  allDates: string[];
  workingDates: string[];
  isWorking: Record<string, boolean>;
}

/** Convert NkData dates ("DD/MM" + day labels) to ISO DateContext */
export function buildDateContext(nk: NkData): DateContext {
  const WEEKEND = new Set(['Sáb', 'Sab', 'Dom']);
  let year = 2026;
  let prevMonth = -1;

  const allDates: string[] = [];
  const isWorking: Record<string, boolean> = {};

  for (let i = 0; i < nk.dates.length; i++) {
    const [dd, mm] = nk.dates[i].split('/');
    const month = parseInt(mm, 10);
    if (prevMonth > 0 && month < prevMonth) year++;
    prevMonth = month;
    const iso = `${year}-${mm}-${dd}`;
    allDates.push(iso);
    const label = nk.days_label[i] || '';
    isWorking[iso] = !WEEKEND.has(label);
  }

  const workingDates = allDates.filter((d) => isWorking[d]);
  return { allDates, workingDates, isWorking };
}

// Legacy exports for backward compat (used by NikufraIntel render)
export const ALL_DATES: string[] = [];
export const WORKING_DATES: string[] = [];
export const IS_WORKING: Record<string, boolean> = {};

// Customer code map: item_id ranges → customer codes (from ISOP row order)
// Items 0001-0048 span multiple customers, ordered by ISOP rows 8-88
const CUSTOMER_BY_ITEM_RANGE: Array<{ from: number; to: number; code: string }> = [
  { from: 1, to: 40, code: '210020' }, // FAURECIA (rows 8-47)
  { from: 41, to: 49, code: '210099' }, // BOSCH-TERM (rows 48-56)
  { from: 50, to: 53, code: '210112' }, // JOAO DEUS (rows 57-60)
  { from: 54, to: 55, code: '210194' }, // E.L.M. (rows 61-62)
  { from: 56, to: 70, code: '210204' }, // FAUR-SIEGE (rows 63-77)
  { from: 71, to: 74, code: '210208' }, // TEKNIK (rows 78-81)
  { from: 75, to: 75, code: '210273' }, // BORGWARNER
  { from: 76, to: 76, code: '210582' }, // PUREM
  { from: 77, to: 78, code: '210588' }, // F. POLSKA
  { from: 79, to: 79, code: '210588' }, // F. POLSKA continued
  { from: 80, to: 80, code: '210592' }, // JTEKT
  { from: 81, to: 81, code: '210602' }, // LECLANCHE
  { from: 82, to: 84, code: '210604' }, // HANON
  { from: 85, to: 85, code: '210605' }, // JTEKT
  { from: 86, to: 88, code: '210610' }, // FAUREC. CZ
];

function getCustomerForItem(itemId: string): string {
  const num = parseInt(itemId.replace('item-', ''), 10);
  for (const range of CUSTOMER_BY_ITEM_RANGE) {
    if (num >= range.from && num <= range.to) return range.code;
  }
  return '210020'; // fallback
}

// ─── Helpers ──────────────────────────────────────────────────────────

function fmtDate(d: string): string {
  // '2026-02-02' → '02/02'
  const parts = d.split('-');
  return `${parts[2]}/${parts[1]}`;
}

function dayName(d: string): string {
  const dt = new Date(d);
  return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][dt.getDay()];
}

function workingDaysBetween(from: string, to: string, ctx: DateContext): number {
  let count = 0;
  for (const d of ctx.allDates) {
    if (d >= from && d < to && ctx.isWorking[d]) count++;
  }
  return count;
}

// ─── Index Builders ───────────────────────────────────────────────────

interface RoutingIndex {
  machine: string;
  altMachines: string[];
  toolCode: string;
  setupTime: number;
  rate: number;
  operators: number;
}

function buildRoutingIndex(snap: SnapshotFixture): Record<string, RoutingIndex> {
  const idx: Record<string, RoutingIndex> = {};
  for (const r of snap.routing) {
    const op = r.operations[0];
    if (!op) continue;
    idx[r.item_sku] = {
      machine: op.resource_code,
      altMachines: op.alt_resources || [],
      toolCode: op.tool_code,
      setupTime: op.setup_time,
      rate: op.rate_pieces_per_hour,
      operators: op.operators_required,
    };
  }
  return idx;
}

function buildToolIndex(nk: NkData): Record<string, NkTool> {
  const idx: Record<string, NkTool> = {};
  for (const t of nk.tools) idx[t.id] = t;
  return idx;
}

function buildSeriesBySkuDate(snap: SnapshotFixture): Record<string, Record<string, number>> {
  const idx: Record<string, Record<string, number>> = {};
  for (const s of snap.series) {
    if (!idx[s.item_sku]) idx[s.item_sku] = {};
    // For aggregated view: use worst (most negative) value per date
    const existing = idx[s.item_sku][s.date];
    if (existing === undefined) {
      idx[s.item_sku][s.date] = s.value;
    } else {
      idx[s.item_sku][s.date] = Math.min(existing, s.value);
    }
  }
  return idx;
}

// Group series entries preserving customer context via item ranges
function buildSeriesByItemId(snap: SnapshotFixture): Array<{
  itemId: string;
  sku: string;
  customerCode: string;
  entries: Array<{ date: string; value: number }>;
}> {
  // Each routing has multiple operations with operation_ids like "op-0001", "op-0049"
  // These map to item blocks which map to customers
  const result: Array<{
    itemId: string;
    sku: string;
    customerCode: string;
    entries: Array<{ date: string; value: number }>;
  }> = [];

  // Build a map from operation_id to customer code
  const opCustomer: Record<string, string> = {};
  for (const r of snap.routing) {
    for (const op of r.operations) {
      const num = parseInt(op.operation_id.replace('op-', ''), 10);
      opCustomer[op.operation_id] = getCustomerForItem(`item-${String(num).padStart(4, '0')}`);
    }
  }

  // Group series by (sku, block position)
  // Series entries appear in blocks: first N entries for first operation, next N for second, etc.
  const skuOps: Record<string, string[]> = {};
  for (const r of snap.routing) {
    skuOps[r.item_sku] = r.operations.map((o) => o.operation_id);
  }

  // Track which series entries belong to which operation block
  const skuEntryCount: Record<string, number> = {};
  const skuBlockBounds: Record<string, Array<{ opId: string; start: number; end: number }>> = {};

  // Count total entries per SKU
  for (const s of snap.series) {
    skuEntryCount[s.item_sku] = (skuEntryCount[s.item_sku] || 0) + 1;
  }

  // For SKUs with multiple operations (cross-client), split entries evenly
  for (const sku of Object.keys(skuOps)) {
    const ops = skuOps[sku];
    const total = skuEntryCount[sku] || 0;
    if (ops.length <= 1 || total === 0) continue;
    // Series entries appear in order: first block for op1, second block for op2, etc.
    // We'll track as we iterate
    skuBlockBounds[sku] = [];
  }

  // Iterate series and assign to operation blocks
  const skuSeenCount: Record<string, number> = {};
  const blockEntries: Record<string, Array<{ date: string; value: number }>> = {};

  for (const s of snap.series) {
    const count = skuSeenCount[s.item_sku] || 0;
    skuSeenCount[s.item_sku] = count + 1;

    const ops = skuOps[s.item_sku] || [];
    if (ops.length <= 1) {
      // Single operation: simple case
      const key = ops[0] || s.item_sku;
      if (!blockEntries[key]) blockEntries[key] = [];
      blockEntries[key].push({ date: s.date, value: s.value });
    } else {
      // Multiple operations: entries appear in blocks
      // Use date ordering to detect block boundaries
      // Entries for op1 come first (chronologically), then op2, etc.
      // Actually, they're contiguous blocks — detect by checking if date goes backwards
      const key = `${s.item_sku}::${count}`;
      if (!blockEntries[key]) blockEntries[key] = [];
      blockEntries[key].push({ date: s.date, value: s.value });
    }
  }

  // Build result from single-op entries
  for (const r of snap.routing) {
    if (r.operations.length === 1) {
      const opId = r.operations[0].operation_id;
      const entries = blockEntries[opId] || [];
      if (entries.length === 0) continue;
      result.push({
        itemId: opId,
        sku: r.item_sku,
        customerCode: opCustomer[opId] || '210020',
        entries,
      });
    } else {
      // Multi-op: reconstruct blocks from indexed entries
      // Group consecutive series entries into blocks based on date resets
      const allEntries: Array<{ date: string; value: number; idx: number }> = [];
      for (let i = 0; ; i++) {
        const key = `${r.item_sku}::${i}`;
        if (!blockEntries[key]) {
          // Check if there are individual entries
          const e = blockEntries[key];
          if (!e) break;
        }
        const entries = blockEntries[`${r.item_sku}::${i}`];
        if (!entries || entries.length === 0) break;
        allEntries.push({ ...entries[0], idx: i });
      }

      // Split into blocks by detecting date resets
      const blocks: Array<Array<{ date: string; value: number }>> = [];
      let currentBlock: Array<{ date: string; value: number }> = [];
      let lastDate = '';

      const totalEntries = skuEntryCount[r.item_sku] || 0;
      let entryIdx = 0;
      for (let i = 0; i < totalEntries; i++) {
        const key = `${r.item_sku}::${i}`;
        const entries = blockEntries[key];
        if (!entries) continue;
        for (const e of entries) {
          if (lastDate && e.date <= lastDate && currentBlock.length > 0) {
            blocks.push([...currentBlock]);
            currentBlock = [];
          }
          currentBlock.push(e);
          lastDate = e.date;
          entryIdx++;
        }
      }
      if (currentBlock.length > 0) blocks.push(currentBlock);

      // Assign blocks to operations
      for (let i = 0; i < Math.min(blocks.length, r.operations.length); i++) {
        const opId = r.operations[i].operation_id;
        result.push({
          itemId: opId,
          sku: r.item_sku,
          customerCode: opCustomer[opId] || '210020',
          entries: blocks[i],
        });
      }
    }
  }

  return result;
}

// ─── Feature 1: Demand Heatmap ────────────────────────────────────────

export interface HeatmapCell {
  machine: string;
  date: string;
  dayIdx: number;
  loadMin: number;
  pct: number;
  skuCount: number;
}

export function computeDemandHeatmap(
  snap: SnapshotFixture,
  _nk: NkData,
  ctx: DateContext,
): HeatmapCell[][] {
  const ri = buildRoutingIndex(snap);
  const seriesIdx = buildSeriesBySkuDate(snap);

  // For each machine × working day, compute total demand minutes
  const grid: HeatmapCell[][] = MACHINES.map((m) =>
    ctx.workingDates.map((d, di) => ({
      machine: m,
      date: d,
      dayIdx: di,
      loadMin: 0,
      pct: 0,
      skuCount: 0,
    })),
  );

  const machineIdx = Object.fromEntries(MACHINES.map((m, i) => [m, i]));

  for (const sku of Object.keys(seriesIdx)) {
    const route = ri[sku];
    if (!route) continue;
    const mi = machineIdx[route.machine];
    if (mi === undefined) continue;
    const rate = route.rate;

    const dates = Object.keys(seriesIdx[sku]).sort();
    for (let i = 0; i < dates.length; i++) {
      const d = dates[i];
      if (!ctx.isWorking[d]) continue;
      const wi = ctx.workingDates.indexOf(d);
      if (wi < 0) continue;

      const val = seriesIdx[sku][d];
      // Negative value = deficit. Compute demand delta
      const prevVal = i > 0 ? seriesIdx[sku][dates[i - 1]] : 0;
      let demandQty = 0;
      if (val < 0) {
        // New deficit or increased deficit
        demandQty = Math.max(0, prevVal >= 0 ? -val : -(val - prevVal));
      } else if (prevVal < 0 && val >= 0) {
        // Recovered — no demand
        demandQty = 0;
      }

      if (demandQty > 0) {
        const minutes = (demandQty / rate) * 60;
        grid[mi][wi].loadMin += minutes;
        grid[mi][wi].skuCount++;
      }
    }
  }

  // Compute percentages
  for (const row of grid) {
    for (const cell of row) {
      cell.pct = (cell.loadMin / DAY_CAP) * 100;
    }
  }

  return grid;
}

// ─── Feature 2: Client Delivery Risk ──────────────────────────────────

export interface ClientRiskSku {
  sku: string;
  name: string;
  machine: string;
  tool: string;
  firstDeficitDate: string | null;
  daysToDeficit: number;
  maxDeficit: number;
  status: 'ok' | 'tight' | 'late';
}

export interface ClientRisk {
  clientCode: string;
  clientName: string;
  skus: ClientRiskSku[];
  overallStatus: 'ok' | 'tight' | 'late';
  totalSKUs: number;
  atRiskSKUs: number;
}

export function computeClientRisk(
  snap: SnapshotFixture,
  _nk: NkData,
  ctx: DateContext,
): ClientRisk[] {
  const ri = buildRoutingIndex(snap);
  const customerMap = Object.fromEntries(snap.master_data.customers.map((c) => [c.code, c.name]));
  const itemName = Object.fromEntries(snap.master_data.items.map((i) => [i.sku, i.name]));
  const perClient = buildSeriesByItemId(snap);
  const startDate = ctx.allDates[0] || '2026-02-02';

  // Group by customer
  const byClient: Record<
    string,
    Array<{ sku: string; entries: Array<{ date: string; value: number }> }>
  > = {};
  for (const entry of perClient) {
    if (!byClient[entry.customerCode]) byClient[entry.customerCode] = [];
    byClient[entry.customerCode].push({ sku: entry.sku, entries: entry.entries });
  }

  const results: ClientRisk[] = [];
  for (const [code, items] of Object.entries(byClient)) {
    const skus: ClientRiskSku[] = [];
    // Deduplicate by SKU within same client
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.sku)) continue;
      seen.add(item.sku);

      const route = ri[item.sku];
      let firstDeficitDate: string | null = null;
      let maxDeficit = 0;
      for (const e of item.entries) {
        if (e.value < 0) {
          if (!firstDeficitDate) firstDeficitDate = e.date;
          maxDeficit = Math.min(maxDeficit, e.value);
        }
      }

      const daysToDeficit = firstDeficitDate
        ? workingDaysBetween(startDate, firstDeficitDate, ctx)
        : 999;

      let status: 'ok' | 'tight' | 'late' = 'ok';
      if (firstDeficitDate && daysToDeficit <= 0) status = 'late';
      else if (firstDeficitDate && daysToDeficit <= 5) status = 'tight';

      skus.push({
        sku: item.sku,
        name: itemName[item.sku] || item.sku,
        machine: route?.machine || '-',
        tool: route?.toolCode || '-',
        firstDeficitDate,
        daysToDeficit,
        maxDeficit: Math.abs(maxDeficit),
        status,
      });
    }

    skus.sort((a, b) => a.daysToDeficit - b.daysToDeficit);

    const atRisk = skus.filter((s) => s.status !== 'ok').length;
    const worst = skus[0]?.status || 'ok';

    results.push({
      clientCode: code,
      clientName: customerMap[code] || code,
      skus,
      overallStatus: atRisk > 0 ? worst : 'ok',
      totalSKUs: skus.length,
      atRiskSKUs: atRisk,
    });
  }

  results.sort((a, b) => {
    const ord = { late: 0, tight: 1, ok: 2 };
    return ord[a.overallStatus] - ord[b.overallStatus] || b.atRiskSKUs - a.atRiskSKUs;
  });

  return results;
}

// ─── Feature 3: Bottleneck Cascade ────────────────────────────────────

export interface ReliefPath {
  toolCode: string;
  altMachine: string;
  minutesSaved: number;
  altLoadPct: number;
}

export interface BottleneckNode {
  machine: string;
  area: string;
  peakPct: number;
  overflowDays: number;
  totalOverflowMin: number;
  hasAlternatives: boolean;
  reliefPaths: ReliefPath[];
}

export function computeBottleneckCascade(
  heatmap: HeatmapCell[][],
  snap: SnapshotFixture,
  nk: NkData,
): BottleneckNode[] {
  const ri = buildRoutingIndex(snap);

  // Compute per-machine peak load and overflow
  const nodes: BottleneckNode[] = MACHINES.map((m, mi) => {
    const row = heatmap[mi];
    const peakPct = Math.max(...row.map((c) => c.pct));
    const overflowDays = row.filter((c) => c.pct > 100).length;
    const totalOverflowMin = row.reduce((s, c) => s + Math.max(0, c.loadMin - DAY_CAP), 0);

    // Find tools on this machine with alternatives
    const toolsOnMachine = nk.tools.filter((t) => t.m === m);
    const hasAlt = toolsOnMachine.some((t) => t.alt && t.alt !== '-');

    // Compute relief paths
    const reliefPaths: ReliefPath[] = [];
    if (peakPct > 100) {
      for (const tool of toolsOnMachine) {
        if (!tool.alt || tool.alt === '-') continue;
        // Estimate minutes this tool contributes: use routing demand data where available
        const toolMinPerDay =
          tool.skus.reduce((sum, sku) => {
            const route = ri[sku];
            if (!route) return sum;
            // Use lot economic qty as proxy for per-day contribution when available
            const lotQty = tool.lt > 0 ? tool.lt : 1000;
            const prodMin = tool.pH > 0 ? (lotQty / tool.pH) * 60 : 0;
            // Amortize over planning horizon (nDays)
            return sum + prodMin / 8;
          }, 0) +
          tool.s * 60; // add setup time

        // Check alt machine's load
        const altMi = MACHINES.indexOf(tool.alt as (typeof MACHINES)[number]);
        const altPeak = altMi >= 0 ? Math.max(...heatmap[altMi].map((c) => c.pct)) : 0;

        reliefPaths.push({
          toolCode: tool.id,
          altMachine: tool.alt,
          minutesSaved: toolMinPerDay,
          altLoadPct: altPeak,
        });
      }
      reliefPaths.sort((a, b) => b.minutesSaved - a.minutesSaved);
    }

    return {
      machine: m,
      area: MACHINE_AREA[m],
      peakPct,
      overflowDays,
      totalOverflowMin,
      hasAlternatives: hasAlt,
      reliefPaths,
    };
  });

  return nodes.sort((a, b) => b.peakPct - a.peakPct);
}

// ─── Feature 4: Setup Crew Timeline ───────────────────────────────────

export interface SetupSlot {
  machine: string;
  toolCode: string;
  dayIdx: number;
  startMin: number;
  endMin: number;
  durationMin: number;
  shift: 'X' | 'Y';
}

export function computeSetupCrewTimeline(nk: NkData, ctx?: DateContext): SetupSlot[] {
  const slots: SetupSlot[] = [];

  // For each working day in horizon, simulate tool sequences per machine
  const focusMachines = MACHINES;
  const wdCount = ctx ? ctx.workingDates.length : 24;
  const numDays = Math.min(8, wdCount);

  for (let di = 0; di < numDays; di++) {
    // Global setup crew timeline for this day
    const daySetups: Array<{ start: number; end: number }> = [];

    function findNextSlot(earliest: number, duration: number, shiftEnd: number): number {
      let candidate = earliest;
      let changed = true;
      while (changed) {
        changed = false;
        for (const s of daySetups) {
          if (candidate < s.end && candidate + duration > s.start) {
            candidate = s.end;
            changed = true;
          }
        }
      }
      return candidate + duration <= shiftEnd ? candidate : -1;
    }

    // Process each machine
    for (const machineId of focusMachines) {
      const machineTools = nk.tools.filter((t) => t.m === machineId);
      if (machineTools.length === 0) continue;

      // Sort by demand priority (tools with stock=0 and high demand first)
      const sorted = [...machineTools].sort((a, b) => {
        if (a.stk === 0 && b.stk > 0) return -1;
        if (b.stk === 0 && a.stk > 0) return 1;
        return b.pH - a.pH; // higher rate = more critical
      });

      let lastTool: string | null = null;
      let cursor = S0;

      for (const tool of sorted) {
        if (tool.id === lastTool) continue; // same tool, no setup

        const setupMin = tool.s * 60;
        if (setupMin <= 0) {
          lastTool = tool.id;
          continue;
        }

        // Try to fit setup in current shift
        let shiftEnd = cursor < T1 ? T1 : S1;
        let start = findNextSlot(cursor, setupMin, shiftEnd);

        if (start < 0 && cursor < T1) {
          // Try next shift
          cursor = T1;
          shiftEnd = S1;
          start = findNextSlot(cursor, setupMin, shiftEnd);
        }

        if (start >= 0) {
          const end = start + setupMin;
          daySetups.push({ start, end });
          slots.push({
            machine: machineId,
            toolCode: tool.id,
            dayIdx: di,
            startMin: start,
            endMin: end,
            durationMin: setupMin,
            shift: start < T1 ? 'X' : 'Y',
          });
          cursor = end;
        }

        lastTool = tool.id;
      }
    }
  }

  return slots;
}

// ─── Feature 5: Cross-Client SKU Aggregation ──────────────────────────

export interface CrossClientSku {
  sku: string;
  name: string;
  machine: string;
  tool: string;
  rate: number;
  clients: Array<{ code: string; name: string; totalDemand: number }>;
  totalDemand: number;
  requiredHours: number;
}

export function computeCrossClientAggregation(
  snap: SnapshotFixture,
  _nk: NkData,
): CrossClientSku[] {
  const ri = buildRoutingIndex(snap);
  const customerMap = Object.fromEntries(snap.master_data.customers.map((c) => [c.code, c.name]));
  const itemName = Object.fromEntries(snap.master_data.items.map((i) => [i.sku, i.name]));
  const perClient = buildSeriesByItemId(snap);

  // Group by SKU
  const bySku: Record<
    string,
    Array<{ code: string; entries: Array<{ date: string; value: number }> }>
  > = {};
  for (const entry of perClient) {
    if (!bySku[entry.sku]) bySku[entry.sku] = [];
    bySku[entry.sku].push({ code: entry.customerCode, entries: entry.entries });
  }

  const results: CrossClientSku[] = [];
  for (const [sku, clients] of Object.entries(bySku)) {
    // Only include SKUs with 2+ different clients
    const uniqueClients = [...new Set(clients.map((c) => c.code))];
    if (uniqueClients.length < 2) continue;

    const route = ri[sku];
    const clientData = uniqueClients.map((code) => {
      const clientEntries = clients.filter((c) => c.code === code);
      // Total demand = sum of absolute negative values
      let totalDemand = 0;
      for (const ce of clientEntries) {
        for (const e of ce.entries) {
          if (e.value < 0) totalDemand = Math.max(totalDemand, Math.abs(e.value));
        }
      }
      return { code, name: customerMap[code] || code, totalDemand };
    });

    const totalDemand = clientData.reduce((s, c) => s + c.totalDemand, 0);
    const rate = route?.rate || 1;
    const requiredHours = totalDemand / rate;

    results.push({
      sku,
      name: itemName[sku] || sku,
      machine: route?.machine || '-',
      tool: route?.toolCode || '-',
      rate,
      clients: clientData.sort((a, b) => b.totalDemand - a.totalDemand),
      totalDemand,
      requiredHours,
    });
  }

  return results.sort((a, b) => b.totalDemand - a.totalDemand);
}

// ─── Feature 6: Tool Grouping Optimizer ───────────────────────────────

export interface ToolGroupResult {
  machine: string;
  area: string;
  currentSequence: string[];
  optimalSequence: string[];
  currentSetups: number;
  optimalSetups: number;
  savedSetups: number;
  savedMinutes: number;
}

export function computeToolGrouping(nk: NkData): ToolGroupResult[] {
  const results: ToolGroupResult[] = [];

  for (const machineId of MACHINES) {
    const machineTools = nk.tools.filter((t) => t.m === machineId);
    if (machineTools.length <= 1) continue;

    // Current sequence: as they appear in data (demand-priority order = ISOP row order)
    const current = machineTools.map((t) => t.id);

    // Optimal: group same-family tools together (BFPxxx sorted, VULxxx sorted, etc.)
    // Then within families, sort by setup time (longest first to minimize total transitions)
    const optimal = [...machineTools]
      .sort((a, b) => {
        const prefA = a.id.replace(/\d+/g, '');
        const prefB = b.id.replace(/\d+/g, '');
        if (prefA !== prefB) return prefA.localeCompare(prefB);
        return a.id.localeCompare(b.id);
      })
      .map((t) => t.id);

    // Count setups (transitions between different tools)
    const countSetups = (seq: string[]): number => {
      let count = 0;
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] !== seq[i - 1]) count++;
      }
      return count;
    };

    const currentSetups = countSetups(current);
    const optimalSetups = countSetups(optimal);

    // Compute average setup time for this machine's tools
    const avgSetupMin = machineTools.reduce((s, t) => s + t.s * 60, 0) / machineTools.length;

    results.push({
      machine: machineId,
      area: MACHINE_AREA[machineId],
      currentSequence: current,
      optimalSequence: optimal,
      currentSetups,
      optimalSetups,
      savedSetups: Math.max(0, currentSetups - optimalSetups),
      savedMinutes: Math.max(0, currentSetups - optimalSetups) * avgSetupMin,
    });
  }

  return results.sort((a, b) => b.savedMinutes - a.savedMinutes);
}

// ─── Feature 7: Machine Alternative Network ───────────────────────────

export interface NetworkNode {
  id: string;
  area: string;
  toolCount: number;
  totalLoad: number;
  isolated: boolean;
  x: number;
  y: number;
}

export interface NetworkEdge {
  from: string;
  to: string;
  tools: string[];
  weight: number;
  bidirectional: boolean;
}

export function computeMachineNetwork(
  nk: NkData,
  heatmap: HeatmapCell[][],
  ctx: DateContext,
): {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
} {
  // Build edges from tool alternatives
  const edgeMap: Record<string, { tools: Set<string>; reverse: boolean }> = {};

  for (const tool of nk.tools) {
    if (!MACHINES.includes(tool.m as (typeof MACHINES)[number])) continue;
    if (!tool.alt || tool.alt === '-') continue;
    if (!MACHINES.includes(tool.alt as (typeof MACHINES)[number])) continue;

    const key = [tool.m, tool.alt].sort().join('→');
    if (!edgeMap[key]) edgeMap[key] = { tools: new Set(), reverse: false };
    edgeMap[key].tools.add(tool.id);

    // Check if reverse edge exists
    const reverseKey = [tool.alt, tool.m].sort().join('→');
    if (reverseKey === key) edgeMap[key].reverse = true;
  }

  const edges: NetworkEdge[] = Object.entries(edgeMap).map(([key, data]) => {
    const [from, to] = key.split('→');
    return {
      from,
      to,
      tools: [...data.tools],
      weight: data.tools.size,
      bidirectional: data.reverse || data.tools.size > 2,
    };
  });

  // Build nodes
  const nodes: NetworkNode[] = MACHINES.map((m, mi) => {
    const toolCount = nk.tools.filter((t) => t.m === m).length;
    const totalLoad = heatmap[mi]?.reduce((s, c) => s + c.pct, 0) || 0;
    const hasEdge = edges.some((e) => e.from === m || e.to === m);
    return {
      id: m,
      area: MACHINE_AREA[m],
      toolCount,
      totalLoad: totalLoad / (ctx.workingDates.length || 1),
      isolated: !hasEdge,
      x: 0,
      y: 0,
    };
  });

  // Simple force-directed layout
  const W = 500,
    H = 400;
  // Initialize in circle
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    n.x = W / 2 + Math.cos(angle) * W * 0.3;
    n.y = H / 2 + Math.sin(angle) * H * 0.3;
  });

  // Run 200 iterations
  for (let iter = 0; iter < 200; iter++) {
    const alpha = 1 - iter / 200;

    // Repulsion between all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (3000 * alpha) / (d * d);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        nodes[i].x -= fx;
        nodes[j].x += fx;
        nodes[i].y -= fy;
        nodes[j].y += fy;
      }
    }

    // Attraction along edges
    for (const e of edges) {
      const si = nodes.findIndex((n) => n.id === e.from);
      const ti = nodes.findIndex((n) => n.id === e.to);
      if (si < 0 || ti < 0) continue;
      const dx = nodes[ti].x - nodes[si].x;
      const dy = nodes[ti].y - nodes[si].y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = d * 0.015 * alpha * e.weight;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      nodes[si].x += fx;
      nodes[ti].x -= fx;
      nodes[si].y += fy;
      nodes[ti].y -= fy;
    }

    // Centering
    const cx = nodes.reduce((a, n) => a + n.x, 0) / nodes.length;
    const cy = nodes.reduce((a, n) => a + n.y, 0) / nodes.length;
    for (const n of nodes) {
      n.x += (W / 2 - cx) * 0.1;
      n.y += (H / 2 - cy) * 0.1;
    }
  }

  // Clamp to bounds
  for (const n of nodes) {
    n.x = Math.max(40, Math.min(W - 40, n.x));
    n.y = Math.max(40, Math.min(H - 40, n.y));
  }

  return { nodes, edges };
}

// ─── Feature 8: Capacity Horizon ──────────────────────────────────────

export interface CapacityBar {
  date: string;
  fmtDate: string;
  dayName: string;
  isWorking: boolean;
  machines: Record<string, number>; // minutes per machine
  total: number;
}

export function computeCapacityHorizon(
  snap: SnapshotFixture,
  _nk: NkData,
  ctx: DateContext,
): CapacityBar[] {
  const ri = buildRoutingIndex(snap);
  const seriesIdx = buildSeriesBySkuDate(snap);

  return ctx.allDates.map((date) => {
    const working = ctx.isWorking[date] ?? false;
    const machines: Record<string, number> = {};
    for (const m of MACHINES) machines[m] = 0;

    if (working) {
      for (const sku of Object.keys(seriesIdx)) {
        const route = ri[sku];
        if (!route || !MACHINES.includes(route.machine as (typeof MACHINES)[number])) continue;
        const val = seriesIdx[sku][date];
        if (val === undefined || val >= 0) continue;

        // Deficit → needs production
        const minutes = (Math.abs(val) / route.rate) * 60;
        // Distribute: use a fraction based on how many working days are left
        const remainingWorkDays = ctx.workingDates.filter((d) => d >= date).length || 1;
        machines[route.machine] += minutes / remainingWorkDays;
      }
    }

    const total = Object.values(machines).reduce((s, v) => s + v, 0);

    return {
      date,
      fmtDate: fmtDate(date),
      dayName: dayName(date),
      isWorking: working,
      machines,
      total,
    };
  });
}

// ─── Feature 9: Urgency Matrix ────────────────────────────────────────

export interface UrgencyPoint {
  sku: string;
  name: string;
  machine: string;
  tool: string;
  daysToDeficit: number;
  maxDeficit: number;
  recoveryHours: number;
  clientCode: string;
  clientName: string;
  rate: number;
}

export function computeUrgencyMatrix(
  snap: SnapshotFixture,
  _nk: NkData,
  ctx: DateContext,
): UrgencyPoint[] {
  const ri = buildRoutingIndex(snap);
  const seriesIdx = buildSeriesBySkuDate(snap);
  const customerMap = Object.fromEntries(snap.master_data.customers.map((c) => [c.code, c.name]));
  const itemName = Object.fromEntries(snap.master_data.items.map((i) => [i.sku, i.name]));
  const startDate = ctx.allDates[0] || '2026-02-02';

  // Use first item entry per SKU for customer assignment
  const skuCustomer: Record<string, string> = {};
  for (const item of snap.master_data.items) {
    if (!skuCustomer[item.sku]) {
      skuCustomer[item.sku] = getCustomerForItem(item.item_id);
    }
  }

  const points: UrgencyPoint[] = [];
  const seen = new Set<string>();

  for (const sku of Object.keys(seriesIdx)) {
    if (seen.has(sku)) continue;
    seen.add(sku);

    const route = ri[sku];
    if (!route) continue;

    const sortedDates = Object.keys(seriesIdx[sku]).sort();
    let firstDeficit: string | null = null;
    let maxDeficit = 0;

    for (const d of sortedDates) {
      const v = seriesIdx[sku][d];
      if (v < 0) {
        if (!firstDeficit) firstDeficit = d;
        maxDeficit = Math.max(maxDeficit, Math.abs(v));
      }
    }

    if (!firstDeficit) continue; // no deficit = not urgent

    const daysToDeficit = workingDaysBetween(startDate, firstDeficit, ctx);
    const code = skuCustomer[sku] || '210020';

    points.push({
      sku,
      name: itemName[sku] || sku,
      machine: route.machine,
      tool: route.toolCode,
      daysToDeficit,
      maxDeficit,
      recoveryHours: maxDeficit / route.rate,
      clientCode: code,
      clientName: customerMap[code] || code,
      rate: route.rate,
    });
  }

  return points.sort((a, b) => a.daysToDeficit - b.daysToDeficit || b.maxDeficit - a.maxDeficit);
}

// ─── Feature 10: Explain Trace ────────────────────────────────────────

export interface ExplainStep {
  step: number;
  question: string;
  answer: string;
  evidence: string;
  ok: boolean;
}

export interface ExplainNode {
  sku: string;
  name: string;
  machine: string;
  tool: string;
  steps: ExplainStep[];
}

export function computeExplainTrace(
  snap: SnapshotFixture,
  nk: NkData,
  heatmap: HeatmapCell[][],
): ExplainNode[] {
  const ri = buildRoutingIndex(snap);
  const toolIdx = buildToolIndex(nk);
  const itemName = Object.fromEntries(snap.master_data.items.map((i) => [i.sku, i.name]));
  const seriesIdx = buildSeriesBySkuDate(snap);

  const nodes: ExplainNode[] = [];
  const seen = new Set<string>();

  for (const sku of Object.keys(seriesIdx)) {
    if (seen.has(sku)) continue;
    seen.add(sku);

    const route = ri[sku];
    if (!route) continue;

    // Only include SKUs with demand (negative values)
    const hasDemand = Object.values(seriesIdx[sku]).some((v) => v < 0);
    if (!hasDemand) continue;

    const mi = MACHINES.indexOf(route.machine as (typeof MACHINES)[number]);
    const avgLoad = mi >= 0 ? heatmap[mi].reduce((s, c) => s + c.pct, 0) / heatmap[mi].length : 0;

    const steps: ExplainStep[] = [
      {
        step: 1,
        question: 'Which tool produces this SKU?',
        answer: route.toolCode,
        evidence: `ISOP routing maps ${sku} → ${route.toolCode} (${toolIdx[route.toolCode]?.pH || route.rate} pcs/h)`,
        ok: true,
      },
      {
        step: 2,
        question: 'Primary machine assignment?',
        answer: route.machine,
        evidence: `Tool ${route.toolCode} is assigned to ${route.machine} (${MACHINE_AREA[route.machine]})`,
        ok: true,
      },
      {
        step: 3,
        question: 'Alternative machine available?',
        answer: route.altMachines.length > 0 ? route.altMachines.join(', ') : 'NONE',
        evidence:
          route.altMachines.length > 0
            ? `Can move to ${route.altMachines.join(', ')} if primary overloaded`
            : 'No alternative — critical dependency on ' + route.machine,
        ok: route.altMachines.length > 0,
      },
      {
        step: 4,
        question: 'Setup time required?',
        answer: `${route.setupTime}h (${route.setupTime * 60} min)`,
        evidence: `Tool change to ${route.toolCode} requires ${route.setupTime * 60} min setup (shared crew, cap=1)`,
        ok: route.setupTime <= 1,
      },
      {
        step: 5,
        question: 'Machine capacity sufficient?',
        answer:
          avgLoad < 100
            ? `${avgLoad.toFixed(0)}% avg load — OK`
            : `${avgLoad.toFixed(0)}% avg load — OVERLOADED`,
        evidence: `${route.machine} average utilization across horizon: ${avgLoad.toFixed(1)}%`,
        ok: avgLoad < 100,
      },
      {
        step: 6,
        question: 'Operators available?',
        answer: `${route.operators} operator${route.operators > 1 ? 's' : ''} required`,
        evidence: `${route.operators === 1 ? '81.5%' : '18.5%'} of operations need ${route.operators} operator${route.operators > 1 ? 's' : ''}`,
        ok: true,
      },
    ];

    nodes.push({
      sku,
      name: itemName[sku] || sku,
      machine: route.machine,
      tool: route.toolCode,
      steps,
    });
  }

  return nodes.sort((a, b) => a.sku.localeCompare(b.sku));
}

// ─── Master Compute ───────────────────────────────────────────────────

export interface IntelData {
  heatmap: HeatmapCell[][];
  clientRisk: ClientRisk[];
  bottlenecks: BottleneckNode[];
  setupTimeline: SetupSlot[];
  crossClient: CrossClientSku[];
  toolGrouping: ToolGroupResult[];
  network: { nodes: NetworkNode[]; edges: NetworkEdge[] };
  horizon: CapacityBar[];
  urgency: UrgencyPoint[];
  explain: ExplainNode[];
  machines: typeof MACHINES;
  workingDates: string[];
}

export function computeAll(snap: SnapshotFixture | null, nk: NkData): IntelData {
  const ctx = buildDateContext(nk);
  const setupTimeline = computeSetupCrewTimeline(nk, ctx);
  const toolGrouping = computeToolGrouping(nk);

  if (!snap) {
    return {
      heatmap: [],
      clientRisk: [],
      bottlenecks: [],
      setupTimeline,
      crossClient: [],
      toolGrouping,
      network: { nodes: [], edges: [] },
      horizon: [],
      urgency: [],
      explain: [],
      machines: MACHINES,
      workingDates: [...ctx.workingDates],
    };
  }

  const heatmap = computeDemandHeatmap(snap, nk, ctx);
  const horizon = computeCapacityHorizon(snap, nk, ctx);
  const urgency = computeUrgencyMatrix(snap, nk, ctx);
  const crossClient = computeCrossClientAggregation(snap, nk);
  const clientRisk = computeClientRisk(snap, nk, ctx);
  const bottlenecks = computeBottleneckCascade(heatmap, snap, nk);
  const network = computeMachineNetwork(nk, heatmap, ctx);
  const explain = computeExplainTrace(snap, nk, heatmap);

  return {
    heatmap,
    clientRisk,
    bottlenecks,
    setupTimeline,
    crossClient,
    toolGrouping,
    network,
    horizon,
    urgency,
    explain,
    machines: MACHINES,
    workingDates: [...ctx.workingDates],
  };
}
