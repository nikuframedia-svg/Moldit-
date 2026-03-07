// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Schedule Scorer
//  Computes KPIs and multi-objective score for a schedule
//  Extracted from NikufraEngine.tsx scoreSchedule()
// ═══════════════════════════════════════════════════════════

import { DAY_CAP, OTD_TOLERANCE } from '../constants.js';
import type { Block } from '../types/blocks.js';
import type { EMachine, EOp, ETool } from '../types/engine.js';
import type { OptResult } from '../types/kpis.js';
import type { WorkforceConfig } from '../types/workforce.js';
import { getBlockProductionForOp, getBlockQtyForOp } from '../utils/block-production.js';
import { capAnalysis } from './cap-analysis.js';
import { computeWorkforceDemand } from './op-demand.js';

export interface ScoreWeights {
  tardiness: number;
  setup_count: number;
  setup_time: number;
  setup_balance: number;
  churn: number;
  overflow: number;
  below_min_batch: number;
  capacity_variance: number;
  setup_density: number;
}

// ── Defaults ────────────────────────────────────────────────

export const DEFAULT_WEIGHTS: ScoreWeights = {
  tardiness: 100.0,
  setup_count: 10.0,
  setup_time: 1.0,
  setup_balance: 30.0,
  churn: 5.0,
  overflow: 50.0,
  below_min_batch: 5.0,
  capacity_variance: 20.0,
  setup_density: 15.0,
};

// ── Helpers ─────────────────────────────────────────────────

/** Count setups by shift */
function setupCountByShift(blocks: Block[]): { X: number; Y: number; Z: number } {
  return {
    X: blocks.filter((b) => b.setupS != null && b.shift === 'X').length,
    Y: blocks.filter((b) => b.setupS != null && b.shift === 'Y').length,
    Z: blocks.filter((b) => b.setupS != null && b.shift === 'Z').length,
  };
}

// ── Main Scorer ─────────────────────────────────────────────

/**
 * Score a schedule producing KPIs and a multi-objective cost score.
 *
 * The score is a negative cost: lower (more negative) = worse.
 * Minimization of tardiness, setup count, churn, etc.
 *
 * @param blocks - Scheduled blocks
 * @param ops - Operations with demand
 * @param _mSt - Machine status (unused, kept for API compat)
 * @param workforceConfig - Workforce zone configuration
 * @param machines - Machine list
 * @param _TM - Tool map (unused in score, kept for API compat)
 * @param weights - Optional weight overrides
 * @param baselineBlocks - Optional baseline for churn computation
 */
