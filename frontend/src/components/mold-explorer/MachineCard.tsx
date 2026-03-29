import React from "react";
import { T } from "../../theme/tokens";
import type { MachineOption } from "../../api/types";

interface Props {
  option: MachineOption;
  onHover: (opt: MachineOption | null) => void;
  onApply: (machine: string) => void;
}

export const MachineCard = React.memo(function MachineCard({ option, onHover, onApply }: Props) {
  const scoreDelta = option.impacto.score_delta;
  const isPositive = scoreDelta > 0;
  const isNegative = scoreDelta < 0;

  return (
    <div
      onMouseEnter={() => onHover(option)}
      onMouseLeave={() => onHover(null)}
      style={{
        background: T.elevated,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: 12,
        cursor: "pointer",
        transition: "all 0.15s",
        minWidth: 140,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: T.primary, marginBottom: 8, fontFamily: "ui-monospace, monospace" }}>
        {option.maquina}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
          <span style={{ color: T.tertiary }}>Makespan</span>
          <span style={{ color: option.impacto.makespan_delta > 0 ? T.red : option.impacto.makespan_delta < 0 ? T.green : T.tertiary }}>
            {option.impacto.makespan_delta > 0 ? "+" : ""}{option.impacto.makespan_delta}d
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
          <span style={{ color: T.tertiary }}>Setups</span>
          <span style={{ color: option.impacto.setups_delta > 0 ? T.red : option.impacto.setups_delta < 0 ? T.green : T.tertiary }}>
            {option.impacto.setups_delta > 0 ? "+" : ""}{option.impacto.setups_delta}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
          <span style={{ color: T.tertiary }}>Cascata</span>
          <span style={{ color: option.cascata.length > 0 ? T.orange : T.tertiary }}>
            {option.cascata.length}
          </span>
        </div>
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onApply(option.maquina); }}
        style={{
          width: "100%",
          background: isPositive ? `${T.green}22` : isNegative ? `${T.red}11` : `${T.blue}11`,
          border: `1px solid ${isPositive ? T.green : isNegative ? T.red : T.blue}44`,
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 10,
          fontWeight: 500,
          color: isPositive ? T.green : isNegative ? T.red : T.blue,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Aplicar
      </button>
    </div>
  );
});
