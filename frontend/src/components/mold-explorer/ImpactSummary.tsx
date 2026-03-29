import React from "react";
import { T } from "../../theme/tokens";

interface Props {
  impacto: {
    makespan_delta: number;
    compliance_delta: number;
    setups_delta: number;
    balance_delta: number;
    score_delta: number;
  };
}

function deltaColor(val: number, invert = false): string {
  const v = invert ? -val : val;
  if (v > 0) return T.green;
  if (v < 0) return T.red;
  return T.tertiary;
}

function formatDelta(val: number, suffix = ""): string {
  const sign = val > 0 ? "+" : "";
  return `${sign}${val}${suffix}`;
}

export const ImpactSummary = React.memo(function ImpactSummary({ impacto }: Props) {
  const kpis = [
    { label: "Makespan", value: impacto.makespan_delta, suffix: "d", invert: true },
    { label: "Compliance", value: Math.round(impacto.compliance_delta * 10000) / 100, suffix: "%", invert: false },
    { label: "Setups", value: impacto.setups_delta, suffix: "", invert: true },
    { label: "Score", value: Math.round(impacto.score_delta * 10000) / 100, suffix: "%", invert: false },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
      {kpis.map((kpi) => (
        <div
          key={kpi.label}
          style={{
            background: T.elevated,
            borderRadius: 8,
            padding: "8px 10px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 10, color: T.tertiary, marginBottom: 4 }}>{kpi.label}</div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "ui-monospace, monospace",
              color: deltaColor(kpi.value, kpi.invert),
            }}
          >
            {formatDelta(kpi.value, kpi.suffix)}
          </div>
        </div>
      ))}
    </div>
  );
});
