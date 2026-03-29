import { useState } from "react";
import { T } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";
import { useDataStore } from "../stores/useDataStore";
import { recalculate } from "../api/endpoints";
import { TH } from "../constants/thresholds";
import { Sidebar } from "./Sidebar";
import { ChatPanel } from "./ChatPanel";
import { UploadZone } from "./ui/UploadZone";
import { ConsolePage } from "../pages/ConsolePage";
import { GanttPage } from "../pages/GanttPage";
import { DeadlinesPage } from "../pages/DeadlinesPage";
import { RiskPage } from "../pages/RiskPage";
import { SimulatorPage } from "../pages/SimulatorPage";
import { ConfigPage } from "../pages/ConfigPage";
import { JournalPage } from "../pages/JournalPage";

const NAV_LABELS: Record<string, string> = {
  console: "Consola",
  gantt: "Producao",
  deadlines: "Prazos",
  risk: "Risco",
  sim: "Simulador",
  config: "Configuracao",
  journal: "Journal",
};

function PageContent() {
  const page = useAppStore((s) => s.activePage);
  switch (page) {
    case "console": return <ConsolePage />;
    case "gantt": return <GanttPage />;
    case "deadlines": return <DeadlinesPage />;
    case "risk": return <RiskPage />;
    case "sim": return <SimulatorPage />;
    case "config": return <ConfigPage />;
    case "journal": return <JournalPage />;
    default: return <ConsolePage />;
  }
}

export function Shell() {
  const hasData = useAppStore((s) => s.hasData);
  const chatOpen = useAppStore((s) => s.chatOpen);
  const toggleChat = useAppStore((s) => s.toggleChat);
  const page = useAppStore((s) => s.activePage);
  const score = useDataStore((s) => s.score);
  const refreshAll = useDataStore((s) => s.refreshAll);
  const [recalcing, setRecalcing] = useState(false);

  const handleRecalc = async () => {
    setRecalcing(true);
    try {
      await recalculate();
      await refreshAll();
    } catch (err) { console.error("Recalculate failed:", err); }
    setRecalcing(false);
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        background: T.bg,
        color: T.primary,
        fontFamily: T.sans,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <Sidebar />

      <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header
          style={{
            height: 48,
            padding: "0 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `0.5px solid ${T.border}`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: T.primary }}>{NAV_LABELS[page] || page}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            {hasData && score && (
              <div style={{ display: "flex", gap: 12 }}>
                <span style={{ fontSize: 11, color: (score.deadline_compliance ?? 0) >= TH.COMPLIANCE_GREEN ? T.green : T.orange, fontFamily: T.mono, fontWeight: 500 }}>
                  Compliance {score.deadline_compliance?.toFixed(1)}%
                </span>
                <span style={{ fontSize: 11, color: T.primary, fontFamily: T.mono, fontWeight: 500 }}>
                  Makespan {score.makespan_total_dias}d
                </span>
              </div>
            )}
            {hasData && (
              <>
                <button
                  onClick={() => refreshAll()}
                  title="Actualizar dados"
                  style={{
                    background: "transparent",
                    border: `0.5px solid ${T.border}`,
                    color: T.secondary,
                    borderRadius: 8,
                    padding: "5px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                >
                  Refresh
                </button>
                <button
                  onClick={handleRecalc}
                  disabled={recalcing}
                  title="Recalcular schedule"
                  style={{
                    background: "transparent",
                    border: `0.5px solid ${T.border}`,
                    color: recalcing ? T.tertiary : T.secondary,
                    borderRadius: 8,
                    padding: "5px 10px",
                    cursor: recalcing ? "default" : "pointer",
                    fontSize: 11,
                    fontFamily: "inherit",
                  }}
                >
                  {recalcing ? "..." : "Recalcular"}
                </button>
              </>
            )}
            <button
              onClick={toggleChat}
              style={{
                background: chatOpen ? `${T.blue}18` : "transparent",
                border: `0.5px solid ${chatOpen ? `${T.blue}44` : T.border}`,
                color: chatOpen ? T.blue : T.secondary,
                borderRadius: 8,
                padding: "5px 12px",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 500,
                fontFamily: "inherit",
              }}
            >
              Copilot
            </button>
          </div>
        </header>

        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {hasData ? <PageContent /> : <UploadZone />}
        </div>
      </main>

      {chatOpen && <ChatPanel />}
    </div>
  );
}
