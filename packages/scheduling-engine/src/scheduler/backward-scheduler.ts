// =====================================================================
//  INCOMPOL PLAN -- Backward Scheduler
//  Computes earliest production start dates from Prz.Fabrico (lead time).
//
//  For each operation with ltDays > 0, counts backward ltDays WORKING
//  days from the last demand day to determine the earliest day that
//  production should BEGIN.
//
//  NEW module -- not extracted from NikufraEngine.
//  Pure function -- no React, no side effects.
// =====================================================================

import type { DecisionRegistry } from '../decisions/decision-registry.js';
import type { EOp } from '../types/engine.js';

// ── Types ───────────────────────────────────────────────────────────

export interface EarliestStartEntry {
  /** Day index when production can start at the earliest */
  earliestDayIdx: number;
  /** Day index of last demand (delivery date) */
  latestDayIdx: number;
  /** Lead time in working days */
  ltDays: number;
  /** Source description */
  source: string;
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Compute earliest production start dates for operations with Prz.Fabrico.
 *
 * For each operation with `ltDays > 0`:
 * 1. Find the LAST day with positive demand (= delivery date)
 * 2. Count backward `ltDays` working days from that delivery date
 * 3. The result is the earliest day production should begin
 *
 * Operations without ltDays or with ltDays=0 are not included in the result.
 *
 * @param ops       - All operations
 * @param workdays  - Per-day workday flags (true = working day)
 * @param nDays     - Total number of days in the horizon
 * @param registry  - Optional decision registry for logging
 * @returns Map from opId to backward-scheduling info
 *
 * @example
 * ```ts
 * const starts = computeEarliestStarts(ops, workdays, 80, registry)
 * // starts.get('OP01') => { earliestDayIdx: 5, latestDayIdx: 12, ltDays: 5, source: 'prz_fabrico' }
 * ```
 */
export function computeEarliestStarts(
  ops: EOp[],
  workdays: boolean[],
  nDays: number,
  registry?: DecisionRegistry,
): Map<string, EarliestStartEntry> {
  const result = new Map<string, EarliestStartEntry>();

  // Build array of working day indices for backward counting
  const workDayIndices: number[] = [];
  for (let d = 0; d < nDays; d++) {
    if (workdays[d]) workDayIndices.push(d);
  }

  for (const op of ops) {
    const ltDays = op.ltDays;
    if (!ltDays || ltDays <= 0) continue;

    // Find the LAST day index with positive demand
    let lastDemandDay = -1;
    for (let d = nDays - 1; d >= 0; d--) {
      if ((op.d[d] || 0) > 0) {
        lastDemandDay = d;
        break;
      }
    }

    // If no demand at all, skip (backlog-only ops have demand in atr, not in d[])
    if (lastDemandDay < 0) continue;

    // Find the position of lastDemandDay in working-day list
    let wdPos = -1;
    for (let i = workDayIndices.length - 1; i >= 0; i--) {
      if (workDayIndices[i] <= lastDemandDay) {
        wdPos = i;
        break;
      }
    }

    if (wdPos < 0) continue;

    // Count backward ltDays working days
    const targetPos = wdPos - ltDays;
    let earliestDayIdx: number;

    if (targetPos < 0) {
      // Lead time exceeds available working days before the delivery date.
      // Set earliest to day 0 (first day of horizon).
      earliestDayIdx = 0;
    } else {
      earliestDayIdx = workDayIndices[targetPos];
    }

    const entry: EarliestStartEntry = {
      earliestDayIdx,
      latestDayIdx: lastDemandDay,
      ltDays,
      source: 'prz_fabrico',
    };

    result.set(op.id, entry);

    // Log the backward scheduling decision
    if (registry) {
      registry.record({
        type: 'BACKWARD_SCHEDULE',
        opId: op.id,
        detail: `Op ${op.id} (${op.sku}): ltDays=${ltDays}, delivery=day${lastDemandDay}, earliest=day${earliestDayIdx}`,
        metadata: {
          ltDays,
          deliveryDay: lastDemandDay,
          earliestDay: earliestDayIdx,
          sku: op.sku,
        },
      });
    }
  }

  return result;
}
