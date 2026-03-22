/**
 * SetupTableLegend — Color legend for setup time ranges.
 * Extracted from SetupTable to comply with 300-line component limit.
 */

const legendItems = [
  { color: 'var(--accent)', label: '<30 min' },
  { color: 'var(--semantic-amber)', label: '30-60 min' },
  { color: 'var(--semantic-red)', label: '>60 min' },
] as const;

export function SetupTableLegend() {
  return (
    <div
      style={{ marginTop: 12, display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)' }}
    >
      {legendItems.map((item) => (
        <span key={item.label}>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              background: item.color,
              marginRight: 4,
            }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}
