// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Scheduler (Main Entry Point)
//  Pipeline: backward → group → sort → allocate → level → merge
//  Pure function — no React, no side effects.
// ═══════════════════════════════════════════════════════════

import { computeWorkforceDemand } from '../analysis/op-demand.js';
import { buildTransparencyReport } from '../analysis/transparency-report.js';
import { computeWorkforceForecast } from '../analysis/workforce-forecast.js';
import { DecisionRegistry } from '../decisions/decision-registry.js';
import type { Block, MoveAction } from '../types/blocks.js';
import type { ConstraintConfig } from '../types/constraints.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../types/constraints.js';
import type { EMachine, EngineData } from '../types/engine.js';
import { finalizeFeasibilityReport } from '../types/infeasibility.js';
import type { DispatchRule } from '../types/kpis.js';
import type { DeficitEvolution, OperationScore, WorkContent } from '../types/scoring.js';
import type { OperationDeadline, ShippingCutoffConfig } from '../types/shipping.js';
import type { TransparencyReport } from '../types/transparency.js';
import type { WorkforceConfig, WorkforceForecast } from '../types/workforce.js';
import { computeATCSAverages, DEFAULT_ATCS_PARAMS } from './atcs-dispatch.js';
import { computeEarliestStarts } from './backward-scheduler.js';
import { mergeConsecutiveBlocks } from './block-merger.js';
import { groupDemandIntoBuckets } from './demand-grouper.js';
import {
  createGroupComparator,
  orderMachinesByUrgency,
  sortAndMergeGroups,
} from './dispatch-rules.js';
import { enforceDeadlines } from './enforce-deadlines.js';
import { levelLoad } from './load-leveler.js';
import { scoreOperations, sortGroupsByScore } from './production-scorer.js';
import { repairScheduleViolations } from './repair-violations.js';
import type { ScheduleAllInput, ScheduleAllResult } from './scheduler-types.js';
import { computeShippingDeadlines } from './shipping-cutoff.js';
import { scheduleMachines } from './slot-allocator.js';
import { computeDeficitEvolution, computeWorkContent } from './work-content.js';

export type { ScheduleAllInput, ScheduleAllResult } from './scheduler-types.js';

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
    enforceDeadlines: enforceDeadlinesEnabled = true,
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
      mGroups[mId] = sortAndMergeGroups(mGroups[mId], rule, supplyBoosts, input.atcsParams, input.disableToolMerge);
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
  const mergedBlocks = mergeConsecutiveBlocks(leveledBlocks);

  // ── Step 7.1: Repair violations (setup overlaps + overcapacity) ──
  const { blocks, setupRepairs, capacityRepairs } = repairScheduleViolations(
    mergedBlocks,
    thirdShift,
    overtimeMap,
  );
  if (setupRepairs > 0 || capacityRepairs > 0) {
    registry.record({
      type: 'SCHEDULE_REPAIR',
      detail: `Post-scheduling repair: ${setupRepairs} setup overlaps, ${capacityRepairs} overcapacity days`,
      metadata: { setupRepairs, capacityRepairs },
    });
  }

  // ── Step 7.5: Enforce deadlines ──
  const { infeasibilities: deadlineInf, remediations } = enforceDeadlinesEnabled
    ? enforceDeadlines({ ops, blocks, toolMap, mSt, tSt, thirdShift, useNewPipeline })
    : { infeasibilities: [], remediations: [] };
  infeasibilities.push(...deadlineInf);

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
