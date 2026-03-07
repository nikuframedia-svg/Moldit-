// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Constraint Manager
//  Wraps all 4 constraints with hard/disabled routing.
//
//  Per Normative Spec: ALL constraints are HARD.
//  For HARD constraints:   delay or block if violated
//  For DISABLED:           skip entirely (no check)
//
//  The manager does NOT record decisions — the scheduler
//  is responsible for decision logging via DecisionRegistry.
// ═══════════════════════════════════════════════════════════

import type { ConstraintConfig, ConstraintMode, ConstraintName } from '../types/constraints.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../types/constraints.js';
import type { WorkforceConfig } from '../types/workforce.js';
import { DEFAULT_WORKFORCE_CONFIG } from '../types/workforce.js';
import type { CalcoTimeline } from './calco-timeline.js';
import { createCalcoTimeline } from './calco-timeline.js';
import type { OperatorPool } from './operator-pool.js';
import { createOperatorPool } from './operator-pool.js';
import type { SetupCrew } from './setup-crew.js';
import { createSetupCrew } from './setup-crew.js';
import type { ToolTimeline } from './tool-timeline.js';
import { createToolTimeline } from './tool-timeline.js';

// ── Result types ──

/** Result from a constraint check through the manager */
export interface ConstraintResult {
  /** true = go ahead, false = blocked (no room in shift) */
  proceed: boolean;
  /** -1 if blocked, otherwise the time to use */
  adjustedTime: number;
  /** Whether time was adjusted from requested */
  wasDelayed: boolean;
}

/** Extended result from operator capacity check */
export interface OperatorCheckResult extends ConstraintResult {
  /** Available operator slots (total cap - current usage) */
  available: number;
  /** Resolved labor group (undefined if machine not mapped) */
  laborGroup: string | undefined;
  /** Whether the machine is not mapped to any labor group */
  unmapped: boolean;
  /** Worst window shortage across all overlapping windows */
  worstWindowShortage: number;
}

/** Setup-specific check input */
export interface SetupCheckInput {
  earliest: number;
  duration: number;
  shiftEnd: number;
  machineId: string;
  opId?: string;
  toolId?: string;
}

/** Tool-specific check input */
export interface ToolCheckInput {
  toolId: string;
  start: number;
  duration: number;
  shiftEnd: number;
  machineId: string;
  instances?: number;
  opId?: string;
}

/** Calco-specific check input */
export interface CalcoCheckInput {
  calcoCode: string;
  start: number;
  duration: number;
  shiftEnd: number;
  machineId: string;
  opId?: string;
}

/** Operator-specific check input */
export interface OperatorCheckInput {
  dayIdx: number;
  startMin: number;
  endMin: number;
  operators: number;
  machineId: string;
  opId?: string;
  toolId?: string;
}

// ── Helpers ──

/** Build a "no action" result — used when constraint is disabled */
function passResult(time: number): ConstraintResult {
  return {
    proceed: true,
    adjustedTime: time,
    wasDelayed: false,
  };
}

/** Build a "no action" operator result — used when constraint is disabled */
function passOperatorResult(): OperatorCheckResult {
  return {
    proceed: true,
    adjustedTime: 0,
    wasDelayed: false,
    available: Infinity,
    laborGroup: undefined,
    unmapped: false,
    worstWindowShortage: 0,
  };
}

// ── Manager ──

/**
 * ConstraintManager — Unified entry point for all scheduling constraints.
 *
 * Wraps the 4 constraint instances (SetupCrew, ToolTimeline, CalcoTimeline,
 * OperatorPool) and routes checks through the configured mode:
 *
 * - **hard**: Constraint is enforced. If violated, the result delays or blocks.
 * - **disabled**: Constraint is skipped entirely (for testing/scenarios).
 *
 * The manager does NOT record decisions. The scheduler is responsible
 * for logging decisions via DecisionRegistry based on the returned results.
 *
 * @example
 * ```ts
 * const mgr = new ConstraintManager(operatorCaps)
 * const result = mgr.checkSetup({ earliest: 500, duration: 30, shiftEnd: 930, machineId: 'PRM019' })
 * if (result.proceed) {
 *   mgr.bookSetup(result.adjustedTime, result.adjustedTime + 30, 'PRM019')
 * }
 * ```
 */
