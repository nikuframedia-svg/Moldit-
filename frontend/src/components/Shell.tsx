/** Shell — 8 paginas, Sidebar esquerda, HeaderStrip topo, StatusBar fundo.
 *
 * Layout: Sidebar (200px) | HeaderStrip (48px) + conteudo + StatusBar (32px)
 */

import { T } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";
import { Sidebar } from "./Sidebar";
import { HeaderStrip } from "./HeaderStrip";
import { StatusBar } from "./StatusBar";
import { ChatPanel } from "./ChatPanel";
import { UploadZone } from "./ui/UploadZone";
import { lazy, Suspense } from "react";

// Lazy-load pages for code splitting
const ConsolaPage = lazy(() => import("../pages/ConsolaPage"));
const ProducaoPage = lazy(() => import("../pages/ProducaoPage"));
const MoldesPage = lazy(() => import("../pages/MoldesPage"));
const RiscoPage = lazy(() => import("../pages/RiscoPage"));
const SimuladorPage = lazy(() => import("../pages/SimuladorPage"));
const EquipaPage = lazy(() => import("../pages/EquipaPage"));
const ConfigPage2 = lazy(() => import("../pages/ConfigPage2"));
const RegrasPage = lazy(() => import("../pages/RegrasPage"));

function PageContent() {
  const page = useAppStore((s) => s.activePage);
  return (
    <Suspense fallback={<div style={{ padding: 24, color: T.secondary }}>A carregar...</div>}>
      {(() => {
        switch (page) {
          case "consola": return <ConsolaPage />;
          case "producao": return <ProducaoPage />;
          case "moldes": return <MoldesPage />;
          case "risco": return <RiscoPage />;
          case "simulador": return <SimuladorPage />;
          case "equipa": return <EquipaPage />;
          case "config": return <ConfigPage2 />;
          case "regras": return <RegrasPage />;
          default: return <ConsolaPage />;
        }
      })()}
    </Suspense>
  );
}

export function Shell() {
  const hasData = useAppStore((s) => s.hasData);
  const chatOpen = useAppStore((s) => s.chatOpen);

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
      {/* Sidebar — 200px, fixa a esquerda */}
      <Sidebar />

      {/* Main area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* HeaderStrip — 48px topo */}
        <HeaderStrip />

        {/* Content area */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <main style={{ flex: 1, overflow: "auto", padding: 24 }}>
            {hasData ? <PageContent /> : <UploadZone />}
          </main>

          {/* Chat panel — 360px lateral */}
          {chatOpen && <ChatPanel />}
        </div>

        {/* StatusBar — 32px fundo (AS/400 linha 23) */}
        <StatusBar />
      </div>
    </div>
  );
}
