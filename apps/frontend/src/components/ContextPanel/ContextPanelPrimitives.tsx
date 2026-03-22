/**
 * ContextPanel shared primitives: Section, Stat, LoadBar.
 */

import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

// ── Collapsible section ────────────────────────────────────
export function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ctx-panel__section">
      <button
        type="button"
        className="ctx-panel__section-header"
        tabIndex={0}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <span className="ctx-panel__section-title">{title}</span>
        <span
          className={`ctx-panel__section-chevron ${open ? 'ctx-panel__section-chevron--open' : ''}`}
        >
          <ChevronRight size={12} />
        </span>
      </button>
      {open && <div className="ctx-panel__section-content">{children}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: 'green' | 'amber' | 'red';
}) {
  return (
    <div className="ctx-panel__stat">
      <span className="ctx-panel__stat-label">{label}</span>
      <span
        className={`ctx-panel__stat-value ${variant ? `ctx-panel__stat-value--${variant}` : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

export function LoadBar({ prod, setup, cap }: { prod: number; setup: number; cap: number }) {
  const total = prod + setup;
  const pPct = cap > 0 ? (prod / cap) * 100 : 0;
  const sPct = cap > 0 ? (setup / cap) * 100 : 0;
  const uPct = cap > 0 ? (total / cap) * 100 : 0;
  return (
    <div className="ctx-panel__bar-wrap">
      <div className="ctx-panel__bar">
        <div
          className="ctx-panel__bar-seg ctx-panel__bar-seg--prod"
          style={{ width: `${Math.min(pPct, 100)}%` }}
        />
        <div
          className="ctx-panel__bar-seg ctx-panel__bar-seg--setup"
          style={{ width: `${Math.min(sPct, 100 - Math.min(pPct, 100))}%` }}
        />
      </div>
      <span className="ctx-panel__bar-label">{uPct.toFixed(0)}%</span>
    </div>
  );
}
