/** StatusBar — barra fixa 32px no fundo (estilo linha 23 AS/400).
 *
 * Mostra a ultima accao, warning ou erro. Nunca desaparece.
 * Cor: verde (ok), amarelo (a processar), vermelho (erro).
 */

import { T as TH } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";

export function StatusBar() {
  const msg = useAppStore((s) => s.statusMsg);
  const level = useAppStore((s) => s.statusLevel);
  const ts = useAppStore((s) => s.statusTime);

  const bg =
    level === "error" ? TH.red
    : level === "warning" ? TH.orange
    : level === "ok" ? TH.green
    : TH.border;

  const color =
    level === "idle" ? TH.tertiary : "#000";

  return (
    <div
      style={{
        height: 32,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        background: bg,
        color,
        fontSize: 12,
        fontFamily: TH.mono,
        fontWeight: 500,
        borderTop: `0.5px solid ${TH.border}`,
      }}
    >
      <span>{msg || "Pronto."}</span>
      {ts && (
        <span style={{ opacity: 0.7 }}>
          {ts}
        </span>
      )}
    </div>
  );
}
