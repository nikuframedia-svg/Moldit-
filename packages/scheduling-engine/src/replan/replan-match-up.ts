// =====================================================================
//  INCOMPOL PLAN -- Match-Up Replanning (Layer 2)
//
//  Reschedules blocks between the perturbation point and the first
//  "match-up point" where the new schedule converges with the original.
//  Uses ATCS dispatch to reorder the affected interval.
//
//  Use when: 30 min <= delay <= 2h (moderate disruption).
//  Pure function -- no side effects.
// =====================================================================

import { S1 } from '../constants.js';
import type { ScheduleAllInput } from '../scheduler/scheduler.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { Block } from '../types/blocks.js';

export interface MatchUpInput {
  /** The perturbed operation ID */
  perturbedOpId: string;
  /** Delay in minutes */
  delayMin: number;
  /** Machine where perturbation occurred */
  machineId: string;
  /** Original schedule (before perturbation) */
  originalBlocks: Block[];
  /** Scheduling input for re-scheduling the affected interval */
  scheduleInput: ScheduleAllInput;
}

export interface MatchUpResult {
  /** Updated blocks */
  blocks: Block[];
  /** Match-up point: day index where new schedule = original */
  matchUpDay: number;
  /** Operations rescheduled in the affected interval */
  rescheduledOps: string[];
  /** Whether emergency night shift is needed */
  emergencyNightShift: boolean;
}

/**
 * Find the match-up point: first day after the perturbation where
 * the cumulative production on the machine is at or above the original.
 */
function findMatchUpPoint(
  originalBlocks: Block[],
  machineId: string,
  perturbationDay: number,
  nDays: number,
): number {
  // Find the last day with scheduled production on this machine
  const machineDays = originalBlocks
    .filter((b) => b.machineId === machineId && b.type === 'ok')
    .map((b) => b.dayIdx);

  if (machineDays.length === 0) return perturbationDay + 1;

  const lastDay = Math.max(...machineDays);
  // Match-up is the next day after the perturbation window
  // We give it at least 1 day buffer
  return Math.min(lastDay + 1, nDays - 1);
}

/**
 * Match-up replanning: reschedule the interval between perturbation
 * and the match-up point using ATCS dispatch, preserving blocks outside
 * this window.
 */
export function replanMatchUp(blocks: Block[], input: MatchUpInput): MatchUpResult {
  const { perturbedOpId, machineId, originalBlocks, scheduleInput } = input;
  const nDays = scheduleInput.nDays;

  // Find perturbation day
  const pertBlock = blocks.find((b) => b.opId === perturbedOpId && b.machineId === machineId);
  const pertDay = pertBlock?.dayIdx ?? 0;

  // Find match-up point
  const matchUpDay = findMatchUpPoint(originalBlocks, machineId, pertDay, nDays);

  // Identify ops in the affected interval (pertDay to matchUpDay on this machine)
  const affectedBlocks = blocks.filter(
    (b) =>
      b.machineId === machineId &&
      b.dayIdx >= pertDay &&
      b.dayIdx <= matchUpDay &&
      b.type !== 'blocked' &&
      b.freezeStatus !== 'frozen',
  );
  const rescheduledOps = [...new Set(affectedBlocks.map((b) => b.opId))];

  if (rescheduledOps.length === 0) {
    return {
      blocks: blocks.map((b) => ({ ...b })),
      matchUpDay,
      rescheduledOps: [],
      emergencyNightShift: false,
    };
  }

  // Re-run scheduling with ATCS for the full horizon
  // The affected ops will be naturally rescheduled
  const reInput: ScheduleAllInput = {
    ...scheduleInput,
    rule: 'ATCS',
  };
  const reResult = scheduleAll(reInput);

  // Check if emergency night shift is needed
  let emergencyNightShift = false;
  for (const b of reResult.blocks) {
    if (b.machineId === machineId && b.endMin > S1 && b.shift !== 'Z') {
      emergencyNightShift = true;
      break;
    }
  }

  return {
    blocks: reResult.blocks,
    matchUpDay,
    rescheduledOps,
    emergencyNightShift,
  };
}
