// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Public API
//  Production Planning Engine for Nikufra Factory
//  100% Pure TypeScript — No React, No Browser APIs
//  Per Normative Spec: ALL constraints HARD, FeasibilityReport always
// ═══════════════════════════════════════════════════════════

export { capAnalysis } from './analysis/cap-analysis.js';
export type { CoverageAuditResult, CoverageAuditRow } from './analysis/coverage-audit.js';
export { auditCoverage } from './analysis/coverage-audit.js';
export type { DecisionKind, DecisionSeverity, ReplanProposal } from './analysis/gen-decisions.js';
// ── Gen Decisions (UI-facing replan proposals) ──
export { genDecisions } from './analysis/gen-decisions.js';
export type { WorkforceDemandResult } from './analysis/op-demand.js';
export { computeWorkforceDemand } from './analysis/op-demand.js';
export type { QuickValidateResult } from './analysis/quick-validate.js';
// ── Quick Validate ──
export { quickValidate } from './analysis/quick-validate.js';
export type { ScoreWeights } from './analysis/score-schedule.js';
// ── Score Weights ──
export {
  DEFAULT_WEIGHTS as DEFAULT_SCORE_WEIGHTS,
  scoreSchedule,
} from './analysis/score-schedule.js';
// ── Analysis ──
export type {
  LateDeliveryAnalysis,
  LateDeliveryEntry,
  SuggestedAction,
} from './analysis/late-delivery-analysis.js';
export { analyzeLateDeliveries } from './analysis/late-delivery-analysis.js';
export { buildTransparencyReport } from './analysis/transparency-report.js';
export type { ScheduleValidationReport, ScheduleViolation } from './analysis/validate-schedule.js';
export { validateSchedule } from './analysis/validate-schedule.js';
export type { WorkforceForecastInput } from './analysis/workforce-forecast.js';
// ── Workforce Forecast ──
export { computeD1WorkforceRisk, computeWorkforceForecast } from './analysis/workforce-forecast.js';
export type { SchedulingConfig } from './config/scheduling-config.js';
// ── Configuration (Zod) ──
export {
  DEFAULT_SCHEDULING_CONFIG,
  migrateConfig,
  POLICY_BALANCED,
  POLICY_INCOMPOL_STANDARD,
  POLICY_MAX_OTD,
  POLICY_MIN_SETUPS,
  POLICY_URGENT,
  SchedulingConfigSchema,
  validateConfig,
} from './config/scheduling-config.js';
export type { SchedulingContext, SchedulingStrategy, ScoringJob } from './config/strategy.js';
// ── Strategy Pattern ──
export {
  BalancedStrategy,
  MaxOTDStrategy,
  MinSetupsStrategy,
  strategyFromConfig,
  WeightedCompositeStrategy,
} from './config/strategy.js';
// ── Constants ──
export {
  ADVANCE_UTIL_THRESHOLD,
  ALT_UTIL_THRESHOLD,
  BUCKET_WINDOW,
  DAY_CAP,
  DEFAULT_MO_CAPACITY,
  DEFAULT_OEE,
  DEFAULT_OVERTIME_MAX_PER_MACHINE,
  DEFAULT_OVERTIME_MAX_TOTAL,
  DEFAULT_SHIPPING_BUFFER_HOURS,
  KNOWN_FOCUS,
  LEVEL_HIGH_THRESHOLD,
  LEVEL_LOOKAHEAD,
  LEVEL_LOW_THRESHOLD,
  MAX_ADVANCE_DAYS,
  MAX_AUTO_MOVES,
  MAX_EDD_GAP,
  MAX_OVERFLOW_ITER,
  OTD_TOLERANCE,
  S0,
  S1,
  S2,
  SPLIT_MIN_DEFICIT,
  SPLIT_MIN_FRACTION,
  T1,
} from './constants.js';
export { createCalcoTimeline } from './constraints/calco-timeline.js';
export { ConstraintManager } from './constraints/constraint-manager.js';
export { createOperatorPool } from './constraints/operator-pool.js';

