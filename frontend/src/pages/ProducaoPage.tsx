/** PRODUCAO — "Onde esta cada molde? Que maquinas trabalham em que?"
 *
 * Gantt global ecra inteiro + reordenacao + registar eventos + relatorios.
 * TODO: Expandir com drag-and-drop, tabela alternativa, navegador, relatorios.
 */

import { useState, useEffect } from "react";
import { T, moldeColor } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";
import { Card } from "../components/ui/Card";
import { ProgressBar } from "../components/ui/ProgressBar";

export default function ProducaoPage() {
  const segmentos = useDataStore((s) => s.segmentos);
  const stress = useDataStore((s) => s.stress);
  const score = useDataStore((s) => s.score);
  const navigateTo = useAppStore((s) => s.navigateTo);
  const pageContext = useAppStore((s) => s.pageContext);
  const [view, setView] = useState<"gantt" | "tabela">("gantt");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (pageContext?.machineId) setFilter(pageContext.machineId);
  }, [pageContext?.machineId]);

  // Group segments by machine
  const byMachine = new Map<string, typeof segmentos>();
  for (const seg of segmentos) {
    if (filter && !seg.maquina_id.toLowerCase().includes(filter.toLowerCase()) && !seg.molde.toLowerCase().includes(filter.toLowerCase())) continue;
    if (!byMachine.has(seg.maquina_id)) byMachine.set(seg.maquina_id, []);
    byMachine.get(seg.maquina_id)!.push(seg);
  }

  const maxDia = segmentos.length > 0 ? Math.max(...segmentos.map((s) => s.dia + 1)) : 30;
  const DAY_W = 28;
  const LANE_H = 36;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setView("gantt")}
            style={{ padding: "6px 14px", borderRadius: 6, border: view === "gantt" ? `1px solid ${T.blue}` : `1px solid ${T.border}`, background: view === "gantt" ? `${T.blue}15` : "transparent", color: view === "gantt" ? T.primary : T.secondary, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            Gantt
          </button>
          <button onClick={() => setView("tabela")}
            style={{ padding: "6px 14px", borderRadius: 6, border: view === "tabela" ? `1px solid ${T.blue}` : `1px solid ${T.border}`, background: view === "tabela" ? `${T.blue}15` : "transparent", color: view === "tabela" ? T.primary : T.secondary, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            Tabela
          </button>
        </div>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar maquina ou molde..."
          style={{ padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.elevated, color: T.primary, fontSize: 12, fontFamily: "inherit", width: 200 }}
        />
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: T.tertiary }}>
          {segmentos.length} segmentos | {byMachine.size} maquinas | {maxDia} dias
        </span>
      </div>

      {/* Gantt View */}
      {view === "gantt" ? (
        <div style={{ flex: 1, overflow: "auto", border: `1px solid ${T.border}`, borderRadius: T.radiusSm }}>
          <div style={{ position: "relative", minWidth: maxDia * DAY_W + 120 }}>
            {/* Day headers */}
            <div style={{ display: "flex", paddingLeft: 120, borderBottom: `1px solid ${T.border}`, position: "sticky", top: 0, background: T.card, zIndex: 2 }}>
              {Array.from({ length: Math.min(maxDia, 60) }, (_, i) => (
                <div key={i} style={{ width: DAY_W, textAlign: "center", fontSize: 9, color: T.tertiary, padding: "4px 0", borderRight: `1px solid ${T.border}` }}>
                  D{i + 1}
                </div>
              ))}
            </div>

            {/* Machine lanes */}
            {Array.from(byMachine.entries()).map(([machineId, segs]) => {
              const machineStress = stress.find((s) => s.maquina_id === machineId);
              return (
                <div key={machineId} style={{ display: "flex", height: LANE_H, borderBottom: `1px solid ${T.border}` }}>
                  {/* Label */}
                  <div style={{ width: 120, padding: "0 8px", display: "flex", alignItems: "center", gap: 4, flexShrink: 0, borderRight: `1px solid ${T.border}`, background: T.card }}>
                    <span style={{ fontSize: 11, fontFamily: T.mono, color: T.primary }}>{machineId}</span>
                    {machineStress && (
                      <span style={{ fontSize: 9, color: machineStress.stress_pct > 90 ? T.red : T.tertiary }}>
                        {Math.round(machineStress.stress_pct)}%
                      </span>
                    )}
                  </div>
                  {/* Bars */}
                  <div style={{ position: "relative", flex: 1, minWidth: maxDia * DAY_W }}>
                    {segs.map((seg, i) => (
                      <div
                        key={i}
                        onClick={() => navigateTo("moldes", { moldeId: seg.molde })}
                        title={`${seg.molde} | Op ${seg.op_id} | ${seg.duracao_h}h`}
                        style={{
                          position: "absolute",
                          left: seg.dia * DAY_W,
                          top: 4,
                          width: Math.max(seg.duracao_h / 16 * DAY_W, 4),
                          height: LANE_H - 8,
                          background: moldeColor(seg.molde),
                          borderRadius: 3,
                          opacity: 0.85,
                          cursor: "pointer",
                          fontSize: 8,
                          color: "#fff",
                          overflow: "hidden",
                          padding: "0 2px",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        {seg.duracao_h >= 8 ? seg.molde : ""}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Table View */
        <div style={{ flex: 1, overflow: "auto" }}>
          <Card style={{ padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Op", "Molde", "Maquina", "Dia", "Inicio", "Duracao", "Setup"].map((h) => (
                    <th key={h} style={{ fontSize: 11, color: T.tertiary, padding: "8px 10px", textAlign: "left", borderBottom: `1px solid ${T.border}`, background: T.card, position: "sticky", top: 0 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {segmentos.filter((s) => !filter || s.maquina_id.includes(filter) || s.molde.includes(filter)).map((seg, i) => (
                  <tr key={i} onClick={() => navigateTo("moldes", { moldeId: seg.molde })} style={{ cursor: "pointer" }}>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: T.mono, borderBottom: `1px solid ${T.border}20` }}>{seg.op_id}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}20` }}>
                      <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: moldeColor(seg.molde), marginRight: 6 }} />
                      {seg.molde}
                    </td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: T.mono, borderBottom: `1px solid ${T.border}20` }}>{seg.maquina_id}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: T.mono, borderBottom: `1px solid ${T.border}20` }}>D{seg.dia + 1}</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: T.mono, borderBottom: `1px solid ${T.border}20` }}>{seg.inicio_h.toFixed(1)}h</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: T.mono, borderBottom: `1px solid ${T.border}20` }}>{seg.duracao_h.toFixed(1)}h</td>
                    <td style={{ padding: "6px 10px", fontSize: 12, fontFamily: T.mono, color: T.tertiary, borderBottom: `1px solid ${T.border}20` }}>{seg.setup_h.toFixed(1)}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
