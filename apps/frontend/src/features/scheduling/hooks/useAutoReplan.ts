/**
 * useAutoReplan — Auto-replan state and actions.
 *
 * Manages AR strategies, undo/redo, simulation, and apply-all.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  AlternativeAction,
  AutoReplanConfig,
  AutoReplanResult,
  DispatchRule,
  EngineData,
  EOp,
  MoveAction,
  ReplanActionDetail,
  ReplanSimulation,
} from '../../../lib/engine';
import {
  applyAlternative,
  autoReplan,
  DEFAULT_AUTO_REPLAN_CONFIG,
  getReplanActions,
  simulateWithout,
  undoReplanActions,
} from '../../../lib/engine';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useToastStore } from '../../../stores/useToastStore';

export interface AutoReplanState {
  arResult: AutoReplanResult | null;
  arActions: ReplanActionDetail[];
  arRunning: boolean;
  arSim: ReplanSimulation | null;
  arSimId: string | null;
  arExclude: Set<string>;
  wdi: number[];
  downStartDay: number;
  downEndDay: number;
  arDayFrom: number;
  arDayTo: number;
  arExpanded: string | null;
  arShowExclude: boolean;
}

export interface AutoReplanActions {
  setArExclude: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDownStartDay: React.Dispatch<React.SetStateAction<number>>;
  setDownEndDay: React.Dispatch<React.SetStateAction<number>>;
  setArDayFrom: React.Dispatch<React.SetStateAction<number>>;
  setArDayTo: React.Dispatch<React.SetStateAction<number>>;
  setArExpanded: React.Dispatch<React.SetStateAction<string | null>>;
  setArShowExclude: React.Dispatch<React.SetStateAction<boolean>>;
  setArResult: React.Dispatch<React.SetStateAction<AutoReplanResult | null>>;
  runAutoReplan: () => void;
  handleArUndo: (decisionId: string) => void;
  handleArAlt: (decisionId: string, alt: AlternativeAction) => void;
  handleArSimulate: (decisionId: string) => void;
  handleArUndoAll: () => void;
  handleArApplyAll: () => void;
}

export function useAutoReplan(
  data: EngineData,
  allOps: EOp[],
  mSt: Record<string, string>,
  tSt: Record<string, string>,
  applyMove: (opId: string, toM: string) => void,
  replanTimelines: ReturnType<typeof import('../../../lib/engine').buildResourceTimelines> | null,
  onReplanComplete?: (info: {
    trigger: string;
    triggerType: string;
    strategy: string;
    strategyLabel: string;
    movesCount: number;
    moves: MoveAction[];
  }) => void,
): { state: AutoReplanState; actions: AutoReplanActions; buildArInput: () => unknown } {
  const wdi = useMemo(
    () =>
      data.workdays.map((w: boolean, i: number) => (w ? i : -1)).filter((i): i is number => i >= 0),
    [data.workdays],
  );

  const [arResult, setArResult] = useState<AutoReplanResult | null>(null);
  const [arActions, setArActions] = useState<ReplanActionDetail[]>([]);
  const [arRunning, setArRunning] = useState(false);
  const [arSim, setArSim] = useState<ReplanSimulation | null>(null);
  const [arSimId, setArSimId] = useState<string | null>(null);
  const [arExclude, setArExclude] = useState<Set<string>>(new Set());
  const [downStartDay, setDownStartDay] = useState(() => wdi[0] ?? 0);
  const [downEndDay, setDownEndDay] = useState(() => wdi[0] ?? 0);
  const [arDayFrom, setArDayFrom] = useState(() => wdi[0] ?? 0);
  const [arDayTo, setArDayTo] = useState(() => wdi[wdi.length - 1] ?? data.nDays - 1);
  const [arExpanded, setArExpanded] = useState<string | null>(null);
  const [arShowExclude, setArShowExclude] = useState(false);
  const arInputRef = useRef<unknown>(null);

  const buildArInput = useCallback(() => {
    const settings = useSettingsStore.getState();
    const rule = (settings.dispatchRule || 'EDD') as DispatchRule;
    return {
      ops: allOps,
      mSt,
      tSt,
      moves: [] as MoveAction[],
      machines: data.machines,
      toolMap: data.toolMap,
      workdays: data.workdays,
      nDays: data.nDays,
      workforceConfig: data.workforceConfig,
      rule,
      thirdShift: data.thirdShift ?? settings.thirdShiftDefault,
      machineTimelines: replanTimelines?.machineTimelines ?? data.machineTimelines,
      toolTimelines: replanTimelines?.toolTimelines ?? data.toolTimelines,
      dates: data.dates,
      twinValidationReport: data.twinValidationReport,
      orderBased: data.orderBased,
    };
  }, [data, allOps, mSt, tSt, replanTimelines]);

  const runAutoReplan = useCallback(() => {
    setArRunning(true);
    setArSim(null);
    setArSimId(null);
    setTimeout(() => {
      const input = buildArInput();
      const excludeOpIds = allOps.filter((o) => arExclude.has(o.t)).map((o) => o.id);
      const config: Partial<AutoReplanConfig> = {
        ...DEFAULT_AUTO_REPLAN_CONFIG,
        excludeOps: excludeOpIds,
      };
      try {
        const result = autoReplan(input, config as AutoReplanConfig);
        const actions = getReplanActions(result);
        arInputRef.current = input;
        setArResult(result);
        setArActions(actions);
      } catch (e) {
        useToastStore
          .getState()
          .actions.addToast(
            `Erro no auto-replan: ${e instanceof Error ? e.message : String(e)}`,
            'error',
            5000,
          );
      }
      setArRunning(false);
    }, 0);
  }, [buildArInput, allOps, arExclude]);

  const handleArUndo = useCallback(
    (decisionId: string) => {
      if (!arInputRef.current || !arResult) return;
      try {
        const inp = arInputRef.current as Parameters<typeof undoReplanActions>[0];
        const newResult = undoReplanActions(inp, arResult, [decisionId]);
        setArResult(newResult);
        setArActions(getReplanActions(newResult));
        setArSim(null);
        setArSimId(null);
        useToastStore.getState().actions.addToast('Acção desfeita', 'success', 3000);
      } catch (e) {
        useToastStore
          .getState()
          .actions.addToast(`Erro: ${e instanceof Error ? e.message : String(e)}`, 'error', 4000);
      }
    },
    [arResult],
  );

  const handleArAlt = useCallback(
    (decisionId: string, alt: AlternativeAction) => {
      if (!arInputRef.current || !arResult) return;
      try {
        const inp = arInputRef.current as Parameters<typeof applyAlternative>[0];
        const newResult = applyAlternative(inp, arResult, decisionId, alt);
        setArResult(newResult);
        setArActions(getReplanActions(newResult));
        setArSim(null);
        setArSimId(null);
        useToastStore.getState().actions.addToast('Alternativa aplicada', 'success', 3000);
      } catch (e) {
        useToastStore
          .getState()
          .actions.addToast(`Erro: ${e instanceof Error ? e.message : String(e)}`, 'error', 4000);
      }
    },
    [arResult],
  );

  const handleArSimulate = useCallback(
    (decisionId: string) => {
      if (!arInputRef.current || !arResult) return;
      try {
        const inp = arInputRef.current as Parameters<typeof simulateWithout>[0];
        const sim = simulateWithout(inp, arResult, [decisionId]);
        setArSim(sim);
        setArSimId(decisionId);
      } catch (e) {
        useToastStore
          .getState()
          .actions.addToast(
            `Erro na simulação: ${e instanceof Error ? e.message : String(e)}`,
            'error',
            4000,
          );
      }
    },
    [arResult],
  );

  const handleArUndoAll = useCallback(() => {
    if (!arInputRef.current || !arResult || arActions.length === 0) return;
    try {
      const inp = arInputRef.current as Parameters<typeof undoReplanActions>[0];
      const allIds = arActions.map((a) => a.decisionId);
      const newResult = undoReplanActions(inp, arResult, allIds);
      setArResult(newResult);
      setArActions(getReplanActions(newResult));
      setArSim(null);
      setArSimId(null);
    } catch (e) {
      useToastStore
        .getState()
        .actions.addToast(`Erro: ${e instanceof Error ? e.message : String(e)}`, 'error', 4000);
    }
  }, [arResult, arActions]);

  const handleArApplyAll = useCallback(() => {
    if (!arResult) return;
    const mvs = arResult.autoMoves;
    for (const mv of mvs) applyMove(mv.opId, mv.toM);
    useToastStore
      .getState()
      .actions.addToast(`Auto-replan aplicado: ${mvs.length} movimentos`, 'success', 5000);
    onReplanComplete?.({
      trigger: 'Auto-Replan',
      triggerType: 'manual',
      strategy: 'auto_replan',
      strategyLabel: 'AUTO',
      movesCount: mvs.length,
      moves: mvs.map((mv) => ({ opId: mv.opId, toM: mv.toM })),
    });
  }, [arResult, applyMove, onReplanComplete]);

  return {
    state: {
      arResult,
      arActions,
      arRunning,
      arSim,
      arSimId,
      arExclude,
      wdi,
      downStartDay,
      downEndDay,
      arDayFrom,
      arDayTo,
      arExpanded,
      arShowExclude,
    },
    actions: {
      setArExclude,
      setDownStartDay,
      setDownEndDay,
      setArDayFrom,
      setArDayTo,
      setArExpanded,
      setArShowExclude,
      setArResult,
      runAutoReplan,
      handleArUndo,
      handleArAlt,
      handleArSimulate,
      handleArUndoAll,
      handleArApplyAll,
    },
    buildArInput,
  };
}
