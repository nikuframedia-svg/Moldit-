// =====================================================================
//  INCOMPOL PLAN -- Replan Dispatcher (Layer Selection)
//
//  Evaluates the perturbation magnitude and chooses the appropriate
//  replanning layer:
//    Layer 1 (right-shift):  delay < 30 min
//    Layer 2 (match-up):     30 min <= delay < 120 min
//    Layer 3 (partial):      delay >= 120 min
//    Layer 4 (full):         catastrophe (multiple machines down)
//
//  If 2 shifts (X+Y) are insufficient → emergencyNightShift = true.
//  Pure function -- no side effects.
// =====================================================================

import type { ScheduleAllInput } from '../scheduler/scheduler.js';
import type { Block } from '../types/blocks.js';
import type { ETool } from '../types/engine.js';
import type { FullReplanResult } from './replan-full.js';
import { replanFull } from './replan-full.js';
import type { MatchUpResult } from './replan-match-up.js';
import { replanMatchUp } from './replan-match-up.js';
import type { PartialReplanResult, ReplanEventType } from './replan-partial.js';
import { replanPartial } from './replan-partial.js';
import type { RightShiftResult } from './replan-right-shift.js';
import { replanRightShift } from './replan-right-shift.js';

// ── Thresholds ──────────────────────────────────────────

/** Layer 1 → 2 boundary (minutes) */
export const LAYER_THRESHOLD_1 = 30;
/** Layer 2 → 3 boundary (minutes) */
export const LAYER_THRESHOLD_2 = 120;

// ── Input / Output ──────────────────────────────────────

export type ReplanLayer = 1 | 2 | 3 | 4;

export interface ReplanDispatchInput {
  /** Current schedule blocks */
  blocks: Block[];
  /** Previous/original blocks (for match-up comparison and SA seed) */
  previousBlocks: Block[];
  /** Perturbed operation ID */
  perturbedOpId: string;
  /** Delay in minutes (for layers 1-3) */
  delayMin: number;
  /** Machine where perturbation occurred */
  machineId: string;
  /** Scheduling input */
  scheduleInput: ScheduleAllInput;
  /** Tool map for dependency analysis */
  TM: Record<string, ETool>;
  /** Event type for partial replanning */
  eventType?: ReplanEventType;
  /** Additional affected ops (for rush orders, material shortages) */
  additionalAffectedOps?: string[];
  /** Force a specific layer (override auto-selection) */
  forceLayer?: ReplanLayer;
  /** Is this a catastrophe? (multiple machines down → force Layer 4) */
  isCatastrophe?: boolean;
}

export interface ReplanDispatchResult {
  /** Which layer was chosen */
  layer: ReplanLayer;
  /** Updated blocks */
  blocks: Block[];
  /** Whether emergency night shift is needed */
  emergencyNightShift: boolean;
  /** Layer-specific result (for inspection) */
  layerResult: RightShiftResult | MatchUpResult | PartialReplanResult | FullReplanResult;
}

// ── Dispatcher ──────────────────────────────────────────

/**
 * Choose the replanning layer based on the delay magnitude.
 */
export function chooseLayer(delayMin: number, isCatastrophe?: boolean): ReplanLayer {
  if (isCatastrophe) return 4;
  if (delayMin < LAYER_THRESHOLD_1) return 1;
  if (delayMin < LAYER_THRESHOLD_2) return 2;
  return 3;
}

/**
 * Dispatch to the appropriate replanning layer based on perturbation severity.
 *
 * - Layer 1 (right-shift): O(n) time shift, delay < 30 min
 * - Layer 2 (match-up): ATCS resequencing, 30 min <= delay < 2h
 * - Layer 3 (partial): Dependency graph propagation, delay >= 2h
 * - Layer 4 (full): Complete regeneration with ATCS + SA, catastrophe
 */
export function dispatchReplan(input: ReplanDispatchInput): ReplanDispatchResult {
  const {
    blocks,
    previousBlocks,
    perturbedOpId,
    delayMin,
    machineId,
    scheduleInput,
    TM,
    eventType = 'breakdown',
    additionalAffectedOps = [],
    forceLayer,
    isCatastrophe,
  } = input;

  const layer = forceLayer ?? chooseLayer(delayMin, isCatastrophe);

  switch (layer) {
    case 1: {
      const result = replanRightShift(blocks, {
        perturbedOpId,
        delayMin,
        machineId,
      });
      return {
        layer: 1,
        blocks: result.blocks,
        emergencyNightShift: result.emergencyNightShift,
        layerResult: result,
      };
    }

    case 2: {
      const result = replanMatchUp(blocks, {
        perturbedOpId,
        delayMin,
        machineId,
        originalBlocks: previousBlocks,
        scheduleInput,
      });
      return {
        layer: 2,
        blocks: result.blocks,
        emergencyNightShift: result.emergencyNightShift,
        layerResult: result,
      };
    }

    case 3: {
      const affectedOpIds = [perturbedOpId, ...additionalAffectedOps];
      const result = replanPartial(blocks, {
        eventType,
        machineId,
        affectedOpIds,
        scheduleInput,
        TM,
      });
      return {
        layer: 3,
        blocks: result.blocks,
        emergencyNightShift: result.emergencyNightShift,
        layerResult: result,
      };
    }

    case 4: {
      const result = replanFull({
        scheduleInput,
        previousBlocks,
      });
      return {
        layer: 4,
        blocks: result.blocks,
        emergencyNightShift: result.emergencyNightShift,
        layerResult: result,
      };
    }
  }
}
