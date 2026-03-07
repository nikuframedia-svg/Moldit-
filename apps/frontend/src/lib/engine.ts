// ═══════════════════════════════════════════════════════════
//  INCOMPOL Web App — Engine Shim Layer
//  Single import point for ALL scheduling logic.
//  Re-exports everything from incompol-plan (the TRUTH).
//  Provides backwards-compatible wrappers where needed.
//  ALL consumers in the web app MUST import from here.
// ═══════════════════════════════════════════════════════════

// ── Re-export ALL types from incompol-plan ──
export type {
  ActionMessage,
  ActionMessagesSummary,
  AdvanceAction,
  AlternativeAction,
  AutoReplanAction,
  AutoReplanConfig,
  // Auto-Replan types
  AutoReplanResult,
  // Block & scheduling types
  Block,
  CapacityLogEntry,
  ConstraintConfig,
  // Constraint types
  ConstraintMode,
  ConstraintName,
  CoverageAudit,
  // Coverage audit result
  CoverageAuditResult,
  CoverageAuditRow,
  CoverageCell,
  CoverageEntry,
  CoverageMatrixResult,
  CoverageMatrixSkuResult,
  CoverageSkuCell,
  CTPInput,
  CTPResult,
  CTPSkuInput,
  DayLoad,
  DayShiftCapacity,
  DayShiftStatus,
  DecisionEntry,
  DecisionKind,
  DecisionSeverity,
  DecisionSummary,
  // Decision types
  DecisionType,
  DeficitEvolution,
  DispatchRule,
  // Engine types
  EMachine,
  EngineData,
  EOp,
  ETool,
  // Failure types
  FailureEvent,
  FailureJustification,
  FailureSeverity,
  FeasibilityReport,
  ImpactedBlock,
  ImpactReport,
  InfeasibilityEntry,
  // Infeasibility types
  InfeasibilityReason,
  LaborWindow,
  MachineLoadEntry,
  MasterISOPData,
  MasterToolRecord,
  MoveAction,
  MoveableOp,
  MRPDayBucket,
  MRPRecord,
  // MRP types
  MRPResult,
  MRPSkuRecord,
  MRPSkuSummary,
  // MRP SKU-View types
  MRPSkuViewRecord,
  MRPSkuViewResult,
  MRPSummary,
  NikufraCustomer,
  NikufraData,
  NikufraHistoryEvent,
  // Core data types
  NikufraMachine,
  NikufraMOLoad,
  NikufraOperation,
  NikufraTool,
  ObjectiveWeights,
  OperationDeadline,
  OperationScore,
  // Optimization
  OptimizationInput,
  OptimizationSetup,
  // KPI & analysis types
  OptResult,
  OrderJustification,
  OvertimeAction,
  PlanningKPIs,
  PlanningMachine,
  PlanningOperation,
  PlanningTool,
  // Plan state types
  PlanState,
  // Quick validate
  QuickValidateResult,
  RCCPEntry,
  RemediationProposal,
  RemediationType,
  ReplanActionDetail,
  // Gen decisions
  ReplanProposal,
  ReplanResult,
  ReplanSimulation,
  ReplanStrategyType,
  ResourceTimeline,
  RiskCell,
  // Risk types
  RiskGridData,
  RiskLevel,
  RiskRow,
  RiskValidationInput,
  ROPConfig,
  ROPResult,
  ROPSkuResult,
  ROPSkuSummary,
  ROPSummary,
  // Scheduler types
  ScheduleAllInput,
  ScheduleAllResult,
  ScheduleSlot,
  // Schedule validation (distinct from kpis.ts ValidationReport)
  ScheduleValidationReport,
  ScheduleViolation,
  // Score weights
  ScoreWeights,
  ServiceLevel,
  ShiftId,
  // Shipping types
  ShippingCutoffConfig,
  SplitAction,
  // Transparency types
  StartReason,
  // Supply priority types
  SupplyPriority,
  SupplyPriorityConfig,
  // Transform types
  TransformConfig,
  TransparencyReport,
  // Twin types
  TwinAnomalyCode,
  TwinAnomalyEntry,
  TwinGroup,
  TwinOutput,
  TwinValidationInput,
  TwinValidationReport,
  UserReplanChoice,
  ValidationReport,
  Violation,
  ViolationSeverity,
  WhatIfDelta,
  WhatIfMutation,
  WhatIfResult,
  // Scoring types
  WorkContent,
  // Workforce types
  WorkforceConfig,
  WorkforceCoverageMissing,
  // Workforce forecast
  WorkforceDemandResult,
  WorkforceForecast,
  WorkforceForecastInput,
  WorkforceForecastWarning,
  WorkforceSuggestion,
  ZoneShiftDemand,
} from '@prodplan/scheduling-engine';
// ── Re-export ALL constants from incompol-plan ──
// ── Re-export ALL functions from incompol-plan ──
export {
  ADVANCE_UTIL_THRESHOLD,
  ALT_UTIL_THRESHOLD,
  analyzeAllFailures,
  analyzeFailureImpact,
  applyAlternative,
  auditCoverage,
  // Auto-Replan
  autoReplan,
  // Overflow
  autoRouteOverflow,
  // Scheduling parameters
  BUCKET_WINDOW,
  // Failures
  buildResourceTimelines,
  // Analysis
  buildTransparencyReport,
  C,
  ConstraintManager,
  capAnalysis,
  cascadingReplan,
  computeActionMessages,
  computeCoverageMatrix,
  computeCoverageMatrixSku,
  computeCTP,
  computeCTPSku,
  computeD1WorkforceRisk,
  computeDeficitEvolution,
  computeEarliestStarts,
  computeFailureActionMessages,
  // MRP
  computeMRP,
  // MRP SKU-View
  computeMRPSkuView,
  // Risk
  computeRiskGrid,
  computeROP,
  computeROPSku,
  computeShippingDeadlines,
  computeSupplyPriority,
  computeWhatIf,
  computeWorkContent,
  computeWorkforceDemand,
  computeWorkforceForecast,
  createCalcoTimeline,
  // Infeasibility
  createEmptyFeasibilityReport,
  createOperatorPool,
  // Constraints
  createSetupCrew,
  createToolTimeline,
  // Capacity
  DAY_CAP, // 1020 min (NOT 990)
  DEFAULT_AUTO_REPLAN_CONFIG,
  // Config defaults
  DEFAULT_CONSTRAINT_CONFIG,
  // MO / Data sentinel
  DEFAULT_MO_CAPACITY,
  DEFAULT_OEE, // 0.66
  // Auto-replan parameters
  DEFAULT_OVERTIME_MAX_PER_MACHINE,
  DEFAULT_OVERTIME_MAX_TOTAL,
  DEFAULT_ROP_CONFIG,
  DEFAULT_SCORE_WEIGHTS,
  // Shipping
  DEFAULT_SHIPPING_BUFFER_HOURS,
  DEFAULT_SHIPPING_CUTOFF,
  DEFAULT_SUPPLY_PRIORITY_CONFIG,
  DEFAULT_TRANSFORM_CONFIG,
  DEFAULT_WORKFORCE_CONFIG,
  // Decisions
  DecisionRegistry,
  deltaizeCumulativeNP,
  deriveLegacyStatus,
  extractStockFromRawNP,
  FactoryLookup,
  finalizeFeasibilityReport,
  fmtMin,
  fromAbs,
  // Gen Decisions
  genDecisions,
  getBlockProductionForOp,
  getBlockQtyForOp,
  getBlockReplanInfo,
  getBlocksForOp,
  getCapacityFactor,
  getReplanActions,
  getShift,
  getShiftEnd,
  getShiftStart,
  groupDemandIntoBuckets,
  inferWorkdaysFromLabels,
  isFullyDown,
  // Machine IDs
  KNOWN_FOCUS,
  LEVEL_HIGH_THRESHOLD,
  LEVEL_LOOKAHEAD,
  LEVEL_LOW_THRESHOLD,
  legacyStatusToFailureEvents,
  levelLoad,
  MAX_ADVANCE_DAYS,
  MAX_AUTO_MOVES,
  // 50 (NOT 16)
  MAX_EDD_GAP,
  MAX_OVERFLOW_ITER,
  mergeConsecutiveBlocks,
  moveableOps,
  // Utilities
  mulberry32,
  // Normalize
  normalizeNikufraData,
  OTD_TOLERANCE,
  // 1.0 HARD (NOT 0.95)
  padMoArray,
  // Quick Validate
  quickValidate,
  rawNPtoDailyDemand,
  rawNPtoOrderDemand,
  replanWithUserChoices,
  // Optimization
  runOptimization,
  // Shift boundaries (THE TRUTH: S0=420 = 07:00, NOT 07:30)
  S0,
  S1,
  S2,
  SPLIT_MIN_DEFICIT,
  SPLIT_MIN_FRACTION,
  // Scheduler (CORE)
  scheduleAll,
  scheduleFromEngineData,
  scoreOperations,
  scoreSchedule,
  simulateWithout,
  sortGroupsByScore,
  T1,
  TC,
  tci,
  toAbs,
  // Transform
  transformPlanState,
  twoOptResequence,
  undoReplanActions,
  validateSchedule,
  validateTwinReferences,
} from '@prodplan/scheduling-engine';

