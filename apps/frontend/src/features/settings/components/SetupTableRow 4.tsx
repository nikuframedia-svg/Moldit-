/**
 * SetupTableRow — Single editable row for a tool in the setup table.
 * Extracted from SetupTable to comply with 300-line component limit.
 */

import { setupColor } from './setupUtils';

export interface SetupTableRowProps {
  tool: { id: string; nm: string; m: string; sH: number; pH: number };
  override: { s?: number; pH?: number } | undefined;
  editing: boolean;
  editVal: string;
  editingRate: boolean;
  editRateVal: string;
  onStartEdit: (toolId: string, currentMinutes: number) => void;
  onCommitEdit: (toolId: string) => void;
  onCancelEdit: () => void;
  onEditValChange: (val: string) => void;
  onStartRateEdit: (toolId: string, currentPH: number) => void;
  onCommitRateEdit: (toolId: string) => void;
  onCancelRateEdit: () => void;
  onEditRateValChange: (val: string) => void;
  onClearOverride: (id: string) => void;
  onClearRateOverride: (id: string) => void;
}

export function SetupTableRow({
  tool: t,
  override: ov,
  editing: isEditing,
  editVal,
  editingRate: isEditingPH,
  editRateVal,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onEditValChange,
  onStartRateEdit,
  onCommitRateEdit,
  onCancelRateEdit,
  onEditRateValChange,
  onClearOverride,
  onClearRateOverride,
}: SetupTableRowProps) {
  const isSetupOverridden = ov?.s !== undefined;
  const isRateOverridden = ov?.pH !== undefined;
  const isOverridden = isSetupOverridden || isRateOverridden;
  const displayMinutes = Math.round(t.sH * 60);

  return (
    <tr>
      <td className="setup-matrix__row-label" title={t.nm}>
        {t.id}
      </td>
      <td className="setup-matrix__cell" style={{ fontSize: 12 }}>
        {t.m}
      </td>
      <td
        className="setup-matrix__cell"
        style={{
          cursor: 'pointer',
          color: setupColor(displayMinutes),
          borderLeft: isSetupOverridden ? '2px solid var(--accent)' : undefined,
        }}
        onClick={() => onStartEdit(t.id, displayMinutes)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onStartEdit(t.id, displayMinutes);
          }
        }}
      >
        {isEditing ? (
          <input
            className="setup-matrix__input"
            type="number"
            value={editVal}
            onChange={(e) => onEditValChange(e.target.value)}
            onBlur={() => onCommitEdit(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitEdit(t.id);
              if (e.key === 'Escape') onCancelEdit();
            }}
            style={{
              width: 50,
              textAlign: 'center',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          />
        ) : (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{displayMinutes}</span>
        )}
      </td>
      <td
        className="setup-matrix__cell"
        style={{
          cursor: 'pointer',
          borderLeft: isRateOverridden ? '2px solid var(--accent)' : undefined,
        }}
        onClick={() => onStartRateEdit(t.id, t.pH)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onStartRateEdit(t.id, t.pH);
          }
        }}
      >
        {isEditingPH ? (
          <input
            className="setup-matrix__input"
            type="number"
            value={editRateVal}
            onChange={(e) => onEditRateValChange(e.target.value)}
            onBlur={() => onCommitRateEdit(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRateEdit(t.id);
              if (e.key === 'Escape') onCancelRateEdit();
            }}
            style={{
              width: 60,
              textAlign: 'center',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          />
        ) : (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: t.pH > 0 ? 'var(--text-primary)' : 'var(--semantic-red)',
            }}
          >
            {t.pH > 0 ? t.pH : '\u2014'}
          </span>
        )}
      </td>
      <td className="setup-matrix__cell" style={{ fontSize: 12 }}>
        {isOverridden ? (
          <span
            style={{
              color: 'var(--accent)',
              fontWeight: 600,
              padding: '1px 4px',
              borderRadius: 3,
              background: 'rgba(34,197,94,0.1)',
            }}
          >
            Editado
          </span>
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>{t.sH > 0 ? 'ISOP' : 'Default'}</span>
        )}
      </td>
      <td className="setup-matrix__cell" style={{ textAlign: 'center' }}>
        {isOverridden && (
          <button
            onClick={() => {
              if (isSetupOverridden) onClearOverride(t.id);
              if (isRateOverridden) onClearRateOverride(t.id);
            }}
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              background: 'none',
              border: '1px solid var(--border-subtle)',
              borderRadius: 3,
              padding: '1px 6px',
              cursor: 'pointer',
            }}
            title="Reset para valor ISOP"
          >
            Reset
          </button>
        )}
      </td>
    </tr>
  );
}
