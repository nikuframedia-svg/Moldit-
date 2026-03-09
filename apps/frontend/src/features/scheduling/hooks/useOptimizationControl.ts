/**
 * useOptimizationControl — GA/SA optimization and moveable ops.
 */

import { useCallback, useMemo, useState } from 'react';
import { useSchedulingWorker } from '../../../hooks/useSchedulingWorker';
import type {
  Block,
  DispatchRule,
  EngineData,
  EOp,
  MoveAction,
  ObjectiveProfile,
  OptimizationInput,
  OptResult,
  SAInput,
  ScoreWeights,
} from '../../../lib/engine';
import { DEFAULT_WORKFORCE_CONFIG, moveableOps, runOptimization } from '../../../lib/engine';
import { useSettingsStore } from '../../../stores/useSettingsStore';
import { useToastStore } from '../../../stores/useToastStore';

export interface OptimizationState {
  optRunning: boolean;
  optResults: OptResult[];
  optProgress: number;
  optN: number;
  optProfile: string;
  optMoveable: ReturnType<typeof moveableOps>;
  saRunning: boolean;
  saProgress: number | null;
  saError: string | null;
}

export interface OptimizationActions {
  setOptN: React.Dispatch<React.SetStateAction<number>>;
  setOptProfile: React.Dispatch<React.SetStateAction<string>>;
  setOptResults: React.Dispatch<React.SetStateAction<OptResult[]>>;
  runOpt: () => void;
  runSA: () => void;
  cancelSA: () => void;
  applyOptResult: (r: OptResult) => void;
}

export function useOptimizationControl(
  data: EngineData,
  blocks: Block[],
  allOps: EOp[],
  mSt: Record<string, string>,
  tSt: Record<string, string>,
  moves: MoveAction[],
  applyMove: (opId: string, toM: string) => void,
  replanTimelines: ReturnType<typeof import('../../../lib/engine').buildResourceTimelines> | null,
  profiles: ObjectiveProfile[],
): { state: OptimizationState; actions: OptimizationActions } {
  const { machines, tools, toolMap: TM, focusIds } = data;

  const [optRunning, setOptRunning] = useState(false);
  const [optResults, setOptResults] = useState<OptResult[]>([]);
  const [optProgress, setOptProgress] = useState(0);
  const [optN, setOptN] = useState(200);
  const [optProfile, setOptProfile] = useState('balanced');
  const optMoveable = useMemo(() => moveableOps(allOps, mSt, tSt, TM), [allOps, mSt, tSt, TM]);

  const runOpt = useCallback(() => {
    setOptRunning(true);
    setOptProgress(0);
    setOptResults([]);
    const settings = useSettingsStore.getState();
    const rule = (settings.dispatchRule || 'EDD') as DispatchRule;
    const prof = profiles.find((p) => p.id === optProfile);
    const weights = prof ? (prof.weights as unknown as ScoreWeights) : undefined;
    const input: OptimizationInput = {
      ops: allOps,
      mSt,
      tSt,
      machines,
      TM,
      focusIds,
      tools,
      workforceConfig: data.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG,
      weights,
      seed: 42,
      workdays: data.workdays,
      nDays: data.nDays,
      rule,
      baselineBlocks: blocks,
      N: optN,
      K: 5,
      thirdShift: data.thirdShift ?? settings.thirdShiftDefault,
      machineTimelines: replanTimelines?.machineTimelines ?? data.machineTimelines,
      toolTimelines: replanTimelines?.toolTimelines ?? data.toolTimelines,
      twinValidationReport: data.twinValidationReport,
      dates: data.dates,
      orderBased: data.orderBased,
    };
    try {
      const setup = runOptimization(input);
      setup.run(
        (batch) => setOptResults(batch),
        (pct) => setOptProgress(pct),
      );
      setOptResults(setup.top);
    } catch (e) {
      useToastStore
        .getState()
        .actions.addToast(
          `Erro na optimização: ${e instanceof Error ? e.message : String(e)}`,
          'error',
          5000,
        );
    }
    setOptRunning(false);
  }, [
    allOps,
    mSt,
    tSt,
    machines,
    TM,
    focusIds,
    tools,
    data,
    blocks,
    optN,
    optProfile,
    replanTimelines,
    profiles,
  ]);

  const applyOptResult = useCallback(
    (r: OptResult) => {
      for (const mv of r.moves) applyMove(mv.opId, mv.toM);
      useToastStore
        .getState()
        .actions.addToast(`Optimização aplicada: ${r.moves.length} movimentos`, 'success', 5000);
    },
    [applyMove],
  );

  // Simulated Annealing via Web Worker
  const {
    runSA: workerRunSA,
    progress: saProgress,
    isRunning: saRunning,
    error: saError,
    cancel: cancelSA,
  } = useSchedulingWorker();

  const runSA = useCallback(() => {
    const settings = useSettingsStore.getState();
    const rule = (settings.dispatchRule || 'ATCS') as DispatchRule;
    const saInput: SAInput = {
      ops: allOps,
      mSt,
      tSt,
      machines,
      TM,
      workdays: data.workdays,
      nDays: data.nDays,
      workforceConfig: data.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG,
      rule,
      thirdShift: data.thirdShift ?? settings.thirdShiftDefault,
      machineTimelines: replanTimelines?.machineTimelines ?? data.machineTimelines,
      toolTimelines: replanTimelines?.toolTimelines ?? data.toolTimelines,
      twinValidationReport: data.twinValidationReport,
      dates: data.dates,
      orderBased: data.orderBased,
      initialBlocks: blocks,
      initialMoves: moves,
    };
    workerRunSA(saInput, { maxIter: 10_000 })
      .then((result) => {
        if (result.improved) {
          for (const mv of result.moves) applyMove(mv.opId, mv.toM);
          useToastStore
            .getState()
            .actions.addToast(
              `SA concluido: score ${result.metrics.score.toFixed(0)} (${result.accepted} aceites em ${result.iterations} iteracoes)`,
              'success',
              5000,
            );
        } else {
          useToastStore
            .getState()
            .actions.addToast('SA concluido: sem melhoria sobre solucao actual', 'info', 4000);
        }
      })
      .catch((err) => {
        useToastStore
          .getState()
          .actions.addToast(
            `Erro SA: ${err instanceof Error ? err.message : String(err)}`,
            'error',
            5000,
          );
      });
  }, [
    allOps,
    mSt,
    tSt,
    machines,
    TM,
    data,
    blocks,
    moves,
    replanTimelines,
    workerRunSA,
    applyMove,
  ]);

  return {
    state: {
      optRunning,
      optResults,
      optProgress,
      optN,
      optProfile,
      optMoveable,
      saRunning,
      saProgress,
      saError,
    },
    actions: {
      setOptN,
      setOptProfile,
      setOptResults,
      runOpt,
      runSA,
      cancelSA,
      applyOptResult,
    },
  };
}
