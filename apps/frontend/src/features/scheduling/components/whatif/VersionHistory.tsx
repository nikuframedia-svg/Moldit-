import { GitCommit, GitCompareArrows, History as HistoryIcon, Save, Star } from 'lucide-react';
import type { AreaCaps, EngineData, EOp, ETool, OptResult } from '../../../../lib/engine';
import { C, genDecisions } from '../../../../lib/engine';
import type { PlanVersionParams } from '../../../../stores/usePlanVersionStore';
import { usePlanVersionStore } from '../../../../stores/usePlanVersionStore';
import { useToastStore } from '../../../../stores/useToastStore';
import { Card, Tag } from '../atoms';
import { DiffDisplay } from './DiffDisplay';
import type { ScenarioConfig } from './whatif-types';

export function VersionActionBar({
  scenario,
  sc,
  areaCaps,
  machines,
  focusT,
  ops,
  tools,
  focusIds,
  getResourceDownDays,
  showHistory,
  setShowHistory,
  showCompare,
  setShowCompare,
  versions,
  toolMap,
}: {
  scenario: OptResult;
  sc: ScenarioConfig;
  areaCaps: AreaCaps;
  machines: EngineData['machines'];
  focusT: ETool[];
  ops: EOp[];
  tools: ETool[];
  focusIds: string[];
  getResourceDownDays: (type: 'machine' | 'tool', id: string) => Set<number>;
  showHistory: boolean;
  setShowHistory: (fn: (h: boolean) => boolean) => void;
  showCompare: boolean;
  setShowCompare: (fn: (c: boolean) => boolean) => void;
  versions: ReturnType<typeof usePlanVersionStore.getState>['versions'];
  toolMap: Record<string, ETool>;
}) {
  const s = scenario;
  const btnBase = {
    borderRadius: 6,
    cursor: 'pointer' as const,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: 'inherit',
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 6,
  };

  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <button
        onClick={() => {
          const mStSave = Object.fromEntries(
            machines.map((m) => [
              m.id,
              getResourceDownDays('machine', m.id).size > 0 ? 'down' : 'running',
            ]),
          );
          const tStSave = Object.fromEntries(
            focusT
              .filter((t) => getResourceDownDays('tool', t.id).size > 0)
              .map((t) => [t.id, 'down']),
          );
          const params: PlanVersionParams = {
            machineStatus: mStSave,
            toolStatus: tStSave,
            areaCaps,
            moves: s.moves,
            seed: sc.seed,
          };
          const decs = genDecisions(
            ops,
            mStSave,
            tStSave,
            s.moves,
            s.blocks,
            machines,
            toolMap,
            focusIds,
            tools,
          );
          const id = usePlanVersionStore
            .getState()
            .actions.savePlan(s as any, decs, params, s.label);
          useToastStore
            .getState()
            .actions.addToast(`Versão guardada: ${s.label} (${id.slice(0, 8)})`, 'success', 4000);
        }}
        style={{
          ...btnBase,
          flex: 1,
          padding: '8px 16px',
          border: `1px solid ${C.bd}`,
          background: 'transparent',
          color: C.t1,
          justifyContent: 'center',
        }}
      >
        <Save size={14} strokeWidth={1.5} />
        Guardar Versão
      </button>
      {versions.length > 0 && (
        <button
          onClick={() => {
            const last = versions[versions.length - 1];
            usePlanVersionStore.getState().actions.commitPlan(last.id);
            useToastStore
              .getState()
              .actions.addToast(`Plano committed: ${last.label}`, 'success', 4000);
          }}
          style={{
            ...btnBase,
            padding: '8px 16px',
            border: `1px solid ${C.acM}`,
            background: C.acS,
            color: C.ac,
          }}
        >
          <GitCommit size={14} strokeWidth={1.5} />
          Commit
        </button>
      )}
      <button
        onClick={() => setShowHistory((h) => !h)}
        style={{
          ...btnBase,
          padding: '8px 12px',
          border: `1px solid ${showHistory ? C.acM : C.bd}`,
          background: showHistory ? C.acS : 'transparent',
          color: showHistory ? C.ac : C.t2,
        }}
      >
        <HistoryIcon size={14} strokeWidth={1.5} />
        {versions.length}
      </button>
      {versions.length >= 2 && (
        <button
          onClick={() => {
            setShowCompare((c) => !c);
            setShowHistory(() => false);
          }}
          style={{
            ...btnBase,
            padding: '8px 12px',
            border: `1px solid ${showCompare ? C.blS : C.bd}`,
            background: showCompare ? C.blS : 'transparent',
            color: showCompare ? C.bl : C.t2,
          }}
        >
          <GitCompareArrows size={14} strokeWidth={1.5} />
          Comparar
        </button>
      )}
    </div>
  );
}

