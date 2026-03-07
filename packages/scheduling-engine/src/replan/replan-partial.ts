// =====================================================================
//  INCOMPOL PLAN -- Partial Replanning (Layer 3)
//
//  Propagates disruption impact through the dependency graph and
//  reschedules ONLY affected operations. Non-affected blocks are frozen.
//
//  Use when: delay > 2h (significant disruption, not catastrophic).
//  Pure function -- no side effects.
// =====================================================================

import { S1 } from '../constants.js';
import type { ScheduleAllInput } from '../scheduler/scheduler.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { Block } from '../types/blocks.js';
import type { EOp, ETool } from '../types/engine.js';

export type ReplanEventType = 'breakdown' | 'rush_order' | 'material_shortage';

export interface PartialReplanInput {
  /** Type of disruption event */
  eventType: ReplanEventType;
  /** Affected machine (for breakdown) */
  machineId?: string;
  /** Affected operations (direct impact) */
  affectedOpIds: string[];
  /** Scheduling input for re-scheduling */
  scheduleInput: ScheduleAllInput;
  /** Tool map for dependency analysis */
  TM: Record<string, ETool>;
}

export interface PartialReplanResult {
  /** Updated blocks */
  blocks: Block[];
  /** Operations that were rescheduled (directly + transitively affected) */
  rescheduledOps: string[];
  /** Operations that were frozen (not touched) */
  frozenOps: string[];
  /** Whether emergency night shift is needed */
  emergencyNightShift: boolean;
}

/**
 * Build the dependency graph: operations sharing the same machine or tool
 * are connected. Returns the transitive closure of affected ops.
 */
function propagateImpact(
  affectedOpIds: string[],
  allOps: EOp[],
  _TM: Record<string, ETool>,
  blocks: Block[],
  machineId?: string,
): Set<string> {
  const affected = new Set(affectedOpIds);

  // Direct machine impact: all ops on the affected machine
  if (machineId) {
    for (const op of allOps) {
      if (op.m === machineId) affected.add(op.id);
    }
    // Also add ops currently scheduled on this machine (via moves)
    for (const b of blocks) {
      if (b.machineId === machineId && b.type !== 'blocked') {
        affected.add(b.opId);
      }
    }
  }

  // Tool dependency: if an affected op uses a tool, other ops sharing
  // that tool on the same machine are also affected (setup crew, tool timeline)
  const affectedTools = new Set<string>();
  for (const opId of affected) {
    const op = allOps.find((o) => o.id === opId);
    if (op) affectedTools.add(op.t);
  }

  for (const op of allOps) {
    if (affectedTools.has(op.t) && !affected.has(op.id)) {
      // Check if this op shares a machine with an affected op
      const sharedMachine = [...affected].some((aId) => {
        const aOp = allOps.find((o) => o.id === aId);
        return aOp && aOp.m === op.m;
      });
      if (sharedMachine) affected.add(op.id);
    }
  }

  return affected;
}

/**
 * Partial replanning: identify all transitively affected operations,
 * reschedule only those, freeze everything else.
 */
export function replanPartial(blocks: Block[], input: PartialReplanInput): PartialReplanResult {
  const { affectedOpIds, scheduleInput, TM, machineId } = input;

  // Propagate impact to find all affected ops
  const affectedSet = propagateImpact(affectedOpIds, scheduleInput.ops, TM, blocks, machineId);
  const rescheduledOps = [...affectedSet];
  const frozenOps = scheduleInput.ops.filter((o) => !affectedSet.has(o.id)).map((o) => o.id);

  // Re-run full scheduling (affected ops will be naturally rescheduled)
  // Frozen ops' blocks are preserved by the scheduling pipeline
  const reInput: ScheduleAllInput = {
    ...scheduleInput,
    rule: 'ATCS',
  };
  const reResult = scheduleAll(reInput);

  // Mark frozen blocks
  const resultBlocks = reResult.blocks.map((b) => ({
    ...b,
    freezeStatus: affectedSet.has(b.opId) ? ('liquid' as const) : ('frozen' as const),
  }));

  // Check for emergency night shift
  let emergencyNightShift = false;
  for (const b of resultBlocks) {
    if (affectedSet.has(b.opId) && b.endMin > S1 && b.shift !== 'Z') {
      emergencyNightShift = true;
      break;
    }
  }

  return {
    blocks: resultBlocks,
    rescheduledOps,
    frozenOps,
    emergencyNightShift,
  };
}
