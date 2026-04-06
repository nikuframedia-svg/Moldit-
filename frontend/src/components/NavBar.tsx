/** NavBar — 4 big buttons, always visible at the top.
 *
 * Badges: alertas (inicio), moldes em risco (moldes), conflitos (equipa).
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";
import { useDataStore } from "../stores/useDataStore";
import { getConsole, getWorkforceConflicts } from "../api/endpoints";

const NAV = [
  { id: "inicio", label: "Inicio", sub: "Como esta a fabrica" },
  { id: "moldes", label: "Moldes", sub: "Os meus moldes" },
  { id: "equipa", label: "Equipa", sub: "Quem faz o que" },
  { id: "config", label: "Config", sub: "Mudar algo" },
] as const;

export function NavBar() {
  const page = useAppStore((s) => s.activePage);
  const setPage = useAppStore((s) => s.setPage);
  const hasData = useAppStore((s) => s.hasData);
  const deadlines = useDataStore((s) => s.deadlines);
  const [alertCount, setAlertCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);

  // Fetch badge counts
  useEffect(() => {
    if (!hasData) return;
    getConsole(0).then((cd) => {
      setAlertCount((cd?.actions || []).filter((a: any) => a.severity === "critical").length);
    }).catch(() => {});
    getWorkforceConflicts(1).then((c) => {
      setConflictCount(c.length);
    }).catch(() => {});
  }, [hasData]);

  const lateCount = deadlines.filter((d) => !d.on_time).length;

  const badges: Record<string, { count: number; color: string }> = {};
  if (alertCount > 0) badges.inicio = { count: alertCount, color: T.red };
  if (lateCount > 0) badges.moldes = { count: lateCount, color: T.orange };
  if (conflictCount > 0) badges.equipa = { count: conflictCount, color: T.orange };

  return (
    <nav
      style={{
        display: "flex",
        height: 56,
        borderBottom: `0.5px solid ${T.border}`,
        background: T.card,
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div style={{ width: 140, display: "flex", alignItems: "center", paddingLeft: 20, flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.primary, letterSpacing: "-0.02em" }}>
          Moldit
        </span>
      </div>

      {/* 4 buttons */}
      <div style={{ flex: 1, display: "flex", gap: 2 }}>
        {NAV.map((n) => {
          const active = page === n.id;
          const badge = badges[n.id];
          return (
            <button
              key={n.id}
              data-testid={`nav-${n.id}`}
              onClick={() => setPage(n.id)}
              style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 2,
                background: "transparent", border: "none",
                borderBottom: active ? `2px solid ${T.blue}` : "2px solid transparent",
                cursor: "pointer", padding: "4px 8px", position: "relative",
                fontFamily: "inherit",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: active ? 700 : 500, color: active ? T.primary : T.secondary }}>
                {n.label}
              </span>
              <span style={{ fontSize: 10, color: T.tertiary }}>{n.sub}</span>
              {badge && badge.count > 0 && (
                <span
                  style={{
                    position: "absolute", top: 4, right: "calc(50% - 32px)",
                    background: badge.color, color: "#fff",
                    fontSize: 9, fontWeight: 700, borderRadius: 8,
                    padding: "1px 5px", minWidth: 16, textAlign: "center",
                  }}
                >
                  {badge.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
