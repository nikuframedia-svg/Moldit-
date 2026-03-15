// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Auto-Replan Orchestrator
//
//  Automatically resolves overflow operations by executing
//  strategies in priority order instead of just suggesting them.
//
//  Strategies (default order):
//    1. ADVANCE_PRODUCTION  — same machine, earlier days
//    2. MOVE_ALT_MACHINE    — move to alternative machine
//    3. SPLIT_OPERATION     — split between primary and alt
//    4. OVERTIME            — extend shift hours
//    5. THIRD_SHIFT         — activate 3rd shift (global, last resort)
//
//  Each action is:
//    - Marked as system-made (isSystemReplanned)
//    - Recorded in DecisionRegistry with explanation
//    - Provided with alternatives the user can choose instead
//    - Reversible by re-running without the action
//
//  Wraps autoRouteOverflow() for advance/move strategies.
//  Pure function — no side effects.
// ═══════════════════════════════════════════════════════════

import { DAY_CAP, S0, S2 } from '../constants.js';
import type { ScheduleAllInput } from '../scheduler/scheduler.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type {
  AdvanceAction,
  MoveAction,
  OvertimeAction,
  SplitAction,
} from '../types/blocks.js';
import type { AutoReplanConfig } from './auto-replan-config.js';
import { DEFAULT_AUTO_REPLAN_CONFIG } from './auto-replan-config.js';
import {
  buildAdvanceAction,
  buildMoveAction,
  buildOvertimeAction,
  buildSplitAction,
  buildThirdShiftAction,
  collectUnresolved,
  emptyResult,
  markAdvanceBlocks,
  markMoveBlocks,
  reRecordDecisions,
} from './auto-replan-actions.js';
import type { AutoReplanAction, AutoReplanResult } from './auto-replan-types.js';
import { computeTardiness, sumOverflow } from './overflow-helpers.js';
import { tryAdvanceOverflow, tryAdvanceTardy } from './strategies/advance-strategy.js';
import { tryMoveOverflow, tryMoveTardy } from './strategies/move-strategy.js';
import { tryOvertime } from './strategies/overtime-strategy.js';
import { trySplitOperation } from './strategies/split-strategy.js';
import { tryThirdShift } from './strategies/third-shift-strategy.js';

// Re-export types for backwards compatibility
export type { AutoReplanAction, AutoReplanResult } from './auto-replan-types.js';

/**
 * Auto-resolve overflow by executing strategies in priority order.
 *
 * Algorithm:
 * 1. Run initial scheduleAll() to get baseline
 * 2. For each strategy in config.strategyOrder:
 *    a. Find overflow candidates
 *    b. Try the strategy (greedy: 1 action at a time)
 *    c. Validate improvement (re-schedule)
 *    d. Record in DecisionRegistry with alternatives
 *    e. Mark blocks as system-replanned
 * 3. Remaining overflow → FORMAL_RISK_ACCEPTANCE
 */
