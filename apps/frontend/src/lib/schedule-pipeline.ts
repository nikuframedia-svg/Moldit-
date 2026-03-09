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
  transformPlanState,
} from './engine';

export interface CacheEntry {
  engine: EngineData;
  blocks: Block[];
  autoMoves: MoveAction[];
  autoAdvances: AdvanceAction[];
  decisions: DecisionEntry[];
  feasibilityReport: FeasibilityReport | null;
  transparencyReport: TransparencyReport | null;
  mrp: MRPResult;
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
  };
  const data = transformPlanState(planState, transformConfig);

  // 2. Compute MRP + supply priority
  const mrp = computeMRP(data);
  const supplyBoosts = computeSupplyPriority(data, mrp);

  // 3. Read scheduling settings
  const settings = useSettingsStore.getState();
  const dispatchRule: DispatchRule = settings.dispatchRule as DispatchRule;

  // 4. Schedule
  let resultBlocks: Block[];
  let resultMoves: MoveAction[] = [];
  let resultAdvances: AdvanceAction[] = [];
  let resultDecisions: DecisionEntry[] = [];
  let resultFeasibility: FeasibilityReport | null = null;
  let resultTransparency: TransparencyReport | null = null;

  if (settings.enableAutoReplan) {
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
  }

  return {
    engine: data,
    blocks: resultBlocks,
    autoMoves: resultMoves,
    autoAdvances: resultAdvances,
    decisions: resultDecisions,
    feasibilityReport: resultFeasibility,
    transparencyReport: resultTransparency,
    mrp,
  };
}
