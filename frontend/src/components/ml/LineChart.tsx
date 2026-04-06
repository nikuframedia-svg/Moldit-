/** SVG Line Chart — evolution of ML metrics over time. */

import { T } from "../../theme/tokens";

interface Point {
  date: string;
  value: number;
}

interface Props {
  data: Point[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  formatY?: (v: number) => string;
}

export default function LineChart({
  data,
  width = 500,
  height = 200,
  color = T.blue,
  label = "",
  formatY = (v) => v.toFixed(2),
}: Props) {
  if (data.length < 2) {
    return (
      <div style={{ textAlign: "center", padding: 32, color: T.secondary }}>
        Dados insuficientes para grafico ({data.length} pontos)
      </div>
    );
  }

  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const values = data.map((d) => d.value);
  const yMin = Math.min(...values) * 0.9;
  const yMax = Math.max(...values) * 1.1 || 1;

  const xScale = (i: number) => pad.left + (i / (data.length - 1)) * w;
  const yScale = (v: number) =>
    pad.top + h - ((v - yMin) / (yMax - yMin)) * h;

  // Build SVG path
  const pathD = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xScale(i)} ${yScale(d.value)}`)
    .join(" ");

  // Fill area
  const areaD =
    pathD +
    ` L ${xScale(data.length - 1)} ${yScale(yMin)} L ${xScale(0)} ${yScale(yMin)} Z`;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = pad.top + h * (1 - f);
        const val = yMin + (yMax - yMin) * f;
        return (
          <g key={f}>
            <line
              x1={pad.left}
              x2={pad.left + w}
              y1={y}
              y2={y}
              stroke={T.border}
              strokeDasharray="4,4"
            />
            <text
              x={pad.left - 6}
              y={y + 4}
              fill={T.secondary}
              fontSize={10}
              textAnchor="end"
              fontFamily={T.mono}
            >
              {formatY(val)}
            </text>
          </g>
        );
      })}

      {/* Area fill */}
      <path d={areaD} fill={color} opacity={0.1} />

      {/* Line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} />

      {/* Points */}
      {data.map((d, i) => (
        <circle
          key={i}
          cx={xScale(i)}
          cy={yScale(d.value)}
          r={3}
          fill={color}
        >
          <title>
            {d.date}: {formatY(d.value)}
          </title>
        </circle>
      ))}

      {/* X-axis labels (first, middle, last) */}
      {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
        <text
          key={i}
          x={xScale(i)}
          y={height - 4}
          fill={T.secondary}
          fontSize={10}
          textAnchor="middle"
          fontFamily={T.mono}
        >
          {data[i]?.date ?? ""}
        </text>
      ))}

      {/* Label */}
      {label && (
        <text
          x={pad.left + w / 2}
          y={12}
          fill={T.primary}
          fontSize={11}
          textAnchor="middle"
          fontWeight="600"
        >
          {label}
        </text>
      )}
    </svg>
  );
}
