// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Late Delivery Analysis
//  Pure read-only analysis of already-scheduled blocks.
//  Identifies demand checkpoints where cumProd < cumDemand
//  and enriches each entry with delay estimate + suggested actions.
//
//  Reference: computeOtdDeliveryFailures() in auto-route-overflow.ts
//             scoreSchedule().otdDelivery in score-schedule.ts
// ═══════════════════════════════════════════════════════════

import type { Block } from '../types/blocks.js';
import type { EOp } from '../types/engine.js';
import { getBlockQtyForOp } from '../utils/block-production.js';

// ── Types ─────────────────────────────────────────────────

export type SuggestedAction =
  | 'THIRD_SHIFT'
  | 'OVERTIME'
  | 'NEGOTIATE_DATE'
  | 'SPLIT'
  | 'FORMAL_ACCEPT';

export interface LateDeliveryEntry {
  opId: string;
  sku: string;
  nm: string;
  machineId: string;
  toolId: string;
  cl?: string;
  clNm?: string;
  /** Client tier 1-5 (1=highest priority, default 3) */
  clientTier: number;
  /** dayIdx of worst failed checkpoint */
  deadline: number;
  /** Calendar date string from dates[] */
  deadlineDate?: string;
  /** cumDemand - cumProd at worst checkpoint (positive) */
  shortfall: number;
  /** Estimated delay in working days */
  delayDays: number;
  /** dayIdx where cumProd finally covers cumDemand (or horizon end) */
  earliestPossibleDay: number;
  /** true if by end of horizon cumProd >= cumDemand */
  isResolved: boolean;
  /** How the delay was resolved (if isResolved) */
  resolvedBy?: 'ADVANCE' | 'ALT_MACHINE' | 'OVERTIME' | 'SPLIT';
  /** Heuristic suggested actions for the user */
  suggestedActions: SuggestedAction[];
}

export interface LateDeliveryAnalysis {
  entries: LateDeliveryEntry[];
  /** Count of entries where isResolved = false */
  unresolvedCount: number;
  /** Count of entries where isResolved = true (resolved with cost) */
  resolvedWithCostCount: number;
  /** Sum of shortfall across all entries */
  totalShortfallPcs: number;
  /** Unique client codes affected */
  affectedClients: string[];
  /** Lowest (worst) tier affected — 1 = most critical */
  worstTierAffected: number;
  /** Mirrors scoreSchedule otdDelivery (%) */
  otdDelivery: number;
}

// ── Main Analysis ─────────────────────────────────────────

/**
 * Analyze late deliveries from an already-scheduled set of blocks.
 *
 * Pure function, O(ops × days). Does NOT re-run the scheduler.
 * Mirrors the OTD-D logic from scoreSchedule() and computeOtdDeliveryFailures().
 *
 * @param blocks - Scheduled blocks (output of scheduling pipeline)
 * @param ops - Operations with demand (EngineData.ops, NOT raw NP)
 * @param dates - Calendar date strings (EngineData.dates)
 * @param clientTiers - Map of client code → tier (1-5). Missing = default 3.
 */
