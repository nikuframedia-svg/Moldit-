// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Shared types for overflow tier functions
// ═══════════════════════════════════════════════════════════

import type { DecisionRegistry } from '../decisions/decision-registry.js';
import type { AdvanceAction, Block, MoveAction } from '../types/blocks.js';
import type { DecisionEntry } from '../types/decisions.js';
import type { EOp } from '../types/engine.js';
import type { FeasibilityReport } from '../types/infeasibility.js';

/** Mutable state threaded through tier functions */
export interface TierState {
  blocks: Block[];
  schedResult: {
    blocks: Block[];
    decisions: DecisionEntry[];
    registry: DecisionRegistry;
    feasibilityReport: FeasibilityReport;
  };
  autoMoves: MoveAction[];
  autoAdvances: AdvanceAction[];
}

/** Scheduling function signature used by all tiers */
export type RunScheduleFn = (
  moves: MoveAction[],
  advances?: AdvanceAction[],
) => {
  blocks: Block[];
  decisions: DecisionEntry[];
  registry: DecisionRegistry;
  feasibilityReport: FeasibilityReport;
};

/** Shared context passed to tier functions */
export interface TierContext {
  ops: EOp[];
  userMoves: MoveAction[];
  mSt: Record<string, string>;
  workdays: boolean[];
  twinPartnerMap: Map<string, string>;
  thirdShift?: boolean;
  machineTimelines?: Record<string, import('../types/failure.js').ResourceTimeline>;
  runSchedule: RunScheduleFn;
  /** Schedule with load leveling enabled (slower, redistributes overflow). Used by Tier 3 bulk trials. */
  runScheduleWithLeveling?: RunScheduleFn;
}
