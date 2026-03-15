// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Work Content & Deficit Evolution
//  Pure capacity calculations for scoring pipeline.
//
//  - computeWorkContent: how much production time each op needs
//  - computeDeficitEvolution: daily stock-vs-demand trajectory
// ═══════════════════════════════════════════════════════════

import { DAY_CAP, DEFAULT_OEE } from '../constants.js';
import type { DecisionRegistry } from '../decisions/decision-registry.js';
import type { EOp, ETool } from '../types/engine.js';
import type { CapacityLogEntry, DeficitEvolution, WorkContent } from '../types/scoring.js';

// ── Work Content ────────────────────────────────────────────

/**
 * Compute work content (production time required) for all operations.
 *
 * For each operation:
 * - totalQty = atr (backlog) + sum(daily demand)
 * - effectiveOEE = tool.oee ?? DEFAULT_OEE
 * - workContentHours = totalQty / (pH * effectiveOEE)
 * - daysRequired = workContentMin / DAY_CAP
 *
 * @param ops       - All operations
 * @param toolMap   - Map from toolId to ETool
 * @param registry  - Optional decision registry for capacity logging
 * @returns Map from opId to WorkContent
 */
export function computeWorkContent(
  ops: EOp[],
  toolMap: Record<string, ETool>,
  registry?: DecisionRegistry,
): Map<string, WorkContent> {
  const result = new Map<string, WorkContent>();

  for (const op of ops) {
    const tool = toolMap[op.t];
    if (!tool) continue;

    const totalQty = op.atr + op.d.reduce((s, v) => s + Math.max(v, 0), 0);
    if (totalQty <= 0) continue;

    const pH = tool.pH;
    if (pH <= 0) continue;

    const oee = tool.oee ?? DEFAULT_OEE;
    if (oee <= 0) continue; // Guard: OEE=0 would cause division by zero
    const oeeSource: WorkContent['oeeSource'] = tool.oee !== undefined ? 'tool' : 'default';

    // Work content = pieces / (rate * OEE)
    const workContentHours = totalQty / (pH * oee);
    const workContentMin = workContentHours * 60;
    const daysRequired = workContentMin / DAY_CAP;

    const wc: WorkContent = {
      opId: op.id,
      totalQty,
      pH,
      oee,
      oeeSource,
      workContentHours,
      workContentMin,
      daysRequired,
    };
    result.set(op.id, wc);

    // Log capacity computation
    if (registry) {
      const availableHoursPerDay = DAY_CAP / 60;
      const resultingCapacityPcsPerDay = pH * oee * availableHoursPerDay;

      const logEntry: CapacityLogEntry = {
        opId: op.id,
        toolId: op.t,
        machineId: op.m,
        oeeValue: oee,
        oeeSource,
        piecesPerHour: pH,
        availableHoursPerDay,
        resultingCapacityPcsPerDay,
        workContentHours,
        daysRequired,
      };

      registry.record({
        type: 'CAPACITY_COMPUTATION',
        opId: op.id,
        toolId: op.t,
        machineId: op.m,
        detail: `Op ${op.id}: qty=${totalQty}, pH=${pH}, OEE=${oee} (${oeeSource}), hours=${workContentHours.toFixed(1)}, days=${daysRequired.toFixed(2)}`,
        metadata: {
          opId: logEntry.opId,
          toolId: logEntry.toolId,
          machineId: logEntry.machineId,
          oeeValue: logEntry.oeeValue,
          oeeSource: logEntry.oeeSource,
          piecesPerHour: logEntry.piecesPerHour,
          availableHoursPerDay: logEntry.availableHoursPerDay,
          resultingCapacityPcsPerDay: logEntry.resultingCapacityPcsPerDay,
          workContentHours: logEntry.workContentHours,
          daysRequired: logEntry.daysRequired,
        },
      });
    }
  }

  return result;
}

// ── Deficit Evolution ────────────────────────────────────────

/**
 * Compute daily deficit evolution for all operations.
 *
 * For each operation, tracks: stock - cumulative_demand per day.
 * This shows when the operation goes into deficit (needs production).
 *
 * Initial stock = op.stk ?? 0 (per-SKU stock) + op.wip ?? 0
 *
 * @param ops     - All operations
 * @param toolMap - Map from toolId to ETool (for tool-level stock fallback)
 * @param nDays   - Total number of days in the horizon
 * @returns Map from opId to DeficitEvolution
 */
export function computeDeficitEvolution(
  ops: EOp[],
  toolMap: Record<string, ETool>,
  nDays: number,
): Map<string, DeficitEvolution> {
  const result = new Map<string, DeficitEvolution>();

  for (const op of ops) {
    // Initial stock: per-SKU stock + WIP, or fall back to tool stock
    const tool = toolMap[op.t];
    const skuStock = (op.stk ?? 0) + (op.wip ?? 0);
    const initialStock = skuStock > 0 ? skuStock : (tool?.stk ?? 0);

    // Compute daily deficit: stock - cumulative demand
    const dailyDeficit: number[] = new Array(nDays);
    let cumDemand = op.atr; // Start with backlog
    let firstDeficitDay = -1;
    let maxDeficit = 0;

    for (let d = 0; d < nDays; d++) {
      cumDemand += Math.max(op.d[d] || 0, 0);
      const deficit = initialStock - cumDemand;
      dailyDeficit[d] = deficit;

      if (deficit < 0) {
        if (firstDeficitDay < 0) firstDeficitDay = d;
        const absDeficit = -deficit;
        if (absDeficit > maxDeficit) maxDeficit = absDeficit;
      }
    }

    result.set(op.id, {
      opId: op.id,
      dailyDeficit,
      firstDeficitDay,
      maxDeficit,
      initialStock,
    });
  }

  return result;
}
