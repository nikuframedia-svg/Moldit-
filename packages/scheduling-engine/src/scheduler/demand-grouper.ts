// =====================================================================
//  INCOMPOL PLAN -- Demand Grouper (Phase 1)
//  Groups operations into tool-groups with delivery buckets.
//
//  Extracted from NikufraEngine scheduleBatch Phase 1.
//  Pure function -- no React, no side effects.
// =====================================================================

import { BUCKET_WINDOW, DEFAULT_OEE } from '../constants.js';
import { isFullyDown } from '../failures/failure-timeline.js';
import type { AdvanceAction, MoveAction } from '../types/blocks.js';
import type { EOp, ETool } from '../types/engine.js';
import type { ResourceTimeline } from '../types/failure.js';
import type { TwinGroup } from '../types/twin.js';
import { mergeTwinBuckets } from './twin-merge.js';

// ── Internal types ──────────────────────────────────────────────────

/** A single SKU batch within a tool group */
export interface SkuBucket {
  opId: string;
  sku: string;
  nm: string;
  atr: number;
  totalQty: number;
  prodQty: number;
  prodMin: number;
  /** Earliest Due Date: day index when this bucket must be delivered */
  edd: number;
  operators: number;
  stk: number;
  lt: number;
  mp?: string;
  blocked: boolean;
  reason: string | null;
  hasAlt: boolean;
  altM: string | null;
  moved: boolean;
  origM: string;
  /** Day index from backward scheduling (Prz.Fabrico) */
  earliestStart?: number;
  /** Whether this bucket represents a twin co-production run */
  isTwinProduction?: boolean;
  /** Co-production group ID (canonical key: [sku1,sku2].sort().join('|')) */
  coProductionGroupId?: string;
  /** Info about both twin outputs (when isTwinProduction=true) */
  twinOutputs?: Array<{
    opId: string;
    sku: string;
    nm: string;
    totalQty: number;
    atr: number;
  }>;
}

/** A tool group: one tool + one EDD bucket on a specific machine */
export interface ToolGroup {
  toolId: string;
  machineId: string;
  /** Earliest Due Date for this group (= latest day of demand in bucket) */
  edd: number;
  setupMin: number;
  totalProdMin: number;
  skus: SkuBucket[];
  tool: ETool;
}

/** Machine status map: machineId -> 'running' | 'down' */
export type MachineStatusMap = Record<string, string>;

/** Tool status map: toolId -> 'running' | 'down' */
export type ToolStatusMap = Record<string, string>;

/** Map from opId to backward-scheduling data */
export interface EarliestStartEntry {
  earliestDayIdx: number;
  latestDayIdx: number;
  ltDays: number;
  source: string;
}

// ── Helper: apply advance override to EDD ───────────────────────────

/**
 * When an advance override exists for an operation, shift the bucket's
 * EDD earlier by the specified number of working days. This causes the
 * scheduler to process the bucket sooner, giving it access to capacity
 * from earlier (lighter) days. The product is produced ahead of schedule
 * and held as inventory until the original demand date.
 */
function applyAdvanceOverride(
  edd: number,
  opId: string,
  advanceOverrides: AdvanceAction[] | undefined,
  workdays: boolean[] | undefined,
): number {
  if (!advanceOverrides) return edd;
  // Prefer exact targetEdd match; fall back to untargeted (targetEdd==null)
  const adv = advanceOverrides.find((a) => a.opId === opId && a.targetEdd === edd)
    ?? advanceOverrides.find((a) => a.opId === opId && a.targetEdd == null);
  if (!adv || adv.advanceDays <= 0) return edd;

  // Count backward advanceDays working days from edd
  let newEdd = edd;
  let daysBack = 0;
  for (let d = edd - 1; d >= 0 && daysBack < adv.advanceDays; d--) {
    const isWork = !workdays || workdays[d];
    if (isWork) {
      daysBack++;
      newEdd = d;
    }
  }
  return Math.max(0, newEdd);
}

// ── Helper: create SkuBucket from accumulated demand ────────────────

