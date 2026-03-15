// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Auto-Replan Types
//  Shared type definitions for the auto-replan system.
// ═══════════════════════════════════════════════════════════

import type { DecisionRegistry } from '../decisions/decision-registry.js';
import type { ScheduleAllResult } from '../scheduler/scheduler.js';
import type {
  AdvanceAction,
  Block,
  MoveAction,
  OvertimeAction,
  ReplanStrategyType,
  SplitAction,
} from '../types/blocks.js';
import type { AlternativeAction, DecisionEntry } from '../types/decisions.js';

/** A single auto-replan action taken by the system */
export interface AutoReplanAction {
  /** Which strategy was used */
  strategy: ReplanStrategyType;
  /** Operation affected */
  opId: string;
  /** Machine involved */
  machineId: string;
  /** Decision ID in registry */
  decisionId: string;
  /** Human-readable description */
  description: string;
  /** Detailed explanation of what was done */
  detail: string;
  /** Alternatives the user could choose instead */
  alternatives: AlternativeAction[];
  /** Structured metadata from original decision (preserved for final re-recording) */
  metadata?: Record<string, unknown>;
}

/** Complete result of auto-replan */
export interface AutoReplanResult {
  /** Final blocks after all replan actions */
  blocks: Block[];
  /** Final scheduling result */
  scheduleResult: ScheduleAllResult;
  /** All auto-replan actions taken, in order */
  actions: AutoReplanAction[];
  /** Auto-generated move actions */
  autoMoves: MoveAction[];
  /** Auto-generated advance actions */
  autoAdvances: AdvanceAction[];
  /** Overtime actions applied */
  overtimeActions: OvertimeAction[];
  /** Split actions applied */
  splitActions: SplitAction[];
  /** Whether 3rd shift was activated by auto-replan */
  thirdShiftActivated: boolean;
  /** Remaining unresolved overflow operations */
  unresolved: Array<{ opId: string; deficit: number; reason: string }>;
  /** Full decision registry */
  registry: DecisionRegistry;
  /** All decisions */
  decisions: DecisionEntry[];
}
