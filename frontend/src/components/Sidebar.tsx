/** Sidebar — 8 paginas, Trust widget, teclas F1-F8.
 *
 * Estilo INCOMPOLINHO: 200px fixa a esquerda, sempre visivel.
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";
import { useDataStore } from "../stores/useDataStore";
import { ProgressBar } from "./ui/ProgressBar";

const NAV = [
  { id: "consola", label: "Consola", sub: "Estado da fabrica", key: "F1" },
  { id: "producao", label: "Producao", sub: "Gantt global", key: "F2" },
  { id: "moldes", label: "Moldes", sub: "Explorador de molde", key: "F3" },
  { id: "risco", label: "Risco", sub: "O que pode correr mal", key: "F4" },
  { id: "alertas", label: "Alertas", sub: "Problemas activos", key: "" },
  { id: "simulador", label: "Simulador", sub: "E se...?", key: "F5" },
  { id: "equipa", label: "Equipa", sub: "Quem faz o que", key: "F6" },
  { id: "config", label: "Config", sub: "Parametros", key: "F7" },
  { id: "regras", label: "Regras", sub: "Como funciona", key: "F8" },
] as const;

export function Sidebar() {
  const page = useAppStore((s) => s.activePage);
  const setPage = useAppStore((s) => s.setPage);
  const hasData = useAppStore((s) => s.hasData);
  const deadlines = useDataStore((s) => s.deadlines);
  const [trustScore, setTrustScore] = useState<number | null>(null);
  const [alertCriticoCount, setAlertCriticoCount] = useState(0);

  // Fetch trust index
  useEffect(() => {
    if (!hasData) return;
    fetch("/api/data/trust")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.score != null) setTrustScore(d.score); })
      .catch(() => {});
  }, [hasData]);

  // Fetch alert stats for badge
  useEffect(() => {
    if (!hasData) return;
    fetch("/api/alerts/stats")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.por_severidade?.critico != null) setAlertCriticoCount(d.por_severidade.critico); })
      .catch(() => {});
  }, [hasData]);

  // F1-F8 keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const idx = parseInt(e.key.replace("F", ""), 10);
      if (idx >= 1 && idx <= 8 && e.key.startsWith("F")) {
        e.preventDefault();
        setPage(NAV[idx - 1].id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setPage]);

  // Badges
  const lateCount = deadlines.filter((d) => !d.on_time).length;
  const badges: Record<string, { count: number; color: string }> = {};
  if (lateCount > 0) badges.producao = { count: lateCount, color: T.orange };
  if (lateCount > 0) badges.risco = { count: lateCount, color: T.red };
  if (alertCriticoCount > 0) badges.alertas = { count: alertCriticoCount, color: T.red };

  return (
    <nav
      style={{
        width: 200,
        flexShrink: 0,
        background: T.card,
        borderRight: `0.5px solid ${T.border}`,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "20px 16px 16px" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.primary, letterSpacing: "-0.02em" }}>
          Moldit
        </div>
        <div style={{ fontSize: 11, color: T.tertiary, marginTop: 2 }}>Producao de Moldes</div>
      </div>

      {/* 8 nav items */}
      <div style={{ flex: 1, padding: "0 8px", display: "flex", flexDirection: "column", gap: 1, overflow: "auto" }}>
        {NAV.map((n, i) => {
          const active = page === n.id;
          const badge = badges[n.id];
          return (
            <button
              key={n.id}
              data-testid={`nav-${n.id}`}
              onClick={() => setPage(n.id)}
              style={{
                background: active ? `${T.blue}15` : "transparent",
                border: "none",
                borderLeft: active ? `3px solid ${T.blue}` : "3px solid transparent",
                borderRadius: 6,
                padding: "8px 10px",
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 8,
                position: "relative",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: active ? 600 : 400, color: active ? T.primary : T.secondary }}>
                  {n.label}
                </div>
                <div style={{ fontSize: 10, color: T.tertiary, marginTop: 1 }}>{n.sub}</div>
              </div>
              <span style={{ fontSize: 9, color: T.tertiary, fontFamily: T.mono }}>{n.key}</span>
              {badge && badge.count > 0 && (
                <span
                  style={{
                    position: "absolute", top: 4, right: 8,
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

      {/* Trust Index widget */}
      <div style={{ padding: "12px 16px", borderTop: `0.5px solid ${T.border}` }}>
        <div style={{ fontSize: 10, color: T.tertiary, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Indice de confianca
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 22, fontWeight: 700, fontFamily: T.mono,
            color: trustScore == null ? T.tertiary : trustScore >= 80 ? T.green : trustScore >= 50 ? T.orange : T.red,
          }}>
            {trustScore != null ? trustScore : "--"}
          </span>
          <div style={{ flex: 1 }}>
            <ProgressBar
              value={trustScore ?? 0}
              color={trustScore == null ? T.tertiary : trustScore >= 80 ? T.green : trustScore >= 50 ? T.orange : T.red}
              height={4}
            />
          </div>
        </div>
      </div>
    </nav>
  );
}
