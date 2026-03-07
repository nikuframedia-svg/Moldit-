// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Transform PlanState to EngineData
//  Converts backend/adapter PlanState to internal engine format
//  Extracted from NikufraEngine.tsx transformPlanState()
//  EXTENDED: propagates lead_time_days from PlanningOperation to EOp.ltDays
// ═══════════════════════════════════════════════════════════

import { KNOWN_FOCUS } from '../constants.js';
import type { EMachine, EngineData, EOp, ETool } from '../types/engine.js';
import type { PlanState } from '../types/plan-state.js';
import { DEFAULT_WORKFORCE_CONFIG } from '../types/workforce.js';
import { inferWorkdaysFromLabels, padMoArray } from '../utils/time.js';
import { validateTwinReferences } from './twin-validator.js';

// ── Configuration ─────────────────────────────────────────

export interface TransformConfig {
  /** MO padding strategy for horizons beyond fixture length */
  moStrategy: 'cyclic' | 'nominal' | 'custom';
  /** Nominal PG1 capacity (used for 'nominal' and 'custom' strategies) */
  moNominalPG1: number;
  /** Nominal PG2 capacity */
  moNominalPG2: number;
  /** Custom PG1 capacity (used for 'custom' strategy) */
  moCustomPG1: number;
  /** Custom PG2 capacity (used for 'custom' strategy) */
  moCustomPG2: number;
  /** How to interpret PlanningOperation.daily_qty values.
   *  - 'daily': values are independent daily demand (pass through unchanged)
   *  - 'cumulative_np': values are cumulative max(0,-NP) from ISOP;
   *    engine converts to incremental daily demand via delta formula.
   *    Backlog (atraso) is subtracted from day 0 to avoid double-counting.
   *  - 'raw_np': values are raw NP from ISOP Excel (positive=stock,
   *    negative=order-stock, null/0=no change). Engine forward-fills nulls,
   *    applies max(0,-NP), then deltaizes to incremental daily demand.
   */
  demandSemantics: 'daily' | 'cumulative_np' | 'raw_np';
}

export const DEFAULT_TRANSFORM_CONFIG: TransformConfig = {
  moStrategy: 'nominal',
  moNominalPG1: 3,
  moNominalPG2: 2,
  moCustomPG1: 3,
  moCustomPG2: 2,
  demandSemantics: 'daily',
};

// ── Cumulative NP → Daily Demand ────────────────────────────

/**
 * Convert cumulative max(0,-NP) array to incremental daily demand.
 *
 * ISOP exports NP(t) = Stock(0) - ΣGrossReq(0..t).
 * Frontend parser applies max(0, -NP) per column, producing cumulative
 * shortfall values. This function converts them to daily demand deltas.
 *
 * Day 0:   demand = max(0, cum[0] - atr)  — subtract backlog (already in cum[0])
 * Day i>0: demand = max(0, cum[i] - cum[i-1])  — increase in shortfall = new demand
 *
 * When cum[i] < cum[i-1], planned receipts reduced the shortfall → no new demand.
 */
export function deltaizeCumulativeNP(cumNP: number[], atr: number): number[] {
  if (cumNP.length === 0) return [];
  const daily: number[] = new Array(cumNP.length);
  daily[0] = Math.max(0, cumNP[0] - Math.max(atr, 0));
  for (let i = 1; i < cumNP.length; i++) {
    daily[i] = Math.max(0, cumNP[i] - cumNP[i - 1]);
  }
  return daily;
}

// ── Raw NP → Daily Demand (full ISOP pipeline) ──────────────

/**
 * Convert raw ISOP NP values to incremental daily demand.
 *
 * Raw ISOP exports NP(t) = Stock(0) - ΣGrossReq(0..t) with:
 *  - Positive values → stock still covers demand (no production needed)
 *  - Negative values → shortfall (order qty exceeds stock)
 *  - null/undefined  → no change from previous day (forward-fill)
 *
 * Steps:
 *  1. Forward-fill: replace null/undefined with previous day's value
 *  2. max(0, -NP): convert to cumulative shortfall (positive = need, 0 = covered)
 *  3. Deltaize: convert cumulative shortfall to incremental daily demand
 */
export function rawNPtoDailyDemand(rawNP: (number | null | undefined)[], atr: number): number[] {
  if (rawNP.length === 0) return [];

  // Step 1: Forward-fill null/undefined values
  const filled: number[] = new Array(rawNP.length);
  filled[0] = rawNP[0] ?? 0;
  for (let i = 1; i < rawNP.length; i++) {
    filled[i] = rawNP[i] ?? filled[i - 1];
  }

  // Step 2: max(0, -NP) → cumulative shortfall
  const cumShortfall: number[] = filled.map((v) => Math.max(0, -v));

  // Step 3: Deltaize cumulative shortfall to daily demand
  const result = deltaizeCumulativeNP(cumShortfall, atr);

  // Guard: demand must never be negative (defence-in-depth)
  for (let i = 0; i < result.length; i++) {
    if (result[i] < 0) {
      result[i] = 0;
    }
  }

  return result;
}

