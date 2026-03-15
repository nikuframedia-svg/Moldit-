/**
 * schedule-pipeline.ts — Pure scheduling pipeline logic.
 *
 * Extracted from useScheduleData to keep the hook thin.
 * Runs: PlanState → EngineData → MRP → Schedule → CacheEntry.
 */

import type { TransformConfigFromSettings } from '../stores/settings-config';
import { useSettingsStore } from '../stores/useSettingsStore';
import type {
  AdvanceAction,
  AutoReplanResult,
  Block,
  DecisionEntry,
  DispatchRule,
  EngineData,
  FeasibilityReport,
  MoveAction,
  MRPResult,
  PlanState,
  TransformConfig,
  TransparencyReport,
} from './engine';
import {
  autoReplan,
  autoRouteOverflow,
  computeMRP,
  computeSupplyPriority,
  DEFAULT_AUTO_REPLAN_CONFIG,
  DISPATCH_BANDIT,
  transformPlanState,
} from './engine';
import { callServerSolver } from '../features/scheduling/api/solverApi';
import { engineDataToSolverRequest, solverResultToBlocks } from '../features/scheduling/api/solver-bridge';

export interface CacheEntry {
  engine: EngineData;
  blocks: Block[];
  autoMoves: MoveAction[];
  autoAdvances: AdvanceAction[];
  decisions: DecisionEntry[];
  feasibilityReport: FeasibilityReport | null;
  transparencyReport: TransparencyReport | null;
  mrp: MRPResult;
  /** The actual dispatch rule used (resolves AUTO to concrete rule) */
  resolvedDispatchRule: DispatchRule;
  /** True when feasibility report includes THIRD_SHIFT remediation */
  thirdShiftRecommended: boolean;
}

export interface DataSourceLike {
  getPlanState: () => Promise<PlanState>;
}

/**
 * Run the full scheduling pipeline:
 * 1. Load PlanState from data source
 * 2. Transform to EngineData
 * 3. Compute MRP + supply priority
 * 4. Schedule (autoReplan or autoRouteOverflow)
 */