export function autoReplan(
  input: ScheduleAllInput,
  config: AutoReplanConfig = DEFAULT_AUTO_REPLAN_CONFIG,
): AutoReplanResult {
  if (!config.enabled) {
    const result = scheduleAll(input);
    return emptyResult(result);
  }

  const autoMoves: MoveAction[] = [];
  const autoAdvances: AdvanceAction[] = [];
  const overtimeActions: OvertimeAction[] = [];
  const splitActions: SplitAction[] = [];
  const actions: AutoReplanAction[] = [];
  let thirdShiftActivated = false;
  const currentOvertimeMap: Record<string, Record<number, number>> = {};
  for (const [mId, dayMap] of Object.entries(input.overtimeMap ?? {})) {
    currentOvertimeMap[mId] = { ...dayMap };
  }
  let currentThirdShift = input.thirdShift ?? false;
  let currentOps = [...input.ops];

  const buildInput = (): ScheduleAllInput => ({
    ...input,
    ops: currentOps,
    moves: [...input.moves, ...autoMoves],
    thirdShift: currentThirdShift,
    overtimeMap: Object.keys(currentOvertimeMap).length > 0 ? currentOvertimeMap : undefined,
    advanceOverrides: autoAdvances.length > 0 ? autoAdvances : input.advanceOverrides,
    enableLeveling: false,
    enforceDeadlines: false,
  });

  let schedResult = scheduleAll(buildInput());
  let blocks = schedResult.blocks;
  let totalOverflow = sumOverflow(blocks);

  if (totalOverflow === 0 && computeTardiness(blocks) === 0) {
    const finalResult = scheduleAll({ ...buildInput(), enableLeveling: true, enforceDeadlines: true });
    return emptyResult(finalResult);
  }

  const excludeOps = new Set<string>(config.excludeOps ?? []);
  let totalActions = 0;
  const wDayCount = input.workdays ? input.workdays.filter(Boolean).length : input.nDays;
  const preTier1TardyOps = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'ok' && b.eddDay != null && b.dayIdx > b.eddDay) {
      preTier1TardyOps.add(b.opId);
    }
  }

  // ═══ TIER 1: Resolve OVERFLOW via strategies in priority order ═══
  let outerImproved = true;
  let outerRound = 0;
  while (outerImproved && totalOverflow > 0 && totalActions < config.maxTotalActions && outerRound < config.maxOuterRounds) {
    outerImproved = false;
    outerRound++;
    const overflowBeforeRound = totalOverflow;
    const hardCap = currentThirdShift ? S2 - S0 : DAY_CAP;

    for (const strategy of config.strategyOrder) {
      if (!config.strategies[strategy]) continue;
      if (totalOverflow === 0 || totalActions >= config.maxTotalActions) break;

      switch (strategy) {
        case 'ADVANCE_PRODUCTION': {
          let improved = true;
          while (improved && totalOverflow > 0 && totalActions < config.maxTotalActions) {
            improved = false;
            const result = tryAdvanceOverflow(buildInput, blocks, totalOverflow, autoAdvances, excludeOps, input.workdays, input.workforceConfig, input.toolMap);
            if (result) {
              autoAdvances.push(result.advance);
              blocks = result.blocks;
              schedResult = result.schedResult;
              totalOverflow = result.newMetric;
              improved = true;
              totalActions++;
              markAdvanceBlocks(blocks, result.ob.opId, result.advance.advanceDays);
              actions.push(buildAdvanceAction(result, schedResult));
            }
          }
          break;
        }

        case 'MOVE_ALT_MACHINE': {
          let improved = true;
          while (improved && totalOverflow > 0 && totalActions < config.maxTotalActions) {
            improved = false;
            const result = tryMoveOverflow(buildInput, blocks, totalOverflow, autoMoves, excludeOps, input.machines, hardCap, wDayCount, input.mSt, input.workdays, input.workforceConfig);
            if (result) {
              autoMoves.push(result.move);
              blocks = result.blocks;
              schedResult = result.schedResult;
              totalOverflow = result.newMetric;
              improved = true;
              totalActions++;
              markMoveBlocks(blocks, result.ob.opId, 'MOVE_ALT_MACHINE');
              actions.push(buildMoveAction(result, schedResult));
            }
          }
          break;
        }

        case 'SPLIT_OPERATION': {
          let splitImproved = true;
          while (splitImproved && totalOverflow > 0 && totalActions < config.maxTotalActions) {
            splitImproved = false;
            const splitResult = trySplitOperation(buildInput(), blocks, totalOverflow, config.split, excludeOps);
            if (splitResult.split && splitResult.candidate && splitResult.syntheticOp) {
              splitImproved = true;
              const c = splitResult.candidate;
              blocks = splitResult.blocks;
              schedResult = splitResult.schedResult;
              totalOverflow = totalOverflow - splitResult.overflowReduction;
              totalActions++;
              currentOps = [
                ...currentOps.map((o) => o.id === c.opId ? { ...o, d: o.d.map((v, i) => Math.max(v - (splitResult.syntheticOp!.d[i] ?? 0), 0)), atr: Math.max((o.atr ?? 0) - (splitResult.syntheticOp!.atr ?? 0), 0) } : o),
                splitResult.syntheticOp,
              ];
              splitActions.push({ opId: c.opId, fraction: c.fraction, toMachine: c.altMachine });
              actions.push(buildSplitAction(c, schedResult));
              excludeOps.add(c.opId);
            }
          }
          break;
        }

        case 'OVERTIME': {
          let otImproved = true;
          while (otImproved && totalOverflow > 0 && totalActions < config.maxTotalActions) {
            otImproved = false;
            const overtimeResult = tryOvertime(buildInput(), blocks, totalOverflow, config.overtime, excludeOps);
            if (overtimeResult.activated) {
              otImproved = true;
              blocks = overtimeResult.blocks;
              schedResult = overtimeResult.schedResult;
              totalOverflow = totalOverflow - overtimeResult.overflowReduction;
              totalActions++;
              for (const ot of overtimeResult.overtimeActions) {
                if (!currentOvertimeMap[ot.machineId]) currentOvertimeMap[ot.machineId] = {};
                currentOvertimeMap[ot.machineId][ot.dayIdx] = (currentOvertimeMap[ot.machineId][ot.dayIdx] ?? 0) + ot.extraMin;
              }
              overtimeActions.push(...overtimeResult.overtimeActions);
              for (const ot of overtimeResult.overtimeActions) {
                actions.push(buildOvertimeAction(ot, schedResult));
              }
            }
          }
          break;
        }

        case 'THIRD_SHIFT': {
          const tsResult = tryThirdShift(buildInput(), blocks, totalOverflow);
          if (tsResult.activated) {
            blocks = tsResult.blocks;
            schedResult = tsResult.schedResult;
            totalOverflow = totalOverflow - tsResult.overflowReduction;
            currentThirdShift = true;
            thirdShiftActivated = true;
            totalActions++;
            actions.push(buildThirdShiftAction(tsResult.overflowReduction, schedResult));
          }
          break;
        }
      }
    }

    if (totalOverflow < overflowBeforeRound) outerImproved = true;
  }

  // ═══ TIER 2: Resolve TARDINESS ═══
  let totalTardiness = computeTardiness(blocks);
  const hardCapT2 = currentThirdShift ? S2 - S0 : DAY_CAP;

  while (totalTardiness > 0 && totalActions < config.maxTotalActions) {
    let tardyImproved = false;

    const advResult = tryAdvanceTardy(buildInput, blocks, totalTardiness, autoAdvances, excludeOps, preTier1TardyOps, input.workdays, input.workforceConfig, input.toolMap);
    if (advResult) {
      autoAdvances.push(advResult.advance);
      blocks = advResult.blocks;
      schedResult = advResult.schedResult;
      totalTardiness = advResult.newMetric;
      tardyImproved = true;
      totalActions++;
      markAdvanceBlocks(blocks, advResult.ob.opId, advResult.advance.advanceDays);
      actions.push(buildAdvanceAction(advResult, schedResult, true));
    } else {
      const moveResult = tryMoveTardy(buildInput, blocks, totalTardiness, autoMoves, excludeOps, preTier1TardyOps, input.machines, hardCapT2, wDayCount, input.mSt, input.workdays, input.workforceConfig);
      if (moveResult) {
        autoMoves.push(moveResult.move);
        blocks = moveResult.blocks;
        schedResult = moveResult.schedResult;
        totalTardiness = moveResult.newMetric;
        tardyImproved = true;
        totalActions++;
        markMoveBlocks(blocks, moveResult.ob.opId, 'MOVE_ALT_MACHINE');
        actions.push(buildMoveAction(moveResult, schedResult, true));
      }
    }

    if (!tardyImproved) break;
  }

  // ═══ FINAL: Re-run with leveling + deadlines ═══
  const finalResult = scheduleAll({ ...buildInput(), enableLeveling: true, enforceDeadlines: true });
  reRecordDecisions(actions, finalResult, currentThirdShift);
  const unresolved = collectUnresolved(finalResult.blocks, currentOps);

  return {
    blocks: finalResult.blocks,
    scheduleResult: finalResult,
    actions,
    autoMoves,
    autoAdvances,
    overtimeActions,
    splitActions,
    thirdShiftActivated,
    unresolved,
    registry: finalResult.registry,
    decisions: finalResult.registry.getAll(),
  };
}

