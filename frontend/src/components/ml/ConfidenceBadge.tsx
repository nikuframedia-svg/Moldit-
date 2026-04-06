/** Confidence badge with color-coded levels. */

import { T } from "../../theme/tokens";

interface Props {
  value: number; // 0.0 – 1.0
  size?: "sm" | "md";
}

export default function ConfidenceBadge({ value, size = "sm" }: Props) {
  let color: string;
  let label: string;

  if (value >= 0.8) {
    color = T.green;
    label = "Alta";
  } else if (value >= 0.5) {
    color = T.orange;
    label = "Media";
  } else if (value >= 0.2) {
    color = T.yellow;
    label = "Baixa";
  } else {
    color = T.red;
    label = "Muito baixa";
  }

  const fontSize = size === "sm" ? 10 : 12;
  const padding = size === "sm" ? "2px 6px" : "3px 8px";

  return (
    <span
      style={{
        display: "inline-block",
        padding,
        borderRadius: 6,
        fontSize,
        fontWeight: 600,
        color: T.bg,
        background: color,
        whiteSpace: "nowrap",
      }}
      title={`Confianca: ${(value * 100).toFixed(0)}%`}
    >
      {label} ({(value * 100).toFixed(0)}%)
    </span>
  );
}
