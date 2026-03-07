// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Frozen Rules
//  ALL values in this file are IMMUTABLE.
//  Any change to a value here MUST cause frozen-invariants
//  tests to FAIL. This file is the single source of truth
//  for the system's invariant rules and constants.
//
//  DO NOT MODIFY without updating the mega-analysis document
//  AND getting explicit approval from the project owner.
// ═══════════════════════════════════════════════════════════

// ── Frozen Constants ─────────────────────────────────────

export const FROZEN_CONSTANTS = {
  // Shift boundaries (minutes from midnight)
  S0: 420, // 07:00 — Shift X start
  T1: 930, // 15:30 — Shift change X→Y
  TG_END: 960, // 16:00 — Turno geral end (affects staffing)
  S1: 1440, // 24:00 — Shift Y end (midnight)
  S2: 1860, // 07:00 next day — Shift Z end (S1 + S0)
  MINUTES_PER_DAY: 1440,

  // Capacity
  DAY_CAP: 1020, // S1 - S0 = 1440 - 420 = 1020 min (2 shifts)
  DEFAULT_OEE: 0.66,
  // Scheduling parameters
  BUCKET_WINDOW: 5,
  MAX_EDD_GAP: 5,
  MAX_AUTO_MOVES: 50,
  MAX_OVERFLOW_ITER: 3,
  ALT_UTIL_THRESHOLD: 0.95,
  MAX_ADVANCE_DAYS: Infinity,
  ADVANCE_UTIL_THRESHOLD: 0.95,
  OTD_TOLERANCE: 1.0,

  // Load leveling
  LEVEL_LOW_THRESHOLD: 0.6,
  LEVEL_HIGH_THRESHOLD: 0.75,
  LEVEL_LOOKAHEAD: 15,

  // Risk grid
  RISK_MEDIUM_THRESHOLD: 0.85,
  RISK_HIGH_THRESHOLD: 0.95,
  RISK_CRITICAL_THRESHOLD: 1.0,

  // Shipping
  DEFAULT_SHIPPING_BUFFER_HOURS: 0,

  // Auto-replan
  DEFAULT_OVERTIME_MAX_PER_MACHINE: 450,
  DEFAULT_OVERTIME_MAX_TOTAL: 2700,
  SPLIT_MIN_FRACTION: 0.3,
  SPLIT_MIN_DEFICIT: 60,

  // Data sentinel
  DEFAULT_MO_CAPACITY: 99,
} as const;

// ── Frozen Machine Set ───────────────────────────────────

export const FROZEN_KNOWN_FOCUS = [
  'PRM019',
  'PRM020',
  'PRM031',
  'PRM039',
  'PRM042',
  'PRM043',
] as const;

// ── Frozen Decision Types (28 exact) ─────────────────────

export const FROZEN_DECISION_TYPES = [
  'BACKWARD_SCHEDULE',
  'LOAD_LEVEL',
  'OVERFLOW_ROUTE',
  'ADVANCE_PRODUCTION',
  'DATA_MISSING',
  'INFEASIBILITY_DECLARED',
  'DEADLINE_CONSTRAINT',
  'OPERATOR_REALLOCATION',
  'ALTERNATIVE_MACHINE',
  'TOOL_DOWN',
  'MACHINE_DOWN',
  'FAILURE_DETECTED',
  'FAILURE_MITIGATION',
  'FAILURE_UNRECOVERABLE',
  'SHIPPING_CUTOFF',
  'PRODUCTION_START',
  'CAPACITY_COMPUTATION',
  'SCORING_DECISION',
  'OPERATOR_CAPACITY_WARNING',
  'AUTO_REPLAN_ADVANCE',
  'AUTO_REPLAN_MOVE',
  'AUTO_REPLAN_SPLIT',
  'AUTO_REPLAN_OVERTIME',
  'AUTO_REPLAN_THIRD_SHIFT',
  'TWIN_VALIDATION_ANOMALY',
  'WORKFORCE_FORECAST_D1',
  'WORKFORCE_COVERAGE_MISSING',
  'LABOR_GROUP_UNMAPPED',
] as const;

// ── Frozen Infeasibility Reasons (11 exact) ──────────────