function mkSkuBucket(
  op: EOp,
  tool: ETool,
  accQty: number,
  edd: number,
  mv: MoveAction | undefined,
  tDown: boolean,
  mDown: boolean,
  earliestStart?: number,
  oee: number = DEFAULT_OEE,
  skipLotEconomic: boolean = false,
): SkuBucket {
  const lt = tool.lt;
  const prodQty = skipLotEconomic ? accQty : lt > 0 ? Math.ceil(accQty / lt) * lt : accQty;
  const effectiveOee = tool.oee ?? oee;
  const prodMin = ((prodQty / tool.pH) * 60) / effectiveOee;
  return {
    opId: op.id,
    sku: op.sku,
    nm: op.nm,
    atr: 0,
    totalQty: accQty,
    prodQty,
    prodMin,
    edd,
    operators: tool.op,
    stk: op.stk ?? tool.stk,
    lt: tool.lt,
    mp: tool.mp,
    blocked: tDown || mDown,
    reason: tDown ? 'tool_down' : mDown ? 'machine_down' : null,
    moved: !!mv,
    hasAlt: !!tool.alt && tool.alt !== '-',
    altM: tool.alt !== '-' ? tool.alt : null,
    origM: op.m,
    earliestStart,
  };
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Groups operations into tool-groups with delivery buckets.
 *
 * Strategy per operation:
 *  - If tool has lot economic (lt > 0): accumulate demand until qty >= lt, then emit bucket
 *  - If tool has no lot economic (lt = 0): use time-window of BUCKET_WINDOW working days
 *  - EDD = LAST day of demand in the bucket (gives scheduler flexibility)
 *  - Backlog (atr > 0) becomes an EDD=0 urgent batch
 *
 * @param ops       - Operations to group
 * @param mSt       - Machine status map
 * @param tSt       - Tool status map
 * @param moves     - Move actions (user + auto moves)
 * @param toolMap   - Tool lookup by ID
 * @param workdays  - Per-day workday flags
 * @param nDays     - Total number of days in horizon
 * @param earliestStarts - Map from opId to backward-scheduling info
 * @returns Record of machineId -> ToolGroup[]
 */
export function groupDemandIntoBuckets(
  ops: EOp[],
  mSt: MachineStatusMap,
  tSt: ToolStatusMap,
  moves: MoveAction[],
  toolMap: Record<string, ETool>,
  workdays: boolean[] | undefined,
  nDays: number,
  earliestStarts?: Map<string, EarliestStartEntry>,
  machineTimelines?: Record<string, ResourceTimeline>,
  toolTimelines?: Record<string, ResourceTimeline>,
  thirdShift?: boolean,
  oee: number = DEFAULT_OEE,
  advanceOverrides?: AdvanceAction[],
  twinGroups?: TwinGroup[],
  orderBased?: boolean,
): Record<string, ToolGroup[]> {
  const mGroups: Record<string, ToolGroup[]> = {};

  // Helper: add SkuBucket to the correct ToolGroup (one per tool per EDD bucket)
  const addToGroup = (effM: string, tool: ETool, sb: SkuBucket) => {
    if (!mGroups[effM]) mGroups[effM] = [];
    // Find or create ToolGroup for this tool with matching EDD
    let grp = mGroups[effM].find((g) => g.toolId === tool.id && g.edd === sb.edd);
    if (!grp) {
      grp = {
        toolId: tool.id,
        machineId: effM,
        edd: sb.edd,
        setupMin: tool.sH * 60,
        totalProdMin: 0,
        skus: [],
        tool,
      };
      mGroups[effM].push(grp);
    }
    grp.skus.push(sb);
    grp.totalProdMin += sb.prodMin;
  };

  ops.forEach((op) => {
    const tool = toolMap[op.t];
    if (!tool) return;

    const mv = moves.find((v) => v.opId === op.id);
    const effM = mv ? mv.toM : op.m;
    const totalQty = op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0);
    if (totalQty <= 0) return;

    // Guard: skip operations with rate=0 (would cause Infinity prodMin)
    if (tool.pH <= 0) return;

    // Temporal awareness: when timelines are present, only block the bucket
    // if the resource is fully down for the ENTIRE horizon. Partial failures
    // are handled per-day-per-shift in the slot allocator.
    const tDown = toolTimelines?.[op.t]
      ? isFullyDown(toolTimelines[op.t], 0, nDays - 1, thirdShift)
      : tSt[op.t] === 'down';
    const mDown = machineTimelines?.[effM]
      ? isFullyDown(machineTimelines[effM], 0, nDays - 1, thirdShift)
      : mSt[effM] === 'down';

    // Backward scheduling: adjust EDD if earliestStarts has info
    const esEntry = earliestStarts?.get(op.id);

    // Handle backlog (atraso) -- immediate due date
    if (op.atr > 0) {
      const sb = mkSkuBucket(
        op,
        tool,
        op.atr,
        0,
        mv,
        tDown,
        mDown,
        esEntry?.earliestDayIdx,
        oee,
        !!orderBased,
      );
      sb.atr = op.atr;
      addToGroup(effM, tool, sb);
    }

    // Split daily demand into delivery buckets
    const hasLt = tool.lt > 0;
    let accQty = 0;
    let bucketLastDay = -1;
    let bucketWorkDays = 0;

    for (let i = 0; i < nDays; i++) {
      const dayQty = Math.max(op.d[i] || 0, 0);
      const isWork = !workdays || workdays[i];
      if (dayQty <= 0) continue;

      bucketLastDay = i; // track LAST day with demand in this bucket
      accQty += dayQty;
      if (isWork) bucketWorkDays++;

      // Emit bucket when:
      //  - ORDER-BASED mode: every day with demand = separate order = separate bucket
      //  - lot-economic mode: accumulated qty >= lt
      //  - time-window mode: accumulated >= BUCKET_WINDOW working days
      //  - always: this is the last demand day for the operation
      const isLastDemand = op.d.slice(i + 1).every((v) => v <= 0);
      const shouldEmit =
        orderBased ||
        isLastDemand ||
        (hasLt && accQty >= tool.lt) ||
        (!hasLt && bucketWorkDays >= BUCKET_WINDOW);

      if (shouldEmit && accQty > 0) {
        // Compute effective EDD: use backward-scheduling earliestDayIdx if it
        // is LATER than the bucket delivery day (means we can't start earlier)
        let edd = bucketLastDay;
        if (esEntry && esEntry.earliestDayIdx > 0) {
          // The edd stays as delivery day; earliestStart constrains when
          // production can BEGIN. We pass it through as metadata.
        }

        // Apply advance override: shift EDD earlier if this op has an advance action
        edd = applyAdvanceOverride(edd, op.id, advanceOverrides, workdays);

        const sb = mkSkuBucket(
          op,
          tool,
          accQty,
          edd,
          mv,
          tDown,
          mDown,
          esEntry?.earliestDayIdx,
          oee,
          !!orderBased,
        );
        addToGroup(effM, tool, sb);
        accQty = 0;
        bucketLastDay = -1;
        bucketWorkDays = 0;
      }
    }

    // Flush remaining accumulated demand
    if (accQty > 0 && bucketLastDay >= 0) {
      const flushEdd = applyAdvanceOverride(bucketLastDay, op.id, advanceOverrides, workdays);
      const sb = mkSkuBucket(
        op,
        tool,
        accQty,
        flushEdd,
        mv,
        tDown,
        mDown,
        esEntry?.earliestDayIdx,
        oee,
        !!orderBased,
      );
      addToGroup(effM, tool, sb);
    }
  });

  // ── Guard: demand conservation check (before twin merge) ──
  // Lightweight O(ops * groups * skus) — negligible for 64 SKUs.
  for (const op of ops) {
    const tool = toolMap[op.t];
    if (!tool || tool.pH <= 0) continue;
    const expected = op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0);
    if (expected <= 0) continue;
    let bucketed = 0;
    for (const groups of Object.values(mGroups)) {
      for (const g of groups) {
        for (const sk of g.skus) {
          if (sk.opId === op.id) bucketed += sk.totalQty;
        }
      }
    }
    if (bucketed !== expected) {
      throw new Error(
        `[demand-grouper] Conservation violation: op=${op.id} expected=${expected} bucketed=${bucketed}`,
      );
    }
  }

  // ── Post-process: merge twin pairs into co-production buckets ──
  if (twinGroups && twinGroups.length > 0) {
    mergeTwinBuckets(mGroups, twinGroups, oee, !!orderBased);
  }

  return mGroups;
}

