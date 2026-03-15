// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Tier 2: Resolve TARDINESS
//  Blocks scheduled after their EDD. Uses advance + alt
//  machine. Constraint: never re-introduce overflow.
// ═══════════════════════════════════════════════════════════

import { MAX_AUTO_MOVES } from '../constants.js';
import type { AdvanceAction } from '../types/blocks.js';
import { computeAdvancedEdd, computeTardiness, sumOverflow } from './overflow-helpers.js';
import type { TierContext, TierState } from './tier-types.js';

/**
 * Tier 2: resolve tardiness (blocks scheduled after their EDD).
 * Mutates `state` in place. Returns the final tardiness value.
 */
export function runTier2(
  state: TierState,
  ctx: TierContext,
  preTier1TardyOps: Set<string>,
): void {
  const { userMoves, mSt, workdays, twinPartnerMap, runSchedule } = ctx;

  // Refresh tardy set: include ops that became tardy after Tier 1
  // (schedule shifts from overflow routing, twin co-production, etc.)
  for (const b of state.blocks) {
    if (b.type === 'ok' && b.eddDay != null && b.dayIdx > b.eddDay) {
      preTier1TardyOps.add(b.opId);
    }
  }

  let totalTardiness = computeTardiness(state.blocks);

  for (let t2 = 0; t2 < MAX_AUTO_MOVES && totalTardiness > 0; t2++) {
    if (state.autoMoves.length + state.autoAdvances.length >= MAX_AUTO_MOVES) break;

    // Separate moved vs advanced sets. Moved ops are fully excluded
    // (can't re-move). Advanced-but-still-tardy ops remain eligible
    // for Phase B/C (move to alt machine).
    const movedIds = new Set([
      ...userMoves.map((m) => m.opId),
      ...state.autoMoves.map((m) => m.opId),
    ]);
    const advancedIds = new Set(state.autoAdvances.map((a) => a.opId));

    const tardyBlocks = state.blocks
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
          ...state.autoAdvances,
          { opId: ob.opId, advanceDays: advDays, originalEdd: obEdd },
        ];
        const newResult = runSchedule([...userMoves, ...state.autoMoves], trial);
        const newTardiness = computeTardiness(newResult.blocks);

        if (newTardiness < totalTardiness && sumOverflow(newResult.blocks) === 0) {
          state.autoAdvances.push({ opId: ob.opId, advanceDays: advDays, originalEdd: obEdd });
          state.blocks = newResult.blocks;
          state.schedResult = newResult;
          totalTardiness = newTardiness;
          tardyImproved = true;

          // Mark blocks as advanced
          for (const b of state.blocks) {
            if (b.opId === ob.opId && b.type === 'ok') {
              b.isAdvanced = true;
              b.advancedByDays = advDays;
            }
          }

          // Record the advance production decision (tardy resolution)
          state.schedResult.registry.record({
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
          state.autoMoves.push(...batchMoves);
          const nr = runSchedule(
            [...userMoves, ...state.autoMoves],
            state.autoAdvances.length > 0 ? state.autoAdvances : undefined,
          );
          const nt = computeTardiness(nr.blocks);
          if (nt < totalTardiness && sumOverflow(nr.blocks) === 0) {
            state.blocks = nr.blocks;
            state.schedResult = nr;
            totalTardiness = nt;
            tardyImproved = true;
            for (const opId of opIds) {
              const blk = tardyBlocks.find((b) => b.opId === opId);
              if (blk) {
                state.schedResult.registry.record({
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
            state.autoMoves.splice(state.autoMoves.length - batchMoves.length);
          }
        }

        // Fall back to individual moves (try each op one at a time)
        if (!tardyImproved) {
          for (const opId of opIds) {
            // Twin-aware: also move twin partner to keep pair together
            const tp = twinPartnerMap.get(opId);
            const tpAlreadyMoved = tp ? movedIds.has(tp) || opIds.includes(tp) : true;
            state.autoMoves.push({ opId, toM: altM });
            if (tp && !tpAlreadyMoved) state.autoMoves.push({ opId: tp, toM: altM });
            const nr = runSchedule(
              [...userMoves, ...state.autoMoves],
              state.autoAdvances.length > 0 ? state.autoAdvances : undefined,
            );
            const nt = computeTardiness(nr.blocks);
            if (nt < totalTardiness && sumOverflow(nr.blocks) === 0) {
              state.blocks = nr.blocks;
              state.schedResult = nr;
              totalTardiness = nt;
              tardyImproved = true;
              const blk = tardyBlocks.find((b) => b.opId === opId);
              if (blk) {
                state.schedResult.registry.record({
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
              state.autoMoves.pop();
              if (tp && !tpAlreadyMoved) state.autoMoves.pop();
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
          state.autoMoves.push({ opId: ob.opId, toM: altM });
          if (tpC && !tpCAlreadyMoved) state.autoMoves.push({ opId: tpC, toM: altM });
          const trialAdv: AdvanceAction[] = [
            ...state.autoAdvances,
            { opId: ob.opId, advanceDays: advDays, originalEdd: obEdd },
          ];
          const nr = runSchedule([...userMoves, ...state.autoMoves], trialAdv);
          const nt = computeTardiness(nr.blocks);

          if (nt < totalTardiness && sumOverflow(nr.blocks) === 0) {
            state.autoAdvances.push({ opId: ob.opId, advanceDays: advDays, originalEdd: obEdd });
            state.blocks = nr.blocks;
            state.schedResult = nr;
            totalTardiness = nt;
            tardyImproved = true;

            // Mark blocks as advanced
            for (const b of state.blocks) {
              if (b.opId === ob.opId && b.type === 'ok') {
                b.isAdvanced = true;
                b.advancedByDays = advDays;
              }
            }

            state.schedResult.registry.record({
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
            state.autoMoves.pop(); // undo the trial move
            if (tpC && !tpCAlreadyMoved) state.autoMoves.pop();
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

          const trial = [...state.autoAdvances, ...batchAdvances];
          const newResult = runSchedule([...userMoves, ...state.autoMoves], trial);
          const newTardiness = computeTardiness(newResult.blocks);

          if (newTardiness < totalTardiness && sumOverflow(newResult.blocks) === 0) {
            for (const ba of batchAdvances) state.autoAdvances.push(ba);
            state.blocks = newResult.blocks;
            state.schedResult = newResult;
            totalTardiness = newTardiness;
            tardyImproved = true;

            for (const b of state.blocks) {
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
}
