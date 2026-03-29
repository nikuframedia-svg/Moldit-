import React from "react";
import { T } from "../../theme/tokens";

interface CascadeItem {
  op_id: number;
  molde: string;
  efeito: string;
  severidade: string;
}

interface Props {
  items: CascadeItem[];
}

const SEV_COLOR: Record<string, string> = {
  alto: T.red,
  medio: T.orange,
  baixo: T.green,
};

export const CascadeList = React.memo(function CascadeList({ items }: Props) {
  if (!items.length) {
    return (
      <div style={{ fontSize: 11, color: T.tertiary, padding: "8px 0" }}>
        Sem efeitos em cascata.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.secondary, marginBottom: 4 }}>
        Efeitos em cascata ({items.length})
      </div>
      {items.map((item) => (
        <div
          key={item.op_id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 8px",
            background: T.elevated,
            borderRadius: 6,
            fontSize: 11,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: SEV_COLOR[item.severidade] ?? T.tertiary,
              flexShrink: 0,
            }}
          />
          <span style={{ color: T.secondary, fontFamily: "ui-monospace, monospace" }}>
            Op {item.op_id}
          </span>
          <span style={{ color: T.tertiary }}>{item.molde}</span>
          <span style={{ color: T.primary, marginLeft: "auto" }}>{item.efeito}</span>
        </div>
      ))}
    </div>
  );
});