export function VersionHistoryPanel({
  versions,
  currentId,
  diffPair,
  setDiffPair,
}: {
  versions: ReturnType<typeof usePlanVersionStore.getState>['versions'];
  currentId: string | null;
  diffPair: [string, string] | null;
  setDiffPair: (pair: [string, string] | null) => void;
}) {
  if (versions.length === 0) return null;

  return (
    <Card style={{ padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.t1, marginBottom: 12 }}>
        Histórico de Versões <Tag color={C.pp}>{versions.length}</Tag>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, paddingLeft: 12 }}>
        {[...versions].reverse().map((v, i) => {
          const isCurrent = v.id === currentId;
          const isFirst = i === versions.length - 1;
          return (
            <div key={v.id} style={{ position: 'relative', paddingLeft: 20, paddingBottom: 16 }}>
              {i < versions.length - 1 && (
                <div
                  style={{
                    position: 'absolute',
                    left: 3,
                    top: 10,
                    bottom: 0,
                    width: 1,
                    background: 'rgba(255,255,255,0.06)',
                  }}
                />
              )}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 2,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: isCurrent ? C.ac : isFirst ? C.t4 : C.t3,
                }}
              />
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    onClick={() =>
                      usePlanVersionStore.getState().actions.setFavorite(v.id, !v.isFavorite)
                    }
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Star
                      size={12}
                      strokeWidth={1.5}
                      fill={v.isFavorite ? C.yl : 'none'}
                      style={{ color: v.isFavorite ? C.yl : C.t4 }}
                    />
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 500, color: C.t1 }}>{v.label}</span>
                  {v.branchLabel && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        color: C.pp,
                        background: C.ppS,
                        padding: '1px 6px',
                        borderRadius: 3,
                      }}
                    >
                      {v.branchLabel}
                    </span>
                  )}
                  {isCurrent && (
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 600,
                        background: C.acS,
                        color: C.ac,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                      }}
                    >
                      COMMITTED
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 11, color: C.t3, fontFamily: 'var(--font-mono)' }}>
                  {v.id.slice(0, 8)}
                </span>
              </div>
              <div style={{ fontSize: 11, color: C.t3, marginTop: 2 }}>
                {new Date(v.timestamp).toLocaleTimeString('pt-PT', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {' · '}OTD {v.kpis.otd.toFixed(1)}% · OTD-D {v.kpis.otdDelivery.toFixed(1)}% ·{' '}
                {v.kpis.setupCount} setups · tard {v.kpis.tardinessDays.toFixed(1)}d
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4, alignItems: 'center' }}>
                {!isCurrent && (
                  <button
                    onClick={() => usePlanVersionStore.getState().actions.commitPlan(v.id)}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      border: `1px solid ${C.bd}`,
                      cursor: 'pointer',
                      background: 'transparent',
                      color: C.t2,
                      fontSize: 10,
                      fontFamily: 'inherit',
                    }}
                  >
                    Commit
                  </button>
                )}
                {i < versions.length - 1 && (
                  <button
                    onClick={() => {
                      const prev = [...versions].reverse()[i + 1];
                      if (prev) setDiffPair([prev.id, v.id]);
                    }}
                    style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      border: `1px solid ${C.bd}`,
                      cursor: 'pointer',
                      background: 'transparent',
                      color: C.t2,
                      fontSize: 10,
                      fontFamily: 'inherit',
                    }}
                  >
                    Diff
                  </button>
                )}
                <input
                  placeholder="branch..."
                  defaultValue={v.branchLabel ?? ''}
                  onBlur={(e) =>
                    usePlanVersionStore
                      .getState()
                      .actions.setBranchLabel(v.id, e.target.value.trim())
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  style={{
                    marginLeft: 'auto',
                    width: 80,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${C.bd}`,
                    background: 'transparent',
                    color: C.t3,
                    fontSize: 9,
                    fontFamily: 'inherit',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {diffPair && <DiffDisplay diffPair={diffPair} setDiffPair={setDiffPair} />}
    </Card>
  );
}
