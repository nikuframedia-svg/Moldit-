// =====================================================================
//  INCOMPOL PLAN -- Dispatch Rules & Group Sorting
//  Comparators for EDD, CR, WSPT, SPT dispatch rules.
//  Tool merging logic to reduce redundant setups.
//  Supply boost priority override.
//
//  Pure functions -- no React, no side effects.
// =====================================================================

import { DAY_CAP, MAX_EDD_GAP } from '../constants.js';
import type { DispatchRule } from '../types/kpis.js';
import type { ATCSParams } from './atcs-dispatch.js';
import { atcsPriority, computeATCSAverages, DEFAULT_ATCS_PARAMS } from './atcs-dispatch.js';
import type { ToolGroup } from './demand-grouper.js';

// ── Supply boost extraction ─────────────────────────────────────────

/** Get the maximum supply boost for a tool group */
function maxBoost(g: ToolGroup, supplyBoosts?: Map<string, { boost: number }>): number {
  if (!supplyBoosts) return 0;
  return Math.max(0, ...g.skus.map((sk) => supplyBoosts.get(sk.opId)?.boost ?? 0));
}

// ── Dispatch comparators ────────────────────────────────────────────

/**
 * Creates a group comparator function for the specified dispatch rule.
 *
 * Rules:
 * - **EDD** (Earliest Due Date): lower edd first, tiebreak by larger production
 * - **CR** (Critical Ratio): (time remaining) / (processing time), lower = more urgent
 * - **WSPT** (Weighted Shortest Processing Time): weight/time descending
 * - **SPT** (Shortest Processing Time): ascending production time
 *
 * Supply boost always takes primary priority (higher boost = schedule first).
 *
 * @param rule          - Dispatch rule to use
 * @param supplyBoosts  - Optional supply boost map
 * @returns Comparator function for Array.sort()
 */
export function createGroupComparator(
  rule: DispatchRule,
  supplyBoosts?: Map<string, { boost: number }>,
  atcsContext?: { avgProdMin: number; avgSetupMin: number; params: ATCSParams },
): (a: ToolGroup, b: ToolGroup) => number {
  return (a: ToolGroup, b: ToolGroup): number => {
    // Supply boost takes priority -- higher boost = schedule first
    const ba = maxBoost(a, supplyBoosts);
    const bb = maxBoost(b, supplyBoosts);
    if (ba !== bb) return bb - ba;

    switch (rule) {
      case 'CR': {
        // Critical Ratio: (time remaining) / (processing time). Lower = more urgent.
        // Uses DAY_CAP because totalProdMin already has OEE baked in
        // from demand-grouper: prodMin = (qty / pH) * 60 / OEE
        const crA = a.edd <= 0 ? 0 : a.edd / Math.max(a.totalProdMin / DAY_CAP, 0.01);
        const crB = b.edd <= 0 ? 0 : b.edd / Math.max(b.totalProdMin / DAY_CAP, 0.01);
        return crA !== crB ? crA - crB : b.totalProdMin - a.totalProdMin;
      }
      case 'WSPT': {
        // Weighted Shortest Processing Time: weight/time descending (higher ratio = schedule first)
        const totalA = a.skus.reduce((s, sk) => s + sk.totalQty, 0);
        const totalB = b.skus.reduce((s, sk) => s + sk.totalQty, 0);
        const ratioA = totalA / Math.max(a.totalProdMin, 1);
        const ratioB = totalB / Math.max(b.totalProdMin, 1);
        return ratioB - ratioA;
      }
      case 'SPT':
        // Shortest Processing Time: ascending production time
        return a.totalProdMin !== b.totalProdMin ? a.totalProdMin - b.totalProdMin : a.edd - b.edd;
      case 'ATCS': {
        // ATCS: higher priority index = schedule first
        const ctx = atcsContext ?? {
          avgProdMin: 100,
          avgSetupMin: 30,
          params: DEFAULT_ATCS_PARAMS,
        };
        // Static comparator: no previous-tool context, so previousToolId = null
        const prioA = atcsPriority(a, null, ctx.params, ctx.avgProdMin, ctx.avgSetupMin);
        const prioB = atcsPriority(b, null, ctx.params, ctx.avgProdMin, ctx.avgSetupMin);
        return prioB - prioA;
      }
      default: // EDD
        return a.edd !== b.edd ? a.edd - b.edd : b.totalProdMin - a.totalProdMin;
    }
  };
}

// ── Tool merging ────────────────────────────────────────────────────

/**
 * Merge consecutive tool-groups for the same tool to reduce redundant setups.
 *
 * After EDD sort, Tool-A-bucket1 then Tool-B-bucket then Tool-A-bucket2
 * would cause 2 setups for Tool-A. This pulls Tool-A-bucket2 right after
 * bucket1, but ONLY if the EDD gap <= MAX_EDD_GAP to avoid delaying
 * intermediate deliveries.
 *
 * @param groups      - Sorted tool groups for one machine
 * @param maxEddGap   - Max days between buckets to allow merging
 * @returns Merged group list with reduced setup transitions
 */
