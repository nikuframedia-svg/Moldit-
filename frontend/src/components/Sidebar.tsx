import { T } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";

const NAV = [
  { id: "console", label: "Consola" },
  { id: "gantt", label: "Producao" },
  { id: "deadlines", label: "Prazos" },
  { id: "risk", label: "Risco" },
  { id: "sim", label: "Simulador" },
  { id: "config", label: "Configuracao" },
  { id: "journal", label: "Journal" },
];

export function Sidebar() {
  const page = useAppStore((s) => s.activePage);
  const setPage = useAppStore((s) => s.setPage);

  return (
    <nav
      style={{
        width: 200,
        flexShrink: 0,
        background: T.card,
        borderRight: `0.5px solid ${T.border}`,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "20px 20px 24px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.primary, letterSpacing: "-0.02em" }}>
          Moldit Planner
        </div>
        <div style={{ fontSize: 11, color: T.tertiary, marginTop: 2 }}>Producao de Moldes</div>
      </div>

      <div style={{ flex: 1, padding: "0 8px", display: "flex", flexDirection: "column", gap: 1 }}>
        {NAV.map((n) => {
          const active = page === n.id;
          return (
            <button
              key={n.id}
              data-testid={`nav-${n.id}`}
              onClick={() => setPage(n.id)}
              style={{
                background: active ? "rgba(255,255,255,0.06)" : "transparent",
                border: "none",
                borderRadius: 8,
                padding: "8px 12px",
                color: active ? T.primary : T.secondary,
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s",
                width: "100%",
                fontFamily: "inherit",
              }}
            >
              {n.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
