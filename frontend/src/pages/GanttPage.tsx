import { useMemo, useState } from "react";
import { T, toolColor } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import type { Segment } from "../api/types";
import { Card } from "../components/ui/Card";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Modal } from "../components/ui/Modal";

const DAY_W = 110;
const LANE_H = 60;
const SHIFT_CHANGE = 930; // minute where shift B starts
const DAY_START = 420;
const DAY_CAP = 1020;
const FALLBACK_MACHINES = ["PRM019", "PRM031", "PRM039", "PRM042", "PRM043"];

export function GanttPage() {
  const segments = useDataStore((s) => s.segments);
  const score = useDataStore((s) => s.score);
  const config = useDataStore((s) => s.config);

  const machines = useMemo(() => {
    if (!config?.machines) return FALLBACK_MACHINES;
    return Object.entries(config.machines)
      .filter(([, m]) => (m as any).active !== false)
      .map(([id]) => id)
      .sort();
  }, [config]);
  const [view, setView] = useState<"gantt" | "tabela">("gantt");
  const [sel, setSel] = useState<Segment | null>(null);
  const [skuFilter, setSkuFilter] = useState("");

  const nDays = useMemo(() => {
    if (!segments?.length) return 14;
    return Math.max(...segments.map((s) => s.day_idx)) + 1;
  }, [segments]);

  const filtered = useMemo(() => {
    if (!segments) return [];
    const q = skuFilter.toLowerCase();
    return q ? segments.filter((s) => s.sku.toLowerCase().includes(q) || s.tool_id.toLowerCase().includes(q)) : segments;
  }, [segments, skuFilter]);

  // Machine utilization
  const utilization = useMemo(() => {
    if (!segments) return {};
    const totals: Record<string, number> = {};
    for (const s of segments) {
      totals[s.machine_id] = (totals[s.machine_id] || 0) + s.prod_min + s.setup_min;
    }
    const result: Record<string, number> = {};
    for (const m of machines) {
      result[m] = Math.min(100, Math.round(((totals[m] || 0) / (nDays * DAY_CAP)) * 100));
    }
    return result;
  }, [segments, nDays, machines]);

  if (!segments) return <div style={{ color: T.secondary, padding: 24 }}>A carregar...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 24 }}>
          {score && [
            { l: "OTD", v: `${score.otd?.toFixed(1)}%`, c: (score.otd ?? 0) >= 98 ? T.green : T.orange },
            { l: "OTD-D", v: `${score.otd_d?.toFixed(1)}%`, c: (score.otd_d ?? 0) >= 95 ? T.green : T.orange },
            { l: "Atrasos", v: score.tardy_count, c: score.tardy_count > 0 ? T.red : T.green },
            { l: "Setups", v: score.setups },
          ].map((k, i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 12, color: T.tertiary }}>{k.l}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: k.c || T.primary, fontFamily: T.mono }}>{k.v}</span>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            value={skuFilter}
            onChange={(e) => setSkuFilter(e.target.value)}
            placeholder="Filtrar SKU/Tool..."
            style={{
              background: T.elevated, border: `0.5px solid ${T.border}`, color: T.primary,
              borderRadius: 8, padding: "6px 12px", fontSize: 12, fontFamily: T.mono, outline: "none", width: 160,
            }}
          />
          <div style={{ display: "flex", background: T.card, borderRadius: 8, border: `0.5px solid ${T.border}`, overflow: "hidden" }}>
            {(["gantt", "tabela"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={{
                background: view === v ? T.elevated : "transparent", border: "none",
                color: view === v ? T.primary : T.tertiary, padding: "6px 16px",
                fontSize: 12, fontWeight: 500, cursor: "pointer", fontFamily: "inherit",
                borderRadius: 6, margin: 2, transition: "all 0.15s",
              }}>{v === "gantt" ? "Gantt" : "Tabela"}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Utilization bars */}
      <Card style={{ padding: 16 }}>
        <div style={{ display: "flex", gap: 16 }}>
          {machines.map((m) => {
            const u = utilization[m] || 0;
            const c = u > 95 ? T.red : u > 85 ? T.orange : u > 70 ? T.blue : T.green;
            return (
              <div key={m} style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: T.secondary }}>{m}</span>
                  <span style={{ fontSize: 11, color: c, fontWeight: 600, fontFamily: T.mono }}>{u}%</span>
                </div>
                <ProgressBar value={u} color={c} height={3} />
              </div>
            );
          })}
        </div>
      </Card>

      {view === "gantt" ? (
        <Card style={{ padding: 0, overflow: "auto" }}>
          {/* Day headers */}
          <div style={{ display: "flex", borderBottom: `0.5px solid ${T.border}`, position: "sticky", top: 0, background: T.card, zIndex: 2 }}>
            <div style={{ width: 72, flexShrink: 0, padding: "10px 16px", fontSize: 11, color: T.tertiary, borderRight: `0.5px solid ${T.border}` }}>
              Máquina
            </div>
            {Array.from({ length: nDays }, (_, i) => (
              <div key={i} style={{
                width: DAY_W, flexShrink: 0, padding: "10px 0", textAlign: "center",
                fontSize: 11, color: T.tertiary, borderRight: `0.5px solid ${T.border}`,
              }}>{i}</div>
            ))}
          </div>

          {/* Machine lanes */}
          {machines.map((m) => {
            const machineSegs = filtered.filter((s) => s.machine_id === m);
            return (
              <div key={m} style={{ display: "flex", borderBottom: `0.5px solid ${T.border}` }}>
                <div style={{
                  width: 72, flexShrink: 0, padding: "0 16px", display: "flex", alignItems: "center",
                  fontSize: 12, fontWeight: 600, color: T.primary, borderRight: `0.5px solid ${T.border}`, fontFamily: T.mono,
                }}>{m}</div>
                <div style={{ position: "relative", height: LANE_H, flex: 1, minWidth: DAY_W * nDays }}>
                  {/* Day grid lines */}
                  {Array.from({ length: nDays }, (_, i) => (
                    <div key={`g${i}`} style={{ position: "absolute", left: i * DAY_W, top: 0, bottom: 0, width: 0.5, background: T.border }} />
                  ))}
                  {/* Shift separators */}
                  {Array.from({ length: nDays }, (_, i) => (
                    <div key={`s${i}`} style={{
                      position: "absolute",
                      left: i * DAY_W + ((SHIFT_CHANGE - DAY_START) / DAY_CAP) * DAY_W,
                      top: 0, bottom: 0, width: 0.5,
                      background: `${T.border}`,
                      borderLeft: `0.5px dashed rgba(255,255,255,0.03)`,
                    }} />
                  ))}
                  {/* Segments */}
                  {machineSegs.map((s) => {
                    const left = s.day_idx * DAY_W + ((s.start_min - DAY_START) / DAY_CAP) * DAY_W;
                    const width = Math.max(((s.end_min - s.start_min) / DAY_CAP) * DAY_W, 3);
                    const col = toolColor(s.tool_id);
                    return (
                      <div
                        key={`${s.lot_id}-${s.day_idx}-${s.start_min}`}
                        onClick={() => setSel(s)}
                        style={{
                          position: "absolute", left, top: 10, width, height: 40,
                          background: `${col}22`, borderRadius: 5, cursor: "pointer",
                          border: `0.5px solid ${col}44`, transition: "all 0.15s",
                          borderLeft: s.is_continuation ? `2px dashed ${col}66` : undefined,
                          display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
                        }}
                      >
                        {width > 28 && (
                          <span style={{ fontSize: 8, color: `${col}cc`, fontWeight: 600, fontFamily: T.mono }}>
                            {s.tool_id}
                          </span>
                        )}
                        {s.setup_min > 0 && (
                          <div style={{
                            position: "absolute", left: 0, top: 0, bottom: 0,
                            width: Math.max((s.setup_min / (s.end_min - s.start_min)) * width, 1.5),
                            background: `${col}18`, borderRight: `0.5px dashed ${col}44`,
                          }} />
                        )}
                        {s.twin_outputs && (
                          <span style={{
                            position: "absolute", top: 1, right: 2, fontSize: 7, fontWeight: 700,
                            color: `${col}cc`, background: `${col}22`, borderRadius: 3, padding: "0 2px",
                          }}>T</span>
                        )}
                      </div>
                    );
                  })}
                  {/* EDD markers — show for unique lot EDDs on this machine */}
                  {(() => {
                    const edds = new Set<number>();
                    machineSegs.forEach((s) => edds.add(s.edd));
                    return [...edds].map((edd) => (
                      <div key={`edd-${edd}`} style={{
                        position: "absolute",
                        left: edd * DAY_W + DAY_W / 2,
                        top: 0, bottom: 0, width: 0,
                        borderLeft: `1px dashed ${T.red}55`,
                      }} />
                    ));
                  })()}
                </div>
              </div>
            );
          })}
        </Card>
      ) : (
        /* Table view */
        <Card style={{ padding: 0, overflow: "auto", maxHeight: 600 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: T.card }}>
                {["Máq", "Dia", "Turno", "Tool", "SKU", "Qty", "Setup", "Prod", "EDD"].map((h) => (
                  <th key={h} style={{
                    padding: "10px 14px", textAlign: "left", fontSize: 11, color: T.tertiary,
                    fontWeight: 500, borderBottom: `0.5px solid ${T.border}`,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 200).map((s, i) => (
                <tr key={i} style={{ borderBottom: `0.5px solid ${T.border}`, cursor: "pointer" }} onClick={() => setSel(s)}>
                  <td style={{ padding: "8px 14px", fontSize: 12, fontWeight: 600, color: T.primary, fontFamily: T.mono }}>{s.machine_id}</td>
                  <td style={{ padding: "8px 14px", fontSize: 12, color: T.secondary }}>{s.day_idx}</td>
                  <td style={{ padding: "8px 14px", fontSize: 12, color: T.tertiary }}>{s.shift}</td>
                  <td style={{ padding: "8px 14px", fontSize: 12, color: toolColor(s.tool_id), fontWeight: 500 }}>{s.tool_id}</td>
                  <td style={{ padding: "8px 14px", fontSize: 12, color: T.secondary, fontFamily: T.mono }}>{s.sku}</td>
                  <td style={{ padding: "8px 14px", fontSize: 12, color: T.secondary }}>{s.qty}</td>
                  <td style={{ padding: "8px 14px", fontSize: 12, color: s.setup_min > 0 ? T.orange : T.tertiary }}>{s.setup_min.toFixed(0)}m</td>
                  <td style={{ padding: "8px 14px", fontSize: 12, color: T.secondary }}>{s.prod_min.toFixed(0)}m</td>
                  <td style={{ padding: "8px 14px", fontSize: 12, color: T.secondary }}>{s.edd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Detail modal */}
      {sel && (
        <Modal title="Segmento" onClose={() => setSel(null)}>
          {[
            ["Máquina", sel.machine_id],
            ["Dia", sel.day_idx],
            ["Turno", sel.shift],
            ["Ferramenta", sel.tool_id],
            ["SKU", sel.sku],
            ["Quantidade", sel.qty],
            ["Setup", `${sel.setup_min.toFixed(1)} min`],
            ["Produção", `${sel.prod_min.toFixed(1)} min`],
            ["Início", `${sel.start_min} min`],
            ["Fim", `${sel.end_min} min`],
            ["EDD", `Dia ${sel.edd}`],
            ["Lot", sel.lot_id],
            ["Continuação", sel.is_continuation ? "Sim" : "Não"],
            ["Gémeos", sel.twin_outputs ? "Sim" : "Não"],
          ].map(([k, v]) => (
            <div key={String(k)} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `0.5px solid ${T.border}` }}>
              <span style={{ fontSize: 13, color: T.secondary }}>{k}</span>
              <span style={{ fontSize: 13, color: T.primary, fontWeight: 500, fontFamily: T.mono }}>{String(v)}</span>
            </div>
          ))}
        </Modal>
      )}
    </div>
  );
}
