// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Transparency Report Builder
//  Produces auditable per-order justifications for scheduling.
//
//  For feasible ops: WHY production starts when it does.
//  For infeasible ops: WHY it can't meet the deadline + suggestions.
//
//  Pure function -- no React, no side effects.
// ═══════════════════════════════════════════════════════════

import { DAY_CAP } from '../constants.js';
import type { Block, ZoneShiftDemand } from '../types/blocks.js';
import type { DecisionEntry } from '../types/decisions.js';
import type { EOp, ETool } from '../types/engine.js';
import type { InfeasibilityEntry } from '../types/infeasibility.js';
import type { CapacityLogEntry, DeficitEvolution, WorkContent } from '../types/scoring.js';
import type { OperationDeadline } from '../types/shipping.js';
import type {
  FailureJustification,
  OrderJustification,
  StartReason,
  TransparencyReport,
} from '../types/transparency.js';
import type { TwinValidationReport } from '../types/twin.js';
import type { WorkforceForecast } from '../types/workforce.js';
import { getBlockProductionForOp, getBlocksForOp } from '../utils/block-production.js';

// ── Helpers ──────────────────────────────────────────────────

/**
 * Determine the start reason for a feasible operation
 * based on scoring metrics and block data.
 */
function determineStartReason(
  wc: WorkContent,
  de: DeficitEvolution,
  deadline: OperationDeadline | undefined,
  blocks: Block[],
): StartReason {
  // If deficit already exists at day 0 (backlog)
  if (de.firstDeficitDay === 0 || de.dailyDeficit[0] < 0) {
    return 'deficit_elimination';
  }

  // If slack is critical (< 1 day)
  if (deadline) {
    const slackMin = deadline.latestFinishAbs - wc.workContentMin;
    if (slackMin < DAY_CAP) {
      return 'urgency_slack_critical';
    }
  }

  // If density is high (needs > 50% of available capacity in remaining time)
  if (deadline && wc.daysRequired > 0) {
    const availableDays = deadline.shippingDayIdx + 1;
    const density = wc.daysRequired / availableDays;
    if (density > 0.5) {
      return 'density_heavy_load';
    }
  }

  // If the block was moved by load leveling
  const opBlocks = blocks.filter((b) => b.opId === wc.opId && b.type === 'ok');
  if (opBlocks.some((b) => b.isLeveled)) {
    return 'future_load_relief';
  }

  // Default: free window
  return 'free_window_available';
}

/**
 * Collect shifts used per day from blocks for an operation.
 */
function collectShiftsPerDay(blocks: Block[], opId: string, nDays: number): ('X' | 'Y' | 'Z')[][] {
  const perDay: ('X' | 'Y' | 'Z')[][] = [];
  for (let d = 0; d < nDays; d++) {
    const shifts = new Set<'X' | 'Y' | 'Z'>();
    for (const b of blocks) {
      if (b.opId === opId && b.dayIdx === d && b.type === 'ok') {
        shifts.add(b.shift);
      }
    }
    perDay.push([...shifts].sort());
  }
  return perDay;
}

// ── Main export ──────────────────────────────────────────────

/**
 * Build a transparency report with per-order justifications.
 *
 * @param blocks           - Final scheduled blocks
 * @param ops              - All operations
 * @param toolMap          - Tool lookup by ID
 * @param deadlines        - Shipping deadlines per op
 * @param workContents     - Work content per op
 * @param deficits         - Deficit evolution per op
 * @param infeasibilities  - Infeasibility entries
 * @param decisions        - All decision entries (for capacity log extraction)
 * @param twinValidation   - Twin validation report (optional)
 * @returns TransparencyReport
 */
