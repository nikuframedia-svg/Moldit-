/** HeaderStrip — 48px topo, titulo + metricas + accoes.
 *
 * Mostra: pagina activa, % prazos, % ocupacao, botoes accao.
 */

import { T } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";
import { useDataStore } from "../stores/useDataStore";

const PAGE_TITLES: Record<string, string> = {
  consola: "Consola",
  producao: "Producao",
  moldes: "Moldes",
  risco: "Risco",
  simulador: "Simulador",
  equipa: "Equipa",
  config: "Configuracao",
  regras: "Regras",
};

export function HeaderStrip() {
  const page = useAppStore((s) => s.activePage);
  const hasData = useAppStore((s) => s.hasData);
  const toggleChat = useAppStore((s) => s.toggleChat);
  const chatOpen = useAppStore((s) => s.chatOpen);
  const setStatus = useAppStore((s) => s.setStatus);
  const score = useDataStore((s) => s.score);
  const refreshAll = useDataStore((s) => s.refreshAll);

  const compliance = score?.deadline_compliance ?? 0;
  const avgUtil = score?.utilization
    ? Object.values(score.utilization).reduce((a, b) => a + b, 0) / Math.max(Object.keys(score.utilization).length, 1)
    : 0;

  const handleRecalc = async () => {
    setStatus("warning", "A recalcular plano...");
    try {
      const { recalculate } = await import("../api/endpoints");
      await recalculate();
      await refreshAll();
      setStatus("ok", "Plano recalculado com sucesso.");
    } catch (e: any) {
      setStatus("error", e.message ?? "Erro ao recalcular.");
    }
  };

  const handleRefresh = async () => {
    setStatus("warning", "A actualizar dados...");
    try {
      await refreshAll();
      setStatus("ok", "Dados actualizados.");
    } catch {
      setStatus("error", "Erro ao actualizar.");
    }
  };

  return (
    <header
      style={{
        height: 48,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        padding: "0 20px",
        borderBottom: `0.5px solid ${T.border}`,
        background: T.card,
        gap: 16,
      }}
    >
      {/* Page title */}
      <div style={{ fontSize: 15, fontWeight: 700, color: T.primary, minWidth: 120 }}>
        {PAGE_TITLES[page] || page}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Global metrics */}
      {hasData && (
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: compliance >= 0.9 ? T.green : compliance >= 0.7 ? T.orange : T.red }} />
            <span style={{ fontSize: 12, color: T.secondary }}>
              Prazos <span style={{ fontWeight: 600, color: T.primary, fontFamily: T.mono }}>{Math.round(compliance * 100)}%</span>
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: avgUtil > 90 ? T.red : avgUtil > 70 ? T.orange : T.green }} />
            <span style={{ fontSize: 12, color: T.secondary }}>
              Ocupacao <span style={{ fontWeight: 600, color: T.primary, fontFamily: T.mono }}>{Math.round(avgUtil)}%</span>
            </span>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 6 }}>
        {hasData && (
          <>
            <HeaderButton label="Actualizar" onClick={handleRefresh} />
            <HeaderButton label="Recalcular" onClick={handleRecalc} primary />
          </>
        )}
        <HeaderButton
          label={chatOpen ? "Fechar" : "Copilot"}
          onClick={toggleChat}
          active={chatOpen}
        />
      </div>
    </header>
  );
}

function HeaderButton({ label, onClick, primary, active }: {
  label: string; onClick: () => void; primary?: boolean; active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        borderRadius: 6,
        border: primary ? "none" : `1px solid ${T.border}`,
        background: primary ? T.blue : active ? `${T.blue}15` : "transparent",
        color: primary ? "#fff" : active ? T.blue : T.secondary,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}
