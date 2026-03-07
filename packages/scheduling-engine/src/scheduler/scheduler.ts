// =====================================================================
//  INCOMPOL PLAN -- Scheduler (Main Entry Point)
//
//  Pipeline:
//    computeEarliestStarts  (backward scheduling)
//      -> groupDemandIntoBuckets  (Phase 1: demand grouping)
//        -> sortAndMergeGroups  (dispatch rules + tool merging)
//          -> scheduleMachines  (Phase 2: slot allocation)
//            -> levelLoad  (post-scheduling load balancing)
//              -> mergeConsecutiveBlocks  (block cleanup)
//
//  Creates a DecisionRegistry and passes it through the entire pipeline.
//  Returns blocks + decisions + feasibility report.
//
//  Per Normative Spec: ALL constraints are HARD.
//  FeasibilityReport is ALWAYS generated — it documents what could
//  and could not be scheduled and why.
//
//  Pure function -- no React, no side effects.
// =====================================================================

import { computeWorkforceDemand } from '../analysis/op-demand.js';
import { buildTransparencyReport } from '../analysis/transparency-report.js';
import { computeWorkforceForecast } from '../analysis/workforce-forecast.js';
import { DecisionRegistry } from '../decisions/decision-registry.js';
import type { AdvanceAction, Block, MoveAction } from '../types/blocks.js';
import type { ConstraintConfig } from '../types/constraints.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../types/constraints.js';
import type { DecisionEntry } from '../types/decisions.js';
import type { EMachine, EngineData, EOp, ETool } from '../types/engine.js';
import type { ResourceTimeline } from '../types/failure.js';
import type { FeasibilityReport, RemediationProposal } from '../types/infeasibility.js';
import { finalizeFeasibilityReport } from '../types/infeasibility.js';
import type { DispatchRule } from '../types/kpis.js';
import type { DeficitEvolution, OperationScore, WorkContent } from '../types/scoring.js';
import type { OperationDeadline, ShippingCutoffConfig } from '../types/shipping.js';
import type { TransparencyReport } from '../types/transparency.js';
import type { TwinValidationReport } from '../types/twin.js';
import type { WorkforceForecast } from '../types/workforce.js';
import { getBlockProductionForOp } from '../utils/block-production.js';
import { computeATCSAverages, DEFAULT_ATCS_PARAMS } from './atcs-dispatch.js';
import { computeEarliestStarts } from './backward-scheduler.js';
import { mergeConsecutiveBlocks } from './block-merger.js';
import { groupDemandIntoBuckets } from './demand-grouper.js';
import {
  createGroupComparator,
  orderMachinesByUrgency,
  sortAndMergeGroups,
} from './dispatch-rules.js';
import { levelLoad } from './load-leveler.js';
import { scoreOperations, sortGroupsByScore } from './production-scorer.js';
import { computeShippingDeadlines } from './shipping-cutoff.js';
import type { WorkforceConfig } from './slot-allocator.js';
import { scheduleMachines } from './slot-allocator.js';
import { computeDeficitEvolution, computeWorkContent } from './work-content.js';

// ── Input / Output types ────────────────────────────────────────────

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

// ── Main export ─────────────────────────────────────────────────

/**
 * Run the full scheduling pipeline.
 *
 * 1. **computeEarliestStarts** -- Backward scheduling from Prz.Fabrico
 * 2. **groupDemandIntoBuckets** -- Phase 1: group operations into tool-groups
 * 3. **sortAndMergeGroups** -- Apply dispatch rule, merge tools, merge MP
 * 4. **orderMachinesByUrgency** -- Determine machine scheduling order
 * 5. **scheduleMachines** -- Phase 2: shift-by-shift allocation (ALL HARD)
 * 6. **levelLoad** -- Post-scheduling load balancing (optional)
 * 7. **mergeConsecutiveBlocks** -- Cleanup: merge adjacent fragments
 * 8. **buildFeasibilityReport** -- Document what was/wasn't scheduled
 *
 * @param input - Complete scheduling input
 * @returns { blocks, decisions, registry, feasibilityReport }
 */
