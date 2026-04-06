/** MoldHeader — mold summary with progress, deadline, and ML phrase. */

import { T } from "../theme/tokens";
import { ProgressBar } from "./ui/ProgressBar";
import { ExplainBox } from "./ExplainBox";

interface Props {
  moldeId: string;
  cliente: string;
  progresso: number;
  opsDone: number;
  opsTotal: number;
  deadlineFrase?: string;
  deadlineCor?: string;
  fraseResumo?: string;
  analogoFrase?: string;
}

export function MoldHeader({
  moldeId, cliente, progresso, opsDone, opsTotal,
  deadlineFrase, deadlineCor, fraseResumo, analogoFrase,
}: Props) {
  const cor = deadlineCor || "green";
  const colorMap: Record<string, string> = { green: T.green, orange: T.orange, red: T.red };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: T.primary }}>{moldeId}</span>
        {cliente && <span style={{ fontSize: 13, color: T.tertiary }}>{cliente}</span>}
      </div>

      <ProgressBar value={progresso} color={colorMap[cor] || T.green} />

      <div style={{ fontSize: 14, color: T.primary, lineHeight: 1.5 }}>
        {fraseResumo || `${opsDone} de ${opsTotal} operacoes feitas.`}
      </div>

      {deadlineFrase && (
        <ExplainBox headline={deadlineFrase} color={cor} />
      )}

      {analogoFrase && (
        <ExplainBox
          headline={analogoFrase}
          color="blue"
          source="Baseado no historico de moldes concluidos"
        />
      )}
    </div>
  );
}