export async function runSchedulePipeline(
  ds: DataSourceLike,
  tcfg: TransformConfigFromSettings,
): Promise<CacheEntry> {
  let planState;
  try {
    planState = await ds.getPlanState();
  } catch (e) {
    throw new Error(`Falha ao carregar dados: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 1. Transform PlanState → EngineData
  const transformConfig: TransformConfig = {
    moStrategy: tcfg.moStrategy,
    moNominalPG1: tcfg.moNominalPG1,
    moNominalPG2: tcfg.moNominalPG2,
    moCustomPG1: tcfg.moCustomPG1,
    moCustomPG2: tcfg.moCustomPG2,
    demandSemantics: tcfg.demandSemantics,
    preStartBufferDays: tcfg.preStartBufferDays,
  };

  // Safety net: force raw_np if demandSemantics is falsy (e.g. stale localStorage)
  if (!transformConfig.demandSemantics) {
    transformConfig.demandSemantics = 'raw_np';
    console.warn('[schedule-pipeline] demandSemantics was falsy — forced to raw_np');
  }

  const data = transformPlanState(planState, transformConfig);

  // Diagnostic: detect zero-demand anomaly (positive fixture values vs raw_np semantics)
  if (transformConfig.demandSemantics === 'raw_np') {
    const hasInput = planState.operations.some((o) =>
      o.daily_qty.some((v) => v != null && v !== 0),
    );
    const hasDemand = data.ops.some((o) => o.d.some((v) => v > 0));
    if (hasInput && !hasDemand) {
      console.warn(
        '[schedule-pipeline] ZERO_DEMAND: rawNPtoOrderDemand produced 0 demand.',
        'demandSemantics:', transformConfig.demandSemantics,
        'sample daily_qty:', planState.operations[0]?.daily_qty.slice(0, 5),
        'sample engine d:', data.ops[0]?.d.slice(0, 5),
      );
    }
  }

  // 2. Compute MRP + supply priority
  const mrp = computeMRP(data);
  const supplyBoosts = computeSupplyPriority(data, mrp);

  // 3. Read scheduling settings
  const settings = useSettingsStore.getState();
  // AUTO delegates to UCB1 bandit; otherwise use manual selection
  const dispatchRule: DispatchRule =
    settings.dispatchRule === 'AUTO'
      ? DISPATCH_BANDIT.select()
      : (settings.dispatchRule as DispatchRule);

  // 4. Schedule
  let resultBlocks: Block[];
  let resultMoves: MoveAction[] = [];
  let resultAdvances: AdvanceAction[] = [];
  let resultDecisions: DecisionEntry[] = [];
  let resultFeasibility: FeasibilityReport | null = null;
  let resultTransparency: TransparencyReport | null = null;

  if (settings.useServerSolver) {
    // CP-SAT server-side solver
    try {
      const request = engineDataToSolverRequest(data, {
        oee: settings.oee,
        timeLimit: settings.serverSolverTimeLimit,
        objective: settings.serverSolverObjective,
      });
      const solverResult = await callServerSolver(request);
      resultBlocks = solverResultToBlocks(solverResult, data);
    } catch (e) {
      // Fallback to client-side scheduling
      console.warn(
        '[schedule-pipeline] Server solver failed, falling back to client-side:',
        e instanceof Error ? e.message : String(e),
      );
      const overflowResult = autoRouteOverflow({
        ops: data.ops,
        mSt: data.mSt,
        tSt: data.tSt,
        userMoves: [],
        machines: data.machines,
        toolMap: data.toolMap,
        workdays: data.workdays,
        nDays: data.nDays,
        workforceConfig: data.workforceConfig,
        rule: dispatchRule,
        supplyBoosts: supplyBoosts.size > 0 ? supplyBoosts : undefined,
        thirdShift: planState.thirdShift ?? settings.thirdShiftDefault,
        machineTimelines: data.machineTimelines,
        toolTimelines: data.toolTimelines,
        twinValidationReport: data.twinValidationReport,
        dates: data.dates,
        orderBased: data.orderBased,
      });
      resultBlocks = overflowResult.blocks;
      resultMoves = overflowResult.autoMoves;
      resultAdvances = overflowResult.autoAdvances ?? [];
      resultDecisions = overflowResult.decisions ?? [];
      resultFeasibility = overflowResult.feasibilityReport ?? null;
    }
  } else if (settings.enableAutoReplan) {
    const replanResult: AutoReplanResult = autoReplan(
      {
        ops: data.ops,
        mSt: data.mSt,
        tSt: data.tSt,
        moves: [],
        machines: data.machines,
        toolMap: data.toolMap,
        workdays: data.workdays,
        nDays: data.nDays,
        workforceConfig: data.workforceConfig,
        rule: dispatchRule,
        supplyBoosts: supplyBoosts.size > 0 ? supplyBoosts : undefined,
        thirdShift: planState.thirdShift ?? settings.thirdShiftDefault,
        machineTimelines: data.machineTimelines,
        toolTimelines: data.toolTimelines,
        dates: data.dates,
        twinValidationReport: data.twinValidationReport,
        orderBased: data.orderBased,
      },
      { ...DEFAULT_AUTO_REPLAN_CONFIG, ...settings.autoReplanConfig },
    );
    resultBlocks = replanResult.blocks;
    resultMoves = replanResult.autoMoves;
    resultAdvances = replanResult.autoAdvances ?? [];
    resultDecisions = replanResult.decisions;
    resultFeasibility = replanResult.scheduleResult?.feasibilityReport ?? null;
    resultTransparency = replanResult.scheduleResult?.transparencyReport ?? null;
  } else {
    const overflowResult = autoRouteOverflow({
      ops: data.ops,
      mSt: data.mSt,
      tSt: data.tSt,
      userMoves: [],
      machines: data.machines,
      toolMap: data.toolMap,
      workdays: data.workdays,
      nDays: data.nDays,
      workforceConfig: data.workforceConfig,
      rule: dispatchRule,
      supplyBoosts: supplyBoosts.size > 0 ? supplyBoosts : undefined,
      thirdShift: planState.thirdShift ?? settings.thirdShiftDefault,
      machineTimelines: data.machineTimelines,
      toolTimelines: data.toolTimelines,
      twinValidationReport: data.twinValidationReport,
      dates: data.dates,
      orderBased: data.orderBased,
    });
    resultBlocks = overflowResult.blocks;
    resultMoves = overflowResult.autoMoves;
    resultAdvances = overflowResult.autoAdvances ?? [];
    resultDecisions = overflowResult.decisions ?? [];
    resultFeasibility = overflowResult.feasibilityReport ?? null;
  }

  // 5. Mark pre-start blocks (scheduled before ISOP D0)
  const preN = data._preStartDays ?? 0;
  if (preN > 0) {
    for (const b of resultBlocks) {
      if (b.dayIdx < preN) {
        b.preStart = true;
        b.preStartReason = `Producao antecipada ${preN - b.dayIdx} dia(s) antes do ISOP`;
      }
    }
  }

  const thirdShiftRecommended = !!(
    resultFeasibility?.remediations?.some((r) => r.type === 'THIRD_SHIFT')
  );

  return {
    engine: data,
    blocks: resultBlocks,
    autoMoves: resultMoves,
    autoAdvances: resultAdvances,
    decisions: resultDecisions,
    feasibilityReport: resultFeasibility,
    transparencyReport: resultTransparency,
    mrp,
    resolvedDispatchRule: dispatchRule,
    thirdShiftRecommended,
  };
}
