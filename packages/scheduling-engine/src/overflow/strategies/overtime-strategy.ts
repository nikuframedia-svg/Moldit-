// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Overtime Strategy
//  Extends shift capacity by adding overtime minutes to
//  specific machine/day combinations.
//
//  Overtime extends beyond the normal day end (S1 = midnight
//  for 2-shift, S2 for 3-shift). This is modeled via the
//  overtimeMap in ScheduleAllInput.
//
//  Pure function — no side effects.
// ═══════════════════════════════════════════════════════════

import { S1, S2 } from '../../constants.js';
import type { ScheduleAllInput, ScheduleAllResult } from '../../scheduler/scheduler.js';
import { scheduleAll } from '../../scheduler/scheduler.js';
import type { Block, OvertimeAction } from '../../types/blocks.js';
import type { AutoReplanConfig } from '../auto-replan-config.js';

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

export interface OvertimeResult {
  activated: boolean;
  overtimeActions: OvertimeAction[];
  blocks: Block[];
  schedResult: ScheduleAllResult;
  overflowReduction: number;
}

// ── Main export ──────────────────────────────────────────

/**
 * Try adding overtime to machines with overflow.
 *
 * Algorithm:
 * 1. Find overflow blocks, identify which machine/days are at capacity
 * 2. For each candidate machine/day, compute needed extra minutes
 * 3. Cap at config limits
 * 4. Re-schedule with overtimeMap and validate improvement
 *
 * @returns OvertimeResult — activated=true if overtime improved the schedule
 */
export function tryOvertime(
  input: ScheduleAllInput,
  currentBlocks: Block[],
  currentOverflow: number,
  config: AutoReplanConfig['overtime'],
  /** Operations already handled by earlier strategies */
  excludeOps: Set<string>,
): OvertimeResult {
  // Don't add overtime when 3rd shift is already active (redundant)
  if (input.thirdShift) {
    return {
      activated: false,
      overtimeActions: [],
      blocks: currentBlocks,
      schedResult: scheduleAll({ ...input, enableLeveling: false, enforceDeadlines: false }),
      overflowReduction: 0,
    };
  }

  // Find overflow blocks and identify which machine/day pairs need extra time
  const overflowBlocks = currentBlocks.filter(
    (b) =>
      ((b.overflow && b.overflowMin != null && b.overflowMin > 0) ||
        (b.type === 'infeasible' && b.prodMin > 0)) &&
      !excludeOps.has(b.opId),
  );

  if (overflowBlocks.length === 0) {
    return {
      activated: false,
      overtimeActions: [],
      blocks: currentBlocks,
      schedResult: scheduleAll({ ...input, enableLeveling: false, enforceDeadlines: false }),
      overflowReduction: 0,
    };
  }

  // Collect unique machine/day combinations from overflow blocks
  // and compute how much overtime each needs
  const machDayNeeds = new Map<string, number>(); // key: "machineId:dayIdx"
  for (const ob of overflowBlocks) {
    const overflowMin = ob.overflow ? ob.overflowMin || 0 : ob.prodMin;
    const key = `${ob.machineId}:${ob.dayIdx}`;
    machDayNeeds.set(key, (machDayNeeds.get(key) ?? 0) + overflowMin);
  }

  // Build overtime map: deep copy to avoid aliasing caller's data
  const overtimeMap: Record<string, Record<number, number>> = {};
  for (const [mId, dayMap] of Object.entries(input.overtimeMap ?? {})) {
    overtimeMap[mId] = { ...dayMap };
  }
  const overtimeActions: OvertimeAction[] = [];

  // Track total overtime per day across all machines
  const dayTotals = new Map<number, number>();

  for (const [key, neededMin] of machDayNeeds) {
    const [machineId, dayIdxStr] = key.split(':');
    const dayIdx = parseInt(dayIdxStr, 10);

    // Current total for this day
    const currentDayTotal = dayTotals.get(dayIdx) ?? 0;

    // Cap at per-machine and per-day limits
    const existing = overtimeMap[machineId]?.[dayIdx] ?? 0;
    const maxForMachine = config.maxMinPerMachinePerDay - existing;
    const maxForDay = config.maxMinTotalPerDay - currentDayTotal;
    const extraMin = Math.min(neededMin, maxForMachine, maxForDay);

    if (extraMin <= 0) continue;

    if (!overtimeMap[machineId]) overtimeMap[machineId] = {};
    overtimeMap[machineId][dayIdx] = existing + extraMin;
    dayTotals.set(dayIdx, currentDayTotal + extraMin);

    overtimeActions.push({ machineId, dayIdx, extraMin });
  }

  if (overtimeActions.length === 0) {
    return {
      activated: false,
      overtimeActions: [],
      blocks: currentBlocks,
      schedResult: scheduleAll({ ...input, enableLeveling: false, enforceDeadlines: false }),
      overflowReduction: 0,
    };
  }

  // Re-schedule with overtime
  const newResult = scheduleAll({
    ...input,
    overtimeMap,
    enableLeveling: false,
    enforceDeadlines: false,
  });

  const newOverflow = sumOverflow(newResult.blocks);

  if (newOverflow < currentOverflow) {
    // Mark overtime blocks
    for (const b of newResult.blocks) {
      if (b.type !== 'ok') continue;
      const extra = overtimeMap[b.machineId]?.[b.dayIdx];
      if (extra && extra > 0) {
        // Check if this block's time extends into overtime territory
        const normalEnd = input.thirdShift ? S2 : S1;
        if (b.endMin > normalEnd) {
          b.isOvertime = true;
          b.overtimeMin = Math.min(b.endMin - normalEnd, extra);
          b.isSystemReplanned = true;
          b.replanStrategy = 'OVERTIME';
        }
      }
    }

    return {
      activated: true,
      overtimeActions,
      blocks: newResult.blocks,
      schedResult: newResult,
      overflowReduction: currentOverflow - newOverflow,
    };
  }

  // No improvement
  return {
    activated: false,
    overtimeActions: [],
    blocks: currentBlocks,
    schedResult: scheduleAll({ ...input, enableLeveling: false, enforceDeadlines: false }),
    overflowReduction: 0,
  };
}
