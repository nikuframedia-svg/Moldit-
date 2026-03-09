// =====================================================================
//  INCOMPOL PLAN -- Scheduling Configuration Schema (Zod)
//
//  Central config for all scheduling parameters:
//  weights, dispatch rule, freeze horizon, constraints, etc.
//  Zod schema provides runtime validation + TypeScript inference.
//
//  Pure module -- no side effects.
// =====================================================================

import { z } from 'zod';

// ── Schema ──────────────────────────────────────────────

const WeightsSchema = z
  .object({
    /** On-time delivery weight (0-1) */
    otd: z.number().min(0).max(1).default(0.7),
    /** Setup minimization weight (0-1) */
    setup: z.number().min(0).max(1).default(0.2),
    /** Machine utilization weight (0-1) */
    utilization: z.number().min(0).max(1).default(0.1),
  })
  .refine((w) => Math.abs(w.otd + w.setup + w.utilization - 1) < 0.001, {
    message: 'Weights must sum to 1.0',
  });

const ConstraintModeSchema = z.enum(['hard', 'disabled']);

const ConstraintsSchema = z.object({
  setupCrew: z.object({ mode: ConstraintModeSchema }).default({ mode: 'hard' }),
  toolTimeline: z.object({ mode: ConstraintModeSchema }).default({ mode: 'hard' }),
  calcoTimeline: z.object({ mode: ConstraintModeSchema }).default({ mode: 'hard' }),
  operatorPool: z.object({ mode: ConstraintModeSchema }).default({ mode: 'hard' }),
});

const DispatchRuleSchema = z.enum(['EDD', 'CR', 'WSPT', 'SPT', 'ATCS']);

const DirectionSchema = z.enum(['forward', 'backward']);

// ── L2: SE/ENTÃO Rules ────────────────────────────────────

const RuleConditionSchema = z.object({
  field: z.string(),
  operator: z.enum(['>', '<', '>=', '<=', '==', '!=']),
  value: z.number(),
  action: z.string(),
});

const L2RulesSchema = z.object({
  rules: z.array(RuleConditionSchema).default([]),
});

// ── L3: Custom Formulas ───────────────────────────────────

const FormulaSchema = z.object({
  name: z.string(),
  expression: z.string(),
  variables: z.array(z.string()).default([]),
});

const L3FormulasSchema = z.object({
  formulas: z.array(FormulaSchema).default([]),
});

// ── L4: Concept Definitions ───────────────────────────────

const ConceptDefinitionSchema = z.object({
  name: z.string(),
  formula: z.string(),
  threshold: z.number().optional(),
});

const L4DefinitionsSchema = z.object({
  definitions: z.array(ConceptDefinitionSchema).default([]),
});

// ── L5: Governance ────────────────────────────────────────

const GovernanceLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);

const ApprovalRuleSchema = z.object({
  action: z.string(),
  requiredLevel: GovernanceLevelSchema,
  approvers: z.array(z.string()).default([]),
});

const L5GovernanceSchema = z.object({
  defaultLevel: GovernanceLevelSchema.default('L1'),
  approvalRules: z.array(ApprovalRuleSchema).default([]),
});

// ── L6: Multi-Step Strategy ───────────────────────────────

const StrategyStepSchema = z.object({
  dispatchRule: DispatchRuleSchema,
  condition: z.string().optional(),
  maxIterations: z.number().int().positive().default(1),
});

const L6StrategySchema = z.object({
  steps: z.array(StrategyStepSchema).default([]),
  fallbackRule: DispatchRuleSchema.default('ATCS'),
});

// ── Main Schema ───────────────────────────────────────────

export const SchedulingConfigSchema = z.object({
  /** Config schema version (for migration) */
  version: z.number().int().positive().default(2),
  /** Objective weights (must sum to 1.0) */
  weights: WeightsSchema.default({ otd: 0.7, setup: 0.2, utilization: 0.1 }),
  /** Dispatch rule for scheduling */
  dispatchRule: DispatchRuleSchema.default('ATCS'),
  /** Scheduling direction */
  direction: DirectionSchema.default('forward'),
  /** Frozen horizon in working days (blocks within this are immutable) */
  frozenHorizonDays: z.number().int().min(0).max(30).default(5),
  /** Lot economic mode: strict enforces lot rounding, relaxed allows exact qty */
  lotEconomicoMode: z.enum(['strict', 'relaxed']).default('relaxed'),
  /** Whether emergency night shift (Z) is allowed */
  emergencyNightShift: z.boolean().default(false),
  /** Constraint configuration */
  constraints: ConstraintsSchema.default({
    setupCrew: { mode: 'hard' },
    toolTimeline: { mode: 'hard' },
    calcoTimeline: { mode: 'hard' },
    operatorPool: { mode: 'hard' },
  }),
  /** ATCS k1/k2 params (optional, uses grid search if omitted) */
  atcsParams: z
    .object({
      k1: z.number().min(0.1).max(5),
      k2: z.number().min(0.01).max(2),
    })
    .optional(),
  /** SA iterations (0 = skip SA) */
  saIterations: z.number().int().min(0).max(100_000).default(10_000),
  /** L2: SE/ENTÃO rules (react-querybuilder → json-rules-engine) */
  l2Rules: L2RulesSchema.optional(),
  /** L3: Custom formulas (expr-eval — safe parser, no eval) */
  l3Formulas: L3FormulasSchema.optional(),
  /** L4: Concept definitions ("atrasado" = custom formula per factory) */
  l4Definitions: L4DefinitionsSchema.optional(),
  /** L5: Governance & approvals (who approves what, L0-L5) */
  l5Governance: L5GovernanceSchema.optional(),
  /** L6: Multi-step strategy (sequence of dispatch rules like Asprova) */
  l6Strategy: L6StrategySchema.optional(),
});

