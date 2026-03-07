import './SkeletonLoader.css';

interface SkeletonCardProps {
  lines?: number;
  showIcon?: boolean;
}

export function SkeletonCard({ lines = 3, showIcon = true }: SkeletonCardProps) {
  return (
    <div className="skeleton-card">
      {showIcon && <div className="skeleton-icon skeleton-pulse" />}
      <div className="skeleton-content">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="skeleton-line skeleton-pulse"
            style={{ width: i === 0 ? '60%' : i === lines - 1 ? '40%' : '80%' }}
          />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table__head">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="skeleton-cell skeleton-pulse" style={{ width: '70%' }} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="skeleton-table__row">
          {Array.from({ length: cols }).map((_, col) => (
            <div
              key={col}
              className="skeleton-cell skeleton-pulse"
              style={{ width: `${50 + Math.random() * 30}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ height = 200 }: { height?: number }) {
  return <div className="skeleton-chart skeleton-pulse" style={{ height }} />;
}
