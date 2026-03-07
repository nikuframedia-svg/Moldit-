// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Split Operation Strategy
//  Divides an overflow operation between primary and alt machine.
//
//  Creates a synthetic operation for the overflow portion
//  and moves it to the alternative machine.
//
//  Pure function — no side effects.
// ═══════════════════════════════════════════════════════════

import { ALT_UTIL_THRESHOLD, DAY_CAP, S0, S2 } from '../../constants.js';
import type { ScheduleAllInput, ScheduleAllResult } from '../../scheduler/scheduler.js';
import { scheduleAll } from '../../scheduler/scheduler.js';
import type { Block } from '../../types/blocks.js';
import type { EOp } from '../../types/engine.js';
import type { AutoReplanConfig } from '../auto-replan-config.js';

// ── Helpers ──────────────────────────────────────────────

/** Sum total overflow minutes across all overflow/infeasible blocks */
function sumOverflow(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.overflow && b.overflowMin) return sum + b.overflowMin;
    if (b.type === 'infeasible' && b.prodMin > 0) return sum + b.prodMin;
    return sum;
  }, 0);
}

/** Compute per-machine utilization */
function machineUtil(
  blocks: Block[],
  machineId: string,
  workdays: boolean[],
  thirdShift?: boolean,
): number {
  const hardCap = thirdShift ? S2 - S0 : DAY_CAP;
  const wDayCount = workdays.filter(Boolean).length;
  const totalCap = wDayCount * hardCap;
  if (totalCap === 0) return 1;
  const used = blocks
    .filter((b) => b.machineId === machineId && b.type === 'ok')
    .reduce((s, b) => s + b.prodMin + b.setupMin, 0);
  return used / totalCap;
}

// ── Types ────────────────────────────────────────────────

export interface SplitCandidate {
  opId: string;
  toolId: string;
  machineId: string;
  altMachine: string;
  overflowMin: number;
  /** Fraction to move to alt machine */
  fraction: number;
  /** Total demand for the operation */
  totalDemand: number;
  /** Demand to keep on primary */
  primaryDemand: number;
  /** Demand to move to alt */
  altDemand: number;
}

export interface SplitResult {
  split: boolean;
  candidate?: SplitCandidate;
  syntheticOp?: EOp;
  blocks: Block[];
  schedResult: ScheduleAllResult;
  overflowReduction: number;
}

// ── Main export ──────────────────────────────────────────

/**
 * Try splitting an overflow operation between primary and alt machine.
 *
 * Algorithm:
 * 1. Find overflow blocks with alt machines available
 * 2. Compute fraction: how much the primary can handle vs total demand
 * 3. Create synthetic operation with the overflow portion
 * 4. Move synthetic to alt machine
 * 5. Re-schedule and validate improvement
 *
 * @returns SplitResult with the new schedule if improved, otherwise original
 */