export const FROZEN_INFEASIBILITY_REASONS = [
  'SETUP_CREW_EXHAUSTED',
  'OPERATOR_CAPACITY',
  'TOOL_CONFLICT',
  'CALCO_CONFLICT',
  'DEADLINE_VIOLATION',
  'MACHINE_DOWN',
  'CAPACITY_OVERFLOW',
  'DATA_MISSING',
  'MACHINE_PARTIAL_DOWN',
  'TOOL_DOWN_TEMPORAL',
  'SHIPPING_CUTOFF_VIOLATION',
] as const;

// ── Frozen Remediation Types (7 exact) ───────────────────

export const FROZEN_REMEDIATION_TYPES = [
  'THIRD_SHIFT',
  'EXTRA_OPERATORS',
  'OVERTIME',
  'SPLIT_OPERATION',
  'ADVANCE_PRODUCTION',
  'TRANSFER_ALT_MACHINE',
  'FORMAL_RISK_ACCEPTANCE',
] as const;

// ── Frozen Start Reasons (6 exact) ───────────────────────

export const FROZEN_START_REASONS = [
  'urgency_slack_critical',
  'density_heavy_load',
  'free_window_available',
  'setup_reduction',
  'future_load_relief',
  'deficit_elimination',
] as const;

// ── Frozen Block Types (4 exact) ─────────────────────────

export const FROZEN_BLOCK_TYPES = ['ok', 'blocked', 'overflow', 'infeasible'] as const;

// ── Frozen Replan Strategy Types (5 exact) ───────────────

export const FROZEN_REPLAN_STRATEGY_TYPES = [
  'ADVANCE_PRODUCTION',
  'MOVE_ALT_MACHINE',
  'SPLIT_OPERATION',
  'OVERTIME',
  'THIRD_SHIFT',
] as const;

// ── Frozen Replan Strategy Order (default) ───────────────

export const FROZEN_REPLAN_STRATEGY_ORDER = [
  'ADVANCE_PRODUCTION',
  'MOVE_ALT_MACHINE',
  'SPLIT_OPERATION',
  'OVERTIME',
  'THIRD_SHIFT',
] as const;

// ── Frozen Auto-Replan Config Defaults ───────────────────

export const FROZEN_AUTO_REPLAN_DEFAULTS = {
  enabled: true,
  maxTotalActions: 50,
  maxIterations: 150, // MAX_AUTO_MOVES * MAX_OVERFLOW_ITER = 50 * 3
  maxOuterRounds: 5,
  overtime: {
    maxMinPerMachinePerDay: 450,
    maxMinTotalPerDay: 2700,
  },
  split: {
    minFractionOnOriginal: 0.3,
    minDeficitForSplit: 60,
  },
} as const;

// ── Frozen Workforce Config ──────────────────────────────

export const FROZEN_WORKFORCE_CONFIG = {
  laborGroups: {
    Grandes: [
      { start: 420, end: 930, capacity: 6 }, // 07:00-15:30
      { start: 930, end: 960, capacity: 6 }, // 15:30-16:00
      { start: 960, end: 1440, capacity: 5 }, // 16:00-00:00
    ],
    Medias: [
      { start: 420, end: 930, capacity: 9 }, // 07:00-15:30
      { start: 930, end: 960, capacity: 8 }, // 15:30-16:00
      { start: 960, end: 1440, capacity: 4 }, // 16:00-00:00
    ],
  },
  machineToLaborGroup: {
    PRM019: 'Grandes',
    PRM031: 'Grandes',
    PRM039: 'Grandes',
    PRM043: 'Grandes',
    PRM042: 'Medias',
  },
  // NOTE: PRM020 is intentionally NOT mapped (unmapped = no operator constraint)
} as const;

// ── Frozen Constraint Config ─────────────────────────────

export const FROZEN_CONSTRAINT_CONFIG = {
  setupCrew: { mode: 'hard' },
  toolTimeline: { mode: 'hard' },
  calcoTimeline: { mode: 'hard' },
  operatorPool: { mode: 'hard' }, // mode is 'hard' but behaviour is ADVISORY (warns, never blocks)
} as const;