export function scheduleAll(input: ScheduleAllInput): ScheduleAllResult {
  const {
    ops,
    mSt,
    tSt,
    moves,
    machines,
    toolMap,
    workdays,
    nDays,
    workforceConfig,
    rule = 'EDD',
    supplyBoosts,
    thirdShift,
    constraintConfig = DEFAULT_CONSTRAINT_CONFIG,
    enableLeveling = true,
    enforceDeadlines = true,
    machineTimelines,
    toolTimelines,
    shippingCutoff,
    useDeterministicScoring,
    advanceOverrides,
    overtimeMap,
  } = input;

  const registry = new DecisionRegistry();

  // ── Record twin validation anomalies into registry ──
  if (input.twinValidationReport) {
    for (const a of input.twinValidationReport.anomalies) {
      registry.record({
        type: 'TWIN_VALIDATION_ANOMALY',
        opId: a.opId,
        toolId: a.tool,
        machineId: a.machine,
        detail: a.detail,
        metadata: {
          code: a.code,
          sku: a.sku,
          twinSku: a.twinSku,
          counterpartMachine: a.counterpartMachine,
          counterpartTool: a.counterpartTool,
        },
      });
    }
  }

  const useNewPipeline = !!shippingCutoff;
  const useScoring = useDeterministicScoring ?? useNewPipeline;

  // Guard: no ops or no machines -> empty result
  if (ops.length === 0 || machines.length === 0) {
    return {
      blocks: [],
      decisions: [],
      registry,
      feasibilityReport: finalizeFeasibilityReport({
        totalOps: 0,
        feasibleOps: 0,
        infeasibleOps: 0,
        entries: [],
        byReason: {},
        feasibilityScore: 1.0,
        remediations: [],
        deadlineFeasible: true,
      }),
    };
  }

  // ── NEW Step 1: Shipping deadlines (when active) ──
  let deadlines: Map<string, OperationDeadline> | undefined;
  let workContents: Map<string, WorkContent> | undefined;
  let deficits: Map<string, DeficitEvolution> | undefined;
  let scores: Map<string, OperationScore> | undefined;

  if (useNewPipeline) {
    deadlines = computeShippingDeadlines(ops, workdays, nDays, shippingCutoff, registry);
    workContents = computeWorkContent(ops, toolMap, registry);
    deficits = computeDeficitEvolution(ops, toolMap, nDays);
  }

  // ── Step 1b: Backward scheduling (Prz.Fabrico — informational when new pipeline) ──
  const earliestStarts = computeEarliestStarts(ops, workdays, nDays, registry);

  // ── NEW Step 2b: Score operations (when active) ──
  if (useScoring && workContents && deficits && deadlines) {
    scores = scoreOperations(workContents, deficits, deadlines, 0, nDays, registry, workdays);
  }

  // ── Step 2: Group demand into tool-group buckets ──
  const twinGroups = input.twinValidationReport?.twinGroups;
  const mGroups = groupDemandIntoBuckets(
    ops,
    mSt,
    tSt,
    moves,
    toolMap,
    workdays,
    nDays,
    earliestStarts,
    machineTimelines,
    toolTimelines,
    thirdShift,
    undefined, // oee (use default)
    advanceOverrides, // advance production overrides
    twinGroups, // twin co-production groups
    input.orderBased, // order-based bucketing (raw_np mode)
  );

  // ── Step 3: Sort + merge groups per machine ──
  if (useScoring && scores) {
    // Deterministic scoring: sort groups by composite score
    for (const mId of Object.keys(mGroups)) {
      mGroups[mId] = sortGroupsByScore(mGroups[mId], scores) as (typeof mGroups)[string];
    }
  } else {
    // Legacy: dispatch rules (EDD/CR/WSPT/SPT/ATCS)
    for (const mId of Object.keys(mGroups)) {
      mGroups[mId] = sortAndMergeGroups(mGroups[mId], rule, supplyBoosts, input.atcsParams);
    }
  }

  // ── Step 4: Order machines by urgency ──
  // For ATCS, compute global averages across all machines for consistent machine ordering
  let atcsCtxGlobal:
    | { avgProdMin: number; avgSetupMin: number; params: { k1: number; k2: number } }
    | undefined;
  if (rule === 'ATCS') {
    const allGroups = Object.values(mGroups).flat();
    atcsCtxGlobal = {
      ...computeATCSAverages(allGroups),
      params: input.atcsParams ?? DEFAULT_ATCS_PARAMS,
    };
  }
  const comparator = createGroupComparator(rule, supplyBoosts, atcsCtxGlobal);
  const machOrder = orderMachinesByUrgency(machines, mGroups, comparator) as EMachine[];

  // ── Step 5: Schedule machines (slot allocation — ALL HARD) ──
  const { blocks: rawBlocks, infeasibilities } = scheduleMachines({
    mGroups,
    machOrder,
    mSt,
    workdays,
    workforceConfig,
    nDays,
    thirdShift,
    registry,
    constraintConfig,
    machineTimelines,
    toolTimelines,
    deadlines,
    overtimeMap,
  });

  // ── Step 6: Load leveling (optional) ──
  let leveledBlocks: Block[];
  if (enableLeveling && earliestStarts.size > 0) {
    leveledBlocks = levelLoad(rawBlocks, machines, workdays, earliestStarts, registry, deadlines);
  } else {
    leveledBlocks = rawBlocks;
  }

  // ── Step 7: Merge consecutive blocks ──
  const blocks = mergeConsecutiveBlocks(leveledBlocks);

  // ── Step 7.5: Enforce deadlines ──
  // When shipping cutoff is active: use SHIPPING_CUTOFF_VIOLATION for overflows
  // When legacy: use DEADLINE_VIOLATION
  const remediations: RemediationProposal[] = [];
  const deadlineReason = useNewPipeline
    ? ('SHIPPING_CUTOFF_VIOLATION' as const)
    : ('DEADLINE_VIOLATION' as const);
  if (enforceDeadlines) {
    for (const op of ops) {
      const totalDemand = op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0);
      if (totalDemand <= 0) continue;
      // Twin-aware production attribution
      const produced = getBlockProductionForOp(blocks, op.id);

      if (produced < totalDemand) {
        const tool = toolMap[op.t];
        const deficit = totalDemand - produced;
        const deficitMin = tool && tool.pH > 0 ? (deficit / tool.pH) * 60 : 0;

        // Convert overflow blocks for this op to infeasible — with precise reason
        for (const b of blocks) {
          if (b.opId === op.id && b.type === 'overflow') {
            b.type = 'infeasible';

            // Determine precise infeasibility reason based on root cause
            if (mSt[b.machineId] === 'down') {
              b.infeasibilityReason = 'MACHINE_DOWN';
              b.infeasibilityDetail = `Máquina ${b.machineId} parada. Procura ${totalDemand}, produzido ${produced}, deficit ${deficit}`;
            } else if (b.effectiveCapacityFactor != null && b.effectiveCapacityFactor < 1.0) {
              b.infeasibilityReason = 'MACHINE_PARTIAL_DOWN';
              b.infeasibilityDetail = `Máquina ${b.machineId} com capacidade reduzida (${Math.round(b.effectiveCapacityFactor * 100)}%). Deficit ${deficit}`;
            } else if (tSt[b.toolId] === 'down') {
              b.infeasibilityReason = 'TOOL_DOWN_TEMPORAL';
              b.infeasibilityDetail = `Ferramenta ${b.toolId} parada. Deficit ${deficit}`;
            } else {
              b.infeasibilityReason = 'CAPACITY_OVERFLOW';
              b.infeasibilityDetail = `Capacidade esgotada em ${b.machineId}. Procura ${totalDemand}, produzido ${produced}, deficit ${deficit}`;
            }
          }
        }

        // Remediation proposals
        if (!thirdShift) {
          remediations.push({
            type: 'THIRD_SHIFT',
            opId: op.id,
            toolId: op.t,
            machineId: op.m,
            capacityGainMin: 420,
            automated: false,
            description: `Activar 3.º turno em ${op.m} — +420 min/dia`,
          });
        }
        if (tool?.alt && tool.alt !== '-') {
          remediations.push({
            type: 'TRANSFER_ALT_MACHINE',
            opId: op.id,
            toolId: op.t,
            machineId: tool.alt,
            capacityGainMin: deficitMin,
            automated: true,
            description: `Mover ${op.t} para ${tool.alt}`,
          });
        }
        remediations.push({
          type: 'ADVANCE_PRODUCTION',
          opId: op.id,
          toolId: op.t,
          machineId: op.m,
          capacityGainMin: deficitMin,
          automated: true,
          description: `Antecipar produção de ${op.t}/${op.sku} — ${deficit} pcs`,
        });
        remediations.push({
          type: 'OVERTIME',
          opId: op.id,
          toolId: op.t,
          machineId: op.m,
          capacityGainMin: Math.min(deficitMin, 120),
          automated: false,
          description: `Overtime em ${op.m} — até +120 min`,
        });
        remediations.push({
          type: 'FORMAL_RISK_ACCEPTANCE',
          opId: op.id,
          toolId: op.t,
          machineId: op.m,
          capacityGainMin: 0,
          automated: false,
          description: `Aceitar atraso de ${deficit} pcs em ${op.sku} — requer aprovação formal`,
        });

        // Determine dominant reason for the infeasibility entry
        const opInfBlocks = blocks.filter((b) => b.opId === op.id && b.type === 'infeasible');
        const dominantReason =
          opInfBlocks.length > 0 && opInfBlocks[0].infeasibilityReason
            ? opInfBlocks[0].infeasibilityReason
            : deadlineReason;

        infeasibilities.push({
          opId: op.id,
          toolId: op.t,
          machineId: op.m,
          reason: dominantReason,
          detail: `Demand ${totalDemand}, produced ${produced}, deficit ${deficit}`,
          attemptedAlternatives: ['Slot allocation', 'Load leveling'],
          suggestion: remediations
            .filter((r) => r.opId === op.id)
            .map((r) => r.description)
            .join('; '),
        });
      }
    }
  }

  // ── Step 8: Build feasibility report ──
  const scheduledOps = new Set<string>();
  const infeasibleOps = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'ok' && b.qty > 0) scheduledOps.add(b.opId);
    if (b.type === 'infeasible') infeasibleOps.add(b.opId);
  }

  const allOpIds = new Set(ops.map((o) => o.id));
  const totalOps = allOpIds.size;

  const feasibilityReport = finalizeFeasibilityReport({
    totalOps,
    feasibleOps: scheduledOps.size,
    infeasibleOps: infeasibleOps.size,
    entries: infeasibilities,
    byReason: {},
    feasibilityScore: 0,
    remediations,
    deadlineFeasible: remediations.length === 0,
  });

  // ── Step 9: D+1 workforce forecast (when workforce config available) ──
  let workforceForecast: WorkforceForecast | undefined;
  if (workforceConfig) {
    workforceForecast = computeWorkforceForecast({
      blocks,
      workforceConfig,
      workdays,
      dates: input.dates ?? [],
      toolMap,
      overtimeMap,
      thirdShift,
    });
    for (const w of workforceForecast.warnings) {
      registry.record({
        type: 'WORKFORCE_FORECAST_D1',
        dayIdx: w.dayIdx,
        shift: w.shift,
        detail: `D+1 workforce overload: ${w.laborGroup} turno ${w.shift} — ${w.projectedPeak} operadores (capacidade: ${w.capacity}, excesso: ${w.excess})`,
        metadata: {
          laborGroup: w.laborGroup,
          projectedPeak: w.projectedPeak,
          capacity: w.capacity,
          excess: w.excess,
          machines: w.machines,
        },
      });
    }
    for (const c of workforceForecast.coverageMissing) {
      registry.record({
        type: 'WORKFORCE_COVERAGE_MISSING',
        machineId: c.machineId,
        dayIdx: c.dayIdx,
        shift: c.shift,
        detail: c.detail,
        metadata: { type: c.type, machineId: c.machineId },
      });
    }
  }

  // ── Step 10: Build transparency report (when new pipeline active) ──
  let transparencyReport: TransparencyReport | undefined;
  if (useNewPipeline && deadlines && workContents && deficits) {
    // Compute workforce warnings for the report
    const wfWarnings = workforceConfig
      ? computeWorkforceDemand(blocks, workforceConfig).warnings
      : undefined;

    transparencyReport = buildTransparencyReport(
      blocks,
      ops,
      toolMap,
      deadlines,
      workContents,
      deficits,
      infeasibilities,
      registry.getAll(),
      input.twinValidationReport,
      wfWarnings,
      workforceForecast,
    );
  }

  return {
    blocks,
    decisions: registry.getAll(),
    registry,
    feasibilityReport,
    workforceForecast,
    ...(useNewPipeline ? { deadlines, workContents, deficits, scores, transparencyReport } : {}),
  };
}

