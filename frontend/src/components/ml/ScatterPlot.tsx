/** SVG Scatter Plot — .mpp estimated vs ML predicted vs actual. */

import { T } from "../../theme/tokens";

interface DataPoint {
  estimado: number;
  previsao: number;
  label?: string;
}

interface Props {
  data: DataPoint[];
  width?: number;
  height?: number;
}

export default function ScatterPlot({
  data,
  width = 400,
  height = 300,
}: Props) {
  if (data.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 32, color: T.secondary }}>
        Sem dados de previsao
      </div>
    );
  }

  const pad = { top: 20, right: 20, bottom: 40, left: 50 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const allVals = data.flatMap((d) => [d.estimado, d.previsao]);
  const maxVal = Math.max(...allVals) * 1.1 || 1;

  const scale = (v: number, dim: number) => (v / maxVal) * dim;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {/* Diagonal (perfect prediction) */}
      <line
        x1={pad.left}
        y1={pad.top + h}
        x2={pad.left + w}
        y2={pad.top}
        stroke={T.tertiary}
        strokeDasharray="6,4"
        strokeWidth={1}
      />

      {/* Axes */}
      <line
        x1={pad.left}
        y1={pad.top + h}
        x2={pad.left + w}
        y2={pad.top + h}
        stroke={T.border}
      />
      <line
        x1={pad.left}
        y1={pad.top}
        x2={pad.left}
        y2={pad.top + h}
        stroke={T.border}
      />

      {/* Points */}
      {data.map((d, i) => (
        <circle
          key={i}
          cx={pad.left + scale(d.estimado, w)}
          cy={pad.top + h - scale(d.previsao, h)}
          r={4}
          fill={T.blue}
          opacity={0.7}
        >
          <title>
            {d.label ?? `Op ${i}`}: estimado={d.estimado.toFixed(1)}h,
            ML={d.previsao.toFixed(1)}h
          </title>
        </circle>
      ))}

      {/* Axis labels */}
      <text
        x={pad.left + w / 2}
        y={height - 4}
        fill={T.secondary}
        fontSize={11}
        textAnchor="middle"
      >
        Estimado .mpp (h)
      </text>
      <text
        x={12}
        y={pad.top + h / 2}
        fill={T.secondary}
        fontSize={11}
        textAnchor="middle"
        transform={`rotate(-90, 12, ${pad.top + h / 2})`}
      >
        Previsao ML (h)
      </text>

      {/* Scale ticks */}
      {[0, 0.5, 1].map((f) => {
        const val = maxVal * f;
        return (
          <g key={f}>
            <text
              x={pad.left - 6}
              y={pad.top + h - scale(val, h) + 4}
              fill={T.secondary}
              fontSize={9}
              textAnchor="end"
              fontFamily={T.mono}
            >
              {val.toFixed(0)}
            </text>
            <text
              x={pad.left + scale(val, w)}
              y={pad.top + h + 14}
              fill={T.secondary}
              fontSize={9}
              textAnchor="middle"
              fontFamily={T.mono}
            >
              {val.toFixed(0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
