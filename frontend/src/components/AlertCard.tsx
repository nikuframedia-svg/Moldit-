/** AlertCard — O QUÊ + PORQUE + IMPACTO + AÇÃO.
 *
 * Each alert follows the 4-part pattern from Simplicidade Radical.
 */

import { T } from "../theme/tokens";
import { Card } from "./ui/Card";

interface AlertOption {
  texto: string;
  endpoint?: string;
}

interface Props {
  titulo: string;
  porque: string;
  impacto: string;
  opcoes: AlertOption[];
  severidade: string;
  onAction?: (endpoint: string) => void;
}

export function AlertCard({
  titulo,
  porque,
  impacto,
  opcoes,
  severidade,
  onAction,
}: Props) {
  const color = severidade === "critical" ? T.red : T.orange;

  return (
    <Card style={{ borderLeft: `3px solid ${color}` }}>
      {/* O QUÊ */}
      <div style={{ fontSize: 14, fontWeight: 600, color: T.primary, marginBottom: 6 }}>
        {titulo}
      </div>

      {/* PORQUE */}
      {porque && (
        <div style={{ fontSize: 13, color: T.secondary, marginBottom: 4, lineHeight: 1.5 }}>
          {porque}
        </div>
      )}

      {/* IMPACTO */}
      {impacto && (
        <div style={{ fontSize: 12, color: T.orange, marginBottom: 8, lineHeight: 1.4 }}>
          {impacto}
        </div>
      )}

      {/* AÇÕES */}
      {opcoes.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {opcoes.map((opt, i) => (
            <button
              key={i}
              onClick={() => onAction?.(opt.endpoint || "")}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: i === 0 ? "none" : `1px solid ${T.border}`,
                background: i === 0 ? T.blue : "transparent",
                color: i === 0 ? "#fff" : T.secondary,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {opt.texto}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