export class ConstraintManager {
  /** Individual constraint instances (exposed for direct access if needed) */
  readonly setupCrew: SetupCrew;
  readonly toolTimeline: ToolTimeline;
  readonly calcoTimeline: CalcoTimeline;
  readonly operatorPool: OperatorPool;

  /** Current constraint configuration */
  private config: ConstraintConfig;

  /**
   * @param workforceConfig - Workforce labor group configuration (laborGroups + machine mapping)
   * @param config          - Constraint modes (defaults to DEFAULT_CONSTRAINT_CONFIG — all hard)
   */
  constructor(workforceConfig?: WorkforceConfig, config?: ConstraintConfig) {
    this.config = config ?? { ...DEFAULT_CONSTRAINT_CONFIG };

    this.setupCrew = createSetupCrew();
    this.toolTimeline = createToolTimeline();
    this.calcoTimeline = createCalcoTimeline();
    this.operatorPool = createOperatorPool(workforceConfig ?? DEFAULT_WORKFORCE_CONFIG);
  }

  // ── Mode helpers ──

  /** Get the mode for a specific constraint */
  getMode(name: ConstraintName): ConstraintMode {
    switch (name) {
      case 'SETUP_CREW':
        return this.config.setupCrew.mode;
      case 'TOOL_TIMELINE':
        return this.config.toolTimeline.mode;
      case 'CALCO_TIMELINE':
        return this.config.calcoTimeline.mode;
      case 'OPERATOR_POOL':
        return this.config.operatorPool.mode;
    }
  }

  /** Update constraint mode at runtime (e.g., for scenario exploration) */
  setMode(name: ConstraintName, mode: ConstraintMode): void {
    switch (name) {
      case 'SETUP_CREW':
        this.config.setupCrew = { mode };
        break;
      case 'TOOL_TIMELINE':
        this.config.toolTimeline = { mode };
        break;
      case 'CALCO_TIMELINE':
        this.config.calcoTimeline = { mode };
        break;
      case 'OPERATOR_POOL':
        this.config.operatorPool = { mode };
        break;
    }
  }

  // ══════════════════════════════════════════════════════════
  //  SETUP CREW
  // ══════════════════════════════════════════════════════════

  /**
   * Check the SetupCrew constraint for a proposed setup.
   *
   * - **hard**: Delays to next available slot. Returns proceed=false if no slot in shift.
   * - **disabled**: Always proceeds, no check.
   *
   * @param input - Setup check parameters
   * @returns ConstraintResult
   */
  checkSetup(input: SetupCheckInput): ConstraintResult {
    const mode = this.config.setupCrew.mode;
    if (mode === 'disabled') return passResult(input.earliest);

    const check = this.setupCrew.check(input.earliest, input.duration, input.shiftEnd);

    // No conflict — proceed at requested time
    if (!check.hasConflict) {
      return passResult(input.earliest);
    }

    // HARD mode: delay or block
    if (check.availableAt === -1) {
      // No room in shift — block
      return {
        proceed: false,
        adjustedTime: -1,
        wasDelayed: false,
      };
    }

    // Delay to available slot
    return {
      proceed: true,
      adjustedTime: check.availableAt,
      wasDelayed: true,
    };
  }