export function trySplitOperation(
  input: ScheduleAllInput,
  currentBlocks: Block[],
  currentOverflow: number,
  config: AutoReplanConfig['split'],
  /** Operations already handled by earlier strategies */
  excludeOps: Set<string>,
): SplitResult {
  // Find overflow blocks with alt machines, sorted by biggest overflow first
  const candidates = currentBlocks
    .filter(
      (b) =>
        ((b.overflow && b.overflowMin != null && b.overflowMin > 0) ||
          (b.type === 'infeasible' && b.prodMin > 0)) &&
        b.hasAlt &&
        b.altM &&
        !excludeOps.has(b.opId) &&
        input.mSt[b.altM!] !== 'down',
    )
    .sort((a, b) => {
      const aMin = a.overflow ? a.overflowMin || 0 : a.prodMin;
      const bMin = b.overflow ? b.overflowMin || 0 : b.prodMin;
      return bMin - aMin;
    });

  // Deduplicate by opId
  const seenOps = new Set<string>();
  const uniqueCandidates = candidates.filter((b) => {
    if (seenOps.has(b.opId)) return false;
    seenOps.add(b.opId);
    return true;
  });

  for (const ob of uniqueCandidates) {
    const overflowMin = ob.overflow ? ob.overflowMin || 0 : ob.prodMin;
    if (overflowMin < config.minDeficitForSplit) continue;

    // Check alt machine utilization
    const altUtil = machineUtil(currentBlocks, ob.altM!, input.workdays, input.thirdShift);
    if (altUtil > ALT_UTIL_THRESHOLD) continue;

    // Find the original operation
    const op = input.ops.find((o) => o.id === ob.opId);
    if (!op) continue;

    const tool = input.toolMap[ob.toolId];
    if (!tool || tool.pH <= 0) continue;

    // Compute total demand
    const totalDemand = op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0);
    if (totalDemand <= 0) continue;

    // Compute what the primary produced
    const primaryProduced = currentBlocks
      .filter((b) => b.opId === ob.opId && b.type === 'ok')
      .reduce((s, b) => s + b.qty, 0);

    // Deficit to move
    const deficit = totalDemand - primaryProduced;
    if (deficit <= 0) continue;

    // Fraction to move to alt
    const fraction = Math.min(deficit / totalDemand, 1 - config.minFractionOnOriginal);
    if (fraction <= 0) continue;

    const altDemand = Math.ceil(totalDemand * fraction);
    const primaryDemand = totalDemand - altDemand;

    // Create synthetic operation for the alt portion (unique ID for re-splits)
    const existingSplits = input.ops.filter((o) => o.id.startsWith(`${op.id}__split`)).length;
    const syntheticOpId =
      existingSplits > 0 ? `${op.id}__split_${existingSplits + 1}` : `${op.id}__split`;

    // Distribute demand: reduce original, create split portion
    // Scale daily demands proportionally
    const splitD = op.d.map((v) => {
      if (v <= 0) return 0;
      const raw = Math.ceil(v * fraction);
      return v > 1 ? Math.min(raw, v - 1) : 0;
    });
    const primaryD = op.d.map((v, i) => Math.max(v - splitD[i], 0));

    // Scale backlog
    const splitAtr = Math.ceil(Math.max(op.atr, 0) * fraction);
    const primaryAtr = Math.max(op.atr, 0) - splitAtr;

    // Distribute stock/WIP proportionally between primary and split
    const totalStk = op.stk ?? 0;
    const totalWip = op.wip ?? 0;
    const splitStk = Math.round(totalStk * fraction);
    const splitWip = Math.round(totalWip * fraction);

    const syntheticOp: EOp = {
      id: syntheticOpId,
      t: op.t,
      m: ob.altM!, // assign to alt machine
      sku: op.sku,
      nm: op.nm,
      atr: splitAtr,
      d: splitD,
      ltDays: op.ltDays,
      cl: op.cl,
      clNm: op.clNm,
      pa: op.pa,
      stk: splitStk,
      wip: splitWip,
      shippingDayIdx: op.shippingDayIdx,
      shippingBufferHours: op.shippingBufferHours,
    };

    // Create modified primary operation
    const modifiedPrimaryOp: EOp = {
      ...op,
      atr: primaryAtr,
      d: primaryD,
      stk: totalStk - splitStk,
      wip: totalWip - splitWip,
    };

    // Build new ops array: replace primary, add synthetic
    const newOps = input.ops.map((o) => (o.id === op.id ? modifiedPrimaryOp : o));
    newOps.push(syntheticOp);

    // Re-schedule with split ops
    const newResult = scheduleAll({
      ...input,
      ops: newOps,
      enableLeveling: false,
      enforceDeadlines: false,
    });

    const newOverflow = sumOverflow(newResult.blocks);

    if (newOverflow < currentOverflow) {
      // Mark split blocks
      for (const b of newResult.blocks) {
        if (b.opId === syntheticOpId) {
          b.isSplitPart = true;
          b.splitFromMachine = ob.machineId;
          b.isSystemReplanned = true;
          b.replanStrategy = 'SPLIT_OPERATION';
        }
      }

      return {
        split: true,
        candidate: {
          opId: ob.opId,
          toolId: ob.toolId,
          machineId: ob.machineId,
          altMachine: ob.altM!,
          overflowMin,
          fraction,
          totalDemand,
          primaryDemand,
          altDemand,
        },
        syntheticOp,
        blocks: newResult.blocks,
        schedResult: newResult,
        overflowReduction: currentOverflow - newOverflow,
      };
    }
  }

  // No improvement found
  return {
    split: false,
    blocks: currentBlocks,
    schedResult: scheduleAll({ ...input, enableLeveling: false, enforceDeadlines: false }),
    overflowReduction: 0,
  };
}
