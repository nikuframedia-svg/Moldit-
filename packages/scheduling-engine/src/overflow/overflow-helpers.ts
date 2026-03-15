// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Overflow Shared Helpers
//  Pure utility functions used across auto-replan strategies.
// ═══════════════════════════════════════════════════════════

import type { Block } from '../types/blocks.js';
import type { EMachine } from '../types/engine.js';

/** Sum total overflow minutes across all overflow/infeasible blocks */
export function sumOverflow(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.overflow && b.overflowMin) return sum + b.overflowMin;
    if (b.type === 'infeasible' && b.prodMin > 0) return sum + b.prodMin;
    return sum;
  }, 0);
}

/** Sum production minutes of blocks scheduled AFTER their deadline (tardy but type='ok') */
export function computeTardiness(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.type === 'ok' && b.eddDay != null && b.dayIdx > b.eddDay) {
      return sum + b.prodMin;
    }
    return sum;
  }, 0);
}

/**
 * Compute per-machine per-day load from blocks.
 */
export function capAnalysis(
  blocks: Block[],
  machines: EMachine[],
): Record<string, Array<{ prod: number; setup: number }>> {
  const result: Record<string, Array<{ prod: number; setup: number }>> = {};
  const nDays = blocks.reduce((mx, b) => Math.max(mx, b.dayIdx + 1), 0);

  for (const m of machines) {
    const days = Array.from({ length: nDays }, () => ({ prod: 0, setup: 0 }));
    for (const b of blocks) {
      if (b.machineId !== m.id || b.dayIdx < 0 || b.dayIdx >= nDays) continue;
      days[b.dayIdx].prod += b.prodMin;
      days[b.dayIdx].setup += b.setupMin;
    }
    result[m.id] = days;
  }
  return result;
}

/**
 * Count backward working days from `fromDay`.
 * Returns the target day index, or -1 if not enough working days.
 */
export function computeAdvancedEdd(fromDay: number, advanceDays: number, workdays: boolean[]): number {
  let target = fromDay;
  let daysBack = 0;
  for (let d = fromDay - 1; d >= 0 && daysBack < advanceDays; d--) {
    if (!workdays || workdays[d]) {
      daysBack++;
      target = d;
    }
  }
  return daysBack === advanceDays ? target : -1;
}