// ── Raw NP → Order-based Daily Demand ───────────────────────

/**
 * Convert raw ISOP NP values to order-based daily demand.
 *
 * Every explicitly negative NP cell = 1 order of |NP| pieces with deadline
 * on that day. Null/undefined cells are NOT demand (they are empty ISOP cells).
 *  - NP < 0 (explicit value) → order of |NP| pcs, deadline = this day
 *  - NP >= 0 → stock OK, no demand
 *  - null/undefined → empty cell, no demand
 *  - atr > 0 → subtract from first order to avoid double-counting
 *    (grouper adds atr separately as EDD=0 bucket)
 *
 * Result: daily demand array where each order's qty appears on its deadline day.
 * Example: NP = [500, 420, -60, null, -200] → demand = [0, 0, 60, 0, 200]
 */
export function rawNPtoOrderDemand(rawNP: (number | null | undefined)[], atr: number): number[] {
  if (rawNP.length === 0) return [];

  const daily: number[] = new Array(rawNP.length).fill(0);

  let atrSubtracted = false;

  for (let day = 0; day < rawNP.length; day++) {
    const np = rawNP[day];
    if (np == null) continue; // null/undefined = empty ISOP cell, skip

    if (np < 0) {
      let qty = Math.abs(np);

      // Subtract atr from first order to avoid double-counting
      // (grouper adds atr separately as EDD=0 bucket)
      if (!atrSubtracted && atr > 0) {
        qty = Math.max(0, qty - atr);
        atrSubtracted = true;
      }

      daily[day] = qty;
    }
  }

  return daily;
}

// ── Extract stock from raw NP values ────────────────────────

/**
 * Extract initial stock from raw ISOP NP values.
 * First non-null value: positive = stock available, negative/zero = no stock.
 */
export function extractStockFromRawNP(rawNP: (number | null | undefined)[]): number {
  for (const v of rawNP) {
    if (v !== null && v !== undefined) {
      return Math.max(0, v);
    }
  }
  return 0;
}

// ── Main Transform ──────────────────────────────────────────

/**
 * Transform backend PlanState to internal EngineData format.
 *
 * This is a pure function -- it does NOT read from any store.
 * Configuration is passed explicitly via the `config` parameter.
 *
 * EXTENDED vs original:
 * - Propagates `lead_time_days` from PlanningOperation to EOp as `ltDays`
 * - Propagates `customer_code`, `customer_name`, `parent_sku` to EOp
 */