// ── Convenience: schedule from EngineData ───────────────────────────

/**
 * Convenience wrapper that accepts EngineData directly.
 *
 * @param engine  - Transformed engine data
 * @param mSt     - Machine status map
 * @param tSt     - Tool status map
 * @param moves   - Move actions
 * @param options - Optional scheduling parameters
 * @returns ScheduleAllResult
 */
export function scheduleFromEngineData(
  engine: EngineData,
  mSt: Record<string, string>,
  tSt: Record<string, string>,
  moves: MoveAction[],
  options?: {
    workforceConfig?: WorkforceConfig;
    rule?: DispatchRule;
    supplyBoosts?: Map<string, { boost: number }>;
    constraintConfig?: ConstraintConfig;
    enableLeveling?: boolean;
    shippingCutoff?: ShippingCutoffConfig;
    useDeterministicScoring?: boolean;
  },
): ScheduleAllResult {
  return scheduleAll({
    ops: engine.ops,
    mSt,
    tSt,
    moves,
    machines: engine.machines,
    toolMap: engine.toolMap,
    workdays: engine.workdays,
    nDays: engine.nDays,
    workforceConfig: options?.workforceConfig ?? engine.workforceConfig,
    rule: options?.rule,
    supplyBoosts: options?.supplyBoosts,
    thirdShift: engine.thirdShift,
    constraintConfig: options?.constraintConfig,
    enableLeveling: options?.enableLeveling,
    machineTimelines: engine.machineTimelines,
    toolTimelines: engine.toolTimelines,
    shippingCutoff: options?.shippingCutoff,
    useDeterministicScoring: options?.useDeterministicScoring,
    twinValidationReport: engine.twinValidationReport,
    dates: engine.dates,
    orderBased: engine.orderBased,
  });
}
