/** Horizontal SHAP contribution bars. */

import { T } from "../../theme/tokens";
import type { ShapContribution } from "../../api/types";

interface Props {
  contributions: ShapContribution[];
  maxWidth?: number;
}

export default function ShapBars({ contributions, maxWidth = 300 }: Props) {
  if (contributions.length === 0) {
    return (
      <span style={{ color: T.secondary, fontSize: 12 }}>
        Sem explicacao disponivel
      </span>
    );
  }

  const maxAbs = Math.max(...contributions.map((c) => Math.abs(c.contribuicao_h)), 0.1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {contributions.map((c, i) => {
        const pct = (Math.abs(c.contribuicao_h) / maxAbs) * 100;
        const isPositive = c.contribuicao_h > 0;
        const color = isPositive ? T.orange : T.green;

        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: maxWidth * 0.5,
                fontSize: 11,
                color: T.secondary,
                textAlign: "right",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={c.descricao}
            >
              {c.feature}
            </div>
            <div
              style={{
                flex: 1,
                height: 16,
                background: T.elevated,
                borderRadius: 4,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: isPositive ? "50%" : `${50 - pct / 2}%`,
                  width: `${pct / 2}%`,
                  height: "100%",
                  background: color,
                  borderRadius: 4,
                  transition: "width 0.3s",
                }}
              />
            </div>
            <div
              style={{
                width: 50,
                fontSize: 11,
                fontFamily: T.mono,
                color: color,
                textAlign: "right",
              }}
            >
              {isPositive ? "+" : ""}
              {c.contribuicao_h.toFixed(1)}h
            </div>
          </div>
        );
      })}
    </div>
  );
}