// ── Frozen Pipeline Steps (exact order) ──────────────────

export const FROZEN_PIPELINE_STEPS = [
  'twin_validation_recording', // Step 0: Record twin anomalies into registry
  'shipping_deadlines', // Step 1a: Compute shipping deadlines (when active)
  'work_content', // Step 1b: Compute work content (when active)
  'deficit_evolution', // Step 1c: Compute deficit evolution (when active)
  'backward_scheduling', // Step 1d: computeEarliestStarts (always)
  'scoring', // Step 2b: scoreOperations (when active)
  'demand_grouping', // Step 2: groupDemandIntoBuckets
  'sort_and_merge', // Step 3: sortAndMergeGroups / sortGroupsByScore
  'machine_ordering', // Step 4: orderMachinesByUrgency
  'slot_allocation', // Step 5: scheduleMachines (Phase 2)
  'load_leveling', // Step 6: levelLoad (optional)
  'block_merging', // Step 7: mergeConsecutiveBlocks
  'enforce_deadlines', // Step 7.5: overflow → infeasible
  'feasibility_report', // Step 8: finalizeFeasibilityReport
  'workforce_forecast_d1', // Step 9: computeWorkforceForecast
  'transparency_report', // Step 10: buildTransparencyReport
] as const;

// ── Frozen Slot-Allocator Verification Order (7 checks) ──

export const FROZEN_SLOT_CHECKS = [
  'setup_crew', // Check 1: HARD — before production loop, exclusive setup crew
  'machine_capacity', // Check 2: Shift boundaries / remaining time
  'failure_timeline', // Check 3: Avaria / capacity factor (0.0 = skip shift)
  'operator_pool', // Check 4: ADVISORY — warns but NEVER blocks
  'calco_timeline', // Check 5: HARD — calco exclusive (no same-machine exception)
  'tool_timeline', // Check 6: HARD — tool exclusive (same-machine OK)
  'shipping_cutoff', // Check 7: HARD — trim/break at deadline (when active)
] as const;

// ── Frozen Score Weights ─────────────────────────────────

export const FROZEN_SCORE_WEIGHTS = {
  tardiness: 100.0,
  setup_count: 10.0,
  setup_time: 1.0,
  setup_balance: 30.0,
  churn: 5.0,
  overflow: 50.0,
  below_min_batch: 5.0,
  capacity_variance: 20.0,
  setup_density: 15.0,
} as const;

// ── Frozen Constraint Names (4 exact) ────────────────────

export const FROZEN_CONSTRAINT_NAMES = [
  'SETUP_CREW',
  'TOOL_TIMELINE',
  'CALCO_TIMELINE',
  'OPERATOR_POOL',
] as const;

// ── Frozen Behavioral Rules ──────────────────────────────

export const FROZEN_BEHAVIORAL_RULES = {
  /** Operator pool NEVER blocks scheduling — always advisory */
  operatorPoolIsAdvisory: true,
  /** Setup crew is exclusive: only 1 setup at a time in the entire factory */
  setupCrewExclusive: true,
  /** Tool timeline prevents simultaneous use on 2+ machines (same machine OK) */
  toolTimelineSameMachineException: true,
  /** Calco timeline is MORE restrictive: no same-machine exception */
  calcoTimelineNoSameMachineException: true,
  /** Blocks never silently disappear — always overflow or infeasible */
  blocksNeverDisappear: true,
  /** Supply boost overrides dispatch rules */
  supplyBoostOverridesDispatch: true,
  /** Load leveling only moves backwards (earlier days), never forward */
  loadLevelingOnlyBackward: true,
  /** MRP twin-aware: grossReq = max(A,B), not sum */
  mrpTwinMaxNotSum: true,
  /** Operations never invented: DATA_MISSING flagged, never assumed */
  neverInventData: true,
  /** PRM020 is intentionally unmapped from labor groups */
  prm020Unmapped: true,
  /** 3rd shift is global activation (all machines) */
  thirdShiftIsGlobal: true,
  /** Score = -Infinity when lostPcs > 0 */
  scoreMinusInfinityOnLostPieces: true,
} as const;
