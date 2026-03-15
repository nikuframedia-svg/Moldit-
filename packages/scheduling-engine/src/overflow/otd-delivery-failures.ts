// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — OTD Delivery Failures
//  Computes per-op demand checkpoints where cumulative
//  production is insufficient. Mirrors otdDelivery in
//  scoreSchedule().
// ═══════════════════════════════════════════════════════════

import type { Block } from '../types/blocks.js';
import type { EOp } from '../types/engine.js';
import { getBlockQtyForOp } from '../utils/block-production.js';

export interface OtdDeliveryFailure {
  opId: string;
  day: number;
  shortfall: number;
}

/**
 * Count OTD-Delivery failures: demand checkpoints where cumulative production
 * is insufficient. This mirrors the otdDelivery metric in scoreSchedule().
 * Returns { count, failures[] } where each failure identifies the op+day.
 */
export function computeOtdDeliveryFailures(
  blocks: Block[],
  ops: EOp[],
): { count: number; failures: OtdDeliveryFailure[] } {
  const ok = blocks.filter((b) => b.type !== 'blocked');
  const failures: OtdDeliveryFailure[] = [];
  let count = 0;

  for (const op of ops) {
    const opOkBlocks = ok.filter((b) => {
      if (b.isTwinProduction && b.outputs) return b.outputs.some((o) => o.opId === op.id);
      return b.opId === op.id;
    });
    let cumDemand = 0;
    let cumProd = 0;
    for (let d = 0; d < op.d.length; d++) {
      const dayDemand = Math.max(op.d[d] || 0, 0);
      cumDemand += dayDemand;
      for (const b of opOkBlocks) {
        if (b.dayIdx === d) {
          cumProd += getBlockQtyForOp(b, op.id);
        }
      }
      if (dayDemand > 0 && cumProd < cumDemand) {
        count++;
        failures.push({ opId: op.id, day: d, shortfall: cumDemand - cumProd });
      }
    }
  }
  return { count, failures };
}
