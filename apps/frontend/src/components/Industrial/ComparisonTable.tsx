import '../../theme/base-components.css';

export interface ComparisonRow {
  label: string;
  baseline: number;
  scenario: number;
  unit: string;
  decimals?: number;
  higherIsBetter: boolean;
}

export interface ComparisonTableProps {
  rows: ComparisonRow[];
  baselineLabel?: string;
  scenarioLabel?: string;
}

function fmtVal(v: number, decimals = 1): string {
  return v.toLocaleString('pt-PT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function ComparisonTable({
  rows,
  baselineLabel = 'Baseline',
  scenarioLabel = 'Cen\u00e1rio',
}: ComparisonTableProps) {
  return (
    <table className="comparison-table" data-testid="comparison-table">
      <thead>
        <tr>
          <th>KPI</th>
          <th>{baselineLabel}</th>
          <th>{scenarioLabel}</th>
          <th>Delta</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const delta = row.scenario - row.baseline;
          const pct = row.baseline !== 0 ? (delta / Math.abs(row.baseline)) * 100 : 0;
          const isSignificant = Math.abs(pct) > 5;
          const isBetter = row.higherIsBetter ? delta > 0 : delta < 0;
          const isWorse = row.higherIsBetter ? delta < 0 : delta > 0;

          const rowClass =
            isSignificant && isBetter
              ? 'comparison-table__row--improved'
              : isSignificant && isWorse
                ? 'comparison-table__row--degraded'
                : '';

          const deltaClass = isBetter
            ? 'comparison-table__delta--positive'
            : isWorse
              ? 'comparison-table__delta--negative'
              : 'comparison-table__delta--neutral';

          const arrow = delta > 0 ? '\u2191' : delta < 0 ? '\u2193' : '';

          return (
            <tr key={row.label} className={rowClass}>
              <td style={{ fontFamily: 'inherit', color: 'var(--text-primary)' }}>{row.label}</td>
              <td>
                {fmtVal(row.baseline, row.decimals)} {row.unit}
              </td>
              <td>
                {fmtVal(row.scenario, row.decimals)} {row.unit}
              </td>
              <td>
                <span className={`comparison-table__delta ${deltaClass}`}>
                  {arrow} {fmtVal(Math.abs(delta), row.decimals)} {row.unit}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
