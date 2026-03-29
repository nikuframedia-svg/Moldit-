import { useMemo, useState } from "react";
import { T, moldeColor } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import type { SegmentoMoldit } from "../api/types";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { Dot } from "../components/ui/Dot";

const DAY_W = 110;
const LANE_H = 56;
const REGIME_H = 8;

const selectStyle: React.CSSProperties = {
  background: T.elevated,
  border: `0.5px solid ${T.border}`,
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 11,
  color: T.primary,
  fontFamily: T.mono,
  outline: "none",
  cursor: "pointer",
};

export function GanttPage() {
  const segmentos = useDataStore((s) => s.segmentos);
  const config = useDataStore((s) => s.config);
  const score = useDataStore((s) => s.score);

  const [moldeFilter, setMoldeFilter] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [sel, setSel] = useState<SegmentoMoldit | null>(null);

  const machines = useMemo(() => {
    if (!config?.machines) return [];
    return Object.keys(config.machines).sort();
  }, [config]);

  const moldes = useMemo(() => {
    return [...new Set(segmentos.map((s) => s.molde))].sort();
  }, [segmentos]);

  const filtered = useMemo(() => {
    let segs = segmentos;
    if (moldeFilter) segs = segs.filter((s) => s.molde === moldeFilter);
    if (machineFilter) segs = segs.filter((s) => s.maquina_id === machineFilter);
    return segs;
  }, [segmentos, moldeFilter, machineFilter]);

  const visibleMachines = useMemo(() => {
    if (machineFilter) return [machineFilter];
    const fromSegs = [...new Set(filtered.map((s) => s.maquina_id))].sort();
    return fromSegs.length > 0 ? fromSegs : machines;
  }, [filtered, machineFilter, machines]);

  const nDays = useMemo(() => {
    if (!filtered.length) return 14;
    return Math.max(...filtered.map((s) => s.dia)) + 1;
  }, [filtered]);

  const minDay = useMemo(() => {
    if (!filtered.length) return 0;
    return Math.min(...filtered.map((s) => s.dia));
  }, [filtered]);

  const visibleDays = useMemo(() => {
    return Array.from({ length: nDays - minDay }, (_, i) => minDay + i);
  }, [nDays, minDay]);

  if (!segmentos.length) {
    return <div style={{ color: T.secondary, padding: 24 }}>Sem segmentos. Carrega um ficheiro MPP primeiro.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Score banner */}
      {score && (
        <div style={{ display: "flex", gap: 16, alignItems: "center", padding: "8px 0" }}>
          <span style={{ fontSize: 12, color: T.secondary }}>
            Ops: {score.ops_agendadas}/{score.ops_total}
          </span>
          <span style={{ fontSize: 12, color: T.secondary }}>
            Makespan: {score.makespan_total_dias}d
          </span>
          <span style={{ fontSize: 12, color: T.secondary }}>
            Setups: {score.total_setups}
          </span>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select value={moldeFilter} onChange={(e) => setMoldeFilter(e.target.value)} style={selectStyle}>
          <option value="">Todos os moldes</option>
          {moldes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={machineFilter} onChange={(e) => setMachineFilter(e.target.value)} style={selectStyle}>
          <option value="">Todas as maquinas</option>
          {(machines.length > 0 ? machines : visibleMachines).map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <span style={{ fontSize: 11, color: T.tertiary, marginLeft: 8 }}>
          {filtered.length} segmentos
        </span>
      </div>

      {/* Gantt chart */}
      <div style={{
        overflow: "auto",
        maxHeight: "calc(100vh - 220px)",
        border: `0.5px solid ${T.border}`,
        borderRadius: 8,
        background: T.card,
      }}>
        <div style={{
          display: "grid",
          gridTemplateColumns: `100px repeat(${visibleDays.length}, ${DAY_W}px)`,
          width: 100 + visibleDays.length * DAY_W,
        }}>
          {/* Header */}
          <div style={{
            position: "sticky", left: 0, top: 0, zIndex: 3,
            background: T.card, borderBottom: `1px solid ${T.border}`, borderRight: `1px solid ${T.border}`,
            padding: "6px 8px", fontSize: 10, fontWeight: 600, color: T.tertiary, textTransform: "uppercase",
          }}>
            Maquina
          </div>
          {visibleDays.map((d) => (
            <div key={d} style={{
              position: "sticky", top: 0, zIndex: 2,
              background: T.card, borderBottom: `1px solid ${T.border}`,
              padding: "4px 2px", textAlign: "center",
              fontSize: 10, fontFamily: T.mono, color: T.secondary,
            }}>
              Dia {d}
            </div>
          ))}

          {/* Machine rows */}
          {visibleMachines.map((mid) => (
            <div key={mid} style={{ display: "contents" }}>
              <div style={{
                position: "sticky", left: 0, zIndex: 1,
                background: T.card, borderBottom: `1px solid ${T.border}`, borderRight: `1px solid ${T.border}`,
                padding: "8px 8px", fontSize: 12, fontFamily: T.mono, fontWeight: 600, color: T.primary,
                display: "flex", alignItems: "center", minHeight: LANE_H,
              }}>
                {mid}
              </div>
              {visibleDays.map((day) => {
                const daySegs = filtered.filter((s) => s.maquina_id === mid && s.dia === day);
                return (
                  <div key={day} style={{
                    borderBottom: `1px solid ${T.border}`,
                    padding: "4px 2px",
                    minHeight: LANE_H,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}>
                    {daySegs.map((seg) => {
                      const pct = (seg.duracao_h / REGIME_H) * 100;
                      const color = moldeColor(seg.molde);
                      return (
                        <div
                          key={`${seg.op_id}-${seg.dia}-${seg.inicio_h}`}
                          onClick={() => setSel(seg)}
                          style={{
                            width: `${Math.min(pct, 100)}%`,
                            minWidth: 20,
                            height: 18,
                            background: `${color}44`,
                            border: `1px solid ${color}`,
                            borderRadius: 3,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            padding: "0 4px",
                            overflow: "hidden",
                          }}
                          title={`Op ${seg.op_id} | ${seg.molde} | ${seg.duracao_h.toFixed(1)}h`}
                        >
                          <span style={{
                            fontSize: 8,
                            color: T.primary,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}>
                            {seg.molde}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", padding: "4px 0" }}>
        {moldes.slice(0, 12).map((m) => (
          <div key={m} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Dot color={moldeColor(m)} size={8} />
            <span style={{ fontSize: 10, color: T.secondary }}>{m}</span>
          </div>
        ))}
      </div>

      {/* Selection detail */}
      {sel && (
        <Card style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: T.primary }}>Operacao {sel.op_id}</span>
            <button
              onClick={() => setSel(null)}
              style={{ background: "none", border: "none", color: T.secondary, cursor: "pointer", fontSize: 16 }}
            >
              x
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <div>
              <Label>Molde</Label>
              <div style={{ fontSize: 13, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>{sel.molde}</div>
            </div>
            <div>
              <Label>Maquina</Label>
              <div style={{ fontSize: 13, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>{sel.maquina_id}</div>
            </div>
            <div>
              <Label>Duracao</Label>
              <div style={{ fontSize: 13, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>{sel.duracao_h.toFixed(1)}h</div>
            </div>
            <div>
              <Label>Setup</Label>
              <div style={{ fontSize: 13, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>{sel.setup_h.toFixed(1)}h</div>
            </div>
            <div>
              <Label>Dia</Label>
              <div style={{ fontSize: 13, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>{sel.dia}</div>
            </div>
            <div>
              <Label>Inicio</Label>
              <div style={{ fontSize: 13, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>{sel.inicio_h.toFixed(1)}h</div>
            </div>
            <div>
              <Label>2a Placa</Label>
              <div style={{ fontSize: 13, fontFamily: T.mono, color: sel.e_2a_placa ? T.orange : T.green, marginTop: 2 }}>
                {sel.e_2a_placa ? "Sim" : "Nao"}
              </div>
            </div>
            <div>
              <Label>Continuacao</Label>
              <div style={{ fontSize: 13, fontFamily: T.mono, color: sel.e_continuacao ? T.orange : T.green, marginTop: 2 }}>
                {sel.e_continuacao ? "Sim" : "Nao"}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
