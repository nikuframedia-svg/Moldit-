/** Shell — 5 pages, NavBar on top, StatusBar on bottom.
 *
 * 5 Paginas. Tudo.
 */

import { T } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";
import { NavBar } from "./NavBar";
import { StatusBar } from "./StatusBar";
import { ChatPanel } from "./ChatPanel";
import { UploadZone } from "./ui/UploadZone";
import InicioPage from "../pages/InicioPage";
import MoldesPage from "../pages/MoldesPage";
import EquipaPage from "../pages/EquipaPage";
import ConfigPage2 from "../pages/ConfigPage2";
import RegrasPage from "../pages/RegrasPage";

function PageContent() {
  const page = useAppStore((s) => s.activePage);
  switch (page) {
    case "inicio":
      return <InicioPage />;
    case "moldes":
      return <MoldesPage />;
    case "equipa":
      return <EquipaPage />;
    case "config":
      return <ConfigPage2 />;
    case "regras":
      return <RegrasPage />;
    default:
      return <InicioPage />;
  }
}

export function Shell() {
  const hasData = useAppStore((s) => s.hasData);
  const chatOpen = useAppStore((s) => s.chatOpen);
  const toggleChat = useAppStore((s) => s.toggleChat);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: T.bg,
        color: T.primary,
        fontFamily: T.sans,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* NavBar — 5 buttons, always visible */}
      <NavBar />

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <main style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {hasData ? <PageContent /> : <UploadZone />}
        </main>

        {/* Chat panel */}
        {chatOpen && <ChatPanel />}
      </div>

      {/* StatusBar — linha 23 AS/400 */}
      <StatusBar />

      {/* Copilot toggle — floating bottom-right */}
      <button
        onClick={toggleChat}
        style={{
          position: "fixed",
          bottom: 52,
          right: 20,
          padding: "10px 18px",
          borderRadius: 24,
          border: "none",
          background: chatOpen ? T.blue : T.elevated,
          color: chatOpen ? "#fff" : T.secondary,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
          boxShadow: "0 2px 12px rgba(0,0,0,0.3)",
          zIndex: 100,
        }}
      >
        {chatOpen ? "Fechar Copilot" : "Copilot"}
      </button>
    </div>
  );
}
