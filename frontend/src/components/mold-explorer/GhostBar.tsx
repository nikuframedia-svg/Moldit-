import React from "react";
import { T } from "../../theme/tokens";
import type { GhostOp } from "../../api/types";

interface Props {
  ghost: GhostOp;
  left: number;
  width: number;
}

export const GhostBar = React.memo(function GhostBar({ ghost, left, width }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        width: Math.max(width, 8),
        height: 14,
        background: "rgba(255,255,255,0.06)",
        border: `1px dashed rgba(255,255,255,0.12)`,
        borderRadius: 3,
        top: 24,
        display: "flex",
        alignItems: "center",
        padding: "0 3px",
        overflow: "hidden",
        pointerEvents: "auto",
      }}
      title={`${ghost.molde} | Op ${ghost.op_id} | ${ghost.inicio_h.toFixed(1)}-${ghost.fim_h.toFixed(1)}h`}
    >
      <span style={{ fontSize: 7, color: T.tertiary, whiteSpace: "nowrap" }}>
        {ghost.molde}
      </span>
    </div>
  );
});
