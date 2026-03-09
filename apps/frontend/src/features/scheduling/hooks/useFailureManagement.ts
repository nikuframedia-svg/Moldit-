/**
 * useFailureManagement — Failure/breakdown management and cascading replan.
 */

import { useCallback, useState } from 'react';
import type {
  Block,
  EngineData,
  FailureEvent,
  ImpactReport,
  MoveAction,
} from '../../../lib/engine';
import { analyzeAllFailures, cascadingReplan } from '../../../lib/engine';
import { useToastStore } from '../../../stores/useToastStore';

export interface FailureState {
  failures: FailureEvent[];
  failureImpacts: ImpactReport[];
  showFailureForm: boolean;
  ffResType: 'machine' | 'tool';
  ffResId: string;
  ffSev: 'total' | 'partial' | 'degraded';
  ffCap: number;
  ffStartDay: number;
  ffEndDay: number;
  ffDesc: string;
  cascRunning: boolean;
  selectedStrategy: string | null;
}

export interface FailureActions {
  setShowFailureForm: React.Dispatch<React.SetStateAction<boolean>>;
  setFfResType: React.Dispatch<React.SetStateAction<'machine' | 'tool'>>;
  setFfResId: React.Dispatch<React.SetStateAction<string>>;
  setFfSev: React.Dispatch<React.SetStateAction<'total' | 'partial' | 'degraded'>>;
  setFfCap: React.Dispatch<React.SetStateAction<number>>;
  setFfStartDay: React.Dispatch<React.SetStateAction<number>>;
  setFfEndDay: React.Dispatch<React.SetStateAction<number>>;
  setFfDesc: React.Dispatch<React.SetStateAction<string>>;
  setSelectedStrategy: React.Dispatch<React.SetStateAction<string | null>>;
  addFailure: () => void;
  removeFailure: (id: string) => void;
  runCascadingReplan: () => void;
}

export function useFailureManagement(
  data: EngineData,
  blocks: Block[],
  wdi: number[],
  buildArInput: () => unknown,
  applyMove: (opId: string, toM: string) => void,
  onReplanComplete?: (info: {
    trigger: string;
    triggerType: string;
    strategy: string;
    strategyLabel: string;
    movesCount: number;
    moves: MoveAction[];
  }) => void,
): { state: FailureState; actions: FailureActions } {
  const [failures, setFailures] = useState<FailureEvent[]>([]);
  const [failureImpacts, setFailureImpacts] = useState<ImpactReport[]>([]);
  const [showFailureForm, setShowFailureForm] = useState(false);
  const [ffResType, setFfResType] = useState<'machine' | 'tool'>('machine');
  const [ffResId, setFfResId] = useState('');
  const [ffSev, setFfSev] = useState<'total' | 'partial' | 'degraded'>('total');
  const [ffCap, setFfCap] = useState(50);
  const [ffStartDay, setFfStartDay] = useState(() => wdi[0] ?? 0);
  const [ffEndDay, setFfEndDay] = useState(() => wdi[0] ?? 0);
  const [ffDesc, setFfDesc] = useState('');
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
  const [cascRunning, setCascRunning] = useState(false);

  const addFailure = useCallback(() => {
    if (!ffResId) return;
    const f: FailureEvent = {
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      resourceType: ffResType,
      resourceId: ffResId,
      startDay: ffStartDay,
      endDay: ffEndDay,
      startShift: null,
      endShift: null,
      severity: ffSev,
      capacityFactor: ffSev === 'total' ? 0 : ffCap / 100,
      description: ffDesc || undefined,
    };
    const newF = [...failures, f];
    setFailures(newF);
    setFailureImpacts(analyzeAllFailures(newF, blocks, data.nDays));
    setShowFailureForm(false);
    setFfDesc('');
  }, [
    ffResType,
    ffResId,
    ffSev,
    ffCap,
    ffStartDay,
    ffEndDay,
    ffDesc,
    failures,
    blocks,
    data.nDays,
  ]);

  const removeFailure = useCallback(
    (id: string) => {
      const newF = failures.filter((f) => f.id !== id);
      setFailures(newF);
      setFailureImpacts(newF.length > 0 ? analyzeAllFailures(newF, blocks, data.nDays) : []);
    },
    [failures, blocks, data.nDays],
  );

  const runCascadingReplan = useCallback(() => {
    if (failures.length === 0) return;
    setCascRunning(true);
    setTimeout(() => {
      const input = buildArInput();
      try {
        const result = cascadingReplan(
          input as Parameters<typeof cascadingReplan>[0],
          failures,
          blocks,
        );
        const mvs = result.mitigationMoves;
        for (const mv of mvs) applyMove(mv.opId, mv.toM);
        useToastStore
          .getState()
          .actions.addToast(
            `Replan cascata: ${mvs.length} movimentos, ${result.unrecoverableBlocks.length} irrecuperáveis`,
            result.unrecoverableBlocks.length > 0 ? 'warning' : 'success',
            5000,
          );
        const triggerDesc = failures.map((f) => f.resourceId).join(', ');
        const stratLabel =
          selectedStrategy === 'right_shift'
            ? 'RIGHT-SHIFT'
            : selectedStrategy === 'match_up'
              ? 'MATCH-UP'
              : selectedStrategy === 'full_regen'
                ? 'REGEN'
                : 'PARCIAL';
        onReplanComplete?.({
          trigger: `Avaria ${triggerDesc}`,
          triggerType: failures[0]?.resourceType === 'machine' ? 'machine_down' : 'tool_down',
          strategy: selectedStrategy || 'partial',
          strategyLabel: stratLabel,
          movesCount: mvs.length,
          moves: mvs.map((mv) => ({ opId: mv.opId, toM: mv.toM })),
        });
      } catch (e) {
        useToastStore
          .getState()
          .actions.addToast(`Erro: ${e instanceof Error ? e.message : String(e)}`, 'error', 5000);
      }
      setCascRunning(false);
    }, 0);
  }, [failures, blocks, buildArInput, applyMove, selectedStrategy, onReplanComplete]);

  return {
    state: {
      failures,
      failureImpacts,
      showFailureForm,
      ffResType,
      ffResId,
      ffSev,
      ffCap,
      ffStartDay,
      ffEndDay,
      ffDesc,
      cascRunning,
      selectedStrategy,
    },
    actions: {
      setShowFailureForm,
      setFfResType,
      setFfResId,
      setFfSev,
      setFfCap,
      setFfStartDay,
      setFfEndDay,
      setFfDesc,
      setSelectedStrategy,
      addFailure,
      removeFailure,
      runCascadingReplan,
    },
  };
}
