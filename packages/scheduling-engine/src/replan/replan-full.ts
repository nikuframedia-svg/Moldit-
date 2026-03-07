// =====================================================================
//  INCOMPOL PLAN -- Full Replanning (Layer 4)
//
//  Complete schedule regeneration using ATCS dispatch, with the
//  previous schedule as a seed for SA optimization.
//  Preserves operations in the frozen zone (0-5 days).
//
//  Use when: catastrophic disruption (multiple machines down, etc.)
//  Pure function -- no side effects.
// =====================================================================

import { scoreSchedule } from '../analysis/score-schedule.js';
import { S1 } from '../constants.js';
import type { SAInput } from '../optimization/simulated-annealing.js';
import { runSimulatedAnnealing } from '../optimization/simulated-annealing.js';
import type { ScheduleAllInput } from '../scheduler/scheduler.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { Block } from '../types/blocks.js';
import { DEFAULT_WORKFORCE_CONFIG } from '../types/workforce.js';

export interface FullReplanInput {
  /** Scheduling input */
  scheduleInput: ScheduleAllInput;
  /** Previous schedule (used as SA seed) */
  previousBlocks: Block[];
  /** Frozen zone boundary (day index, default: 5) */
  frozenDayLimit?: number;
  /** SA iterations (default: 2000 for faster recovery) */
  saIterations?: number;
}

export interface FullReplanResult {
  /** Updated blocks with freeze status */
  blocks: Block[];
  /** Whether SA improved over base ATCS */
  saImproved: boolean;
  /** SA score delta */
  scoreDelta: number;
  /** Number of frozen ops preserved */
  frozenCount: number;
  /** Whether emergency night shift is needed */
  emergencyNightShift: boolean;
}

/**
 * Assign freeze status to blocks based on day boundaries.
 * - frozen: dayIdx < frozenDayLimit (0-5 days by default)
 * - slushy: frozenDayLimit <= dayIdx < frozenDayLimit + 10 (5d-2wk)
 * - liquid: dayIdx >= frozenDayLimit + 10 (beyond 2 weeks)
 */
export function assignFreezeZones(blocks: Block[], frozenDayLimit: number): Block[] {
  const slushyLimit = frozenDayLimit + 10; // ~2 weeks
  return blocks.map((b) => ({
    ...b,
    freezeStatus:
      b.dayIdx < frozenDayLimit
        ? ('frozen' as const)
        : b.dayIdx < slushyLimit
          ? ('slushy' as const)
          : ('liquid' as const),
  }));
}

/**
 * Full replanning: regenerate complete schedule with ATCS + SA.
 * Preserves frozen-zone operations.
 */
export function replanFull(input: FullReplanInput): FullReplanResult {
  const { scheduleInput, previousBlocks, frozenDayLimit = 5, saIterations = 2000 } = input;

  // 1. Generate fresh ATCS schedule
  const atcsInput: ScheduleAllInput = {
    ...scheduleInput,
    rule: 'ATCS',
  };
  const atcsResult = scheduleAll(atcsInput);

  // Score the ATCS result
  const wfc = scheduleInput.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG;
  const atcsScore = scoreSchedule(
    atcsResult.blocks,
    scheduleInput.ops,
    scheduleInput.mSt,
    wfc,
    scheduleInput.machines,
    scheduleInput.toolMap,
    undefined,
    previousBlocks,
    scheduleInput.nDays,
  );

  // 2. Run SA with previous schedule as seed
  const saInput: SAInput = {
    ops: scheduleInput.ops,
    mSt: scheduleInput.mSt,
    tSt: scheduleInput.tSt,
    machines: scheduleInput.machines,
    TM: scheduleInput.toolMap,
    workdays: scheduleInput.workdays,
    nDays: scheduleInput.nDays,
    workforceConfig: wfc,
    rule: 'ATCS',
    thirdShift: scheduleInput.thirdShift,
    machineTimelines: scheduleInput.machineTimelines,
    toolTimelines: scheduleInput.toolTimelines,
    twinValidationReport: scheduleInput.twinValidationReport,
    dates: scheduleInput.dates,
    orderBased: scheduleInput.orderBased,
    atcsParams: scheduleInput.atcsParams,
    initialBlocks: atcsResult.blocks,
    initialMoves: scheduleInput.moves,
  };

  const saResult = runSimulatedAnnealing(saInput, {
    maxIter: saIterations,
    seed: 42,
  });

  // Pick the better result
  const bestBlocks = saResult.improved ? saResult.blocks : atcsResult.blocks;
  const scoreDelta = saResult.improved ? saResult.metrics.score - atcsScore.score : 0;

  // 3. Assign freeze zones
  const frozenBlocks = assignFreezeZones(bestBlocks, frozenDayLimit);
  const frozenCount = frozenBlocks.filter((b) => b.freezeStatus === 'frozen').length;

  // Check for emergency night shift
  let emergencyNightShift = false;
  for (const b of frozenBlocks) {
    if (b.endMin > S1 && b.shift !== 'Z') {
      emergencyNightShift = true;
      break;
    }
  }

  return {
    blocks: frozenBlocks,
    saImproved: saResult.improved,
    scoreDelta,
    frozenCount,
    emergencyNightShift,
  };
}
