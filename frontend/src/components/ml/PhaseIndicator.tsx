/** Cold Start Phase Indicator. */

import { T } from "../../theme/tokens";

interface Props {
  phase: string;
  label: string;
  message: string;
}

const PHASE_COLORS: Record<string, string> = {
  zero: T.red,
  cold: T.orange,
  warm: T.yellow,
  stable: T.blue,
  mature: T.green,
};

const PHASE_ICONS: Record<string, string> = {
  zero: "0",
  cold: "1",
  warm: "2",
  stable: "3",
  mature: "4",
};

export default function PhaseIndicator({ phase, label, message }: Props) {
  const color = PHASE_COLORS[phase] ?? T.secondary;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        background: T.card,
        borderRadius: 10,
        border: `1px solid ${color}40`,
      }}
    >
      {/* Phase circle */}
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: `${color}20`,
          border: `2px solid ${color}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontWeight: 700,
          color,
          fontFamily: T.mono,
        }}
      >
        {PHASE_ICONS[phase] ?? "?"}
      </div>

      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: T.primary,
            marginBottom: 2,
          }}
        >
          Fase: {label}
        </div>
        <div style={{ fontSize: 11, color: T.secondary }}>{message}</div>
      </div>
    </div>
  );
}