export function transformPlanState(ps: PlanState, config?: Partial<TransformConfig>): EngineData {
  const cfg = { ...DEFAULT_TRANSFORM_CONFIG, ...config };

  const machines: EMachine[] = ps.machines.map((m) => ({
    id: m.id,
    area: m.area,
    focus: KNOWN_FOCUS.has(m.id),
  }));

  const tools: ETool[] = ps.tools.map((t) => {
    if (t.lot_economic_qty < 0) {
      throw new Error(`Tool ${t.id}: lot_economic_qty must be >= 0, got ${t.lot_economic_qty}`);
    }
    return {
      id: t.id,
      m: t.machine,
      alt: t.alt_machine || '-',
      sH: t.setup_hours,
      pH: t.pcs_per_hour,
      op: t.operators,
      lt: t.lot_economic_qty,
      stk: 0, // Stock-A eliminado — forçado a 0 independentemente do input
      nm: t.names[0] || t.id,
      calco: t.calco_code || undefined,
    };
  });

  // Dynamic horizon: use all dates from data (not hardcoded to 8)
  const nDays = ps.dates.length || ps.operations[0]?.daily_qty.length || 8;

  const ops: EOp[] = ps.operations.map((o) => ({
    id: o.id,
    t: o.tool,
    m: o.machine,
    sku: o.sku,
    nm: o.name || o.sku,
    atr: o.atraso,
    d:
      cfg.demandSemantics === 'raw_np'
        ? rawNPtoOrderDemand(o.daily_qty, o.atraso)
        : cfg.demandSemantics === 'cumulative_np'
          ? deltaizeCumulativeNP(o.daily_qty as number[], o.atraso)
          : ([...o.daily_qty] as number[]),
    // EXTENDED: propagate lead_time_days -> ltDays
    ltDays: o.lead_time_days,
    // Propagate customer and parent info
    cl: o.customer_code,
    clNm: o.customer_name,
    pa: o.parent_sku,
    // Per-operation shipping buffer (user-set)
    shippingBufferHours: o.buffer_hours,
    // Per-SKU stock and WIP (not tool-level aggregate)
    stk: 0, // Stock-A eliminado — forçado a 0
    wip: o.wip,
    // Twin piece reference
    twin: o.twin,
  }));

  // Pad daily_qty to nDays if shorter
  ops.forEach((o) => {
    while (o.d.length < nDays) o.d.push(0);
  });

  // Stock-A (Col N) eliminado — stk inicia a 0 acima.
  // Em modo raw_np, o stock REAL vem dos valores NP nas colunas de datas.
  // extractStockFromRawNP() extrai o primeiro NP positivo como stock disponível.
  if (cfg.demandSemantics === 'raw_np') {
    const toolStockAccum: Record<string, number> = {};
    for (let i = 0; i < ops.length; i++) {
      const npStock = extractStockFromRawNP(ps.operations[i].daily_qty);
      ops[i].stk = npStock;
      const toolId = ops[i].t;
      toolStockAccum[toolId] = (toolStockAccum[toolId] ?? 0) + npStock;
    }
    for (const t of tools) {
      if (toolStockAccum[t.id] !== undefined) {
        t.stk = toolStockAccum[t.id];
      }
    }
  }

  const dates = [...ps.dates];
  const dnames = [...ps.days_label];
  while (dates.length < nDays) {
    dates.push('--/--');
    dnames.push('--');
  }

  const toolMap: Record<string, ETool> = {};
  tools.forEach((t) => {
    toolMap[t.id] = t;
  });

  const focusIds = machines.filter((m) => m.focus).map((m) => m.id);

  const workdays = ps.workday_flags
    ? [...ps.workday_flags]
    : inferWorkdaysFromLabels(ps.days_label, nDays);
  while (workdays.length < nDays) workdays.push(true);

  // Pad MO arrays to match horizon (fixture MO may have 8 elements for 80-day ISOP)
  const moStrat = cfg.moStrategy;
  const nomPG1 = moStrat === 'custom' ? cfg.moCustomPG1 : cfg.moNominalPG1;
  const nomPG2 = moStrat === 'custom' ? cfg.moCustomPG2 : cfg.moNominalPG2;

  const mo = ps.mo
    ? {
        PG1: padMoArray(ps.mo.PG1, nDays, moStrat, nomPG1),
        PG2: padMoArray(ps.mo.PG2, nDays, moStrat, nomPG2),
        ...(ps.mo.poolPG1 ? { poolPG1: padMoArray(ps.mo.poolPG1, nDays, moStrat, nomPG1) } : {}),
        ...(ps.mo.poolPG2 ? { poolPG2: padMoArray(ps.mo.poolPG2, nDays, moStrat, nomPG2) } : {}),
      }
    : undefined;

  // Machine and tool status: ALL default to 'running'.
  // PlanState.machineStatus / toolStatus are deliberately IGNORED here.
  // ISOP red cells do NOT indicate unavailability — use FailureEvent[] for
  // explicit temporal downtime instead.
  const mSt: Record<string, string> = {};
  machines.forEach((m) => {
    mSt[m.id] = 'running';
  });
  const tSt: Record<string, string> = {};
  tools.forEach((t) => {
    tSt[t.id] = 'running';
  });

  // ── Twin validation ──────────────────────────────────────
  // Build toolId → lot_economic_qty lookup for TwinGroup.lotEconomicDiffers
  const toolLtMap: Record<string, number> = {};
  for (const t of ps.tools) {
    toolLtMap[t.id] = t.lot_economic_qty;
  }

  const twinInput = ps.operations.map((o) => ({
    id: o.id,
    sku: o.sku,
    machine: o.machine,
    tool: o.tool,
    pH: o.pcs_per_hour,
    operators: o.operators,
    twin: o.twin,
    ltDays: o.lead_time_days,
    lotEconomic: toolLtMap[o.tool],
  }));
  const twinValidation = validateTwinReferences(twinInput);

  return {
    machines,
    tools,
    ops,
    dates,
    dnames,
    toolMap,
    focusIds,
    workdays,
    mo,
    nDays,
    thirdShift: ps.thirdShift,
    mSt,
    tSt,
    twinGroups: twinValidation.twinGroups,
    twinValidationReport: twinValidation,
    workforceConfig: ps.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG,
    orderBased: cfg.demandSemantics === 'raw_np',
  };
}
