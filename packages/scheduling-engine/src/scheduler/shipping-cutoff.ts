// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Shipping Cutoff (Deadlines)
//  Computes latest-finish-time for each operation based on
//  shipping day and configurable buffer.
//
//  Shipping is LAW: production NEVER finishes after the deadline.
// ═══════════════════════════════════════════════════════════

import { S1 } from '../constants.js';
import type { DecisionRegistry } from '../decisions/decision-registry.js';
import type { EOp } from '../types/engine.js';
import type { OperationDeadline, ShippingCutoffConfig } from '../types/shipping.js';

// ── Main export ─────────────────────────────────────────────

/**
 * Compute shipping deadlines for all operations.
 *
 * For each operation:
 * 1. Find the LAST day with positive demand (= shipping day)
 * 2. Resolve buffer: order override > op.shippingBufferHours > SKU override > default
 * 3. Compute latestFinishAbs = (shippingDay * 1440 + S1) - (bufferHours * 60)
 *    where S1 = end of shift Y (24:00 = 1440 min). Default buffer = 0.
 *
 * Operations with no demand (backlog-only) use day 0 as shipping day.
 *
 * @param ops       - All operations
 * @param workdays  - Per-day workday flags (true = working day)
 * @param nDays     - Total number of days in the horizon
 * @param config    - Shipping cutoff configuration
 * @param registry  - Optional decision registry for logging
 * @returns Map from opId to OperationDeadline
 */
export function computeShippingDeadlines(
  ops: EOp[],
  workdays: boolean[],
  nDays: number,
  config: ShippingCutoffConfig,
  registry?: DecisionRegistry,
): Map<string, OperationDeadline> {
  const result = new Map<string, OperationDeadline>();

  for (const op of ops) {
    // 1. Find the LAST day with positive demand (shipping day)
    let shippingDayIdx = -1;
    for (let d = nDays - 1; d >= 0; d--) {
      if ((op.d[d] || 0) > 0) {
        shippingDayIdx = d;
        break;
      }
    }

    // Backlog-only operations: ship on day 0 (urgent)
    if (shippingDayIdx < 0) {
      if (op.atr > 0) {
        shippingDayIdx = 0;
      } else {
        // No demand and no backlog — skip
        continue;
      }
    }

    // 2. Resolve buffer: order > operation > sku > default
    let bufferHours = config.defaultBufferHours;
    let bufferSource: OperationDeadline['bufferSource'] = 'default';

    if (config.skuOverrides && config.skuOverrides[op.sku] !== undefined) {
      bufferHours = config.skuOverrides[op.sku];
      bufferSource = 'sku';
    }

    if (op.shippingBufferHours !== undefined) {
      bufferHours = op.shippingBufferHours;
      bufferSource = 'operation';
    }

    if (config.orderOverrides && config.orderOverrides[op.id] !== undefined) {
      bufferHours = config.orderOverrides[op.id];
      bufferSource = 'order';
    }

    // 3. Compute latest finish time
    // End of shipping day = shippingDayIdx * 1440 + S1 (24:00)
    // Subtract buffer
    const shippingDayEndAbs = shippingDayIdx * 1440 + S1;
    const bufferMin = bufferHours * 60;
    const latestFinishAbs = Math.max(0, shippingDayEndAbs - bufferMin);

    // Decompose into day + minute
    const latestFinishDay = Math.floor(latestFinishAbs / 1440);
    const latestFinishMin = latestFinishAbs % 1440;

    // Count working days available for production (day 0 up to latestFinishDay)
    let availableWorkdays = 0;
    for (let d = 0; d <= latestFinishDay && d < nDays; d++) {
      if (workdays[d]) availableWorkdays++;
    }
    const shippingDayIsWorkday = workdays[shippingDayIdx] ?? false;

    const deadline: OperationDeadline = {
      opId: op.id,
      shippingDayIdx,
      bufferHours,
      latestFinishAbs,
      latestFinishDay,
      latestFinishMin,
      bufferSource,
      availableWorkdays,
      shippingDayIsWorkday,
    };

    result.set(op.id, deadline);

    // Log the decision
    if (registry) {
      registry.record({
        type: 'SHIPPING_CUTOFF',
        opId: op.id,
        detail: `Op ${op.id} (${op.sku}): ship=day${shippingDayIdx}${shippingDayIsWorkday ? '' : ' (non-workday)'}, buffer=${bufferHours}h (${bufferSource}), latestFinish=day${latestFinishDay}@${latestFinishMin}min (abs=${latestFinishAbs}), ${availableWorkdays} workdays available`,
        metadata: {
          sku: op.sku,
          shippingDayIdx,
          shippingDayIsWorkday,
          bufferHours,
          bufferSource,
          latestFinishAbs,
          latestFinishDay,
          latestFinishMin,
          availableWorkdays,
        },
      });
    }
  }

  return result;
}
