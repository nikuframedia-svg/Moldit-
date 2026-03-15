// =====================================================================
//  INCOMPOL PLAN — Schedule Violation Repair
//  Post-scheduling safety net: fix setup overlaps and overcapacity.
//
//  Runs after mergeConsecutiveBlocks and before deadline enforcement.
//  Catches edge cases from levelLoad/autoRouteOverflow interactions.
//
//  Pure function — no React, no side effects.
// =====================================================================

import { DAY_CAP, MINUTES_PER_DAY, S0, S2 } from '../constants.js';
import type { Block } from '../types/blocks.js';

// ── Setup Overlap Repair ─────────────────────────────────────────

/**
 * Fix setup crew overlaps by delaying later setups.
 *
 * Simulates the SetupCrew constraint on the final block set.
 * When two setups on different machines overlap in absolute time,
 * the later one is delayed to start after the earlier one ends.
 * Production start is adjusted accordingly, and production is clipped
 * if it would exceed the day boundary.
 */
function repairSetupOverlaps(blocks: Block[]): { blocks: Block[]; repaired: number } {
  const withSetup = blocks.filter(
    (b) => b.setupS != null && b.setupE != null && b.type === 'ok',
  );
  if (withSetup.length < 2) return { blocks, repaired: 0 };

  // Sort by absolute setup start time
  withSetup.sort((a, b) => {
    const absA = a.dayIdx * MINUTES_PER_DAY + a.setupS!;
    const absB = b.dayIdx * MINUTES_PER_DAY + b.setupS!;
    return absA - absB;
  });

  // Simulate setupCrew: track booked slots
  const booked: Array<{ start: number; end: number; machineId: string }> = [];
  let repaired = 0;

  for (const block of withSetup) {
    const absStart = block.dayIdx * MINUTES_PER_DAY + block.setupS!;
    const setupDur = block.setupE! - block.setupS!;

    // Find next available slot (same logic as createSetupCrew.findNextAvailable)
    let candidate = absStart;
    let changed = true;
    let iterations = 0;
    while (changed && iterations < 200) {
      changed = false;
      iterations++;
      for (const s of booked) {
        if (s.machineId === block.machineId) continue; // same machine is fine
        if (candidate < s.end && candidate + setupDur > s.start) {
          candidate = s.end;
          changed = true;
        }
      }
    }

    // Book this slot
    booked.push({ start: candidate, end: candidate + setupDur, machineId: block.machineId });

    // If we had to delay, update the block
    if (candidate !== absStart) {
      const newDay = Math.floor(candidate / MINUTES_PER_DAY);
      const newSetupS = candidate % MINUTES_PER_DAY;
      const newSetupE = newSetupS + setupDur;
      const prodDur = block.endMin - block.startMin;

      block.dayIdx = newDay;
      block.setupS = newSetupS;
      block.setupE = newSetupE;
      block.startMin = newSetupE;
      block.endMin = newSetupE + prodDur;

      // Clip if production extends past midnight (S1=1440)
      const dayEnd = 1440; // S1 — 2-shift day end
      if (block.endMin > dayEnd) {
        const clipped = block.endMin - dayEnd;
        block.endMin = dayEnd;
        block.prodMin = Math.max(0, block.prodMin - clipped);
        if (block.qty > 0 && block.prodMin > 0) {
          const origProd = prodDur;
          block.qty = Math.round(block.qty * (block.prodMin / origProd));
        }
      }

      repaired++;
    }
  }

  return { blocks, repaired };
}

// ── Overcapacity Repair ──────────────────────────────────────────

/**
 * Fix machine overcapacity by clipping the last block on overloaded days.
 *
 * For each machine-day where total minutes exceed effective capacity,
 * reduces the production of the last-ending block to fit within capacity.
 * Excess is converted to overflow.
 *
 * Accounts for overtime (overtimeMap) and 3rd shift.
 */
function repairOvercapacity(
  blocks: Block[],
  thirdShift?: boolean,
  overtimeMap?: Record<string, Record<number, number>>,
): { blocks: Block[]; repaired: number } {
  const baseCap = thirdShift ? S2 - S0 : DAY_CAP;
  let repaired = 0;

  // Group blocks by machine-day
  const mdMap = new Map<string, { machineId: string; dayIdx: number; blocks: Block[] }>();
  for (const b of blocks) {
    if (b.type !== 'ok') continue;
    const key = `${b.machineId}:${b.dayIdx}`;
    if (!mdMap.has(key)) mdMap.set(key, { machineId: b.machineId, dayIdx: b.dayIdx, blocks: [] });
    mdMap.get(key)!.blocks.push(b);
  }

  for (const [, { machineId, dayIdx, blocks: dayBlocks }] of mdMap) {
    let totalMin = 0;
    for (const b of dayBlocks) {
      totalMin += b.endMin - b.startMin;
      if (b.setupS != null && b.setupE != null) totalMin += b.setupE - b.setupS;
    }

    // Effective capacity includes overtime for this machine-day
    const ot = overtimeMap?.[machineId]?.[dayIdx] ?? 0;
    const eDayCap = baseCap + ot;

    if (Math.round(totalMin) <= eDayCap) continue;

    const excess = Math.round(totalMin) - eDayCap;

    // Find the block with the latest endMin — clip it
    dayBlocks.sort((a, b) => b.endMin - a.endMin);
    const victim = dayBlocks[0];

    const prodDur = victim.endMin - victim.startMin;
    const clipMin = Math.min(excess, prodDur);

    if (clipMin >= prodDur) {
      // Entire block becomes overflow
      victim.type = 'overflow';
    } else {
      // Clip production from the end
      const newProd = prodDur - clipMin;
      if (victim.qty > 0 && prodDur > 0) {
        victim.qty = Math.round(victim.qty * (newProd / prodDur));
      }
      victim.endMin -= clipMin;
      victim.prodMin = Math.max(0, victim.prodMin - clipMin);

      // Create overflow block for the clipped portion
      const overflowBlock: Block = {
        ...victim,
        startMin: victim.endMin,
        endMin: victim.endMin + clipMin,
        qty: Math.round((victim.qty / Math.max(1, newProd)) * clipMin),
        prodMin: clipMin,
        setupMin: 0,
        setupS: null,
        setupE: null,
        type: 'overflow',
      };
      blocks.push(overflowBlock);
    }

    repaired++;
  }

  return { blocks, repaired };
}

// ── Main Export ───────────────────────────────────────────────────

/**
 * Post-scheduling repair pass. Fixes:
 * 1. Setup crew overlaps (2+ setups on different machines simultaneously)
 * 2. Machine overcapacity (day exceeding effective DAY_CAP)
 *
 * Returns the repaired block array and a count of fixes applied.
 * When no violations exist, returns blocks unchanged.
 */
export function repairScheduleViolations(
  blocks: Block[],
  thirdShift?: boolean,
  overtimeMap?: Record<string, Record<number, number>>,
): { blocks: Block[]; setupRepairs: number; capacityRepairs: number } {
  // Work on a mutable copy
  const result = blocks.map((b) => ({ ...b }));

  const { repaired: setupRepairs } = repairSetupOverlaps(result);
  const { blocks: finalBlocks, repaired: capacityRepairs } = repairOvercapacity(
    result,
    thirdShift,
    overtimeMap,
  );

  return { blocks: finalBlocks, setupRepairs, capacityRepairs };
}
