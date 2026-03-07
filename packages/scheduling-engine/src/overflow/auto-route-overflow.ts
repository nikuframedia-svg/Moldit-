// =====================================================================
//  INCOMPOL PLAN -- Auto-Route Overflow
//  Iteratively resolves overflow operations using two strategies:
//
//  Phase A (preferred): ADVANCE production — schedule earlier on the
//    SAME machine, using capacity from lighter days.
//  Phase B (fallback): MOVE to alternative machine — existing strategy.
//
//  Uses the new scheduleAll() internally for re-scheduling.
//
//  Algorithm: Greedy -- apply ONE action per iteration, re-schedule,
//  and validate improvement. If the action makes things worse, undo
//  and try the next candidate.
//
//  Pure function -- no React, no side effects.
// =====================================================================

import {
  ALT_UTIL_THRESHOLD,
  DAY_CAP,
  MAX_ADVANCE_DAYS,
  MAX_AUTO_MOVES,
  MAX_OVERFLOW_ITER,
  S0,
  S2,
} from '../constants.js';
import type { DecisionRegistry } from '../decisions/decision-registry.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { AdvanceAction, Block, DayLoad, MoveAction } from '../types/blocks.js';
import type { ConstraintConfig } from '../types/constraints.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../types/constraints.js';
import type { DecisionEntry } from '../types/decisions.js';
import type { EMachine, EOp, ETool } from '../types/engine.js';
import type { ResourceTimeline } from '../types/failure.js';
import type { DispatchRule } from '../types/kpis.js';
import type { TwinValidationReport } from '../types/twin.js';
import type { WorkforceConfig } from '../types/workforce.js';
import { getBlockQtyForOp } from '../utils/block-production.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Sum total unscheduled minutes across all blocks (overflow + infeasible) */
function sumOverflow(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.overflow && b.overflowMin) return sum + b.overflowMin;
    if (b.type === 'infeasible' && b.prodMin > 0) return sum + b.prodMin;
    return sum;
  }, 0);
}

/** Sum production minutes of blocks scheduled AFTER their deadline (tardy) */
function computeTardiness(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.type === 'ok' && b.eddDay != null && b.dayIdx > b.eddDay) {
      return sum + b.prodMin;
    }
    return sum;
  }, 0);
}

/**
 * Compute per-machine per-day load from blocks.
 * Returns Record<machineId, DayLoad[]> indexed by day.
 */
function capAnalysis(blocks: Block[], machines: EMachine[]): Record<string, DayLoad[]> {
  const result: Record<string, DayLoad[]> = {};
  const nDays = blocks.reduce((mx, b) => Math.max(mx, b.dayIdx + 1), 0);

  for (const m of machines) {
    const days: DayLoad[] = Array.from({ length: nDays }, () => ({
      prod: 0,
      setup: 0,
      ops: 0,
      pcs: 0,
      blk: 0,
    }));

    for (const b of blocks) {
      if (b.machineId !== m.id) continue;
      if (b.dayIdx < 0 || b.dayIdx >= nDays) continue;
      const dl = days[b.dayIdx];
      dl.prod += b.prodMin;
      dl.setup += b.setupMin;
      dl.ops++;
      dl.pcs += b.qty;
      if (b.blocked) dl.blk++;
    }

    result[m.id] = days;
  }

  return result;
}

/**
 * Count backward `advanceDays` working days from `fromDay`.
 * Returns the target day index, or -1 if not enough working days.
 */
function computeAdvancedEdd(fromDay: number, advanceDays: number, workdays: boolean[]): number {
  let target = fromDay;
  let daysBack = 0;
  for (let d = fromDay - 1; d >= 0 && daysBack < advanceDays; d--) {
    if (!workdays || workdays[d]) {
      daysBack++;
      target = d;
    }
  }
  return daysBack === advanceDays ? target : -1;
}

/**
 * Count OTD-Delivery failures: demand checkpoints where cumulative production
 * is insufficient. This mirrors the otdDelivery metric in scoreSchedule().
 * Returns { count, failures[] } where each failure identifies the op+day.
 */
function computeOtdDeliveryFailures(
  blocks: Block[],
  ops: EOp[],
): { count: number; failures: Array<{ opId: string; day: number; shortfall: number }> } {
  const ok = blocks.filter((b) => b.type !== 'blocked');
  const failures: Array<{ opId: string; day: number; shortfall: number }> = [];
  let count = 0;

  for (const op of ops) {
    const opOkBlocks = ok.filter((b) => {
      if (b.isTwinProduction && b.outputs) return b.outputs.some((o) => o.opId === op.id);
      return b.opId === op.id;
    });
    let cumDemand = 0;
    let cumProd = 0;
    for (let d = 0; d < op.d.length; d++) {
      const dayDemand = Math.max(op.d[d] || 0, 0);
      cumDemand += dayDemand;
      for (const b of opOkBlocks) {
        if (b.dayIdx === d) {
          cumProd += getBlockQtyForOp(b, op.id);
        }
      }
      if (dayDemand > 0 && cumProd < cumDemand) {
        count++;
        failures.push({ opId: op.id, day: d, shortfall: cumDemand - cumProd });
      }
    }
  }
  return { count, failures };
}

