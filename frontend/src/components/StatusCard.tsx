/** StatusCard — number + phrase + color.
 *
 * One of the 4 cards on INICIO page.
 * Expandable on click (progressive disclosure).
 */

import { useState } from "react";
import { T } from "../theme/tokens";
import { Card } from "./ui/Card";

const COLOR_MAP: Record<string, string> = {
  green: T.green, verde: T.green,
  orange: T.orange, laranja: T.orange,
  red: T.red, vermelho: T.red,
};

interface Props {
  valor: string;
  frase: string;
  cor: string;
  detail?: string;
}

export function StatusCard({ valor, frase, cor, detail }: Props) {
  const [expanded, setExpanded] = useState(false);
  const color = COLOR_MAP[cor] || T.primary;

  return (
    <Card
      onClick={detail ? () => setExpanded(!expanded) : undefined}
      style={{
        cursor: detail ? "pointer" : "default",
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color,
          fontFamily: T.mono,
          lineHeight: 1.1,
        }}
      >
        {valor}
      </div>
      <div style={{ fontSize: 13, color: T.secondary, marginTop: 6, lineHeight: 1.5 }}>
        {frase}
      </div>
      {expanded && detail && (
        <div style={{ fontSize: 12, color: T.tertiary, marginTop: 8, lineHeight: 1.5 }}>
          {detail}
        </div>
      )}
    </Card>
  );
}
