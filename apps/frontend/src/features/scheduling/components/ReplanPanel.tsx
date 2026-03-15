/**
 * ReplanPanel — Orchestrator for all replan sub-components.
 * Delegates rendering to focused sub-components in ./replan/.
 * Includes simplified mode (default) for operators and advanced mode for planners.
 */
import { ChevronDown } from 'lucide-react';
import type React from 'react';
import { useCallback, useState } from 'react';
import type { AutoReplanResult, Block, DayLoad, EngineData, EOp, MoveAction, OptResult, ReplanDispatchResult } from '../../../lib/engine';
import { type buildResourceTimelines, C, dispatchReplan } from '../../../lib/engine';
import { useReplanOrchestrator } from '../hooks/useReplanOrchestrator';
import { OBJECTIVE_PROFILES } from './constants';
import { ReplanKPIPreview } from './ReplanKPIPreview';
import { ReplanStrategyCard } from './ReplanStrategyCard';
import { ReplanTimeline } from './ReplanTimeline';
import {
  AutoReplanCard,
  DayRangePicker,
  DecisionsPanel,
  FailureFormCard,
  OptimalRoutingCard,
  QualityBanner,
  ResourceDownCard,
  RushOrderCard,
  SimpleReplanView,
} from './replan';

export function ReplanView({
  mSt,
  tSt,
  moves,
  applyMove,
  undoMove,
  blocks,
  cap,
  data,
  onApplyAndSave,
  isSaving,
  setResourceDown,
  clearResourceDown,
  getResourceDownDays,
  replanTimelines,
  rushOrders,
  setRushOrders,
  allOps,
  neMetrics,
  setAppliedReplan,
}: {
  mSt: Record<string, string>;
  tSt: Record<string, string>;
  toggleM?: (id: string) => void;
  toggleT?: (id: string) => void;
  moves: MoveAction[];
  applyMove: (opId: string, toM: string) => void;
  undoMove: (opId: string) => void;
  blocks: Block[];
  cap: Record<string, DayLoad[]>;
  data: EngineData;
  onApplyAndSave?: () => void;
  isSaving?: boolean;
  setResourceDown: (type: 'machine' | 'tool', id: string, days: number[]) => void;
  clearResourceDown: (type: 'machine' | 'tool', id: string) => void;
  getResourceDownDays: (type: 'machine' | 'tool', id: string) => Set<number>;
  replanTimelines: ReturnType<typeof buildResourceTimelines> | null;
  rushOrders: Array<{ toolId: string; sku: string; qty: number; deadline: number }>;
  setRushOrders: React.Dispatch<
    React.SetStateAction<Array<{ toolId: string; sku: string; qty: number; deadline: number }>>
  >;
  allOps: EOp[];
  neMetrics: (OptResult & { blocks: Block[] }) | null;
  setAppliedReplan: (result: AutoReplanResult | null) => void;
}) {
  const [advancedMode, setAdvancedMode] = useState(false);
  const [replanRunning, setReplanRunning] = useState(false);
  const [replanResult, setReplanResult] = useState<ReplanDispatchResult | null>(null);
  const { machines, tools, dates, dnames, toolMap: TM, focusIds } = data;
  const {
    rpc,
    rpcActions,
    replanEntries,
    undoEntry,
    clearHistory,
    replanPreview,
    setReplanPreview,
  } = useReplanOrchestrator(
    data,
    blocks,
    allOps,
    mSt,
    tSt,
    moves,
    applyMove,
    replanTimelines,
    OBJECTIVE_PROFILES,
    setRushOrders,
    neMetrics,
    setAppliedReplan,
  );

  const { xai, editingDown, decs, qv } = rpc;
  const { setXai, setEditingDown } = rpcActions;

  const handleDispatchReplan = useCallback(
    (machineId: string, delayMin: number) => {
      setReplanRunning(true);
      setReplanResult(null);
      try {
        const machineBlocks = blocks.filter((b) => b.machineId === machineId && b.type === 'ok');
        const perturbedOpId = machineBlocks[0]?.opId ?? allOps.find((o) => o.m === machineId)?.id ?? '';
        const result = dispatchReplan({
          blocks,
          previousBlocks: blocks,
          perturbedOpId,
          delayMin,
          machineId,
          scheduleInput: {
            ops: data.ops,
            mSt,
            tSt,
            moves,
            machines: data.machines,
            toolMap: data.toolMap,
            workdays: data.workdays,
            nDays: data.nDays,
            workforceConfig: data.workforceConfig,
            twinValidationReport: data.twinValidationReport,
            dates: data.dates,
            orderBased: data.orderBased,
            machineTimelines: data.machineTimelines,
            toolTimelines: data.toolTimelines,
          },
          TM,
          eventType: 'breakdown',
          isCatastrophe: delayMin >= 510,
        });
        setReplanResult(result);
      } finally {
        setReplanRunning(false);
      }
    },
    [blocks, allOps, data, mSt, tSt, moves, TM],
  );

  if (!advancedMode) {
    return (
      <SimpleReplanView
        machines={machines}
        mSt={mSt}
        getResourceDownDays={getResourceDownDays}
        setEditingDown={setEditingDown}
        onRunAutoReplan={rpcActions.runAutoReplan}
        arRunning={rpc.arRunning}
        arResult={rpc.arResult}
        arActionsCount={rpc.arActions.length}
        moves={moves}
        onSwitchAdvanced={() => setAdvancedMode(true)}
        onDispatchReplan={handleDispatchReplan}
        replanRunning={replanRunning}
        replanResult={replanResult}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Back to simple mode */}
      <button
        onClick={() => setAdvancedMode(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderRadius: 8,
          border: `1px solid ${C.bd}`,
          background: 'transparent',
          color: C.t3,
          fontSize: 11,
          fontWeight: 500,
          cursor: 'pointer',
          fontFamily: 'inherit',
          alignSelf: 'flex-start',
        }}
      >
        <ChevronDown
          size={12}
          strokeWidth={1.5}
          style={{ transform: 'rotate(90deg)' }}
        />
        Modo Simples
      </button>

      <QualityBanner qv={qv} />

      <ResourceDownCard
        machines={machines}
        tools={tools}
        focusIds={focusIds}
        mSt={mSt}
        tSt={tSt}
        editingDown={editingDown}
        setEditingDown={setEditingDown}
        blockCountByMachine={rpc.blockCountByMachine}
        getResourceDownDays={getResourceDownDays}
        setResourceDown={setResourceDown}
        clearResourceDown={clearResourceDown}
        moves={moves}
        undoMove={undoMove}
        applyMove={applyMove}
        onApplyAndSave={onApplyAndSave}
        isSaving={isSaving}
        decs={decs}
        dates={dates}
        dnames={dnames}
        wdi={rpc.wdi}
        downStartDay={rpc.downStartDay}
        downEndDay={rpc.downEndDay}
        setDownStartDay={rpcActions.setDownStartDay}
        setDownEndDay={rpcActions.setDownEndDay}
      />

      {editingDown && (
        <DayRangePicker
          editingDown={editingDown}
          currentDown={getResourceDownDays(editingDown.type, editingDown.id)}
          dates={dates}
          dnames={dnames}
          wdi={rpc.wdi}
          downStartDay={rpc.downStartDay}
          downEndDay={rpc.downEndDay}
          setDownStartDay={rpcActions.setDownStartDay}
          setDownEndDay={rpcActions.setDownEndDay}
          setEditingDown={setEditingDown}
          setResourceDown={setResourceDown}
          clearResourceDown={clearResourceDown}
        />
      )}

      <AutoReplanCard
        wdi={rpc.wdi}
        dates={dates}
        dnames={dnames}
        nDays={data.nDays}
        tools={tools}
        focusIds={focusIds}
        arRunning={rpc.arRunning}
        arResult={rpc.arResult}
        arActions={rpc.arActions}
        arSim={rpc.arSim}
        arSimId={rpc.arSimId}
        arExclude={rpc.arExclude}
        arDayFrom={rpc.arDayFrom}
        arDayTo={rpc.arDayTo}
        arExpanded={rpc.arExpanded}
        arShowExclude={rpc.arShowExclude}
        setArExclude={rpcActions.setArExclude}
        setArDayFrom={rpcActions.setArDayFrom}
        setArDayTo={rpcActions.setArDayTo}
        setArExpanded={rpcActions.setArExpanded}
        setArShowExclude={rpcActions.setArShowExclude}
        setArResult={rpcActions.setArResult}
        runAutoReplan={rpcActions.runAutoReplan}
        handleArUndo={rpcActions.handleArUndo}
        handleArAlt={rpcActions.handleArAlt}
        handleArSimulate={rpcActions.handleArSimulate}
        handleArUndoAll={rpcActions.handleArUndoAll}
        handleArApplyAll={rpcActions.handleArApplyAll}
      />

      <FailureFormCard
        machines={machines}
        tools={tools}
        focusIds={focusIds}
        failures={rpc.failures}
        failureImpacts={rpc.failureImpacts}
        showFailureForm={rpc.showFailureForm}
        ffResType={rpc.ffResType}
        ffResId={rpc.ffResId}
        ffSev={rpc.ffSev}
        ffCap={rpc.ffCap}
        ffStartDay={rpc.ffStartDay}
        ffEndDay={rpc.ffEndDay}
        ffDesc={rpc.ffDesc}
        cascRunning={rpc.cascRunning}
        wdi={rpc.wdi}
        dates={dates}
        dnames={dnames}
        setShowFailureForm={rpcActions.setShowFailureForm}
        setFfResType={rpcActions.setFfResType}
        setFfResId={rpcActions.setFfResId}
        setFfSev={rpcActions.setFfSev}
        setFfCap={rpcActions.setFfCap}
        setFfStartDay={rpcActions.setFfStartDay}
        setFfEndDay={rpcActions.setFfEndDay}
        setFfDesc={rpcActions.setFfDesc}
        addFailure={rpcActions.addFailure}
        removeFailure={rpcActions.removeFailure}
        runCascadingReplan={rpcActions.runCascadingReplan}
      />

      {rpc.failures.length > 0 && rpc.failureImpacts.length > 0 && (
        <ReplanStrategyCard
          failures={rpc.failures}
          impacts={rpc.failureImpacts}
          blocks={blocks}
          onSelectStrategy={rpcActions.setSelectedStrategy}
          selectedStrategy={rpc.selectedStrategy}
        />
      )}

      {replanPreview && (
        <ReplanKPIPreview
          before={replanPreview.before}
          after={replanPreview.after}
          movesCount={replanPreview.movesCount}
          onApply={() => {
            replanPreview.pendingApply?.();
            setReplanPreview(null);
          }}
          onCancel={() => setReplanPreview(null)}
        />
      )}

      <OptimalRoutingCard
        tools={tools}
        optRunning={rpc.optRunning}
        optResults={rpc.optResults}
        optProgress={rpc.optProgress}
        optN={rpc.optN}
        optProfile={rpc.optProfile}
        optMoveable={rpc.optMoveable}
        saRunning={rpc.saRunning}
        saProgress={rpc.saProgress}
        setOptN={rpcActions.setOptN}
        setOptProfile={rpcActions.setOptProfile}
        setOptResults={rpcActions.setOptResults}
        runOpt={rpcActions.runOpt}
        runSA={rpcActions.runSA}
        cancelSA={rpcActions.cancelSA}
        applyOptResult={rpcActions.applyOptResult}
        profiles={OBJECTIVE_PROFILES}
      />

      <RushOrderCard
        tools={tools}
        focusIds={focusIds}
        toolMap={TM}
        rushOrders={rushOrders}
        roTool={rpc.roTool}
        roQty={rpc.roQty}
        roDeadline={rpc.roDeadline}
        wdi={rpc.wdi}
        dates={dates}
        dnames={dnames}
        setRoTool={rpcActions.setRoTool}
        setRoQty={rpcActions.setRoQty}
        setRoDeadline={rpcActions.setRoDeadline}
        addRushOrder={rpcActions.addRushOrder}
        removeRushOrder={rpcActions.removeRushOrder}
      />

      <DecisionsPanel
        data={data}
        blocks={blocks}
        cap={cap}
        mSt={mSt}
        moves={moves}
        undoMove={undoMove}
        applyMove={applyMove}
        decs={decs}
        xai={xai}
        setXai={setXai}
        neMetrics={neMetrics}
      />

      <ReplanTimeline
        entries={replanEntries}
        onUndo={(id) => {
          const entry = undoEntry(id);
          if (entry) {
            for (const mv of entry.moves) undoMove(mv.opId);
          }
        }}
        onClear={clearHistory}
      />
    </div>
  );
}