// ── Input / Output types ────────────────────────────────────────────

export interface AutoRouteOverflowInput {
  ops: EOp[];
  mSt: Record<string, string>;
  tSt: Record<string, string>;
  /** User-specified move actions (not auto-generated) */
  userMoves: MoveAction[];
  machines: EMachine[];
  toolMap: Record<string, ETool>;
  workdays: boolean[];
  nDays: number;
  workforceConfig?: WorkforceConfig;
  rule?: DispatchRule;
  supplyBoosts?: Map<string, { boost: number }>;
  thirdShift?: boolean;
  constraintConfig?: ConstraintConfig;
  /** Per-machine failure timelines */
  machineTimelines?: Record<string, ResourceTimeline>;
  /** Per-tool failure timelines */
  toolTimelines?: Record<string, ResourceTimeline>;
  /** Twin validation report (from transform pipeline) */
  twinValidationReport?: TwinValidationReport;
  /** Date labels for the planning horizon */
  dates?: string[];
  /** Order-based demand mode: each day with demand = separate order bucket */
  orderBased?: boolean;
  /** Max optimization tier to run (1=overflow, 2=tardiness, 3=OTD-delivery, 4=residual). Default: all tiers */
  maxTier?: 1 | 2 | 3 | 4;
}

export interface AutoRouteOverflowResult {
  /** Final blocks after overflow routing */
  blocks: Block[];
  /** Auto-generated move actions (alt machine) */
  autoMoves: MoveAction[];
  /** Auto-generated advance actions (same machine, earlier days) */
  autoAdvances: AdvanceAction[];
  /** All decisions from the final scheduling run */
  decisions: DecisionEntry[];
  /** Registry from the final scheduling run */
  registry: DecisionRegistry;
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Auto-resolve overflow operations using two strategies:
 *
 * **Phase A (preferred): Advance production** — schedule earlier on the
 * same machine, using capacity from lighter days. Tries advancing
 * 1..MAX_ADVANCE_DAYS working days.
 *
 * **Phase B (fallback): Move to alternative machine** — existing
 * strategy. Routes the operation to its alt machine if it has capacity.
 *
 * Algorithm:
 * 1. Run initial schedule with user moves only
 * 2. If no overflow, return immediately
 * 3. For each step:
 *    a. Find overflow blocks, sorted by biggest overflow first
 *    b. Phase A: try advancing each candidate on same machine
 *    c. Phase B: if no advance helped, try alt machine routing
 *    d. Re-schedule and validate improvement
 *    e. If worse, undo and try next candidate
 * 4. Repeat until no improvement or limits reached
 *
 * @param input - Complete scheduling input with user moves
 * @returns { blocks, autoMoves, autoAdvances, decisions, registry }
 */
export function autoRouteOverflow(input: AutoRouteOverflowInput): AutoRouteOverflowResult {
  const {
    ops,
    mSt,
    tSt,
    userMoves,
    machines,
    toolMap,
    workdays,
    nDays,
    workforceConfig,
    rule = 'EDD',
    supplyBoosts,
    thirdShift,
    constraintConfig = DEFAULT_CONSTRAINT_CONFIG,
    machineTimelines,
    toolTimelines,
    twinValidationReport,
    dates,
    orderBased,
  } = input;
  const maxTier = input.maxTier ?? 4;

  // ── Twin-aware move helpers ──────────────────────────────────────
  // Build opId → twin partner opId map so that when we move one twin,
  // we also move its partner. This prevents splitting twin pairs across
  // machines, which would break co-production in mergeTwinBuckets().
  const twinPartnerMap = new Map<string, string>();
  if (twinValidationReport?.twinGroups) {
    for (const tg of twinValidationReport.twinGroups) {
      twinPartnerMap.set(tg.opId1, tg.opId2);
      twinPartnerMap.set(tg.opId2, tg.opId1);
    }
  }

  // Helper to run a full schedule with given moves and advances
  const runSchedule = (moves: MoveAction[], advances?: AdvanceAction[]) =>
    scheduleAll({
      ops,
      mSt,
      tSt,
      moves,
      machines,
      toolMap,
      workdays,
      nDays,
      workforceConfig,
      rule,
      supplyBoosts,
      thirdShift,
      constraintConfig,
      // Disable leveling during overflow routing iterations for speed;
      // the final result will be leveled in the caller if needed
      enableLeveling: false,
      // Preserve overflow markers during iterations (don't convert to infeasible)
      enforceDeadlines: false,
      machineTimelines,
      toolTimelines,
      advanceOverrides: advances,
      twinValidationReport,
      dates,
      orderBased,
    });

  // Pass 1: greedy schedule with user moves only
  let schedResult = runSchedule(userMoves);
  let blocks = schedResult.blocks;
  let totalOverflowMin = sumOverflow(blocks);

  const autoMoves: MoveAction[] = [];
  const autoAdvances: AdvanceAction[] = [];

  // Hard capacity per working day
  const hardCap = thirdShift ? S2 - S0 : DAY_CAP;

  // Snapshot tardy ops from the INITIAL schedule — only these are Tier 2 candidates.
  // Captured BEFORE Tier 1 to prevent chasing phantom tardiness created by
  // Tier 1 side effects (tool-group merging can push unrelated ops later).
  const preTier1TardyOps = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'ok' && b.eddDay != null && b.dayIdx > b.eddDay) {
      preTier1TardyOps.add(b.opId);
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  TIER 1: Resolve OVERFLOW (only when overflow exists)
  // ════════════════════════════════════════════════════════════════
  if (totalOverflowMin > 0) {
    const maxSteps = MAX_AUTO_MOVES * MAX_OVERFLOW_ITER;

    for (let step = 0; step < maxSteps; step++) {
      if (autoMoves.length + autoAdvances.length >= MAX_AUTO_MOVES) break;

      const cap = capAnalysis(blocks, machines);
      const actionIds = new Set([
        ...userMoves.map((m) => m.opId),
        ...autoMoves.map((m) => m.opId),
        ...autoAdvances.map((a) => a.opId),
      ]);

      // Find ALL overflow/infeasible blocks sorted by biggest unscheduled first
      const allOverflowBlocks = blocks
        .filter(
          (b) =>
            ((b.overflow && b.overflowMin != null && b.overflowMin > 0) ||
              (b.type === 'infeasible' && b.prodMin > 0)) &&
            !actionIds.has(b.opId),
        )
        .sort((a, b) => {
          const aMin = a.overflow ? a.overflowMin || 0 : a.prodMin;
          const bMin = b.overflow ? b.overflowMin || 0 : b.prodMin;
          return bMin - aMin;
        });

      if (allOverflowBlocks.length === 0) break;

      let moved = false;
      const seenOps = new Set<string>();

      // ── Phase A: Try ADVANCING production on same machine ──────────
      for (const ob of allOverflowBlocks) {
        if (seenOps.has(ob.opId)) continue;
        seenOps.add(ob.opId);

        const mId = ob.machineId;
        const mDays = cap[mId];
        if (!mDays) continue;

        // Try advancing 1..MAX_ADVANCE_DAYS working days
        for (let advDays = 1; advDays <= MAX_ADVANCE_DAYS; advDays++) {
          const targetDay = computeAdvancedEdd(ob.dayIdx, advDays, workdays);
          if (targetDay < 0) break; // can't go further back

          // Note: we intentionally do NOT pre-filter by target day utilization.
          // The advance shifts the EDD, which triggers a full re-schedule that may
          // change group ordering (e.g. tool-merging) and save setup time globally.
          // The sumOverflow comparison below is the authoritative validation.

          // Try this advance
          const trial: AdvanceAction[] = [
            ...autoAdvances,
            { opId: ob.opId, advanceDays: advDays, originalEdd: ob.dayIdx },
          ];
          const newResult = runSchedule([...userMoves, ...autoMoves], trial);
          const newOverflow = sumOverflow(newResult.blocks);

          if (newOverflow < totalOverflowMin) {
            autoAdvances.push({ opId: ob.opId, advanceDays: advDays, originalEdd: ob.dayIdx });
            blocks = newResult.blocks;
            schedResult = newResult;
            totalOverflowMin = newOverflow;
            moved = true;

            // Mark blocks as advanced
            for (const b of blocks) {
              if (b.opId === ob.opId && b.type === 'ok') {
                b.isAdvanced = true;
                b.advancedByDays = advDays;
              }
            }

            // Record the advance production decision
            const unschedMin = ob.overflow ? ob.overflowMin || 0 : ob.prodMin;
            schedResult.registry.record({
              type: 'ADVANCE_PRODUCTION',
              opId: ob.opId,
              toolId: ob.toolId,
              machineId: mId,
              detail: `Advanced ${ob.sku} production by ${advDays} working days on ${mId} (EDD ${ob.dayIdx} -> ${targetDay}, ${ob.type === 'infeasible' ? 'infeasible' : 'overflow'}: ${unschedMin}min)`,
              metadata: {
                originalEdd: ob.dayIdx,
                newEdd: targetDay,
                advanceDays: advDays,
                sku: ob.sku,
                overflowMin: unschedMin,
                machineId: mId,
              },
            });

            break; // success with this advance amount
          }
        }

        if (moved) break; // restart outer loop with updated state
      }

      // ── Phase B: Try ALT MACHINE routing (fallback) ────────────────
      if (!moved) {
        // Filter for overflow blocks that have alternatives
        const altCandidates = allOverflowBlocks.filter(
          (b) =>
            b.hasAlt &&
            b.altM &&
            !actionIds.has(b.opId) &&
            mSt[b.altM!] !== 'down' &&
            !(
              machineTimelines?.[b.altM!] &&
              machineTimelines[b.altM!].every((day) =>
                (thirdShift ? (['X', 'Y', 'Z'] as const) : (['X', 'Y'] as const)).every(
                  (s) => (day[s]?.capacityFactor ?? 1) <= 0,
                ),
              )
            ),
        );

        const seenOpsAlt = new Set<string>();
        for (const ob of altCandidates) {
          if (seenOpsAlt.has(ob.opId)) continue;
          seenOpsAlt.add(ob.opId);

          const altM = ob.altM!;
          const altDays = cap[altM];
          if (!altDays) continue;

          const wDayCount = workdays ? workdays.filter(Boolean).length : nDays;
          const altTotalUsed = altDays.reduce((s, d) => s + d.prod + d.setup, 0);
          const altUtil = altTotalUsed / (wDayCount * hardCap);
          if (altUtil > ALT_UTIL_THRESHOLD) continue;

          const altRemaining = wDayCount * hardCap - altTotalUsed;
          if (altRemaining < 30) continue;

          // Try moving this single operation (+ twin partner if applicable)
          const twinPartner = twinPartnerMap.get(ob.opId);
          const twinAlreadyMoved = twinPartner ? actionIds.has(twinPartner) : true;
          autoMoves.push({ opId: ob.opId, toM: altM });
          if (twinPartner && !twinAlreadyMoved) {
            autoMoves.push({ opId: twinPartner, toM: altM });
          }
          const newResult = runSchedule(
            [...userMoves, ...autoMoves],
            autoAdvances.length > 0 ? autoAdvances : undefined,
          );
          const newOverflow = sumOverflow(newResult.blocks);

          if (newOverflow < totalOverflowMin) {
            blocks = newResult.blocks;
            schedResult = newResult;
            totalOverflowMin = newOverflow;
            moved = true;

            // Record the overflow route decision
            const unschedMin = ob.overflow ? ob.overflowMin || 0 : ob.prodMin;
            schedResult.registry.record({
              type: 'OVERFLOW_ROUTE',
              opId: ob.opId,
              toolId: ob.toolId,
              machineId: altM,
              detail: `Moved ${ob.sku} from ${ob.machineId} to ${altM} (${ob.type === 'infeasible' ? 'infeasible' : 'overflow'}: ${unschedMin}min)`,
              metadata: {
                fromMachine: ob.machineId,
                toMachine: altM,
                overflowMin: unschedMin,
                sku: ob.sku,
                altUtil: Math.round(altUtil * 100),
              },
            });

            break; // success -- restart outer loop with updated capacity
          } else {
            // This move made things worse -- undo and try next candidate
            autoMoves.pop();
            if (twinPartner && !twinAlreadyMoved) autoMoves.pop();
          }
        }
      }

      if (!moved) break; // no single action improved things
      if (totalOverflowMin === 0) break;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  TIER 2: Resolve TARDINESS (blocks scheduled after their EDD)
  //  Runs AFTER overflow resolution. Uses advance + alt machine.
  //  Constraint: never re-introduce overflow (sumOverflow stays 0).
  // ════════════════════════════════════════════════════════════════

  if (maxTier < 2) {
    return {
      blocks,
      autoMoves,
      autoAdvances,
      decisions: schedResult.decisions,
      registry: schedResult.registry,
    };
  }

  // Refresh tardy set: include ops that became tardy after Tier 1
  // (schedule shifts from overflow routing, twin co-production, etc.)
  for (const b of blocks) {
    if (b.type === 'ok' && b.eddDay != null && b.dayIdx > b.eddDay) {
      preTier1TardyOps.add(b.opId);
    }
  }

  let totalTardiness = computeTardiness(blocks);

  for (let t2 = 0; t2 < MAX_AUTO_MOVES && totalTardiness > 0; t2++) {
    if (autoMoves.length + autoAdvances.length >= MAX_AUTO_MOVES) break;

    // Separate moved vs advanced sets. Moved ops are fully excluded
    // (can't re-move). Advanced-but-still-tardy ops remain eligible
    // for Phase B/C (move to alt machine).
    const movedIds = new Set([...userMoves.map((m) => m.opId), ...autoMoves.map((m) => m.opId)]);
    const advancedIds = new Set(autoAdvances.map((a) => a.opId));

    const tardyBlocks = blocks
      .filter(
        (b) =>
          b.type === 'ok' &&
          b.eddDay != null &&
          b.dayIdx > b.eddDay &&
          preTier1TardyOps.has(b.opId) &&
          !movedIds.has(b.opId),
      )
      .sort((a, b) => b.prodMin - a.prodMin);

    if (tardyBlocks.length === 0) break;

    let tardyImproved = false;

    // ── Phase A: Try ADVANCING tardy ops on same machine ─────────
    // Skip ops already advanced (Phase A already tried them).
    const seenTardyOps = new Set<string>();
    for (const ob of tardyBlocks) {
      if (seenTardyOps.has(ob.opId)) continue;
      seenTardyOps.add(ob.opId);
      if (advancedIds.has(ob.opId)) continue; // already advanced, skip to Phase B/C

      const obEdd = ob.eddDay!;

      for (let advDays = 1; advDays <= 30; advDays++) {
        const targetDay = computeAdvancedEdd(obEdd, advDays, workdays);
        if (targetDay < 0) break;

        const trial: AdvanceAction[] = [
          ...autoAdvances,
          { opId: ob.opId, advanceDays: advDays, originalEdd: obEdd },
        ];
        const newResult = runSchedule([...userMoves, ...autoMoves], trial);
        const newTardiness = computeTardiness(newResult.blocks);

        if (newTardiness < totalTardiness && sumOverflow(newResult.blocks) === 0) {
          autoAdvances.push({ opId: ob.opId, advanceDays: advDays, originalEdd: obEdd });
          blocks = newResult.blocks;
          schedResult = newResult;
          totalTardiness = newTardiness;
          tardyImproved = true;

          // Mark blocks as advanced
          for (const b of blocks) {
            if (b.opId === ob.opId && b.type === 'ok') {
              b.isAdvanced = true;
              b.advancedByDays = advDays;
            }
          }

          // Record the advance production decision (tardy resolution)
          schedResult.registry.record({
            type: 'ADVANCE_PRODUCTION',
            opId: ob.opId,
            toolId: ob.toolId,
            machineId: ob.machineId,
            detail: `Advanced ${ob.sku} by ${advDays}d on ${ob.machineId} (tardy: EDD ${obEdd} -> ${targetDay})`,
            metadata: {
              originalEdd: obEdd,
              newEdd: targetDay,
              advanceDays: advDays,
              sku: ob.sku,
              reason: 'tardiness',
            },
          });

          break; // success with this advance amount
        }
      }

      if (tardyImproved) break; // restart Tier 2 loop with updated state
    }

    // Phase B: Alt machine for tardy ops.
    // The sumOverflow(nr.blocks) === 0 check inside ensures moves never
    // re-introduce overflow, so this is safe even after Tier 1 ran.
    if (!tardyImproved) {
      // Group tardy ops by alt machine — try batch move first (all ops sharing
      // the same alt), then fall back to individual moves. Batch moves let the
      // scheduler consolidate tool groups (fewer setups) on the alt machine.
      const altGroups = new Map<string, string[]>();
      const seenBatch = new Set<string>();
      for (const ob of tardyBlocks) {
        if (seenBatch.has(ob.opId)) continue;
        seenBatch.add(ob.opId);
        if (!ob.hasAlt || !ob.altM || mSt[ob.altM] === 'down') continue;
        const altM = ob.altM;
        if (!altGroups.has(altM)) altGroups.set(altM, []);
        altGroups.get(altM)!.push(ob.opId);
      }

      for (const [altM, opIds] of altGroups) {
        // Twin-aware: include twin partners in the batch to keep pairs together
        const batchOpIds = new Set(opIds);
        for (const opId of opIds) {
          const tp = twinPartnerMap.get(opId);
          if (tp && !movedIds.has(tp)) batchOpIds.add(tp);
        }
        const expandedOpIds = [...batchOpIds];

        // Try batch move (all ops to same alt at once)
        if (expandedOpIds.length > 1) {
          const batchMoves = expandedOpIds.map((opId) => ({ opId, toM: altM }));
          autoMoves.push(...batchMoves);
          const nr = runSchedule(
            [...userMoves, ...autoMoves],
            autoAdvances.length > 0 ? autoAdvances : undefined,
          );
          const nt = computeTardiness(nr.blocks);
          if (nt < totalTardiness && sumOverflow(nr.blocks) === 0) {
            blocks = nr.blocks;
            schedResult = nr;
            totalTardiness = nt;
            tardyImproved = true;
            for (const opId of opIds) {
              const blk = tardyBlocks.find((b) => b.opId === opId);
              if (blk) {
                schedResult.registry.record({
                  type: 'OVERFLOW_ROUTE',
                  opId,
                  toolId: blk.toolId,
                  machineId: altM,
                  detail: `Moved ${blk.sku} from ${blk.machineId} to ${altM} (tardy batch)`,
                  metadata: {
                    fromMachine: blk.machineId,
                    toMachine: altM,
                    sku: blk.sku,
                    reason: 'tardiness',
                  },
                });
              }
            }
            break;
          } else {
            autoMoves.splice(autoMoves.length - batchMoves.length);
          }
        }

        // Fall back to individual moves (try each op one at a time)
        if (!tardyImproved) {
          for (const opId of opIds) {
            // Twin-aware: also move twin partner to keep pair together
            const tp = twinPartnerMap.get(opId);
            const tpAlreadyMoved = tp ? movedIds.has(tp) || opIds.includes(tp) : true;
            autoMoves.push({ opId, toM: altM });
            if (tp && !tpAlreadyMoved) autoMoves.push({ opId: tp, toM: altM });
            const nr = runSchedule(
              [...userMoves, ...autoMoves],
              autoAdvances.length > 0 ? autoAdvances : undefined,
            );
            const nt = computeTardiness(nr.blocks);
            if (nt < totalTardiness && sumOverflow(nr.blocks) === 0) {
              blocks = nr.blocks;
              schedResult = nr;
              totalTardiness = nt;
              tardyImproved = true;
              const blk = tardyBlocks.find((b) => b.opId === opId);
              if (blk) {
                schedResult.registry.record({
                  type: 'OVERFLOW_ROUTE',
                  opId,
                  toolId: blk.toolId,
                  machineId: altM,
                  detail: `Moved ${blk.sku} from ${blk.machineId} to ${altM} (tardy resolution)`,
                  metadata: {
                    fromMachine: blk.machineId,
                    toMachine: altM,
                    sku: blk.sku,
                    reason: 'tardiness',
                  },
                });
              }
              break;
            } else {
              autoMoves.pop();
              if (tp && !tpAlreadyMoved) autoMoves.pop();
            }
          }
        }

        if (tardyImproved) break;
      }
    }

    // ── Phase C: Combined MOVE + ADVANCE for tardy ops ──────────
    // If Phase A (advance-only) and Phase B (move-only) both failed,
    // try moving the op to its alt machine AND advancing it by N days.
    // This lets the scheduler use earlier (less congested) slots on
    // the alt machine — solving cases where the alt is full near EDD
    // but has capacity earlier.
    if (!tardyImproved) {
      const seenC = new Set<string>();
      for (const ob of tardyBlocks) {
        if (seenC.has(ob.opId)) continue;
        seenC.add(ob.opId);
        if (!ob.hasAlt || !ob.altM || mSt[ob.altM] === 'down') continue;
        const altM = ob.altM;
        const obEdd = ob.eddDay!;

        // Twin-aware: move partner along with the primary op
        const tpC = twinPartnerMap.get(ob.opId);
        const tpCAlreadyMoved = tpC ? movedIds.has(tpC) : true;

        for (let advDays = 1; advDays <= 30; advDays++) {
          const targetDay = computeAdvancedEdd(obEdd, advDays, workdays);
          if (targetDay < 0) break;

          // Try move + advance together (include twin partner in move)
          autoMoves.push({ opId: ob.opId, toM: altM });
          if (tpC && !tpCAlreadyMoved) autoMoves.push({ opId: tpC, toM: altM });
          const trialAdv: AdvanceAction[] = [
            ...autoAdvances,
            { opId: ob.opId, advanceDays: advDays, originalEdd: obEdd },
          ];
          const nr = runSchedule([...userMoves, ...autoMoves], trialAdv);
          const nt = computeTardiness(nr.blocks);

          if (nt < totalTardiness && sumOverflow(nr.blocks) === 0) {
            autoAdvances.push({ opId: ob.opId, advanceDays: advDays, originalEdd: obEdd });
            blocks = nr.blocks;
            schedResult = nr;
            totalTardiness = nt;
            tardyImproved = true;

            // Mark blocks as advanced
            for (const b of blocks) {
              if (b.opId === ob.opId && b.type === 'ok') {
                b.isAdvanced = true;
                b.advancedByDays = advDays;
              }
            }

            schedResult.registry.record({
              type: 'OVERFLOW_ROUTE',
              opId: ob.opId,
              toolId: ob.toolId,
              machineId: altM,
              detail: `Moved ${ob.sku} from ${ob.machineId} to ${altM} + advanced ${advDays}d (tardy combo)`,
              metadata: {
                fromMachine: ob.machineId,
                toMachine: altM,
                sku: ob.sku,
                advanceDays: advDays,
                reason: 'tardiness',
              },
            });
            break;
          } else {
            autoMoves.pop(); // undo the trial move
            if (tpC && !tpCAlreadyMoved) autoMoves.pop();
          }
        }

        if (tardyImproved) break;
      }
    }

    // ── Phase D: BATCH advance all tardy ops by 1 day ───────
    // When individual advances fail (local minimum), try advancing
    // ALL tardy ops simultaneously. This helps when multiple ops
    // compete for the same capacity window — moving them ALL earlier
    // can break the deadlock that individual advances can't.
    if (!tardyImproved) {
      // Collect unique tardy ops (not yet moved)
      const batchOps = new Map<string, number>(); // opId → eddDay
      for (const ob of tardyBlocks) {
        if (!batchOps.has(ob.opId) && !advancedIds.has(ob.opId) && ob.eddDay != null) {
          batchOps.set(ob.opId, ob.eddDay);
        }
      }

      if (batchOps.size > 1) {
        for (let advDays = 1; advDays <= 5; advDays++) {
          const batchAdvances: AdvanceAction[] = [];
          for (const [opId, edd] of batchOps) {
            const targetDay = computeAdvancedEdd(edd, advDays, workdays);
            if (targetDay >= 0) {
              batchAdvances.push({ opId, advanceDays: advDays, originalEdd: edd });
            }
          }

          if (batchAdvances.length < 2) continue;

          const trial = [...autoAdvances, ...batchAdvances];
          const newResult = runSchedule([...userMoves, ...autoMoves], trial);
          const newTardiness = computeTardiness(newResult.blocks);

          if (newTardiness < totalTardiness && sumOverflow(newResult.blocks) === 0) {
            for (const ba of batchAdvances) autoAdvances.push(ba);
            blocks = newResult.blocks;
            schedResult = newResult;
            totalTardiness = newTardiness;
            tardyImproved = true;

            for (const b of blocks) {
              if (batchOps.has(b.opId) && b.type === 'ok') {
                b.isAdvanced = true;
                b.advancedByDays = advDays;
              }
            }
            break;
          }
        }
      }
    }

    if (!tardyImproved) break;
  }

  // ════════════════════════════════════════════════════════════════
  //  TIER 3: Resolve OTD-DELIVERY failures
  //  Runs AFTER Tier 2. Targets demand checkpoints where cumulative
  //  production is insufficient (otdDelivery < 100%), even when all
  //  blocks satisfy their EDD (computeTardiness = 0).
  //
  //  This happens when blocks are scheduled on their EDD day but
  //  earlier demand checkpoints for the same op aren't covered.
  //  Strategy: advance the op's production to cover earlier demand.
  // ════════════════════════════════════════════════════════════════

  if (maxTier < 3) {
    return {
      blocks,
      autoMoves,
      autoAdvances,
      decisions: schedResult.decisions,
      registry: schedResult.registry,
    };
  }

  let otdResult = computeOtdDeliveryFailures(blocks, ops);
  // Allow small tardiness increase (5% or 30min floor) to resolve OTD failures.
  // This prevents over-optimizing for block-level tardiness at the expense of
  // per-demand-day OTD delivery, while still protecting against large regressions.
  const preTier3Tardiness = computeTardiness(blocks);
  const tardinessBudget = Math.max(preTier3Tardiness * 1.05, preTier3Tardiness + 30);

  for (let t3 = 0; t3 < MAX_AUTO_MOVES && otdResult.count > 0; t3++) {
    if (autoMoves.length + autoAdvances.length >= MAX_AUTO_MOVES) break;

    const movedIds = new Set([...userMoves.map((m) => m.opId), ...autoMoves.map((m) => m.opId)]);
    const advancedIds = new Set(autoAdvances.map((a) => a.opId));

    // Deduplicate failures by opId, keeping the one with largest shortfall
    const failsByOp = new Map<string, { day: number; shortfall: number }>();
    for (const f of otdResult.failures) {
      const existing = failsByOp.get(f.opId);
      if (!existing || f.shortfall > existing.shortfall) {
        failsByOp.set(f.opId, { day: f.day, shortfall: f.shortfall });
      }
    }

    // Sort by shortfall descending (prioritize biggest gaps)
    const sortedFails = [...failsByOp.entries()]
      .filter(([opId]) => !movedIds.has(opId))
      .sort((a, b) => b[1].shortfall - a[1].shortfall);

    if (sortedFails.length === 0) break;

    let otdImproved = false;

    // Phase A: Try advancing the op's production earlier
    for (const [opId, info] of sortedFails) {
      if (advancedIds.has(opId)) continue;

      for (let advDays = 1; advDays <= 30; advDays++) {
        const targetDay = computeAdvancedEdd(info.day, advDays, workdays);
        if (targetDay < 0) break;

        const trial: AdvanceAction[] = [
          ...autoAdvances,
          { opId, advanceDays: advDays, originalEdd: info.day },
        ];
        const newResult = runSchedule([...userMoves, ...autoMoves], trial);
        const newOtd = computeOtdDeliveryFailures(newResult.blocks, ops);

        if (
          newOtd.count < otdResult.count &&
          sumOverflow(newResult.blocks) === 0 &&
          computeTardiness(newResult.blocks) <= tardinessBudget
        ) {
          autoAdvances.push({ opId, advanceDays: advDays, originalEdd: info.day });
          blocks = newResult.blocks;
          schedResult = newResult;
          otdResult = newOtd;
          otdImproved = true;

          for (const b of blocks) {
            if (b.opId === opId && b.type === 'ok') {
              b.isAdvanced = true;
              b.advancedByDays = advDays;
            }
          }

          schedResult.registry.record({
            type: 'ADVANCE_PRODUCTION',
            opId,
            toolId: '',
            machineId: '',
            detail: `Advanced ${opId} by ${advDays}d (OTD-delivery: shortfall ${info.shortfall} pcs at day ${info.day})`,
            metadata: { advanceDays: advDays, reason: 'otd_delivery', shortfall: info.shortfall },
          });
          break;
        }
      }

      if (otdImproved) break;
    }

    // Phase B: Try alt machine for the failing op
    if (!otdImproved) {
      for (const [opId, info] of sortedFails) {
        // Find the op's blocks to get alt machine info
        const opBlock = blocks.find((b) => b.opId === opId && b.hasAlt && b.altM);
        if (!opBlock || !opBlock.altM || mSt[opBlock.altM] === 'down') continue;

        const altM = opBlock.altM;
        const twinPartner = twinPartnerMap.get(opId);
        const tpAlreadyMoved = twinPartner ? movedIds.has(twinPartner) : true;

        autoMoves.push({ opId, toM: altM });
        if (twinPartner && !tpAlreadyMoved) autoMoves.push({ opId: twinPartner, toM: altM });

        const nr = runSchedule(
          [...userMoves, ...autoMoves],
          autoAdvances.length > 0 ? autoAdvances : undefined,
        );
        const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);

        if (
          newOtd.count < otdResult.count &&
          sumOverflow(nr.blocks) === 0 &&
          computeTardiness(nr.blocks) <= tardinessBudget
        ) {
          blocks = nr.blocks;
          schedResult = nr;
          otdResult = newOtd;
          otdImproved = true;

          schedResult.registry.record({
            type: 'OVERFLOW_ROUTE',
            opId,
            toolId: opBlock.toolId,
            machineId: altM,
            detail: `Moved ${opId} from ${opBlock.machineId} to ${altM} (OTD-delivery: shortfall ${info.shortfall} pcs)`,
            metadata: { fromMachine: opBlock.machineId, toMachine: altM, reason: 'otd_delivery' },
          });
          break;
        } else {
          autoMoves.pop();
          if (twinPartner && !tpAlreadyMoved) autoMoves.pop();
        }
      }
    }

    // Phase C: Combined move + advance for OTD failures
    if (!otdImproved) {
      for (const [opId, info] of sortedFails) {
        const opBlock = blocks.find((b) => b.opId === opId && b.hasAlt && b.altM);
        if (!opBlock || !opBlock.altM || mSt[opBlock.altM] === 'down') continue;

        const altM = opBlock.altM;
        const twinPartner = twinPartnerMap.get(opId);
        const tpAlreadyMoved = twinPartner ? movedIds.has(twinPartner) : true;

        for (let advDays = 1; advDays <= 30; advDays++) {
          const targetDay = computeAdvancedEdd(info.day, advDays, workdays);
          if (targetDay < 0) break;

          autoMoves.push({ opId, toM: altM });
          if (twinPartner && !tpAlreadyMoved) autoMoves.push({ opId: twinPartner, toM: altM });
          const trialAdv: AdvanceAction[] = [
            ...autoAdvances,
            { opId, advanceDays: advDays, originalEdd: info.day },
          ];
          const nr = runSchedule([...userMoves, ...autoMoves], trialAdv);
          const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);

          if (
            newOtd.count < otdResult.count &&
            sumOverflow(nr.blocks) === 0 &&
            computeTardiness(nr.blocks) <= tardinessBudget
          ) {
            autoAdvances.push({ opId, advanceDays: advDays, originalEdd: info.day });
            blocks = nr.blocks;
            schedResult = nr;
            otdResult = newOtd;
            otdImproved = true;

            schedResult.registry.record({
              type: 'OVERFLOW_ROUTE',
              opId,
              toolId: opBlock.toolId,
              machineId: altM,
              detail: `Moved ${opId} to ${altM} + advanced ${advDays}d (OTD-delivery combo)`,
              metadata: {
                fromMachine: opBlock.machineId,
                toMachine: altM,
                advanceDays: advDays,
                reason: 'otd_delivery',
              },
            });
            break;
          } else {
            autoMoves.pop();
            if (twinPartner && !tpAlreadyMoved) autoMoves.pop();
          }
        }

        if (otdImproved) break;
      }
    }

    if (!otdImproved) break;
  }

  return {
    blocks,
    autoMoves,
    autoAdvances,
    decisions: schedResult.decisions,
    registry: schedResult.registry,
  };
}
