import { T } from "../../theme/tokens";

interface Props { children: React.ReactNode; color?: string }

export function Pill({ children, color = T.secondary }: Props) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 500,
        color,
        background: `${color}15`,
        letterSpacing: "0.01em",
      }}
    >
      {children}
    </span>
  );
}