// ── Constraints ──
export { createSetupCrew } from './constraints/setup-crew.js';
export { createToolTimeline } from './constraints/tool-timeline.js';
// ── Decisions ──
export { DecisionRegistry } from './decisions/decision-registry.js';
export { cascadingReplan } from './failures/cascading-replan.js';
// ── Failures ──
export {
  buildResourceTimelines,
  deriveLegacyStatus,
  getCapacityFactor,
  isFullyDown,
  legacyStatusToFailureEvents,
} from './failures/failure-timeline.js';
export { analyzeAllFailures, analyzeFailureImpact } from './failures/impact-analysis.js';
export { computeActionMessages, computeFailureActionMessages } from './mrp/mrp-actions.js';
export { computeCoverageMatrixSku } from './mrp/mrp-coverage-sku.js';
export { computeCTP } from './mrp/mrp-ctp.js';
export { computeCTPSku } from './mrp/mrp-ctp-sku.js';
// ── MRP ──
export { computeMRP } from './mrp/mrp-engine.js';
export type { ROPConfig } from './mrp/mrp-rop.js';
export { computeCoverageMatrix, computeROP, DEFAULT_ROP_CONFIG } from './mrp/mrp-rop.js';
export { computeROPSku } from './mrp/mrp-rop-sku.js';
// ── MRP SKU-View ──
export { computeMRPSkuView } from './mrp/mrp-sku-view.js';
export { computeWhatIf } from './mrp/mrp-what-if.js';
export type { SupplyPriority, SupplyPriorityConfig } from './mrp/supply-priority.js';
export { computeSupplyPriority, DEFAULT_SUPPLY_PRIORITY_CONFIG } from './mrp/supply-priority.js';
export type {
  MoveableOp,
  OptimizationInput,
  OptimizationSetup,
} from './optimization/run-optimization.js';
// ── Optimization ──
export { moveableOps, runOptimization, twoOptResequence } from './optimization/run-optimization.js';
export type { SAConfig, SAInput, SAResult } from './optimization/simulated-annealing.js';
// ── Simulated Annealing ──
export { DEFAULT_SA_CONFIG, runSimulatedAnnealing } from './optimization/simulated-annealing.js';
export type { AutoReplanAction, AutoReplanResult } from './overflow/auto-replan-types.js';
// ── Auto-Replan ──
export { autoReplan } from './overflow/auto-replan.js';
// ── Overflow Helpers ──
export { computeAdvancedEdd, computeTardiness, sumOverflow } from './overflow/overflow-helpers.js';
export type { AutoReplanConfig } from './overflow/auto-replan-config.js';
export { DEFAULT_AUTO_REPLAN_CONFIG } from './overflow/auto-replan-config.js';
export type {
  ReplanActionDetail,
  ReplanSimulation,
  UserReplanChoice,
} from './overflow/auto-replan-control.js';
// ── Auto-Replan Control (undo / replace / simulate) ──
export {
  applyAlternative,
  getBlockReplanInfo,
  getReplanActions,
  replanWithUserChoices,
  simulateWithout,
  undoReplanActions,
} from './overflow/auto-replan-control.js';
// ── Overflow ──
export { autoRouteOverflow } from './overflow/auto-route-overflow.js';
export { tier3Diag } from './overflow/tier3-otd-delivery.js';
export { computeOtdDeliveryFailures } from './overflow/otd-delivery-failures.js';
export type {
  ReplanDispatchInput,
  ReplanDispatchResult,
  ReplanLayer,
} from './replan/replan-dispatcher.js';
export {
  chooseLayer,
  dispatchReplan,
  LAYER_THRESHOLD_1,
  LAYER_THRESHOLD_2,
} from './replan/replan-dispatcher.js';
export type { FullReplanInput, FullReplanResult } from './replan/replan-full.js';
export { assignFreezeZones, replanFull } from './replan/replan-full.js';
export type { MatchUpInput, MatchUpResult } from './replan/replan-match-up.js';
export { replanMatchUp } from './replan/replan-match-up.js';
export type {
  PartialReplanInput,
  PartialReplanResult,
  ReplanEventType,
} from './replan/replan-partial.js';
export { replanPartial } from './replan/replan-partial.js';
export type { RightShiftInput, RightShiftResult } from './replan/replan-right-shift.js';
// ── Layered Replanning ──
export { replanRightShift } from './replan/replan-right-shift.js';
export type {
  RiskCell,
  RiskGridData,
  RiskLevel,
  RiskRow,
  RiskValidationInput,
} from './risk/risk-grid.js';
// ── Risk ──
export { computeRiskGrid } from './risk/risk-grid.js';
export type { ATCSParams, GridResult } from './scheduler/atcs-dispatch.js';
export {
  atcsGridSearch,
  atcsPriority,
  computeATCSAverages,
  DEFAULT_ATCS_PARAMS,
} from './scheduler/atcs-dispatch.js';
export { computeEarliestStarts } from './scheduler/backward-scheduler.js';
export { mergeConsecutiveBlocks } from './scheduler/block-merger.js';
export { groupDemandIntoBuckets } from './scheduler/demand-grouper.js';
export { levelLoad } from './scheduler/load-leveler.js';
export { scoreOperations, sortGroupsByScore } from './scheduler/production-scorer.js';
export { repairScheduleViolations } from './scheduler/repair-violations.js';
export type { ScheduleAllInput, ScheduleAllResult } from './scheduler/scheduler.js';
// ── Scheduler (CORE) ──
export { scheduleAll, scheduleFromEngineData } from './scheduler/scheduler.js';
export { computeShippingDeadlines } from './scheduler/shipping-cutoff.js';
export type { UCB1Arm, UCB1ArmStats, UCB1State } from './scheduler/ucb1-selector.js';
// ── UCB1 Selector ──
export { DISPATCH_BANDIT, UCB1Selector } from './scheduler/ucb1-selector.js';
export { computeDeficitEvolution, computeWorkContent } from './scheduler/work-content.js';
// ── Normalize ──
export { FactoryLookup, normalizeNikufraData } from './transform/normalize.js';
export type { TransformConfig } from './transform/transform-plan-state.js';
// ── Transform ──
export {
  DEFAULT_TRANSFORM_CONFIG,
  deltaizeCumulativeNP,
  extractStockFromRawNP,
  rawNPtoDailyDemand,
  rawNPtoOrderDemand,
  transformPlanState,
} from './transform/transform-plan-state.js';
export type { TwinValidationInput } from './transform/twin-validator.js';
export { validateTwinReferences } from './transform/twin-validator.js';
export type {
  AdvanceAction,
  Block,
  DayLoad,
  MoveAction,
  OvertimeAction,
  ReplanStrategyType,
  SplitAction,
  TwinOutput,
  ZoneShiftDemand,
} from './types/blocks.js';
export type { ConstraintConfig, ConstraintMode, ConstraintName } from './types/constraints.js';
export { DEFAULT_CONSTRAINT_CONFIG } from './types/constraints.js';
// ── Types ──
export type {
  MasterISOPData,
  MasterToolRecord,
  NikufraCustomer,
  NikufraData,
  NikufraHistoryEvent,
  NikufraMachine,
  NikufraMOLoad,
  NikufraOperation,
  NikufraTool,
} from './types/core.js';
export type {
  AlternativeAction,
  DecisionEntry,
  DecisionSummary,
  DecisionType,
} from './types/decisions.js';
export type {
  EMachine,
  EngineData,
  EOp,
  ETool,
} from './types/engine.js';
export type {
  DayShiftCapacity,
  DayShiftStatus,
  FailureEvent,
  FailureSeverity,
  ImpactedBlock,
  ImpactReport,
  ReplanResult,
  ResourceTimeline,
  ShiftId,
} from './types/failure.js';
export type {
  FeasibilityReport,
  InfeasibilityEntry,
  InfeasibilityReason,
  RemediationProposal,
  RemediationType,
} from './types/infeasibility.js';
// ── Infeasibility ──
export { createEmptyFeasibilityReport, finalizeFeasibilityReport } from './types/infeasibility.js';
export type {
  CoverageAudit,
  CoverageEntry,
  DispatchRule,
  ObjectiveWeights,
  OptResult,
  ValidationReport,
  Violation,
  ViolationSeverity,
} from './types/kpis.js';
export type {
  ActionMessage,
  ActionMessagesSummary,
  CoverageCell,
  CoverageMatrixResult,
  CoverageMatrixSkuResult,
  CoverageSkuCell,
  CTPInput,
  CTPResult,
  CTPSkuInput,
  MRPDayBucket,
  MRPRecord,
  MRPResult,
  MRPSkuRecord,
  MRPSkuSummary,
  MRPSkuViewRecord,
  MRPSkuViewResult,
  MRPSummary,
  RCCPEntry,
  ROPResult,
  ROPSkuResult,
  ROPSkuSummary,
  ROPSummary,
  ServiceLevel,
  WhatIfDelta,
  WhatIfMutation,
  WhatIfResult,
} from './types/mrp.js';
export type {
  MachineLoadEntry,
  PlanningKPIs,
  PlanningMachine,
  PlanningOperation,
  PlanningTool,
  PlanState,
  ScheduleSlot,
} from './types/plan-state.js';
export type {
  CapacityLogEntry,
  DeficitEvolution,
  OperationScore,
  WorkContent,
} from './types/scoring.js';
export type { OperationDeadline, ShippingCutoffConfig } from './types/shipping.js';
export { DEFAULT_SHIPPING_CUTOFF } from './types/shipping.js';
export type {
  FailureJustification,
  OrderJustification,
  StartReason,
  TransparencyReport,
} from './types/transparency.js';
export type {
  TwinAnomalyCode,
  TwinAnomalyEntry,
  TwinGroup,
  TwinValidationReport,
} from './types/twin.js';
export type {
  LaborWindow,
  WorkforceConfig,
  WorkforceCoverageMissing,
  WorkforceForecast,
  WorkforceForecastWarning,
  WorkforceSuggestion,
} from './types/workforce.js';
export { DEFAULT_WORKFORCE_CONFIG } from './types/workforce.js';
export {
  getBlockProductionForOp,
  getBlockQtyForOp,
  getBlocksForOp,
} from './utils/block-production.js';
export { C, TC, tci } from './utils/colors.js';
// ── Utilities ──
export { mulberry32 } from './utils/prng.js';
export {
  fmtMin,
  fromAbs,
  getShift,
  getShiftEnd,
  getShiftStart,
  inferWorkdaysFromLabels,
  padMoArray,
  toAbs,
} from './utils/time.js';