/** Inferred TypeScript type from the Zod schema */
export type SchedulingConfig = z.infer<typeof SchedulingConfigSchema>;

// ── Defaults ────────────────────────────────────────────

export const DEFAULT_SCHEDULING_CONFIG: SchedulingConfig = SchedulingConfigSchema.parse({});

// ── Policy Presets ──────────────────────────────────────

/** Max OTD: prioritize on-time delivery above all else */
export const POLICY_MAX_OTD: Partial<SchedulingConfig> = {
  weights: { otd: 0.9, setup: 0.05, utilization: 0.05 },
  dispatchRule: 'EDD',
  emergencyNightShift: true,
};

/** Min Setups: minimize setup time and changeovers */
export const POLICY_MIN_SETUPS: Partial<SchedulingConfig> = {
  weights: { otd: 0.3, setup: 0.6, utilization: 0.1 },
  dispatchRule: 'ATCS',
  lotEconomicoMode: 'strict',
};

/** Balanced: even trade-off between OTD, setup, and utilization */
export const POLICY_BALANCED: Partial<SchedulingConfig> = {
  weights: { otd: 0.5, setup: 0.3, utilization: 0.2 },
  dispatchRule: 'ATCS',
};

/** Urgent: emergency mode, maximize throughput with night shift */
export const POLICY_URGENT: Partial<SchedulingConfig> = {
  weights: { otd: 0.8, setup: 0.1, utilization: 0.1 },
  dispatchRule: 'ATCS',
  emergencyNightShift: true,
  frozenHorizonDays: 2,
  saIterations: 2000,
};

/** Incompol Standard: factory default for Incompol (5 prensas, 59 ferramentas) */
export const POLICY_INCOMPOL_STANDARD: Partial<SchedulingConfig> = {
  weights: { otd: 0.7, setup: 0.2, utilization: 0.1 },
  dispatchRule: 'ATCS',
  direction: 'forward',
  frozenHorizonDays: 5,
  lotEconomicoMode: 'relaxed',
  emergencyNightShift: false,
  constraints: {
    setupCrew: { mode: 'hard' },
    toolTimeline: { mode: 'hard' },
    calcoTimeline: { mode: 'hard' },
    operatorPool: { mode: 'hard' },
  },
  saIterations: 10_000,
  l5Governance: {
    defaultLevel: 'L1',
    approvalRules: [
      { action: 'edit_plan_frozen', requiredLevel: 'L4', approvers: [] },
      { action: 'edit_plan_slushy', requiredLevel: 'L3', approvers: [] },
      { action: 'enable_night_shift', requiredLevel: 'L4', approvers: [] },
      { action: 'override_priority', requiredLevel: 'L3', approvers: [] },
    ],
  },
};

// ── Validation ──────────────────────────────────────────

/**
 * Validate and parse an unknown config object into a SchedulingConfig.
 * Missing fields are filled with defaults.
 * Throws ZodError if validation fails.
 */
export function validateConfig(raw: unknown): SchedulingConfig {
  return SchedulingConfigSchema.parse(raw);
}

// ── Migration ───────────────────────────────────────────

/**
 * Migrate a config from an older version to the current schema.
 * Currently only v1 exists; future versions add migration steps.
 */
export function migrateConfig(old: unknown, fromVersion: number): SchedulingConfig {
  if (fromVersion < 1 || typeof old !== 'object' || old === null) {
    // Invalid or pre-v1: return defaults
    return DEFAULT_SCHEDULING_CONFIG;
  }

  // v1 → v2: add version bump, L2-L6 are optional (no-op migration)
  if (fromVersion === 1) {
    const patched = { ...(old as Record<string, unknown>), version: 2 };
    return SchedulingConfigSchema.parse(patched);
  }

  // v2 → current: validate as-is
  if (fromVersion === 2) {
    return SchedulingConfigSchema.parse(old);
  }

  // Unknown future version: strip unknown fields, parse what we can
  return SchedulingConfigSchema.parse(old);
}
