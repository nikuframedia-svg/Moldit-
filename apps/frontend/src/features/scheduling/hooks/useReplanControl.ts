/**
 * useReplanControl — Orchestrator hook that composes sub-hooks.
 *
 * Exports the same public interface as before for backward compatibility.
 */

import { useMemo, useState } from 'react';
import type { AutoReplanResult, Block, EngineData, EOp, MoveAction, ObjectiveProfile } from '../../../lib/engine';
import { genDecisions, quickValidate } from '../../../lib/engine';
import type { AutoReplanActions, AutoReplanState } from './useAutoReplan';
import { useAutoReplan } from './useAutoReplan';
import type { FailureActions, FailureState } from './useFailureManagement';
import { useFailureManagement } from './useFailureManagement';
import type { OptimizationActions, OptimizationState } from './useOptimizationControl';
import { useOptimizationControl } from './useOptimizationControl';
import type { RushOrderActions, RushOrderState } from './useRushOrders';
import { useRushOrders } from './useRushOrders';

export interface ReplanControlState
  extends AutoReplanState,
    FailureState,
    OptimizationState,
    RushOrderState {
  xai: string | null;
  editingDown: { type: 'machine' | 'tool'; id: string } | null;
  blockCountByMachine: Record<string, number>;
  decs: ReturnType<typeof genDecisions>;
  qv: ReturnType<typeof quickValidate>;
}

export interface ReplanControlActions
  extends AutoReplanActions,
    FailureActions,
    OptimizationActions,
    RushOrderActions {
  setXai: React.Dispatch<React.SetStateAction<string | null>>;
  setEditingDown: React.Dispatch<
    React.SetStateAction<{ type: 'machine' | 'tool'; id: string } | null>
  >;
}

export function useReplanControl(
  data: EngineData,
  blocks: Block[],
  allOps: EOp[],
  mSt: Record<string, string>,
  tSt: Record<string, string>,
  moves: MoveAction[],
  applyMove: (opId: string, toM: string) => void,
  replanTimelines: ReturnType<typeof import('../../../lib/engine').buildResourceTimelines> | null,
  profiles: ObjectiveProfile[],
  setRushOrders: React.Dispatch<
    React.SetStateAction<Array<{ toolId: string; sku: string; qty: number; deadline: number }>>
  >,
  setAppliedReplan: (result: AutoReplanResult | null) => void,
  onReplanComplete?: (info: {
    trigger: string;
    triggerType: string;
    strategy: string;
    strategyLabel: string;
    movesCount: number;
    moves: MoveAction[];
  }) => void,
): { state: ReplanControlState; actions: ReplanControlActions } {
  const { machines, toolMap: TM, focusIds, tools } = data;

  // Shared state
  const [xai, setXai] = useState<string | null>(null);
  const [editingDown, setEditingDown] = useState<{ type: 'machine' | 'tool'; id: string } | null>(
    null,
  );

  const blockCountByMachine = useMemo(() => {
    const map: Record<string, number> = {};
    for (const b of blocks) {
      if (b.type !== 'blocked') map[b.machineId] = (map[b.machineId] ?? 0) + 1;
    }
    return map;
  }, [blocks]);

  // Sub-hooks
  const ar = useAutoReplan(data, allOps, mSt, tSt, applyMove, replanTimelines, setAppliedReplan, onReplanComplete);
  const fm = useFailureManagement(
    data,
    blocks,
    ar.state.wdi,
    ar.buildArInput,
    applyMove,
    onReplanComplete,
  );
  const opt = useOptimizationControl(
    data,
    blocks,
    allOps,
    mSt,
    tSt,
    moves,
    applyMove,
    replanTimelines,
    profiles,
  );
  const ro = useRushOrders(data.ops, ar.state.wdi, setRushOrders);

  // Derived
  const decs = useMemo(
    () => genDecisions(allOps, mSt, tSt, moves, blocks, machines, TM, focusIds, tools),
    [allOps, mSt, tSt, moves, blocks, machines, TM, focusIds, tools],
  );
  const qv = useMemo(() => quickValidate(blocks, machines, TM), [blocks, machines, TM]);

  return {
    state: {
      xai,
      editingDown,
      blockCountByMachine,
      decs,
      qv,
      ...ar.state,
      ...fm.state,
      ...opt.state,
      ...ro.state,
    },
    actions: {
      setXai,
      setEditingDown,
      ...ar.actions,
      ...fm.actions,
      ...opt.actions,
      ...ro.actions,
    },
  };
}
