import './HeatmapLegend.css';

const BANDS = [
  { label: '0%', color: 'rgba(255,255,255,0.03)', desc: 'Inactivo' },
  { label: '0–30%', color: 'rgba(20,184,166,0.15)', desc: 'Baixa' },
  { label: '30–60%', color: 'rgba(20,184,166,0.25)', desc: 'Normal' },
  { label: '60–85%', color: 'rgba(245,158,11,0.25)', desc: 'Elevada' },
  { label: '85–100%', color: 'rgba(245,158,11,0.40)', desc: 'Alta' },
  { label: '>100%', color: 'rgba(239,68,68,0.35)', desc: 'Excesso' },
];

/**
 * Legenda horizontal para heatmaps de utilização.
 * Mostra as 6 bandas de cor com labels descritivos.
 */
export function HeatmapLegend() {
  return (
    <div className="heatmap-legend" data-testid="heatmap-legend">
      <span className="heatmap-legend__label">Utilização:</span>
      {BANDS.map((b) => (
        <div className="heatmap-legend__item" key={b.label}>
          <span className="heatmap-legend__swatch" style={{ background: b.color }} />
          <span className="heatmap-legend__text">{b.desc}</span>
          <span className="heatmap-legend__range">{b.label}</span>
        </div>
      ))}
    </div>
  );
}
