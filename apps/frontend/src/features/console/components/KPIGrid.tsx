/**
 * KPIGrid — 6 premium KPI cards with sparklines for the selected day.
 * Uses KPICard from Industrial/ for ECharts sparklines + trend + status bar.
 */

import { KPICard } from '@/components/Industrial/KPICard';
import './KPIGrid.css';

export interface KPISparklines {
  pcs: number[];
  ops: number[];
  util: number[];
  setup: number[];
  alerts: number[];
  operators: number[];
}

interface KPIGridProps {
  totalPcs: number;
  totalOps: number;
  factoryUtil: number;
  totalSetupMin: number;
  violationCount: number;
  infeasibleCount: number;
  overflowCount: number;
  operatorsByArea: { pg1: number; pg2: number; total: number };
  operatorCapacity: { pg1: number; pg2: number };
  sparklines?: KPISparklines;
  otd?: number;
  otdSparkline?: number[];
}

function utilColor(v: number): string {
  if (v >= 0.85) return 'var(--semantic-amber)';
  if (v >= 0.6) return 'var(--semantic-green)';
  return 'var(--accent)';
}

function otdColor(v: number): string {
  if (v >= 0.95) return 'var(--semantic-green)';
  if (v >= 0.85) return 'var(--semantic-amber)';
  return 'var(--semantic-red)';
}

function alertColor(n: number): string {
  if (n === 0) return 'var(--semantic-green)';
  if (n <= 3) return 'var(--semantic-amber)';
  return 'var(--semantic-red)';
}

export function KPIGrid(props: KPIGridProps) {
  const {
    totalPcs,
    totalOps,
    factoryUtil,
    totalSetupMin,
    violationCount,
    infeasibleCount,
    overflowCount,
    sparklines,
    otd,
    otdSparkline,
  } = props;

  const alertCount = violationCount + infeasibleCount;
  const setupH = Math.floor(totalSetupMin / 60);
  const setupM = Math.round(totalSetupMin % 60);

  return (
    <div className="kpi-grid" data-testid="kpi-grid">
      <KPICard
        label="OTD"
        value={otd != null ? `${otd.toFixed(0)}` : '—'}
        unit="%"
        sparkline={otdSparkline}
        statusColor={otd != null ? otdColor(otd / 100) : undefined}
      />
      <KPICard
        label="Producao"
        value={totalPcs.toLocaleString()}
        unit="pcs"
        sparkline={sparklines?.pcs}
        statusColor="var(--accent)"
      />
      <KPICard
        label="Operacoes"
        value={totalOps}
        sparkline={sparklines?.ops}
        statusColor="var(--accent)"
      />
      <KPICard
        label="Utilizacao"
        value={`${(factoryUtil * 100).toFixed(0)}`}
        unit="%"
        sparkline={sparklines?.util}
        statusColor={utilColor(factoryUtil)}
      />
      <KPICard
        label="Setup"
        value={`${setupH}h${setupM > 0 ? `${setupM}m` : ''}`}
        sparkline={sparklines?.setup}
        statusColor="var(--accent)"
      />
      <KPICard
        label="Alertas"
        value={alertCount}
        trend={
          overflowCount > 0
            ? { direction: 'up' as const, label: `${overflowCount} overflow` }
            : undefined
        }
        sparkline={sparklines?.alerts}
        statusColor={alertColor(alertCount)}
      />
    </div>
  );
}
