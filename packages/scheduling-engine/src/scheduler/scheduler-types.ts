// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Scheduler Input/Output Types
// ═══════════════════════════════════════════════════════════

import type { DecisionRegistry } from '../decisions/decision-registry.js';
import type { AdvanceAction, Block, MoveAction } from '../types/blocks.js';
import type { ConstraintConfig } from '../types/constraints.js';
import type { DecisionEntry } from '../types/decisions.js';
import type { EMachine, EOp, ETool } from '../types/engine.js';
import type { ResourceTimeline } from '../types/failure.js';
import type { FeasibilityReport } from '../types/infeasibility.js';
import type { DispatchRule } from '../types/kpis.js';
import type { DeficitEvolution, OperationScore, WorkContent } from '../types/scoring.js';
import type { OperationDeadline, ShippingCutoffConfig } from '../types/shipping.js';
import type { TransparencyReport } from '../types/transparency.js';
import type { TwinValidationReport } from '../types/twin.js';
import type { WorkforceConfig, WorkforceForecast } from '../types/workforce.js';

export interface ScheduleAllInput {
  ops: EOp[];
  /** Machine status map: machineId -> 'running' | 'down' */
  mSt: Record<string, string>;
  /** Tool status map: toolId -> 'running' | 'down' */
  tSt: Record<string, string>;
  /** Move actions (user moves + auto overflow moves) */
  moves: MoveAction[];
  machines: EMachine[];
  /** Tool lookup by ID */
  toolMap: Record<string, ETool>;
  /** Per-day workday flags */
  workdays: boolean[];
  /** Total days in the horizon */
  nDays: number;
  /** Workforce zone configuration for operator capacity */
  workforceConfig?: WorkforceConfig;
  /** Dispatch rule for sorting groups */
  rule?: DispatchRule;
  /** Supply boost overrides for priority scheduling */
  supplyBoosts?: Map<string, { boost: number }>;
  /** Enable 3rd shift (Z: 00:00 - 07:00) */
  thirdShift?: boolean;
  /** Constraint configuration (defaults to all HARD) */
  constraintConfig?: ConstraintConfig;
  /** Enable load leveling (default: true) */
  enableLeveling?: boolean;
  /** Enforce deadline as hard constraint (default: true).
   *  When true, overflow blocks are converted to infeasible if demand not met.
   *  Set to false during auto-route iterations to preserve overflow markers. */
  enforceDeadlines?: boolean;
  /** Per-machine failure timelines (per-day-per-shift capacity) */
  machineTimelines?: Record<string, ResourceTimeline>;
  /** Per-tool failure timelines (per-day-per-shift capacity) */
  toolTimelines?: Record<string, ResourceTimeline>;
  /** Shipping cutoff configuration. When present, activates shipping-as-law pipeline. */
  shippingCutoff?: ShippingCutoffConfig;
  /** Use deterministic scoring for operation ordering (default: true when shippingCutoff present) */
  useDeterministicScoring?: boolean;
  /** Advance production overrides — adjust EDD earlier for specific ops */
  advanceOverrides?: AdvanceAction[];
  /** Per-machine per-day overtime map: machineId -> dayIdx -> extra minutes */
  overtimeMap?: Record<string, Record<number, number>>;
  /** Twin validation report (from transform pipeline) */
  twinValidationReport?: TwinValidationReport;
  /** Date labels for the planning horizon (needed for D+1 forecast) */
  dates?: string[];
  /** Order-based demand mode: each day with demand = separate order bucket, no lot economic */
  orderBased?: boolean;
  /** ATCS parameters (k1/k2) — only used when rule = 'ATCS' */
  atcsParams?: { k1: number; k2: number };
  /** When true, skip mergeConsecutiveTools step to allow interleaving of same-tool buckets.
   *  Improves OTD-Delivery for tools shared by many ops at the cost of more setups. */
  disableToolMerge?: boolean;
}

export interface ScheduleAllResult {
  /** Final scheduled blocks (merged) */
  blocks: Block[];
  /** All decisions made during scheduling */
  decisions: DecisionEntry[];
  /** Full decision registry (for further queries) */
  registry: DecisionRegistry;
  /** Feasibility report — always present */
  feasibilityReport: FeasibilityReport;
  /** Shipping deadlines (when shippingCutoff is active) */
  deadlines?: Map<string, OperationDeadline>;
  /** Work content per operation (when shippingCutoff is active) */
  workContents?: Map<string, WorkContent>;
  /** Deficit evolution per operation (when shippingCutoff is active) */
  deficits?: Map<string, DeficitEvolution>;
  /** Operation scores (when deterministic scoring is active) */
  scores?: Map<string, OperationScore>;
  /** Transparency report (when shippingCutoff is active) */
  transparencyReport?: TransparencyReport;
  /** D+1 workforce forecast (when workforceConfig is present) */
  workforceForecast?: WorkforceForecast;
}
