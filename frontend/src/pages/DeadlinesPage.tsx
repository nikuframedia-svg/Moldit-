import { useMemo, useState } from "react";
import { T } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { Num } from "../components/ui/Num";
import { Dot } from "../components/ui/Dot";
import { Pill } from "../components/ui/Pill";

const thStyle: React.CSSProperties = {
  fontSize: 11, color: T.tertiary, fontWeight: 500, textAlign: "left",
  padding: "8px 12px", borderBottom: `1px solid ${T.border}`,
  position: "sticky", top: 0, background: T.card,
  textTransform: "uppercase", letterSpacing: "0.04em",
};

const tdStyle: React.CSSProperties = {
  fontSize: 12, color: T.primary, padding: "6px 12px",
  borderBottom: `1px solid ${T.border}`, fontFamily: T.mono,
};

function statusColor(onTime: boolean, diasAtraso: number): string {
  if (onTime) return T.green;
  if (diasAtraso <= 5) return T.orange;
  return T.red;
}

function statusLabel(onTime: boolean, diasAtraso: number): string {
  if (onTime) return "On-time";
  if (diasAtraso <= 5) return "At-risk";
  return "Late";
}

export function DeadlinesPage() {
  const deadlines = useDataStore((s) => s.deadlines);
  const moldes = useDataStore((s) => s.moldes);
  const [filter, setFilter] = useState<"all" | "on_time" | "at_risk" | "late">("all");

  const filtered = useMemo(() => {
    if (filter === "all") return deadlines;
    if (filter === "on_time") return deadlines.filter((d) => d.on_time);
    if (filter === "at_risk") return deadlines.filter((d) => !d.on_time && d.dias_atraso <= 5);
    return deadlines.filter((d) => !d.on_time && d.dias_atraso > 5);
  }, [deadlines, filter]);

  const onTimeCount = deadlines.filter((d) => d.on_time).length;
  const atRiskCount = deadlines.filter((d) => !d.on_time && d.dias_atraso <= 5).length;
  const lateCount = deadlines.filter((d) => !d.on_time && d.dias_atraso > 5).length;

  if (deadlines.length === 0) {
    return <div style={{ color: T.secondary, padding: 24 }}>Sem dados de prazos. Carrega um ficheiro primeiro.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <Card style={{ textAlign: "center" }}>
          <Label>Total Moldes</Label>
          <Num size={36}>{moldes.length || deadlines.length}</Num>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <Label>On-time</Label>
          <Num size={36} color={T.green}>{onTimeCount}</Num>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <Label>At-risk</Label>
          <Num size={36} color={T.orange}>{atRiskCount}</Num>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <Label>Late</Label>
          <Num size={36} color={T.red}>{lateCount}</Num>
        </Card>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 4 }}>
        {([
          { id: "all" as const, label: `Todos (${deadlines.length})` },
          { id: "on_time" as const, label: `On-time (${onTimeCount})` },
          { id: "at_risk" as const, label: `At-risk (${atRiskCount})` },
          { id: "late" as const, label: `Late (${lateCount})` },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            style={{
              background: filter === t.id ? T.elevated : "transparent",
              border: `0.5px solid ${filter === t.id ? T.borderHover : T.border}`,
              color: filter === t.id ? T.primary : T.secondary,
              borderRadius: 8, padding: "5px 12px", cursor: "pointer",
              fontSize: 12, fontWeight: filter === t.id ? 600 : 400, fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Timeline per mold */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((d) => {
          const color = statusColor(d.on_time, d.dias_atraso);
          const molde = moldes.find((m) => m.id === d.molde);
          return (
            <Card key={d.molde} style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <Dot color={color} size={8} />
                <span style={{ fontSize: 14, fontWeight: 600, color: T.primary, fontFamily: T.mono }}>{d.molde}</span>
                <Pill color={color}>{statusLabel(d.on_time, d.dias_atraso)}</Pill>
                {molde && <span style={{ fontSize: 11, color: T.secondary }}>{molde.cliente}</span>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                <div>
                  <Label>Deadline</Label>
                  <div style={{ fontSize: 12, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>{d.deadline}</div>
                </div>
                <div>
                  <Label>Conclusao Prevista</Label>
                  <div style={{ fontSize: 12, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>Dia {d.conclusao_prevista}</div>
                </div>
                <div>
                  <Label>Delta (dias)</Label>
                  <div style={{ fontSize: 12, fontFamily: T.mono, color, fontWeight: 600, marginTop: 2 }}>
                    {d.on_time ? "0" : `+${d.dias_atraso}`}
                  </div>
                </div>
                <div>
                  <Label>Ops Pendentes</Label>
                  <div style={{ fontSize: 12, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>{d.operacoes_pendentes}</div>
                </div>
              </div>
              {molde && (
                <div style={{ marginTop: 8, display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: T.tertiary }}>
                    Progresso: {molde.progresso.toFixed(0)}% ({molde.ops_concluidas}/{molde.total_ops} ops)
                  </span>
                  <span style={{ fontSize: 11, color: T.tertiary }}>
                    Work total: {molde.total_work_h.toFixed(0)}h
                  </span>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Table view */}
      <Card style={{ padding: 0, overflow: "auto", maxHeight: 400 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Molde</th>
              <th style={thStyle}>Deadline</th>
              <th style={thStyle}>Conclusao</th>
              <th style={thStyle}>Delta (d)</th>
              <th style={thStyle}>Ops Pendentes</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => {
              const color = statusColor(d.on_time, d.dias_atraso);
              return (
                <tr key={d.molde}>
                  <td style={tdStyle}>{d.molde}</td>
                  <td style={tdStyle}>{d.deadline}</td>
                  <td style={tdStyle}>Dia {d.conclusao_prevista}</td>
                  <td style={{ ...tdStyle, color, fontWeight: 600 }}>
                    {d.on_time ? "0" : `+${d.dias_atraso}`}
                  </td>
                  <td style={tdStyle}>{d.operacoes_pendentes}</td>
                  <td style={tdStyle}>
                    <Pill color={color}>{statusLabel(d.on_time, d.dias_atraso)}</Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
