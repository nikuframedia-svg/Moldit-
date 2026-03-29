import React from "react";
import { T } from "../../theme/tokens";

interface Props {
  earliest: { dia: number; hora: number };
  latest: { dia: number; hora: number };
  atual: { dia: number; hora: number };
}

export const TimingSlider = React.memo(function TimingSlider({ earliest, latest, atual }: Props) {
  const eAbs = earliest.dia * 24 + earliest.hora;
  const lAbs = latest.dia * 24 + latest.hora;
  const aAbs = atual.dia * 24 + atual.hora;
  const range = lAbs - eAbs;

  if (range <= 0) {
    return (
      <div style={{ fontSize: 11, color: T.tertiary, padding: "8px 0" }}>
        Sem margem temporal (slack = 0).
      </div>
    );
  }

  const pct = Math.min(100, Math.max(0, ((aAbs - eAbs) / range) * 100));

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.secondary, marginBottom: 8 }}>
        Janela temporal
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.tertiary, marginBottom: 4 }}>
        <span>D{earliest.dia} {earliest.hora.toFixed(0)}h</span>
        <span>D{latest.dia} {latest.hora.toFixed(0)}h</span>
      </div>
      <div style={{ position: "relative", height: 8, background: T.elevated, borderRadius: 4 }}>
        {/* Slack range */}
        <div style={{ position: "absolute", inset: 0, background: `${T.green}22`, borderRadius: 4 }} />
        {/* Current position marker */}
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            top: -2,
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: T.blue,
            border: `2px solid ${T.primary}`,
            transform: "translateX(-50%)",
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: T.secondary, marginTop: 6, textAlign: "center" }}>
        Atual: Dia {atual.dia}, {atual.hora.toFixed(1)}h
      </div>
    </div>
  );
});
