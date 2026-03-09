import '../../theme/base-components.css';

export type ProgressBarSize = 'sm' | 'md' | 'lg';
export type ProgressBarStatus = 'normal' | 'warning' | 'critical';

export interface ProgressBarProps {
  /** Value 0-100 */
  value: number;
  /** Optional label displayed above the bar */
  label?: string;
  /** Override automatic color thresholds */
  status?: ProgressBarStatus;
  /** Bar height: sm=4px, md=8px, lg=12px */
  size?: ProgressBarSize;
  /** Show percentage text */
  showText?: boolean;
  /** Absolute current value (for formatted label) */
  current?: number;
  /** Absolute total value (for formatted label) */
  total?: number;
}

const SIZE_MAP: Record<ProgressBarSize, number> = { sm: 4, md: 8, lg: 12 };

function resolveColor(value: number, status?: ProgressBarStatus): string {
  if (status === 'critical') return 'var(--semantic-red)';
  if (status === 'warning') return 'var(--semantic-amber)';
  if (status === 'normal') return 'var(--semantic-green)';
  // Auto: green >=70%, amber 40-70%, red <40%
  if (value >= 70) return 'var(--semantic-green)';
  if (value >= 40) return 'var(--semantic-amber)';
  return 'var(--semantic-red)';
}

function fmtNum(n: number): string {
  return n.toLocaleString('pt-PT');
}

export function ProgressBar({
  value,
  label,
  status,
  size = 'md',
  showText,
  current,
  total,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = resolveColor(clamped, status);
  const height = SIZE_MAP[size];

  const formattedLabel =
    current != null && total != null
      ? `${clamped}% \u2014 ${fmtNum(current)} / ${fmtNum(total)} pe\u00e7as`
      : null;

  return (
    <div className="progress-bar" data-testid="progress-bar">
      {(label || showText || formattedLabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          {label && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>}
          {formattedLabel ? (
            <span
              style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              {formattedLabel}
            </span>
          ) : (
            showText && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{clamped}%</span>
          )}
        </div>
      )}
      <div
        style={{
          width: '100%',
          height,
          borderRadius: height / 2,
          background: 'var(--bg-raised)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: '100%',
            borderRadius: height / 2,
            background: color,
            transition: 'width 0.3s ease, background 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}
