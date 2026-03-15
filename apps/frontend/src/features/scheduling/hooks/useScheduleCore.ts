import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataSource } from '../../../hooks/useDataSource';
import type { AutoReplanResult, EngineData, EOp, MoveAction } from '../../../lib/engine';
import { transformPlanState } from '../../../lib/engine';
import { useDataStore } from '../../../stores/useDataStore';
import { useReplanStore } from '../../../stores/useReplanStore';
import { getTransformConfig } from '../../../stores/useSettingsStore';
import { useToastStore } from '../../../stores/useToastStore';
import { useScheduleFilters } from './useScheduleFilters';

export function useScheduleCore(initialView = 'plan') {
  const ds = useDataSource();
  const hasHydrated = useDataStore((s) => s._hasHydrated);
  const [engineData, setEngineData] = useState<EngineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { state: filters, actions: filterActions } = useScheduleFilters(engineData);
  const { mSt, tSt, failureEvents, isScheduling, replanTimelines } = filters;
  const {
    setMSt,
    setTSt,
    toggleM,
    toggleT,
    setResourceDown,
    clearResourceDown,
    getResourceDownDays,
  } = filterActions;
  const [moves, setMoves] = useState<MoveAction[]>([]);
  const [view, setView] = useState(initialView);
  const [isSaving, setIsSaving] = useState(false);
  const [rushOrders, setRushOrders] = useState<
    Array<{ toolId: string; sku: string; qty: number; deadline: number }>
  >([]);
  const [isopBanner, setIsopBanner] = useState<string | null>(null);
  const prevOpsRef = useRef<EOp[] | null>(null);
  const [appliedReplan, setAppliedReplan] = useState<AutoReplanResult | null>(null);

  const loadData = useCallback(async () => {
    if (!ds.getPlanState) {
      setError('Planning engine not available in this data source');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const tcfg = getTransformConfig();
      const data = transformPlanState(await ds.getPlanState(), {
        moStrategy: tcfg.moStrategy,
        moNominalPG1: tcfg.moNominalPG1,
        moNominalPG2: tcfg.moNominalPG2,
        moCustomPG1: tcfg.moCustomPG1,
        moCustomPG2: tcfg.moCustomPG2,
        demandSemantics: tcfg.demandSemantics,
      });
      setEngineData(data);
      filterActions.resetFilters(data.machines);
      setMoves([]);
      setAppliedReplan(null);
      setIsopBanner(null);
      prevOpsRef.current = data.ops;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load plan state');
    } finally {
      setLoading(false);
    }
  }, [ds]);

  useEffect(() => {
    if (!hasHydrated) return;
    loadData();
  }, [loadData, hasHydrated]);

  const applyMove = useCallback(
    (opId: string, toM: string) =>
      setMoves((p) => (p.find((m) => m.opId === opId) ? p : [...p, { opId, toM }])),
    [],
  );
  const undoMove = useCallback(
    (opId: string) => setMoves((p) => p.filter((m) => m.opId !== opId)),
    [],
  );

  const handleApplyAndSave = useCallback(
    async (
      movesToApply?: MoveAction[],
      scenarioState?: { mSt: Record<string, string>; tSt: Record<string, string> },
    ) => {
      const applyMoves = movesToApply || moves;
      const appliedMSt = scenarioState?.mSt || mSt;
      const appliedTSt = scenarioState?.tSt || tSt;
      if (applyMoves.length === 0 && Object.values(appliedMSt).every((s) => s !== 'down')) return;
      if (ds.applyReplan) {
        setIsSaving(true);
        try {
          const backendMoves = applyMoves.map((mv) => {
            const origM = engineData?.ops.find((o) => o.id === mv.opId)?.m || '';
            return { op_id: mv.opId, from_machine: origM, to_machine: mv.toM };
          });
          const machineStatus: Record<string, string> = {};
          for (const [id, st] of Object.entries(appliedMSt)) {
            if (st === 'down') machineStatus[id] = 'down';
          }
          const toolStatus: Record<string, string> = {};
          for (const [id, st] of Object.entries(appliedTSt)) {
            if (st === 'down') toolStatus[id] = 'down';
          }
          await ds.applyReplan({
            moves: backendMoves,
            machine_status: machineStatus,
            tool_status: toolStatus,
            author: 'planner-001',
            description: `Replan: ${applyMoves.length} movimentos`,
          });
          await loadData();
          useToastStore
            .getState()
            .actions.addToast(
              `Replan aplicado: ${applyMoves.length} movimentos guardados`,
              'success',
              5000,
            );
          setView('plan');
        } catch (e) {
          useToastStore
            .getState()
            .actions.addToast(
              `Erro ao aplicar replan: ${e instanceof Error ? e.message : String(e)}`,
              'error',
              6000,
            );
        } finally {
          setIsSaving(false);
        }
      } else {
        if (scenarioState) {
          setMSt(scenarioState.mSt);
          setTSt(scenarioState.tSt);
        }
        setMoves(applyMoves);
        useToastStore
          .getState()
          .actions.addToast(`Plano aplicado: ${applyMoves.length} movimentos`, 'success', 5000);
        setView('plan');
      }
    },
    [ds, moves, mSt, tSt, engineData, loadData],
  );

  useEffect(() => {
    useReplanStore.getState().actions.setOnApplyCallback(loadData);
    return () => {
      useReplanStore.getState().actions.setOnApplyCallback(null);
    };
  }, [loadData]);

  return {
    engineData,
    loading,
    error,
    loadData,
    view,
    setView,
    mSt,
    tSt,
    toggleM,
    toggleT,
    setMSt,
    setTSt,
    moves,
    applyMove,
    undoMove,
    handleApplyAndSave,
    isSaving,
    rushOrders,
    setRushOrders,
    isopBanner,
    setIsopBanner,
    isScheduling,
    failureEvents,
    replanTimelines,
    setResourceDown,
    clearResourceDown,
    getResourceDownDays,
    appliedReplan,
    setAppliedReplan,
  };
}
