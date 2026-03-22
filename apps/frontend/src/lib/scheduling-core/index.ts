// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Scheduling Core (Slim)
//  Types + Pure utilities only. Zero scheduling logic.
//  All scheduling done by backend CP-SAT solver.
// ═══════════════════════════════════════════════════════════

// ── Types (re-exported from canonical location: domain/types/scheduling) ──
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
} from '../../domain/types/scheduling/blocks.js';
// ── Compat types (from deleted modules — pure type stubs) ──
export type {
  ATCSParams,
  AutoReplanAction,
  AutoReplanConfig,
  AutoReplanResult,
  CoverageAuditResult,
  CoverageAuditRow,
  DecisionKind,
  DecisionSeverity,
  FullReplanInput,
  FullReplanResult,
  GridResult,
  LateDeliveryAnalysis,
  LateDeliveryEntry,
  MatchUpInput,
  MatchUpResult,
  MoveableOp,
  OptimizationInput,
  OptimizationSetup,
  PartialReplanInput,
  PartialReplanResult,
  QuickValidateResult,
  ReplanActionDetail,
  ReplanEventType,
  ReplanProposal,
  ReplanSimulation,
  RightShiftInput,
  RightShiftResult,
  RiskCell,
  RiskGridData,
  RiskLevel,
  RiskRow,
  RiskValidationInput,
  SAConfig,
  SAInput,
  SAResult,
  ScheduleAllInput,
  ScheduleAllResult,
  ScheduleValidationReport,
  ScheduleViolation,
  SchedulingConfig,
  SchedulingContext,
  SchedulingStrategy,
  ScoringJob,
  TransformConfig,
  TwinValidationInput,
  UserReplanChoice,
  WorkforceDemandResult,
  WorkforceForecastInput,
} from '../../domain/types/scheduling/compat.js';
// ── Constants (re-export from domain/types/scheduling) ──
export {
  DAY_CAP,
  DEFAULT_OEE,
  S0,
  S1,
  S2,
  T1,
} from '../../domain/types/scheduling/constants.js';
export type {
  ConstraintConfig,
  ConstraintMode,
  ConstraintName,
} from '../../domain/types/scheduling/constraints.js';
export { DEFAULT_CONSTRAINT_CONFIG } from '../../domain/types/scheduling/constraints.js';
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
} from '../../domain/types/scheduling/core.js';
export type {
  AlternativeAction,
  DecisionEntry,
  DecisionSummary,
  DecisionType,
} from '../../domain/types/scheduling/decisions.js';
export type {
  EMachine,
  EngineData,
  EOp,
  ETool,
} from '../../domain/types/scheduling/engine.js';
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
} from '../../domain/types/scheduling/failure.js';
export type {
  FeasibilityReport,
  InfeasibilityEntry,
  InfeasibilityReason,
  RemediationProposal,
  RemediationType,
} from '../../domain/types/scheduling/infeasibility.js';
export {
  createEmptyFeasibilityReport,
  finalizeFeasibilityReport,
} from '../../domain/types/scheduling/infeasibility.js';
export type {
  CoverageAudit,
  CoverageEntry,
  DispatchRule,
  ObjectiveWeights,
  OptResult,
  ValidationReport,
  Violation,
  ViolationSeverity,
} from '../../domain/types/scheduling/kpis.js';
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
} from '../../domain/types/scheduling/mrp.js';
export type {
  MachineLoadEntry,
  PlanningKPIs,
  PlanningMachine,
  PlanningOperation,
  PlanningTool,
  PlanState,
  ScheduleSlot,
} from '../../domain/types/scheduling/plan-state.js';
export type {
  CapacityLogEntry,
  DeficitEvolution,
  OperationScore,
  WorkContent,
} from '../../domain/types/scheduling/scoring.js';
export type {
  OperationDeadline,
  ShippingCutoffConfig,
} from '../../domain/types/scheduling/shipping.js';
export { DEFAULT_SHIPPING_CUTOFF } from '../../domain/types/scheduling/shipping.js';
export type {
  FailureJustification,
  OrderJustification,
  StartReason,
  TransparencyReport,
} from '../../domain/types/scheduling/transparency.js';
export type {
  TwinAnomalyCode,
  TwinAnomalyEntry,
  TwinGroup,
  TwinValidationReport,
} from '../../domain/types/scheduling/twin.js';
export type {
  LaborWindow,
  WorkforceConfig,
  WorkforceCoverageMissing,
  WorkforceForecast,
  WorkforceForecastWarning,
  WorkforceSuggestion,
} from '../../domain/types/scheduling/workforce.js';
export { DEFAULT_WORKFORCE_CONFIG } from '../../domain/types/scheduling/workforce.js';
// ── Analysis (score weights only) ──
export type { ScoreWeights } from './analysis/score-schedule.js';
export { DEFAULT_WEIGHTS as DEFAULT_SCORE_WEIGHTS } from './analysis/score-schedule.js';
// ── Failures (resource timeline builder — pure data transform) ──
export {
  buildResourceTimelines,
  deriveLegacyStatus,
  getCapacityFactor,
  isFullyDown,
  legacyStatusToFailureEvents,
} from './failures/failure-timeline.js';
// ── MRP (pure computation — no scheduling) ──
export { computeActionMessages } from './mrp/mrp-actions.js';
export { computeCoverageMatrixSku } from './mrp/mrp-coverage-sku.js';
export { computeCTP } from './mrp/mrp-ctp.js';
export { computeCTPSku } from './mrp/mrp-ctp-sku.js';
export { computeMRP } from './mrp/mrp-engine.js';
export type { ROPConfig } from './mrp/mrp-rop.js';
export { computeCoverageMatrix, computeROP, DEFAULT_ROP_CONFIG } from './mrp/mrp-rop.js';
export { computeROPSku } from './mrp/mrp-rop-sku.js';
export { computeMRPSkuView } from './mrp/mrp-sku-view.js';
export { computeWhatIf } from './mrp/mrp-what-if.js';
export type { SupplyPriority, SupplyPriorityConfig } from './mrp/supply-priority.js';
export { computeSupplyPriority, DEFAULT_SUPPLY_PRIORITY_CONFIG } from './mrp/supply-priority.js';
// ── Replan (layer chooser — pure function) ──
export type {
  ReplanDispatchInput,
  ReplanDispatchResult,
  ReplanLayer,
} from './replan/replan-dispatcher.js';
export {
  chooseLayer,
  LAYER_THRESHOLD_1,
  LAYER_THRESHOLD_2,
} from './replan/replan-dispatcher.js';

// ── Utilities (pure functions) ──
export {
  getBlockProductionForOp,
  getBlockQtyForOp,
  getBlocksForOp,
} from './utils/block-production.js';
export { C, TC, tci } from './utils/colors.js';
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