export function scoreSchedule(
  blocks: Block[],
  ops: EOp[],
  _mSt: Record<string, string>,
  workforceConfig: WorkforceConfig,
  machines: EMachine[],
  _TM: Record<string, ETool>,
  weights?: Partial<ScoreWeights>,
  baselineBlocks?: Block[],
  nDays?: number,
): OptResult & { blocks: Block[] } {
  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const ok = blocks.filter((b) => b.type !== 'blocked');
  const totalDemand = ops.reduce(
    (a, o) => a + o.d.reduce((x, y) => x + Math.max(y, 0), 0) + Math.max(o.atr, 0),
    0,
  );
  // Twin-aware production: use per-op helper to avoid double-counting co-production
  const produced = ops.reduce((a, o) => a + getBlockProductionForOp(blocks, o.id), 0);
  const otd =
    totalDemand > 0
      ? Math.min(100, Math.max(0, 100 - ((totalDemand - produced) / totalDemand) * 100))
      : 100;

  // OTD-D (Delivery): checks if cumulative production meets cumulative demand by each due date.
  let otdDOnTime = 0;
  let otdDTotal = 0;
  for (const op of ops) {
    // Twin-aware: include blocks where this op appears in outputs[]
    const opOkBlocks = ok.filter((b) => {
      if (b.isTwinProduction && b.outputs) return b.outputs.some((o) => o.opId === op.id);
      return b.opId === op.id;
    });
    let cumDemand = 0;
    let cumProd = 0;
    for (let d = 0; d < op.d.length; d++) {
      const dayDemand = Math.max(op.d[d] || 0, 0);
      cumDemand += dayDemand;
      cumProd += opOkBlocks
        .filter((b) => b.dayIdx === d)
        .reduce((s, b) => s + getBlockQtyForOp(b, op.id), 0);
      if (dayDemand > 0) {
        otdDTotal++;
        if (cumProd >= cumDemand * OTD_TOLERANCE) otdDOnTime++;
      }
    }
  }
  const otdDelivery = otdDTotal > 0 ? (otdDOnTime / otdDTotal) * 100 : 100;

  const setupBlocks = ok.filter((b) => b.setupS != null);
  const setupCount = setupBlocks.length;
  const setupMinVal = setupBlocks.reduce((a, b) => a + ((b.setupE || 0) - (b.setupS || 0)), 0);
  const sByShift = setupCountByShift(blocks);
  const hasThirdShift = sByShift.Z > 0 || blocks.some((b) => b.shift === 'Z');
  const setupBalance = hasThirdShift
    ? (Math.abs(sByShift.X - sByShift.Y) +
        Math.abs(sByShift.Y - sByShift.Z) +
        Math.abs(sByShift.X - sByShift.Z)) /
      3
    : Math.abs(sByShift.X - sByShift.Y);
  const moveCount = blocks.filter((b) => b.moved).length;
  const overflows = ok.filter((b) => b.overflow).length;
  const belowMinCount = ok.filter((b) => b.belowMinBatch).length;

  // Churn: |delta-start| in minutes against baseline
  let churnReal: number;
  if (baselineBlocks && baselineBlocks.length > 0) {
    const baseMap = new Map<string, number>();
    baselineBlocks.forEach((b) => {
      const key = `${b.opId}_${b.dayIdx}`;
      if (!baseMap.has(key)) baseMap.set(key, b.startMin);
    });
    churnReal = 0;
    blocks.forEach((b) => {
      const baseStart = baseMap.get(`${b.opId}_${b.dayIdx}`);
      if (baseStart !== undefined) churnReal += Math.abs(b.startMin - baseStart);
    });
  } else {
    churnReal = moveCount * 60; // fallback: ~60min per move estimated
  }
  // Normalize churn to ~same scale as moveCount for scoring
  const churnNorm = churnReal / 60;

  // Tardiness: operations that finish after S1 of their day (overflow = tardiness)
  let tardinessDays = 0;
  ok.forEach((b) => {
    if (b.overflow && b.overflowMin) tardinessDays += b.overflowMin / DAY_CAP;
  });

  // Capacity analysis
  const cap = capAnalysis(blocks, machines, nDays);
  const utils: number[] = [];
  const sNDays = nDays ?? (blocks.length > 0 ? Math.max(...blocks.map((b) => b.dayIdx)) + 1 : 0);
  machines.forEach((m) => {
    for (let d = 0; d < sNDays; d++) {
      const dc = cap[m.id]?.[d];
      if (dc) {
        const u = (dc.prod + dc.setup) / DAY_CAP;
        if (u > 0) utils.push(u);
      }
    }
  });
  const uMean = utils.length > 0 ? utils.reduce((a, v) => a + v, 0) / utils.length : 0;
  const uVar =
    utils.length > 0 ? utils.reduce((a, v) => a + (v - uMean) ** 2, 0) / utils.length : 0;

  // Setup density: max setups in any single machine-shift slot.
  // Penalises concentrated setups (e.g. 3 setups in one shift on one machine).
  let maxSetupDensity = 0;
  {
    const densityMap = new Map<string, number>();
    for (const b of setupBlocks) {
      const key = `${b.machineId}_${b.dayIdx}_${b.shift}`;
      densityMap.set(key, (densityMap.get(key) ?? 0) + 1);
    }
    for (const count of densityMap.values()) {
      if (count > maxSetupDensity) maxSetupDensity = count;
    }
  }

  const wfDemand = computeWorkforceDemand(blocks, workforceConfig, nDays);
  const peakOps = wfDemand.peakTotal;
  const overOps = wfDemand.maxOverload;
  const lostPcs = totalDemand - produced;
  const deadlineFeasible = lostPcs <= 0;

  // Score: -Infinity when deadline violated (hard constraint), weighted cost otherwise
  const score = deadlineFeasible
    ? -(
        w.tardiness * tardinessDays +
        w.setup_count * setupCount +
        w.setup_time * setupMinVal +
        w.setup_balance * setupBalance +
        w.churn * churnNorm +
        w.overflow * overflows +
        w.below_min_batch * belowMinCount +
        w.capacity_variance * uVar +
        w.setup_density * maxSetupDensity
      )
    : -Infinity;

  return {
    score,
    otd,
    otdDelivery,
    produced,
    totalDemand,
    lostPcs: Math.max(0, lostPcs),
    setupCount,
    setupMin: setupMinVal,
    peakOps,
    overOps,
    overflows,
    capUtil: uMean,
    capVar: uVar,
    tardinessDays,
    setupByShift: sByShift,
    deadlineFeasible,
    capByMachine: Object.fromEntries(
      machines.map((m) => [
        m.id,
        {
          days: Array.from({ length: sNDays }, (_, d) => {
            const dc = cap[m.id]?.[d] || { prod: 0, setup: 0, pcs: 0, ops: 0 };
            return {
              prod: dc.prod,
              setup: dc.setup,
              pcs: dc.pcs,
              ops: dc.ops,
              util: (dc.prod + dc.setup) / DAY_CAP,
            };
          }),
        },
      ]),
    ),
    workforceDemand: wfDemand.entries,
    moves: [],
    blocks,
    label: '',
  };
}
