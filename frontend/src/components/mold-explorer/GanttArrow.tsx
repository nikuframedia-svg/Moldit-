import React from "react";
import { T } from "../../theme/tokens";

interface Props {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  critical: boolean;
  hasSlack: boolean;
}

export const GanttArrow = React.memo(function GanttArrow({ x1, y1, x2, y2, critical, hasSlack }: Props) {
  const color = critical ? T.red : hasSlack ? T.green : T.tertiary;
  const strokeWidth = critical ? 2 : 1;
  const dashArray = hasSlack ? "4,3" : "none";

  // Simple path: go right from source, bend down/up, go right to target
  const midX = (x1 + x2) / 2;
  const d = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={dashArray}
        opacity={0.7}
      />
      {/* Arrowhead */}
      <polygon
        points={`${x2},${y2} ${x2 - 5},${y2 - 3} ${x2 - 5},${y2 + 3}`}
        fill={color}
        opacity={0.7}
      />
    </g>
  );
});