export function buildTransparencyReport(
  blocks: Block[],
  ops: EOp[],
  toolMap: Record<string, ETool>,
  deadlines: Map<string, OperationDeadline>,
  workContents: Map<string, WorkContent>,
  deficits: Map<string, DeficitEvolution>,
  infeasibilities: InfeasibilityEntry[],
  decisions: DecisionEntry[],
  twinValidation?: TwinValidationReport,
  workforceWarnings?: ZoneShiftDemand[],
  workforceForecast?: WorkforceForecast,
): TransparencyReport {
  const orderJustifications: OrderJustification[] = [];
  const failureJustifications: FailureJustification[] = [];

  // Extract capacity log from decisions
  const capacityLog: CapacityLogEntry[] = decisions
    .filter((d) => d.type === 'CAPACITY_COMPUTATION')
    .map((d) => d.metadata as unknown as CapacityLogEntry);

  // Build infeasible op set
  const infeasibleOpIds = new Set(infeasibilities.map((e) => e.opId));

  // Compute nDays from max dailyDeficit length
  const nDays = Math.max(...Array.from(deficits.values()).map((d) => d.dailyDeficit.length), 0);

  for (const op of ops) {
    const wc = workContents.get(op.id);
    const de = deficits.get(op.id);
    const deadline = deadlines.get(op.id);
    const tool = toolMap[op.t];

    // Skip ops with no demand
    const totalDemand = op.atr + op.d.reduce((s, v) => s + Math.max(v, 0), 0);
    if (totalDemand <= 0) continue;

    if (infeasibleOpIds.has(op.id)) {
      // ── Failure justification ──
      const entry = infeasibilities.find((e) => e.opId === op.id)!;
      const pH = tool?.pH ?? 0;
      const oee = tool?.oee ?? 0.66;
      const effectivePH = pH * oee;

      // Missing capacity — twin-aware production attribution
      const produced = getBlockProductionForOp(blocks, op.id);
      const missingPcs = totalDemand - produced;
      const missingHours = effectivePH > 0 ? missingPcs / effectivePH : 0;

      // First impossible moment: deadline abs or latest block end
      let firstImpossibleMoment = 0;
      if (deadline) {
        firstImpossibleMoment = deadline.latestFinishAbs;
      }

      // Suggestions
      const suggestions: string[] = [];
      if (entry.suggestion) {
        suggestions.push(...entry.suggestion.split('; '));
      }

      failureJustifications.push({
        opId: op.id,
        constraintsViolated: [entry.reason],
        firstImpossibleMoment,
        missingCapacityHours: Math.round(missingHours * 100) / 100,
        missingCapacityPieces: missingPcs,
        suggestions,
      });
    } else if (wc && de) {
      // ── Order justification ──
      const okBlocks = blocks.filter((b) => b.opId === op.id && b.type === 'ok');
      // Twin-aware production attribution
      const totalProduced = getBlockProductionForOp(blocks, op.id);

      // Allocated hours per day
      const totalProdMin = okBlocks.reduce((s, b) => s + b.prodMin, 0);
      const daysWithProd = new Set(okBlocks.map((b) => b.dayIdx)).size;
      const allocatedHoursPerDay = daysWithProd > 0 ? totalProdMin / daysWithProd / 60 : 0;

      // Shifts per day
      const shiftsUsedPerDay = collectShiftsPerDay(blocks, op.id, nDays);

      // Capacity
      const pH = wc.pH;
      const oee = wc.oee;
      const availableHoursPerDay = DAY_CAP / 60;
      const capacityPcsPerDay = pH * oee * availableHoursPerDay;

      // Start reason
      const startReason = determineStartReason(wc, de, deadline, blocks);

      // Initial deficit: if deficit exists at day 0, it's the negative of dailyDeficit[0]
      const initialDeficit =
        de.dailyDeficit.length > 0 && de.dailyDeficit[0] < 0 ? -de.dailyDeficit[0] : 0;

      // Twin co-production metadata
      const twinBlks = getBlocksForOp(blocks, op.id).filter((b) => b.isTwinProduction);
      const isTwinProd = twinBlks.length > 0;
      let twinPartnerSku: string | undefined;
      let twinOutputs: Array<{ sku: string; qty: number }> | undefined;
      if (isTwinProd) {
        // Aggregate outputs per SKU across all twin blocks
        const qtyBySku: Record<string, number> = {};
        for (const tb of twinBlks) {
          if (tb.outputs) {
            for (const o of tb.outputs) {
              qtyBySku[o.sku] = (qtyBySku[o.sku] ?? 0) + o.qty;
            }
          }
        }
        twinOutputs = Object.entries(qtyBySku).map(([sku, qty]) => ({ sku, qty }));
        // Partner = the other SKU in outputs
        const partner = twinBlks[0]?.outputs?.find((o) => o.opId !== op.id);
        twinPartnerSku = partner?.sku;
      }

      orderJustifications.push({
        opId: op.id,
        initialStock: de.initialStock,
        initialDeficit,
        deficitEvolution: [...de.dailyDeficit],
        pH,
        oee,
        capacityPcsPerDay: Math.round(capacityPcsPerDay * 100) / 100,
        allocatedHoursPerDay: Math.round(allocatedHoursPerDay * 100) / 100,
        shiftsUsedPerDay,
        startReason,
        feasible: true,
        totalProduced,
        totalDemand,
        ...(isTwinProd ? { isTwinProduction: true, twinPartnerSku, twinOutputs } : {}),
      });
    }
  }

  return {
    orderJustifications,
    failureJustifications,
    capacityLog,
    twinValidationReport: twinValidation,
    workforceWarnings,
    workforceForecast,
  };
}