  /**
   * Book a setup slot. Call after checkSetup() returns proceed=true.
   *
   * @param start     - Absolute start minute (use adjustedTime from result)
   * @param end       - Absolute end minute
   * @param machineId - Machine performing the setup
   */
  bookSetup(start: number, end: number, machineId: string): void {
    if (this.config.setupCrew.mode !== 'disabled') {
      this.setupCrew.book(start, end, machineId);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  TOOL TIMELINE
  // ══════════════════════════════════════════════════════════

  /**
   * Check the ToolTimeline constraint for a proposed tool usage.
   *
   * - **hard**: Delays to next available slot. Returns proceed=false if no slot.
   * - **disabled**: Always proceeds, no check.
   *
   * @param input - Tool check parameters
   * @returns ConstraintResult
   */
  checkTool(input: ToolCheckInput): ConstraintResult {
    const mode = this.config.toolTimeline.mode;
    if (mode === 'disabled') return passResult(input.start);

    const check = this.toolTimeline.check(
      input.toolId,
      input.start,
      input.duration,
      input.shiftEnd,
      input.machineId,
      input.instances,
    );

    // No conflict
    if (check.isAvailable) {
      return passResult(input.start);
    }

    // HARD mode: delay or block
    if (check.availableAt === -1) {
      return {
        proceed: false,
        adjustedTime: -1,
        wasDelayed: false,
      };
    }

    return {
      proceed: true,
      adjustedTime: check.availableAt,
      wasDelayed: true,
    };
  }

  /**
   * Book a tool usage. Call after checkTool() returns proceed=true.
   *
   * @param toolId    - Tool code
   * @param start     - Absolute start minute
   * @param end       - Absolute end minute
   * @param machineId - Machine using the tool
   */
  bookTool(toolId: string, start: number, end: number, machineId: string): void {
    if (this.config.toolTimeline.mode !== 'disabled') {
      this.toolTimeline.book(toolId, start, end, machineId);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  CALCO TIMELINE
  // ══════════════════════════════════════════════════════════

  /**
   * Check the CalcoTimeline constraint for a proposed calco usage.
   *
   * - **hard**: Delays to next available slot. Returns proceed=false if no slot.
   * - **disabled**: Always proceeds, no check.
   *
   * @param input - Calco check parameters
   * @returns ConstraintResult
   */
  checkCalco(input: CalcoCheckInput): ConstraintResult {
    const mode = this.config.calcoTimeline.mode;
    if (mode === 'disabled') return passResult(input.start);

    const check = this.calcoTimeline.check(
      input.calcoCode,
      input.start,
      input.duration,
      input.shiftEnd,
    );

    // No conflict
    if (check.isAvailable) {
      return passResult(input.start);
    }

    // HARD mode: delay or block
    if (check.availableAt === -1) {
      return {
        proceed: false,
        adjustedTime: -1,
        wasDelayed: false,
      };
    }

    return {
      proceed: true,
      adjustedTime: check.availableAt,
      wasDelayed: true,
    };
  }

  /**
   * Book a calco usage. Call after checkCalco() returns proceed=true.
   *
   * @param calcoCode - Calco code
   * @param start     - Absolute start minute
   * @param end       - Absolute end minute
   * @param machineId - Machine using the calco
   */
  bookCalco(calcoCode: string, start: number, end: number, machineId: string): void {
    if (this.config.calcoTimeline.mode !== 'disabled') {
      this.calcoTimeline.book(calcoCode, start, end, machineId);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  OPERATOR POOL
  // ══════════════════════════════════════════════════════════

  /**
   * Check the OperatorPool constraint for a proposed operation.
   *
   * Returns an OperatorCheckResult with capacity info and labor group.
   *
   * - **hard**: Always proceeds (advisory only). Returns capacity info for warnings.
   * - **disabled**: Always proceeds, no check.
   *
   * @param input - Operator check parameters
   * @returns OperatorCheckResult
   */
  checkOperators(input: OperatorCheckInput): OperatorCheckResult {
    const mode = this.config.operatorPool.mode;
    if (mode === 'disabled') return passOperatorResult();

    const check = this.operatorPool.checkCapacity(
      input.dayIdx,
      input.startMin,
      input.endMin,
      input.operators,
      input.machineId,
    );

    return {
      proceed: true,
      adjustedTime: 0,
      wasDelayed: false,
      available: check.available,
      laborGroup: check.laborGroup,
      unmapped: check.unmapped,
      worstWindowShortage: check.worstWindowShortage,
    };
  }

  /**
   * Book operator demand. Call after checkOperators() returns proceed=true.
   *
   * @param di        - Day index
   * @param shift     - Shift code
   * @param operators - Number of operators
   * @param machineId - Machine ID (resolved to labor group internally)
   */
  bookOperators(
    di: number,
    startMin: number,
    endMin: number,
    operators: number,
    machineId: string,
  ): void {
    if (this.config.operatorPool.mode !== 'disabled') {
      this.operatorPool.book(di, startMin, endMin, operators, machineId);
    }
  }

  // ══════════════════════════════════════════════════════════
  //  UTILITY
  // ══════════════════════════════════════════════════════════

  /** Get current constraint configuration (read-only copy) */
  getConfig(): Readonly<ConstraintConfig> {
    return { ...this.config };
  }

  /** Reset all constraint state (for new scheduling run) */
  reset(): void {
    this.setupCrew.clear();
    this.toolTimeline.clear();
    this.calcoTimeline.clear();
    this.operatorPool.clear();
  }
}