export function analyzeLateDeliveries(
  blocks: Block[],
  ops: EOp[],
  dates: string[],
  clientTiers: Record<string, number>,
): LateDeliveryAnalysis {
  const ok = blocks.filter((b) => b.type !== 'blocked');
  const entries: LateDeliveryEntry[] = [];

  // OTD-D tracking (mirrors scoreSchedule)
  let otdDOnTime = 0;
  let otdDTotal = 0;

  for (const op of ops) {
    // Twin-aware: include blocks where this op appears in outputs[]
    const opOkBlocks = ok.filter((b) => {
      if (b.isTwinProduction && b.outputs) return b.outputs.some((o) => o.opId === op.id);
      return b.opId === op.id;
    });

    let cumDemand = 0;
    let cumProd = 0;
    let worstShortfall = 0;
    let worstDay = -1;

    // Track per-day cumulative for checkpoint analysis
    const cumProdByDay: number[] = [];

    for (let d = 0; d < op.d.length; d++) {
      const dayDemand = Math.max(op.d[d] || 0, 0);
      cumDemand += dayDemand;
      cumProd += opOkBlocks
        .filter((b) => b.dayIdx === d)
        .reduce((s, b) => s + getBlockQtyForOp(b, op.id), 0);
      cumProdByDay.push(cumProd);

      // OTD-D counting
      if (dayDemand > 0) {
        otdDTotal++;
        if (cumProd >= cumDemand) otdDOnTime++;
      }

      // Checkpoint failure detection: demand day where cumProd < cumDemand
      if (dayDemand > 0 && cumProd < cumDemand) {
        const shortfall = cumDemand - cumProd;
        if (shortfall > worstShortfall) {
          worstShortfall = shortfall;
          worstDay = d;
        }
      }
    }

    // If no failed checkpoint for this op, skip
    if (worstDay < 0) continue;

    // Find earliestPossibleDay: scan forward from worstDay
    // until cumProd >= cumDemand at that checkpoint
    const totalCumDemandAtWorst = op.d
      .slice(0, worstDay + 1)
      .reduce((s, v) => s + Math.max(v || 0, 0), 0);
    let earliestPossibleDay = op.d.length; // default: horizon end
    let resolved = false;
    for (let d = worstDay + 1; d < op.d.length; d++) {
      if ((cumProdByDay[d] ?? 0) >= totalCumDemandAtWorst) {
        earliestPossibleDay = d;
        resolved = true;
        break;
      }
    }
    // Also check if final cumProd covers
    if (!resolved && cumProd >= totalCumDemandAtWorst) {
      earliestPossibleDay = op.d.length - 1;
      resolved = true;
    }

    const delayDays = Math.max(0, earliestPossibleDay - worstDay);
    const clientTier = (op.cl ? clientTiers[op.cl] : undefined) ?? 3;

    // Determine resolvedBy heuristic (if resolved)
    let resolvedBy: LateDeliveryEntry['resolvedBy'];
    if (resolved) {
      // Check if blocks exist on earlier days (advance) or alt machines
      const primaryMachine = op.m;
      const hasAltMachineBlocks = opOkBlocks.some((b) => b.machineId !== primaryMachine);
      if (hasAltMachineBlocks) {
        resolvedBy = 'ALT_MACHINE';
      } else if (opOkBlocks.some((b) => b.dayIdx < worstDay)) {
        resolvedBy = 'ADVANCE';
      } else {
        resolvedBy = 'OVERTIME';
      }
    }

    // Suggest actions based on delay severity and tier
    const suggestedActions: SuggestedAction[] = [];
    if (delayDays <= 2) {
      suggestedActions.push('OVERTIME');
    }
    if (delayDays >= 1 && delayDays <= 3) {
      suggestedActions.push('THIRD_SHIFT');
    }
    if (delayDays > 3) {
      suggestedActions.push('SPLIT');
    }
    if (delayDays > 5) {
      suggestedActions.push('NEGOTIATE_DATE');
    }
    suggestedActions.push('FORMAL_ACCEPT');

    entries.push({
      opId: op.id,
      sku: op.sku,
      nm: op.nm,
      machineId: op.m,
      toolId: op.t,
      cl: op.cl,
      clNm: op.clNm,
      clientTier,
      deadline: worstDay,
      deadlineDate: dates[worstDay],
      shortfall: worstShortfall,
      delayDays,
      earliestPossibleDay,
      isResolved: resolved,
      resolvedBy,
      suggestedActions,
    });
  }

  // Sort: unresolved first, then by tier (ascending = higher priority), then by delayDays desc
  entries.sort((a, b) => {
    if (a.isResolved !== b.isResolved) return a.isResolved ? 1 : -1;
    if (a.clientTier !== b.clientTier) return a.clientTier - b.clientTier;
    return b.delayDays - a.delayDays;
  });

  const unresolvedCount = entries.filter((e) => !e.isResolved).length;
  const resolvedWithCostCount = entries.filter((e) => e.isResolved).length;
  const totalShortfallPcs = entries.reduce((s, e) => s + e.shortfall, 0);

  const clientSet = new Set<string>();
  for (const e of entries) {
    if (e.cl) clientSet.add(e.cl);
  }

  const worstTierAffected =
    entries.length > 0 ? Math.min(...entries.map((e) => e.clientTier)) : 5;

  const otdDelivery = otdDTotal > 0 ? (otdDOnTime / otdDTotal) * 100 : 100;

  return {
    entries,
    unresolvedCount,
    resolvedWithCostCount,
    totalShortfallPcs,
    affectedClients: [...clientSet],
    worstTierAffected,
    otdDelivery,
  };
}
