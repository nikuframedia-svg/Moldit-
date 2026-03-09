/**
 * TrustIndexBadge — Global trust indicator in sidebar.
 * Shows score, gate classification, and dimension breakdown on hover.
 */

import { useDataStore } from '@/stores/useDataStore';
import './TrustIndexBadge.css';

interface TrustIndexBadgeProps {
  collapsed?: boolean;
}

interface TrustGate {
  label: string;
  color: string;
}

function classifyGate(score: number): TrustGate {
  if (score >= 0.9) return { label: 'Full Auto', color: 'var(--semantic-green)' };
  if (score >= 0.7) return { label: 'Monitoring', color: 'var(--accent)' };
  if (score >= 0.5) return { label: 'Suggestion', color: 'var(--semantic-amber)' };
  return { label: 'Manual', color: 'var(--semantic-red)' };
}

const DIM_LABELS: Record<string, string> = {
  completeness: 'Completude',
  quality: 'Qualidade',
  demandCoverage: 'Procura',
  consistency: 'Consistencia',
};

export function TrustIndexBadge({ collapsed }: TrustIndexBadgeProps) {
  const trustScore = useDataStore((s) => s.meta?.trustScore);
  const trustDimensions = useDataStore((s) => s.meta?.trustDimensions);

  if (trustScore == null) return null;

  const gate = classifyGate(trustScore);

  return (
    <div className={`ti-badge${collapsed ? ' ti-badge--collapsed' : ''}`}>
      <span className="ti-badge__dot" style={{ background: gate.color }} />

      {!collapsed && (
        <>
          <span className="ti-badge__score">TI: {trustScore.toFixed(2)}</span>
          <span className="ti-badge__gate" style={{ color: gate.color }}>
            {gate.label}
          </span>
        </>
      )}

      <div className="ti-badge__tooltip">
        <div className="ti-badge__tooltip-title" style={{ color: gate.color }}>
          TrustIndex: {trustScore.toFixed(2)} — {gate.label}
        </div>
        {trustDimensions &&
          Object.entries(trustDimensions).map(([key, value]) => (
            <div key={key} className="ti-badge__tooltip-row">
              <span>{DIM_LABELS[key] ?? key}</span>
              <span className="ti-badge__tooltip-value">{(value * 100).toFixed(0)}%</span>
            </div>
          ))}
      </div>
    </div>
  );
}
