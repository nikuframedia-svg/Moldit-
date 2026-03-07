// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Auto-Replan Configuration
//  Configures the automatic replanning orchestrator.
//  Strategy order and toggles are user-configurable.
// ═══════════════════════════════════════════════════════════

import {
  DEFAULT_OVERTIME_MAX_PER_MACHINE,
  DEFAULT_OVERTIME_MAX_TOTAL,
  MAX_AUTO_MOVES,
  MAX_OVERFLOW_ITER,
  SPLIT_MIN_DEFICIT,
  SPLIT_MIN_FRACTION,
} from '../constants.js';
import type { ReplanStrategyType } from '../types/blocks.js';

/** Configuration for the auto-replan orchestrator */
export interface AutoReplanConfig {
  /** Master switch: enable auto-replan (default: true) */
  enabled: boolean;

  /**
   * Ordered list of strategies to try (first = highest priority).
   * Default order:
   *   1. ADVANCE_PRODUCTION  — resolver na mesma máquina primeiro
   *   2. MOVE_ALT_MACHINE    — mover para alternativa
   *   3. SPLIT_OPERATION     — dividir entre máquinas
   *   4. OVERTIME            — horas extra
   *   5. THIRD_SHIFT         — último recurso (activação global)
   */
  strategyOrder: ReplanStrategyType[];

  /** Per-strategy toggle (default: all enabled) */
  strategies: Record<ReplanStrategyType, boolean>;

  /** Max total actions across all strategies */
  maxTotalActions: number;

  /** Max iterations for the replan loop */
  maxIterations: number;

  /** Overtime constraints */
  overtime: {
    /** Maximum overtime minutes per machine per day */
    maxMinPerMachinePerDay: number;
    /** Maximum overtime minutes across all machines per day */
    maxMinTotalPerDay: number;
  };

  /** Split constraints */
  split: {
    /** Minimum fraction to keep on original machine (e.g., 0.3 = at least 30%) */
    minFractionOnOriginal: number;
    /** Only split if deficit exceeds this threshold (minutes) */
    minDeficitForSplit: number;
  };

  /** Max outer rounds: full passes through all strategies (allows later strategies
   *  to feed capacity back to earlier ones). Default: 5. */
  maxOuterRounds: number;

  /** Operation IDs to exclude from auto-replan (never touched by the system) */
  excludeOps?: string[];
}

/** Default configuration */
export const DEFAULT_AUTO_REPLAN_CONFIG: AutoReplanConfig = {
  enabled: true,
  strategyOrder: [
    'ADVANCE_PRODUCTION',
    'MOVE_ALT_MACHINE',
    'SPLIT_OPERATION',
    'OVERTIME',
    'THIRD_SHIFT',
  ],
  strategies: {
    ADVANCE_PRODUCTION: true,
    MOVE_ALT_MACHINE: true,
    SPLIT_OPERATION: true,
    OVERTIME: true,
    THIRD_SHIFT: true,
  },
  maxTotalActions: MAX_AUTO_MOVES,
  maxIterations: MAX_AUTO_MOVES * MAX_OVERFLOW_ITER,
  overtime: {
    maxMinPerMachinePerDay: DEFAULT_OVERTIME_MAX_PER_MACHINE,
    maxMinTotalPerDay: DEFAULT_OVERTIME_MAX_TOTAL,
  },
  split: {
    minFractionOnOriginal: SPLIT_MIN_FRACTION,
    minDeficitForSplit: SPLIT_MIN_DEFICIT,
  },
  maxOuterRounds: 5,
};
