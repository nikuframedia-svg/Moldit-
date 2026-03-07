// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Workforce Demand Computation
//  Per-labor-group, per-window, per-day peak concurrent operator demand.
//
//  Window-based model: capacity varies within a shift
//  (e.g. 07:00-15:30=6, 15:30-16:00=6, 16:00-00:00=5 for Grandes).
//
//  Peak concurrent = sum of max(operators per machine) in each
//  labor group, evaluated per window.
// ═══════════════════════════════════════════════════════════

import { T1 } from '../constants.js';
import type { Block, ZoneShiftDemand } from '../types/blocks.js';
import type { WorkforceConfig } from '../types/workforce.js';

// ── Types ────────────────────────────────────────────────────

export interface WorkforceDemandResult {
  /** All demand entries: per labor group × window × day */
  entries: ZoneShiftDemand[];
  /** Overloaded entries only (for warnings) */
  warnings: ZoneShiftDemand[];
  /** Peak total operators across all groups in any single day/window */
  peakTotal: number;
  /** Max overload (max(0, peakNeed - capacity)) across all entries */
  maxOverload: number;
}

// ── Helpers ──────────────────────────────────────────────────

/** Derive shift code from a minute within the day */
function minuteToShift(minute: number): 'X' | 'Y' {
  return minute < T1 ? 'X' : 'Y';
}

// ── Main Computation ────────────────────────────────────────

/**
 * Compute workforce demand per labor group × window × day from scheduled blocks.
 *
 * For each (day, laborGroup, window):
 *   1. Find blocks that overlap this window
 *   2. Group by machine (only machines mapped to the labor group)
 *   3. Find peak operators per machine (concurrent peak model)
 *   4. Sum peaks across all machines in the group
 *   5. Compare against configured capacity for this window
 *   6. Compute peakShortage, overloadPeopleMinutes, shortageMinutes
 *
 * @param blocks - Scheduled blocks
 * @param config - Workforce configuration (laborGroups + machine mapping)
 * @param nDays  - Total days in horizon (optional, derived from blocks if absent)
 * @returns WorkforceDemandResult with entries, warnings, and summary metrics
 */
export function computeWorkforceDemand(
  blocks: Block[],
  config: WorkforceConfig,
  nDays?: number,
): WorkforceDemandResult {
  const totalDays = nDays ?? (blocks.length > 0 ? Math.max(...blocks.map((b) => b.dayIdx)) + 1 : 0);

  // Build reverse map: laborGroup → machineIds
  const groupMachines: Record<string, Set<string>> = {};
  for (const [machineId, laborGroup] of Object.entries(config.machineToLaborGroup)) {
    if (!groupMachines[laborGroup]) groupMachines[laborGroup] = new Set();
    groupMachines[laborGroup].add(machineId);
  }

  const entries: ZoneShiftDemand[] = [];
  const warnings: ZoneShiftDemand[] = [];
  let peakTotal = 0;
  let maxOverload = 0;

  for (let di = 0; di < totalDays; di++) {
    // Get all active blocks for this day
    const dayBlocks = blocks.filter((b) => b.dayIdx === di && b.type !== 'blocked');

    let dayTotal = 0;

    for (const laborGroup of Object.keys(config.laborGroups)) {
      const machSet = groupMachines[laborGroup];
      const windows = config.laborGroups[laborGroup];

      for (const w of windows) {
        if (!machSet) {
          // Labor group has no machines mapped — emit zero entry
          const shift = minuteToShift(w.start);
          entries.push({
            laborGroup,
            shift,
            dayIdx: di,
            windowStart: w.start,
            windowEnd: w.end,
            peakNeed: 0,
            capacity: w.capacity,
            overloaded: false,
            peakShortage: 0,
            overloadPeopleMinutes: 0,
            shortageMinutes: 0,
          });
          continue;
        }

        // Find blocks that overlap this window [w.start, w.end)
        const windowBlocks = dayBlocks.filter((b) => {
          if (!machSet.has(b.machineId)) return false;
          return b.startMin < w.end && b.endMin > w.start;
        });

        // Find peak operators per machine in this window
        const machPeaks: Record<string, number> = {};
        for (const b of windowBlocks) {
          machPeaks[b.machineId] = Math.max(machPeaks[b.machineId] || 0, b.operators);
        }

        // Sum peaks across machines in group
        let peakNeed = 0;
        for (const ops of Object.values(machPeaks)) {
          peakNeed += ops;
        }

        const capacity = w.capacity;
        const overloaded = peakNeed > capacity;
        const peakShortage = Math.max(0, peakNeed - capacity);

        // overloadPeopleMinutes: shortage × window duration
        const windowDuration = w.end - w.start;
        const overloadPeopleMinutes = overloaded ? peakShortage * windowDuration : 0;

        // shortageMinutes: total window duration where capacity exceeded
        const shortageMinutes = overloaded ? windowDuration : 0;

        const shift = minuteToShift(w.start);

        const entry: ZoneShiftDemand = {
          laborGroup,
          shift,
          dayIdx: di,
          windowStart: w.start,
          windowEnd: w.end,
          peakNeed,
          capacity,
          overloaded,
          peakShortage,
          overloadPeopleMinutes,
          shortageMinutes,
        };
        entries.push(entry);
        if (overloaded) warnings.push(entry);

        dayTotal += peakNeed;
        if (peakShortage > maxOverload) maxOverload = peakShortage;
      }
    }

    if (dayTotal > peakTotal) peakTotal = dayTotal;
  }

  return { entries, warnings, peakTotal, maxOverload };
}
