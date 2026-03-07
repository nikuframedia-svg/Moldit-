// =====================================================================
//  INCOMPOL PLAN -- Right-Shift Replanning (Layer 1)
//
//  Simplest replan strategy: shift all subsequent blocks on the same
//  machine forward by the delay amount. O(n), no sequence change.
//
//  Use when: delay < 30 min (minor disruption).
//  Pure function -- no side effects.
// =====================================================================

import { S1, S2 } from '../constants.js';
import type { Block } from '../types/blocks.js';

export interface RightShiftInput {
  /** The perturbed operation ID */
  perturbedOpId: string;
  /** Delay in minutes to apply */
  delayMin: number;
  /** Machine where the perturbation occurred */
  machineId: string;
}

export interface RightShiftResult {
  /** Updated blocks (all machines, only affected machine modified) */
  blocks: Block[];
  /** List of operation IDs that were shifted */
  affectedOps: string[];
  /** Total delay propagated to last block (minutes) */
  totalPropagatedDelay: number;
  /** Whether any block overflowed into next day */
  hasOverflow: boolean;
  /** Whether emergency night shift is needed */
  emergencyNightShift: boolean;
}

/**
 * Right-shift all subsequent blocks on the same machine after the
 * perturbed operation. O(n) scan, no resequencing.
 *
 * Blocks are shifted forward in time by the delay amount.
 * If a shifted block exceeds S1 (end of shift Y), it overflows.
 * If it exceeds S2 (end of shift Z), emergencyNightShift = true.
 */
export function replanRightShift(blocks: Block[], input: RightShiftInput): RightShiftResult {
  const { perturbedOpId, delayMin, machineId } = input;
  const result = blocks.map((b) => ({ ...b }));
  const affectedOps: string[] = [];
  let hasOverflow = false;
  let emergencyNightShift = false;

  // Find the perturbed block
  const machineBlocks = result
    .filter((b) => b.machineId === machineId && b.type !== 'blocked')
    .sort((a, b) => {
      const absA = a.dayIdx * 1440 + a.startMin;
      const absB = b.dayIdx * 1440 + b.startMin;
      return absA - absB;
    });

  // Find the index of the perturbed block
  const pertIdx = machineBlocks.findIndex((b) => b.opId === perturbedOpId);
  if (pertIdx < 0 || delayMin <= 0) {
    return {
      blocks: result,
      affectedOps: [],
      totalPropagatedDelay: 0,
      hasOverflow: false,
      emergencyNightShift: false,
    };
  }

  // Shift the perturbed block and all subsequent blocks
  const accDelay = delayMin;
  for (let i = pertIdx; i < machineBlocks.length; i++) {
    const mb = machineBlocks[i];
    // Find this block in the result array and shift it
    const idx = result.findIndex(
      (b) => b.opId === mb.opId && b.dayIdx === mb.dayIdx && b.machineId === mb.machineId,
    );
    if (idx < 0) continue;

    const b = result[idx];
    affectedOps.push(b.opId);

    // Shift timing
    if (b.setupS != null && b.setupE != null) {
      b.setupS += accDelay;
      b.setupE += accDelay;
    }
    b.startMin += accDelay;
    b.endMin += accDelay;

    // Check overflow: if endMin exceeds day capacity
    const dayEnd = b.shift === 'Z' ? S2 : S1;
    if (b.endMin > dayEnd) {
      hasOverflow = true;
      b.overflow = true;
      b.overflowMin = b.endMin - dayEnd;

      if (b.endMin > S2) {
        emergencyNightShift = true;
      }
    }
  }

  const totalPropagatedDelay = accDelay;

  return {
    blocks: result,
    affectedOps: [...new Set(affectedOps)],
    totalPropagatedDelay,
    hasOverflow,
    emergencyNightShift,
  };
}