// ── Backwards-compatible types for web app ──

/**
 * Legacy AreaCaps type used by web app components.
 * Maps to WorkforceConfig in INCOMPOL PLAN.
 */
export interface AreaCaps {
  PG1: number;
  PG2: number;
}

/**
 * Legacy Decision type used by web app UI.
 * Simpler than INCOMPOL PLAN's DecisionEntry.
 */
export interface Decision {
  id: string;
  opId: string;
  type: 'replan' | 'blocked';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  desc: string;
  reasoning: string[];
  impact: Record<string, unknown> | null;
  action: _MoveAction | null;
}

/**
 * Legacy OpDay type (kept for backwards compat).
 */
export interface OpDay {
  pg1: number;
  pg2: number;
  total: number;
}

/**
 * Legacy ObjectiveProfile type.
 */
export interface ObjectiveProfile {
  id: string;
  label: string;
  weights: Record<string, number>;
}

import type {
  MoveAction as _MoveAction,
  ZoneShiftDemand as _ZoneShiftDemand,
} from '@prodplan/scheduling-engine';

// ── Backwards-compatible helper: opsByDayFromWorkforce ──
// Aggregates ZoneShiftDemand[] into per-day pg1/pg2/total operator counts.
// This replaces the old metrics.opsByDay (OpDay[]) that no longer exists on OptResult.
// For each dayIdx, we take max peakNeed across shifts per labor group (not sum)
// because a single operator covers one shift, and peakNeed already represents
// the concurrent peak within that shift.

export function opsByDayFromWorkforce(wfd: _ZoneShiftDemand[], nDays: number): OpDay[] {
  const result: OpDay[] = Array.from({ length: nDays }, () => ({ pg1: 0, pg2: 0, total: 0 }));
  for (const e of wfd) {
    if (e.dayIdx < 0 || e.dayIdx >= nDays) continue;
    // Map labor groups to PG1/PG2
    if (e.laborGroup === 'Grandes') {
      result[e.dayIdx].pg1 = Math.max(result[e.dayIdx].pg1, e.peakNeed);
    } else {
      result[e.dayIdx].pg2 = Math.max(result[e.dayIdx].pg2, e.peakNeed);
    }
  }
  for (const r of result) r.total = r.pg1 + r.pg2;
  return result;
}
