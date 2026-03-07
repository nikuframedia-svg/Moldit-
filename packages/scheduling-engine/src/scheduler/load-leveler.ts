// =====================================================================
//  INCOMPOL PLAN -- Load Leveler
//  Post-scheduling pass: balance machine utilization across days.
//
//  After initial scheduling, find light days (< 50% util) and heavy
//  days (> 85% util), then move blocks from heavy to light days.
//
//  Constraints:
//  - Only move FORWARD (to earlier days), never delay deliveries
//  - Legacy pipeline: respect backward-scheduling earliestStart dates
//  - New pipeline (deadlines present): ignore earliestStart (Prz.Fabrico
//    is informational), moving earlier is always safe vs deadline
//  - Prefer moving high-volume blocks and close deliveries
//  - Record every move in the DecisionRegistry
//
//  NEW module -- not extracted from NikufraEngine.
//  Pure function -- no React, no side effects.
// =====================================================================

import {
  DAY_CAP,
  LEVEL_HIGH_THRESHOLD,
  LEVEL_LOOKAHEAD,
  LEVEL_LOW_THRESHOLD,
} from '../constants.js';
import type { DecisionRegistry } from '../decisions/decision-registry.js';
import type { Block } from '../types/blocks.js';
import type { EMachine } from '../types/engine.js';
import type { OperationDeadline } from '../types/shipping.js';
import type { EarliestStartEntry } from './backward-scheduler.js';

// ── Types ───────────────────────────────────────────────────────────

