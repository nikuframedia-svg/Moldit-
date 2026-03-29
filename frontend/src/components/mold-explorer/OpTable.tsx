import { T } from "../../theme/tokens";
import { useMoldExplorerStore } from "../../stores/useMoldExplorerStore";
import type { ExplorerOp } from "../../api/types";

const FLEX_COLORS: Record<string, string> = {
  verde: T.green,
  azul: T.blue,
  laranja: T.orange,
  vermelho: T.red,
  cinzento: T.tertiary,
};

const FLEX_LABELS: Record<string, string> = {
  verde: "Flexivel",
  azul: "Fixo",
  laranja: "Critico c/ alt.",
  vermelho: "Critico",
  cinzento: "Concluido",
};

export function OpTable() {
  const explorerData = useMoldExplorerStore((s) => s.explorerData);
  const selectedOpId = useMoldExplorerStore((s) => s.selectedOpId);
  const selectOp = useMoldExplorerStore((s) => s.selectOp);

  if (!explorerData) return null;

  const ops = [...explorerData.operacoes].sort((a, b) => {
    if (a.dia !== b.dia) return a.dia - b.dia;
    return a.inicio_h - b.inicio_h;
  });

  return (
    <div style={{ overflow: "auto", maxHeight: 300 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 11,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        <thead>
          <tr style={{ borderBottom: `1px solid ${T.border}` }}>
            {["Op", "Nome", "Maquina", "Dia", "Inicio", "Duracao", "Slack", "Flex"].map((h) => (
              <th
                key={h}
                style={{
                  textAlign: "left",
                  padding: "6px 8px",
                  fontSize: 10,
                  fontWeight: 600,
                  color: T.tertiary,
                  textTransform: "uppercase",
                  position: "sticky",
                  top: 0,
                  background: T.card,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ops.map((op: ExplorerOp) => {
            const isSelected = op.op_id === selectedOpId;
            const flexColor = FLEX_COLORS[op.flexibilidade] ?? T.tertiary;
            return (
              <tr
                key={op.op_id}
                onClick={() => selectOp(op.op_id)}
                style={{
                  borderBottom: `1px solid ${T.border}`,
                  background: isSelected ? `${T.blue}11` : "transparent",
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
              >
                <td style={{ padding: "5px 8px", color: T.secondary }}>{op.op_id}</td>
                <td style={{ padding: "5px 8px", color: T.primary }}>{op.nome}</td>
                <td style={{ padding: "5px 8px", color: T.secondary }}>{op.maquina}</td>
                <td style={{ padding: "5px 8px", color: T.secondary }}>{op.dia}</td>
                <td style={{ padding: "5px 8px", color: T.secondary }}>{op.inicio_h.toFixed(1)}h</td>
                <td style={{ padding: "5px 8px", color: T.secondary }}>{op.work_h.toFixed(1)}h</td>
                <td style={{ padding: "5px 8px", color: op.slack_h > 0 ? T.green : T.tertiary }}>
                  {op.slack_h.toFixed(1)}h
                </td>
                <td style={{ padding: "5px 8px" }}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: `${flexColor}18`,
                      border: `1px solid ${flexColor}44`,
                      borderRadius: 4,
                      padding: "1px 6px",
                      fontSize: 9,
                      color: flexColor,
                      fontWeight: 500,
                    }}
                  >
                    {FLEX_LABELS[op.flexibilidade] ?? op.flexibilidade}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
