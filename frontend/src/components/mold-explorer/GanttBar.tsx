import React from "react";
import { T } from "../../theme/tokens";
import type { ExplorerOp } from "../../api/types";

const FLEX_COLORS: Record<string, string> = {
  verde: T.green,
  azul: T.blue,
  laranja: T.orange,
  vermelho: T.red,
  cinzento: T.tertiary,
};

interface Props {
  op: ExplorerOp;
  left: number;
  width: number;
  selected: boolean;
  onClick: () => void;
}

export const GanttBar = React.memo(function GanttBar({ op, left, width, selected, onClick }: Props) {
  const color = FLEX_COLORS[op.flexibilidade] ?? T.blue;
  const barWidth = Math.max(width, 16);

  return (
    <div
      data-testid={`gantt-bar-${op.op_id}`}
      onClick={onClick}
      style={{
        position: "absolute",
        left,
        width: barWidth,
        height: 20,
        background: `${color}${selected ? "55" : "33"}`,
        border: `1.5px solid ${color}`,
        borderRadius: 4,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        padding: "0 4px",
        overflow: "hidden",
        transition: "all 0.15s",
        boxShadow: selected ? `0 0 0 2px ${color}44` : "none",
        zIndex: selected ? 10 : 1,
      }}
      title={`Op ${op.op_id} | ${op.nome} | ${op.work_h}h | Slack: ${op.slack_h}h`}
    >
      {/* Setup overlay */}
      {op.setup_h > 0 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min((op.setup_h / (op.work_h + op.setup_h)) * 100, 30)}%`,
            background: `${color}22`,
            borderRight: `1px dashed ${color}66`,
          }}
        />
      )}
      <span
        style={{
          fontSize: 8,
          color: T.primary,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          position: "relative",
          zIndex: 1,
        }}
      >
        {op.nome}
      </span>
    </div>
  );
});