export function mergeConsecutiveTools(
  groups: ToolGroup[],
  maxEddGap: number = MAX_EDD_GAP,
): ToolGroup[] {
  const merged: ToolGroup[] = [];
  const used = new Set<number>();

  for (let i = 0; i < groups.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    merged.push(groups[i]);

    // Pull forward subsequent buckets for the same tool (if EDD gap is small enough)
    let lastEdd = groups[i].edd;
    for (let j = i + 1; j < groups.length; j++) {
      if (used.has(j)) continue;
      if (groups[j].toolId === groups[i].toolId && groups[j].edd - lastEdd <= maxEddGap) {
        used.add(j);
        merged.push(groups[j]);
        lastEdd = groups[j].edd;
      }
    }
  }

  return merged;
}

/**
 * G5: Material-part merging -- group tools that share the same MP consecutively.
 * Reduces material changeovers (same coil/sheet can serve multiple tools).
 * Only reorders within a small EDD window to avoid delaying urgent deliveries.
 *
 * @param groups      - Tool-merged group list
 * @param maxEddGap   - Max EDD gap for material merging
 * @returns Groups reordered to minimize material changeovers
 */
export function mergeMaterialParts(
  groups: ToolGroup[],
  maxEddGap: number = MAX_EDD_GAP,
): ToolGroup[] {
  const mpMerged: ToolGroup[] = [];
  const mpUsed = new Set<number>();

  for (let i = 0; i < groups.length; i++) {
    if (mpUsed.has(i)) continue;
    mpUsed.add(i);
    mpMerged.push(groups[i]);

    const mp = groups[i].tool.mp;
    if (!mp) continue;

    // Pull forward groups with same MP (if EDD gap is small)
    for (let j = i + 1; j < groups.length; j++) {
      if (mpUsed.has(j)) continue;
      if (groups[j].tool.mp === mp && groups[j].edd - groups[i].edd <= maxEddGap) {
        mpUsed.add(j);
        mpMerged.push(groups[j]);
      }
    }
  }

  return mpMerged;
}

// ── SKU intra-group sort ────────────────────────────────────────────

/**
 * Sort SKUs within each tool group by urgency:
 * 1. Backlog (atr > 0) first
 * 2. Zero-stock items with lot economic first
 * 3. Largest quantity first (tiebreaker)
 *
 * @param groups - Tool groups (mutated in place)
 */
export function sortSkusWithinGroups(groups: ToolGroup[]): void {
  for (const g of groups) {
    g.skus.sort((a, b) => {
      if (a.atr > 0 && b.atr === 0) return -1;
      if (b.atr > 0 && a.atr === 0) return 1;
      if (a.stk === 0 && a.lt > 0 && !(b.stk === 0 && b.lt > 0)) return -1;
      if (b.stk === 0 && b.lt > 0 && !(a.stk === 0 && a.lt > 0)) return 1;
      return b.totalQty - a.totalQty;
    });
  }
}

// ── Full sort + merge pipeline ──────────────────────────────────────

/**
 * Apply the complete dispatch pipeline to groups for one machine:
 * 1. Sort by dispatch rule (with supply boost override)
 * 2. Merge consecutive same-tool groups
 * 3. Merge same-material-part groups
 * 4. Sort SKUs within each group
 *
 * @param groups         - Unsorted tool groups for one machine
 * @param rule           - Dispatch rule to apply
 * @param supplyBoosts   - Optional supply boost map
 * @returns Sorted, merged groups ready for scheduling
 */
export function sortAndMergeGroups(
  groups: ToolGroup[],
  rule: DispatchRule,
  supplyBoosts?: Map<string, { boost: number }>,
  atcsParams?: ATCSParams,
): ToolGroup[] {
  // For ATCS, pre-compute averages from the group set (needed by the priority formula)
  const atcsContext =
    rule === 'ATCS'
      ? { ...computeATCSAverages(groups), params: atcsParams ?? DEFAULT_ATCS_PARAMS }
      : undefined;
  const comparator = createGroupComparator(rule, supplyBoosts, atcsContext);
  const sorted = [...groups].sort(comparator);

  const toolMerged = mergeConsecutiveTools(sorted);
  const mpMerged = mergeMaterialParts(toolMerged);

  sortSkusWithinGroups(mpMerged);

  return mpMerged;
}

// ── Machine ordering ────────────────────────────────────────────────

/**
 * Order machines by urgency of their first group.
 * Machines with no-alt tools get priority (can't be rerouted).
 *
 * @param machines      - All machines
 * @param mGroups       - Machine -> sorted groups map
 * @param comparator    - Group comparator function
 * @returns Machines sorted by scheduling urgency
 */
export function orderMachinesByUrgency(
  machines: { id: string }[],
  mGroups: Record<string, ToolGroup[]>,
  comparator: (a: ToolGroup, b: ToolGroup) => number,
): { id: string }[] {
  return machines
    .filter((m) => mGroups[m.id]?.length)
    .sort((a, b) => {
      const urgA = mGroups[a.id]?.[0];
      const urgB = mGroups[b.id]?.[0];
      if (urgA && urgB) {
        const d = comparator(urgA, urgB);
        if (d !== 0) return d;
      }
      // Tiebreaker: machines with no-alt tools get priority (can't be rerouted)
      const aNoAlt = mGroups[a.id]?.some((g) => g.skus.some((s) => !s.hasAlt)) ? 0 : 1;
      const bNoAlt = mGroups[b.id]?.some((g) => g.skus.some((s) => !s.hasAlt)) ? 0 : 1;
      if (aNoAlt !== bNoAlt) return aNoAlt - bNoAlt;
      return a.id.localeCompare(b.id);
    });
}
