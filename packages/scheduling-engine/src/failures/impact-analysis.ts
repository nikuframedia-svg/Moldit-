// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Failure Impact Analysis
//
//  Analyzes the impact of FailureEvent(s) on an existing
//  schedule.  Pure function — no side effects.
// ═══════════════════════════════════════════════════════════

import type { Block } from '../types/blocks.js';
import type { FailureEvent, ImpactedBlock, ImpactReport, ShiftId } from '../types/failure.js';
import { isShiftInFailureWindow } from './shift-utils.js';

// ══════════════════════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════════════════════

/**
 * Analyze the impact of a single failure event on the current schedule.
 *
 * For each scheduled block that overlaps with the failure window:
 * - qtyAtRisk = qty × (1 − capacityFactor)
 * - minutesAtRisk = prodMin × (1 − capacityFactor)
 */
export function analyzeFailureImpact(
  failure: FailureEvent,
  blocks: Block[],
  _nDays: number,
  thirdShift?: boolean,
): ImpactReport {
  const activeShifts: ShiftId[] = thirdShift ? ['X', 'Y', 'Z'] : ['X', 'Y'];
  const impactedBlocks: ImpactedBlock[] = [];
  const dailyMap = new Map<number, { qtyAtRisk: number; minutesAtRisk: number; count: number }>();

  for (const b of blocks) {
    if (b.type !== 'ok' || b.qty <= 0) continue;

    // Match resource
    const matches =
      failure.resourceType === 'machine'
        ? b.machineId === failure.resourceId
        : b.toolId === failure.resourceId;
    if (!matches) continue;

    // Check temporal overlap
    if (!isShiftInFailureWindow(failure, b.dayIdx, b.shift as ShiftId, activeShifts)) continue;

    const lossFactor = 1 - failure.capacityFactor;
    const qtyAtRisk = Math.round(b.qty * lossFactor);
    const minutesAtRisk = Math.round(b.prodMin * lossFactor);

    if (qtyAtRisk <= 0 && minutesAtRisk <= 0) continue;

    impactedBlocks.push({
      opId: b.opId,
      toolId: b.toolId,
      sku: b.sku,
      machineId: b.machineId,
      dayIdx: b.dayIdx,
      shift: b.shift as ShiftId,
      scheduledQty: b.qty,
      qtyAtRisk,
      minutesAtRisk,
      hasAlternative: b.hasAlt,
      altMachine: b.altM ?? null,
    });

    const dd = dailyMap.get(b.dayIdx) || { qtyAtRisk: 0, minutesAtRisk: 0, count: 0 };
    dd.qtyAtRisk += qtyAtRisk;
    dd.minutesAtRisk += minutesAtRisk;
    dd.count++;
    dailyMap.set(b.dayIdx, dd);
  }

  const ops = new Set(impactedBlocks.map((ib) => ib.opId));
  const skus = new Set(impactedBlocks.map((ib) => ib.sku));
  const withAlt = impactedBlocks.filter((ib) => ib.hasAlternative).length;
  const totalQty = impactedBlocks.reduce((s, ib) => s + ib.qtyAtRisk, 0);
  const totalMin = impactedBlocks.reduce((s, ib) => s + ib.minutesAtRisk, 0);

  const dailyImpact = [...dailyMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([dayIdx, d]) => ({
      dayIdx,
      qtyAtRisk: d.qtyAtRisk,
      minutesAtRisk: d.minutesAtRisk,
      blocksAffected: d.count,
    }));

  return {
    failureEvent: failure,
    impactedBlocks,
    summary: {
      totalBlocksAffected: impactedBlocks.length,
      totalQtyAtRisk: totalQty,
      totalMinutesAtRisk: totalMin,
      blocksWithAlternative: withAlt,
      blocksWithoutAlternative: impactedBlocks.length - withAlt,
      opsAffected: ops.size,
      skusAffected: skus.size,
    },
    dailyImpact,
  };
}

/**
 * Analyze ALL failure events against the current schedule.
 * Returns one ImpactReport per failure event.
 */
export function analyzeAllFailures(
  failures: FailureEvent[],
  blocks: Block[],
  nDays: number,
  thirdShift?: boolean,
): ImpactReport[] {
  return failures.map((fe) => analyzeFailureImpact(fe, blocks, nDays, thirdShift));
}
