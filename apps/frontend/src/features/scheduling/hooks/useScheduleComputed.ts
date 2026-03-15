import { useCallback, useMemo } from 'react';
import type {
  AutoReplanResult,
  Block,
  DecisionEntry,
  DispatchRule,
  EngineData,
  EOp,
  MoveAction,
} from '../../../lib/engine';
import {
  autoReplan,
  autoRouteOverflow,
  type buildResourceTimelines,
  capAnalysis,
  DEFAULT_AUTO_REPLAN_CONFIG,
  DEFAULT_WORKFORCE_CONFIG,
  getReplanActions,
  scoreSchedule,
} from '../../../lib/engine';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useToastStore } from '../../../stores/useToastStore';
import { useScheduleValidation } from './useScheduleValidation';

export function useScheduleComputed({
  engineData,
  rushOrders,
  mSt,
  tSt,
  moves,
  failureEvents,
  replanTimelines,
  appliedReplan,
}: {
  engineData: EngineData | null;
  rushOrders: Array<{ toolId: string; sku: string; qty: number; deadline: number }>;
  mSt: Record<string, string>;
  tSt: Record<string, string>;
  moves: MoveAction[];
  failureEvents: unknown[];
  replanTimelines: ReturnType<typeof buildResourceTimelines> | null;
  appliedReplan: AutoReplanResult | null;
}) {
  const rushOps = useMemo((): EOp[] => {
    if (!engineData || rushOrders.length === 0) return [];
    return rushOrders
      .map((ro, idx): EOp | null => {
        const tool = engineData.toolMap[ro.toolId];
        if (!tool) return null;
        const d = Array(engineData.nDays).fill(0) as number[];
        d[ro.deadline] = -ro.qty;
        return {
          id: `rush-${ro.toolId}-${ro.deadline}-${ro.qty}-${idx}`,
          t: ro.toolId,
          m: tool.m,
          sku: ro.sku,
          nm: `RUSH: ${tool.nm || ro.sku}`,
          atr: 0,
          d,
        };
      })
      .filter((op): op is EOp => op !== null);
  }, [engineData, rushOrders]);

  const allOps = useMemo(
    () =>
      !engineData
        ? ([] as EOp[])
        : rushOps.length > 0
          ? [...engineData.ops, ...rushOps]
          : engineData.ops,
    [engineData, rushOps],
  );

  const {
    blocks,
    autoMoves,
    decisions: schedDecisions,
  } = useMemo(() => {
    if (!engineData)
      return {
        blocks: [] as Block[],
        autoMoves: [] as MoveAction[],
        decisions: [] as DecisionEntry[],
      };
    if (appliedReplan) {
      return {
        blocks: appliedReplan.blocks,
        autoMoves: appliedReplan.autoMoves,
        decisions: appliedReplan.decisions,
      };
    }
    const settings = useSettingsStore.getState();
    const isInteractive = failureEvents.length > 0 || moves.length > 0;
    return autoRouteOverflow({
      ops: allOps,
      mSt,
      tSt,
      userMoves: moves,
      machines: engineData.machines,
      toolMap: engineData.toolMap,
      workdays: engineData.workdays,
      nDays: engineData.nDays,
      workforceConfig: engineData.workforceConfig,
      rule: (settings.dispatchRule as DispatchRule) || 'EDD',
      thirdShift: engineData.thirdShift ?? settings.thirdShiftDefault,
      machineTimelines: replanTimelines?.machineTimelines ?? engineData.machineTimelines,
      toolTimelines: replanTimelines?.toolTimelines ?? engineData.toolTimelines,
      twinValidationReport: engineData.twinValidationReport,
      dates: engineData.dates,
      orderBased: engineData.orderBased,
      maxTier: isInteractive ? 2 : undefined,
    });
  }, [engineData, allOps, mSt, tSt, moves, replanTimelines, failureEvents.length, appliedReplan]);

  const cap = useMemo(
    () => (engineData ? capAnalysis(blocks, engineData.machines) : {}),
    [blocks, engineData],
  );

  const neMetrics = useMemo(() => {
    if (!engineData || blocks.length === 0) return null;
    return scoreSchedule(
      blocks,
      allOps,
      engineData.mSt,
      engineData.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG,
      engineData.machines,
      engineData.toolMap,
      undefined,
      undefined,
      engineData.nDays,
    );
  }, [blocks, allOps, engineData]);

  const { validation, audit, feasibility } = useScheduleValidation(blocks, allOps, engineData);

  const handlePlanAutoReplan = useCallback(() => {
    if (!engineData) return null;
    try {
      const settings = useSettingsStore.getState();
      const rule = (settings.dispatchRule || 'EDD') as DispatchRule;
      const result = autoReplan(
        {
          ops: allOps,
          mSt,
          tSt,
          moves: [] as MoveAction[],
          machines: engineData.machines,
          toolMap: engineData.toolMap,
          workdays: engineData.workdays,
          nDays: engineData.nDays,
          workforceConfig: engineData.workforceConfig,
          rule,
          thirdShift: engineData.thirdShift ?? settings.thirdShiftDefault,
          machineTimelines: replanTimelines?.machineTimelines ?? engineData.machineTimelines,
          toolTimelines: replanTimelines?.toolTimelines ?? engineData.toolTimelines,
          dates: engineData.dates,
          twinValidationReport: engineData.twinValidationReport,
          orderBased: engineData.orderBased,
        },
        DEFAULT_AUTO_REPLAN_CONFIG,
      );
      return {
        actions: getReplanActions(result),
        moveCount: result.autoMoves.length,
        unresolvedCount: result.unresolved.length,
      };
    } catch (e) {
      useToastStore
        .getState()
        .actions.addToast(
          `Erro no auto-replan: ${e instanceof Error ? e.message : String(e)}`,
          'error',
          5000,
        );
      return null;
    }
  }, [engineData, allOps, mSt, tSt, replanTimelines]);

  const downC = Object.values(mSt).filter((s) => s === 'down').length;
  const blkOps = new Set(blocks.filter((b) => b.type === 'blocked').map((b) => b.opId)).size;

  return {
    allOps,
    blocks,
    autoMoves,
    schedDecisions,
    cap,
    neMetrics,
    validation,
    audit,
    feasibility,
    handlePlanAutoReplan,
    downC,
    blkOps,
  };
}
