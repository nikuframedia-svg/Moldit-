// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Third Shift Strategy
//  Activates the 3rd shift (Z: 00:00-07:00, +420 min/day)
//  as a LAST RESORT when all other strategies have failed.
//
//  This is a GLOBAL toggle — activates 3rd shift on ALL machines.
//
//  Pure function — no side effects.
// ═══════════════════════════════════════════════════════════

import type { ScheduleAllInput, ScheduleAllResult } from '../../scheduler/scheduler.js';
import { scheduleAll } from '../../scheduler/scheduler.js';
import type { Block } from '../../types/blocks.js';

// ── Helpers ──────────────────────────────────────────────

/** Sum total overflow minutes */
function sumOverflow(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.overflow && b.overflowMin) return sum + b.overflowMin;
    if (b.type === 'infeasible' && b.prodMin > 0) return sum + b.prodMin;
    return sum;
  }, 0);
}

// ── Types ────────────────────────────────────────────────

export interface ThirdShiftResult {
  activated: boolean;
  blocks: Block[];
  schedResult: ScheduleAllResult;
  overflowReduction: number;
}

// ── Main export ──────────────────────────────────────────

/**
 * Try activating the 3rd shift globally.
 *
 * @param input - Current scheduling input
 * @param currentBlocks - Current schedule blocks
 * @param currentOverflow - Current total overflow minutes
 * @returns ThirdShiftResult — activated=true if 3rd shift improved the schedule
 */
export function tryThirdShift(
  input: ScheduleAllInput,
  currentBlocks: Block[],
  currentOverflow: number,
): ThirdShiftResult {
  // Already active — nothing to do
  if (input.thirdShift) {
    return {
      activated: false,
      blocks: currentBlocks,
      schedResult: scheduleAll({ ...input, enableLeveling: false, enforceDeadlines: false }),
      overflowReduction: 0,
    };
  }

  // Re-run with 3rd shift enabled
  const newResult = scheduleAll({
    ...input,
    thirdShift: true,
    enableLeveling: false,
    enforceDeadlines: false,
  });

  const newOverflow = sumOverflow(newResult.blocks);

  if (newOverflow < currentOverflow) {
    // Mark all blocks in Z shift as system-replanned
    for (const b of newResult.blocks) {
      if (b.shift === 'Z' && b.type === 'ok') {
        b.isSystemReplanned = true;
        b.replanStrategy = 'THIRD_SHIFT';
      }
    }

    return {
      activated: true,
      blocks: newResult.blocks,
      schedResult: newResult,
      overflowReduction: currentOverflow - newOverflow,
    };
  }

  // No improvement
  return {
    activated: false,
    blocks: currentBlocks,
    schedResult: scheduleAll({ ...input, enableLeveling: false, enforceDeadlines: false }),
    overflowReduction: 0,
  };
}
