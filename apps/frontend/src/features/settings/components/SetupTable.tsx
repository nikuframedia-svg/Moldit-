/**
 * SetupTable — Editable table of setup times and production rates per tool.
 * Composes SetupTableRow and SetupTableLegend sub-components.
 */

import { useState } from 'react';
import { SetupTableLegend } from './SetupTableLegend';
import { SetupTableRow } from './SetupTableRow';

export interface SetupTableProps {
  tools: Array<{ id: string; nm: string; m: string; sH: number; pH: number }>;
  toolOverrides: Record<string, { s?: number; pH?: number }>;
  onSetOverride: (id: string, minutes: number) => void;
  onSetRateOverride: (id: string, pH: number) => void;
  onClearOverride: (id: string) => void;
  onClearRateOverride: (id: string) => void;
}

export function SetupTable({
  tools,
  toolOverrides,
  onSetOverride,
  onSetRateOverride,
  onClearOverride,
  onClearRateOverride,
}: SetupTableProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editingRate, setEditingRate] = useState<string | null>(null);
  const [editRateVal, setEditRateVal] = useState('');

  if (tools.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
        Sem ferramentas para esta máquina
      </div>
    );
  }

  const startEdit = (toolId: string, currentMinutes: number) => {
    setEditing(toolId);
    setEditVal(String(currentMinutes));
  };

  const commitEdit = (toolId: string) => {
    const val = Math.max(0, Math.round(Number(editVal) || 0));
    onSetOverride(toolId, val);
    setEditing(null);
  };

  const startRateEdit = (toolId: string, currentPH: number) => {
    setEditingRate(toolId);
    setEditRateVal(String(currentPH));
  };

  const commitRateEdit = (toolId: string) => {
    const val = Math.max(0, Math.round(Number(editRateVal) || 0));
    onSetRateOverride(toolId, val);
    setEditingRate(null);
  };

  const stats = {
    count: tools.length,
    avgSetup:
      tools.length > 0 ? Math.round(tools.reduce((s, t) => s + t.sH * 60, 0) / tools.length) : 0,
    minSetup: tools.length > 0 ? Math.round(Math.min(...tools.map((t) => t.sH * 60))) : 0,
    maxSetup: tools.length > 0 ? Math.round(Math.max(...tools.map((t) => t.sH * 60))) : 0,
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 16,
          fontSize: 12,
          color: 'var(--text-secondary)',
          marginBottom: 12,
        }}
      >
        <span>{stats.count} ferramentas</span>
        <span>
          Média:{' '}
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {stats.avgSetup}m
          </span>
        </span>
        <span>
          Min: <span style={{ fontFamily: 'var(--font-mono)' }}>{stats.minSetup}m</span>
        </span>
        <span>
          Max: <span style={{ fontFamily: 'var(--font-mono)' }}>{stats.maxSetup}m</span>
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="setup-matrix">
          <thead>
            <tr>
              <th className="setup-matrix__corner">Ferramenta</th>
              <th className="setup-matrix__header">Máquina</th>
              <th className="setup-matrix__header">Setup (min)</th>
              <th className="setup-matrix__header">Peças/h</th>
              <th className="setup-matrix__header">Fonte</th>
              <th className="setup-matrix__header" style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <SetupTableRow
                key={t.id}
                tool={t}
                override={toolOverrides[t.id]}
                editing={editing === t.id}
                editVal={editVal}
                editingRate={editingRate === t.id}
                editRateVal={editRateVal}
                onStartEdit={startEdit}
                onCommitEdit={commitEdit}
                onCancelEdit={() => setEditing(null)}
                onEditValChange={setEditVal}
                onStartRateEdit={startRateEdit}
                onCommitRateEdit={commitRateEdit}
                onCancelRateEdit={() => setEditingRate(null)}
                onEditRateValChange={setEditRateVal}
                onClearOverride={onClearOverride}
                onClearRateOverride={onClearRateOverride}
              />
            ))}
          </tbody>
        </table>
      </div>

      <SetupTableLegend />
    </div>
  );
}