/** Per-machine per-day utilization snapshot */
interface DayUtil {
  machineId: string;
  dayIdx: number;
  usedMin: number;
  util: number; // 0.0 - 1.0+
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Compute per-machine per-day utilization from blocks.
 */
function computeUtilization(
  blocks: Block[],
  machines: EMachine[],
  workdays: boolean[],
  nDays: number,
): Map<string, DayUtil[]> {
  const utilMap = new Map<string, DayUtil[]>();

  for (const m of machines) {
    const days: DayUtil[] = [];
    for (let d = 0; d < nDays; d++) {
      if (!workdays[d]) continue;
      const dayBlocks = blocks.filter(
        (b) => b.machineId === m.id && b.dayIdx === d && b.type === 'ok',
      );
      const usedMin = dayBlocks.reduce((s, b) => s + b.prodMin + b.setupMin, 0);
      days.push({
        machineId: m.id,
        dayIdx: d,
        usedMin,
        util: usedMin / DAY_CAP,
      });
    }
    utilMap.set(m.id, days);
  }

  return utilMap;
}

/**
 * Check if a block can be moved to an earlier day.
 *
 * When deadlines are present (new pipeline), the earliestStart from
 * Prz.Fabrico is ignored — the shipping deadline is the law, and
 * moving earlier can never violate it.
 *
 * When deadlines are absent (legacy pipeline), earliestStart is
 * respected as before.
 */
function canMoveForward(
  block: Block,
  targetDay: number,
  earliestStarts: Map<string, EarliestStartEntry>,
  hasDeadlines: boolean,
): boolean {
  // Never move to a later day
  if (targetDay >= block.dayIdx) return false;

  // Respect backward scheduling ONLY when legacy pipeline is active.
  // When shipping cutoff is active, Prz.Fabrico is informational only —
  // the deadline controls timing, and moving earlier is always safe.
  if (!hasDeadlines) {
    const es = earliestStarts.get(block.opId);
    if (es && targetDay < es.earliestDayIdx) return false;
  }

  // Don't move blocked or overflow blocks
  if (block.type !== 'ok') return false;

  return true;
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Level load across days by moving blocks from heavy days to light days.
 *
 * Algorithm:
 * 1. Compute per-machine per-day utilization
 * 2. For each machine, identify heavy days (> LEVEL_HIGH_THRESHOLD)
 * 3. For each heavy day, find blocks that can move forward
 * 4. For each candidate block, find a light day (< LEVEL_LOW_THRESHOLD)
 *    within LEVEL_LOOKAHEAD days earlier
 * 5. Move the block (update dayIdx, startMin, endMin) and record the decision
 *
 * Only moves FORWARD (to earlier days). Never delays deliveries.
 *
 * @param blocks          - Merged blocks from the scheduler
 * @param machines        - All machines
 * @param workdays        - Per-day workday flags
 * @param earliestStarts  - Backward-scheduling constraints
 * @param registry        - Decision registry for tracking moves
 * @returns New block array with leveled load
 */
export function levelLoad(
  blocks: Block[],
  machines: EMachine[],
  workdays: boolean[],
  earliestStarts: Map<string, EarliestStartEntry>,
  registry: DecisionRegistry,
  deadlines?: Map<string, OperationDeadline>,
): Block[] {
  const nDays = workdays.length;
  // Work on a mutable copy
  const result = blocks.map((b) => ({ ...b }));

  // Build working day list
  const wDays: number[] = [];
  for (let d = 0; d < nDays; d++) {
    if (workdays[d]) wDays.push(d);
  }

  if (wDays.length < 2) return result;

  const hasDeadlines = !!deadlines && deadlines.size > 0;

  // Iterate per machine
  for (const mach of machines) {
    const mId = mach.id;

    // Compute utilization for this machine
    const utilMap = computeUtilization(result, [mach], workdays, nDays);
    const dayUtils = utilMap.get(mId);
    if (!dayUtils) continue;

    // Find heavy days (sorted by utilization descending -- handle worst first)
    const heavyDays = dayUtils
      .filter((du) => du.util > LEVEL_HIGH_THRESHOLD)
      .sort((a, b) => b.util - a.util);

    for (const heavy of heavyDays) {
      // Find candidate blocks on this heavy day, sorted by volume descending
      const candidateBlocks = result
        .filter((b) => b.machineId === mId && b.dayIdx === heavy.dayIdx && b.type === 'ok')
        .sort((a, b) => b.prodMin - a.prodMin);

      for (const block of candidateBlocks) {
        // Find the position of this day in the working day list
        const heavyWdIdx = wDays.indexOf(heavy.dayIdx);
        if (heavyWdIdx < 0) continue;

        // Look backward for a light day within LEVEL_LOOKAHEAD working days
        let moved = false;
        for (let look = 1; look <= LEVEL_LOOKAHEAD && heavyWdIdx - look >= 0; look++) {
          const targetDay = wDays[heavyWdIdx - look];

          // Check eligibility
          if (!canMoveForward(block, targetDay, earliestStarts, hasDeadlines)) continue;

          // Compute utilization of target day (recalculate from current state)
          const targetBlocks = result.filter(
            (b) => b.machineId === mId && b.dayIdx === targetDay && b.type === 'ok',
          );
          const targetUsed = targetBlocks.reduce((s, b) => s + b.prodMin + b.setupMin, 0);
          const targetUtil = targetUsed / DAY_CAP;

          if (targetUtil >= LEVEL_LOW_THRESHOLD) continue;

          // Check if adding this block would keep target below high threshold
          const newTargetUtil = (targetUsed + block.prodMin + block.setupMin) / DAY_CAP;
          if (newTargetUtil > LEVEL_HIGH_THRESHOLD) continue;

          // Move the block
          const origDay = block.dayIdx;
          block.dayIdx = targetDay;
          block.isLeveled = true;

          // Record the move in the decision registry
          registry.record({
            type: 'LOAD_LEVEL',
            opId: block.opId,
            toolId: block.toolId,
            machineId: mId,
            dayIdx: targetDay,
            shift: block.shift,
            detail: `Moved ${block.sku} from day ${origDay} (${Math.round(heavy.util * 100)}% util) to day ${targetDay} (${Math.round(targetUtil * 100)}% util)`,
            metadata: {
              fromDay: origDay,
              toDay: targetDay,
              fromUtil: heavy.util,
              toUtil: targetUtil,
              prodMin: block.prodMin,
              sku: block.sku,
            },
          });

          moved = true;
          break;
        }

        // After moving one block, re-check if this day is still heavy
        if (moved) {
          const updatedUsed = result
            .filter((b) => b.machineId === mId && b.dayIdx === heavy.dayIdx && b.type === 'ok')
            .reduce((s, b) => s + b.prodMin + b.setupMin, 0);
          heavy.usedMin = updatedUsed;
          heavy.util = updatedUsed / DAY_CAP;
          if (heavy.util <= LEVEL_HIGH_THRESHOLD) break;
        }
      }
    }
  }

  return result;
}
