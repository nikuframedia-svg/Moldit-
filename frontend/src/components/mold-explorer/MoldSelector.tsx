import { T } from "../../theme/tokens";
import { useDataStore } from "../../stores/useDataStore";
import { useMoldExplorerStore } from "../../stores/useMoldExplorerStore";
import { ProgressBar } from "../ui/ProgressBar";

export function MoldSelector() {
  const moldes = useDataStore((s) => s.moldes);
  const selectedMoldeId = useMoldExplorerStore((s) => s.selectedMoldeId);
  const explorerData = useMoldExplorerStore((s) => s.explorerData);
  const selectMolde = useMoldExplorerStore((s) => s.selectMolde);
  const loadingExplorer = useMoldExplorerStore((s) => s.loadingExplorer);

  const molde = explorerData?.molde;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <select
        value={selectedMoldeId ?? ""}
        onChange={(e) => e.target.value && selectMolde(e.target.value)}
        style={{
          background: T.elevated,
          border: `0.5px solid ${T.border}`,
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 12,
          color: T.primary,
          fontFamily: "ui-monospace, monospace",
          outline: "none",
          cursor: "pointer",
          minWidth: 160,
        }}
      >
        <option value="">Selecionar molde...</option>
        {moldes.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id} ({m.deadline})
          </option>
        ))}
      </select>

      {loadingExplorer && (
        <span style={{ fontSize: 11, color: T.tertiary }}>A carregar...</span>
      )}

      {molde && !loadingExplorer && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, flex: 1 }}>
          <div style={{ fontSize: 11, color: T.secondary }}>
            Deadline: <span style={{ color: T.primary, fontWeight: 600 }}>{molde.deadline}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 120 }}>
            <span style={{ fontSize: 10, color: T.tertiary }}>Progresso</span>
            <div style={{ width: 80 }}>
              <ProgressBar value={molde.progresso} />
            </div>
            <span style={{ fontSize: 10, color: T.secondary, fontFamily: "ui-monospace, monospace" }}>
              {molde.progresso.toFixed(0)}%
            </span>
          </div>
          <div style={{ fontSize: 11, color: T.tertiary }}>
            {explorerData.operacoes.length} ops
          </div>
          <div style={{
            fontSize: 10,
            padding: "2px 8px",
            borderRadius: 4,
            background: molde.status === "concluido" ? `${T.green}22` : molde.status === "por_iniciar" ? `${T.tertiary}22` : `${T.blue}22`,
            color: molde.status === "concluido" ? T.green : molde.status === "por_iniciar" ? T.tertiary : T.blue,
            fontWeight: 500,
          }}>
            {molde.status === "concluido" ? "Concluido" : molde.status === "por_iniciar" ? "Por iniciar" : "Em curso"}
          </div>
        </div>
      )}
    </div>
  );
}
