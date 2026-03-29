import { Fragment, useEffect, useMemo, useState } from "react";
import { T } from "../theme/tokens";
import { getRisk } from "../api/endpoints";
import { useDataStore } from "../stores/useDataStore";
import type { RiskResult } from "../api/types";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { Num } from "../components/ui/Num";
import { Pill } from "../components/ui/Pill";

type Tab = "bottlenecks" | "atrasos" | "montecarlo" | "propostas";

const TABS: { id: Tab; label: string }[] = [
  { id: "bottlenecks", label: "Bottlenecks" },
  { id: "atrasos", label: "Atrasos" },
  { id: "montecarlo", label: "Monte Carlo" },
  { id: "propostas", label: "Propostas" },
];

export function RiskPage() {
  const [tab, setTab] = useState<Tab>("bottlenecks");
  const [risk, setRisk] = useState<RiskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deadlines = useDataStore((s) => s.deadlines);
  const stress = useDataStore((s) => s.stress);

  useEffect(() => {
    getRisk()
      .then(setRisk)
      .catch((e) => setError(String(e)));
  }, []);

  // Heatmap data from risk result
  const heatmapData = useMemo(() => {
    if (!risk) return { machines: [] as string[], days: [] as number[], cells: new Map<string, number>() };
    const heatmap = risk.heatmap ?? [];
    const machines = [...new Set(heatmap.map((c) => c.maquina_id))].sort();
    const days = [...new Set(heatmap.map((c) => c.dia))].sort((a, b) => a - b);
    const cells = new Map<string, number>();
    for (const c of heatmap) cells.set(`${c.maquina_id}-${c.dia}`, c.stress_pct);
    return { machines, days, cells };
  }, [risk]);

  const lateDeadlines = useMemo(() => {
    return deadlines.filter((d) => !d.on_time);
  }, [deadlines]);

  if (error) return <div style={{ color: T.red, padding: 24 }}>{error}</div>;

  const healthColor = risk
    ? risk.health_score >= 80 ? T.green : risk.health_score >= 50 ? T.orange : T.red
    : T.secondary;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? T.elevated : "transparent",
              border: `0.5px solid ${tab === t.id ? T.borderHover : T.border}`,
              color: tab === t.id ? T.primary : T.secondary,
              borderRadius: 8, padding: "5px 12px", cursor: "pointer",
              fontSize: 12, fontWeight: tab === t.id ? 600 : 400, fontFamily: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Bottlenecks ── */}
      {tab === "bottlenecks" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <Card style={{ textAlign: "center" }}>
              <Label>Health Score</Label>
              <Num size={48} color={healthColor}>{risk?.health_score ?? "-"}</Num>
            </Card>
            <Card style={{ textAlign: "center" }}>
              <Label>Maquinas Stressadas</Label>
              <Num size={36} color={stress.filter((s) => s.stress_pct > 85).length > 0 ? T.red : T.green}>
                {stress.filter((s) => s.stress_pct > 85).length}
              </Num>
            </Card>
            <Card style={{ textAlign: "center" }}>
              <Label>Bottleneck Principal</Label>
              <div style={{ marginTop: 8 }}>
                {risk?.bottleneck_machines?.[0]
                  ? <Pill color={T.red}>{risk.bottleneck_machines[0].maquina_id}</Pill>
                  : <span style={{ color: T.secondary, fontSize: 13 }}>Nenhum</span>
                }
              </div>
            </Card>
          </div>

          {/* Stress table */}
          {stress.length > 0 && (
            <Card style={{ padding: 0, overflow: "auto" }}>
              <div style={{ padding: "12px 16px 4px" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>Stress por Maquina</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thS}>Maquina</th>
                    <th style={thS}>Stress %</th>
                    <th style={thS}>Total Horas</th>
                    <th style={thS}>Capacidade</th>
                    <th style={thS}>Pico Dia</th>
                    <th style={thS}>Pico Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {stress.map((m) => {
                    const c = m.stress_pct > 90 ? T.red : m.stress_pct > 70 ? T.orange : T.green;
                    return (
                      <tr key={m.maquina_id}>
                        <td style={tdS}>{m.maquina_id}</td>
                        <td style={{ ...tdS, color: c, fontWeight: 600 }}>{m.stress_pct.toFixed(0)}%</td>
                        <td style={tdS}>{m.total_horas.toFixed(0)}</td>
                        <td style={tdS}>{m.capacidade}</td>
                        <td style={tdS}>Dia {m.pico_dia}</td>
                        <td style={tdS}>{m.pico_horas.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}

          {/* Heatmap */}
          {heatmapData.machines.length > 0 && (
            <Card style={{ padding: 0, overflow: "auto" }}>
              <div style={{ padding: "12px 16px 4px" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>Heatmap de Stress</span>
              </div>
              <div style={{ padding: "8px 16px 16px", overflowX: "auto" }}>
                <div style={{ display: "grid", gridTemplateColumns: `80px repeat(${heatmapData.days.length}, 24px)`, gap: 2 }}>
                  <div />
                  {heatmapData.days.map((d) => (
                    <div key={d} style={{ fontSize: 8, color: T.tertiary, textAlign: "center", fontFamily: T.mono }}>
                      {d % 5 === 0 ? d : ""}
                    </div>
                  ))}
                  {heatmapData.machines.map((m) => (
                    <Fragment key={m}>
                      <div style={{ fontSize: 10, color: T.secondary, fontFamily: T.mono, display: "flex", alignItems: "center" }}>{m}</div>
                      {heatmapData.days.map((d) => {
                        const val = heatmapData.cells.get(`${m}-${d}`) ?? 0;
                        const alpha = Math.min(val / 100, 1);
                        const bg = val > 85 ? `${T.red}${Math.round(alpha * 200).toString(16).padStart(2, "0")}`
                          : val > 70 ? `${T.orange}${Math.round(alpha * 150).toString(16).padStart(2, "0")}`
                          : `${T.green}${Math.round(alpha * 80).toString(16).padStart(2, "0")}`;
                        return <div key={d} style={{ width: 22, height: 22, borderRadius: 3, background: bg }} title={`${m} D${d}: ${val.toFixed(0)}%`} />;
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── Atrasos ── */}
      {tab === "atrasos" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <Card style={{ textAlign: "center" }}>
              <Label>Moldes Atrasados</Label>
              <Num size={36} color={lateDeadlines.length > 0 ? T.red : T.green}>{lateDeadlines.length}</Num>
            </Card>
            <Card style={{ textAlign: "center" }}>
              <Label>Atraso Medio (dias)</Label>
              <Num size={36}>
                {lateDeadlines.length > 0
                  ? (lateDeadlines.reduce((a, d) => a + d.dias_atraso, 0) / lateDeadlines.length).toFixed(1)
                  : "0"
                }
              </Num>
            </Card>
          </div>

          {lateDeadlines.length > 0 && (
            <Card style={{ padding: 0, overflow: "auto", maxHeight: 500 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thS}>Molde</th>
                    <th style={thS}>Deadline</th>
                    <th style={thS}>Conclusao</th>
                    <th style={thS}>Atraso (d)</th>
                    <th style={thS}>Ops Pendentes</th>
                  </tr>
                </thead>
                <tbody>
                  {lateDeadlines.map((d) => (
                    <tr key={d.molde}>
                      <td style={tdS}>{d.molde}</td>
                      <td style={tdS}>{d.deadline}</td>
                      <td style={tdS}>Dia {d.conclusao_prevista}</td>
                      <td style={{ ...tdS, color: T.red, fontWeight: 600 }}>+{d.dias_atraso}</td>
                      <td style={tdS}>{d.operacoes_pendentes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {lateDeadlines.length === 0 && (
            <Card>
              <div style={{ textAlign: "center", padding: 24, color: T.green, fontSize: 14 }}>
                Todos os moldes dentro do prazo.
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── Monte Carlo ── */}
      {tab === "montecarlo" && (
        <Card>
          <div style={{ textAlign: "center", padding: 48, color: T.secondary, fontSize: 14 }}>
            Simulacao Monte Carlo em desenvolvimento. Esta funcionalidade permitira analise probabilistica
            dos prazos de entrega considerando variabilidade nas duracoes das operacoes.
          </div>
        </Card>
      )}

      {/* ── Propostas ── */}
      {tab === "propostas" && (
        <>
          {risk?.proposals && risk.proposals.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {risk.proposals.map((p, i) => (
                <Card key={i} style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>{p.titulo}</span>
                    <Pill color={T.blue}>{p.impacto}</Pill>
                  </div>
                  <div style={{ fontSize: 12, color: T.secondary, lineHeight: 1.5 }}>{p.descricao}</div>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <div style={{ textAlign: "center", padding: 24, color: T.secondary, fontSize: 13 }}>
                Sem propostas de melhoria disponiveis.
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

const thS: React.CSSProperties = {
  fontSize: 11, color: T.tertiary, fontWeight: 500, textAlign: "left",
  padding: "8px 12px", borderBottom: `1px solid ${T.border}`,
  position: "sticky", top: 0, background: T.card,
  textTransform: "uppercase", letterSpacing: "0.04em",
};

const tdS: React.CSSProperties = {
  fontSize: 12, color: T.primary, padding: "6px 12px",
  borderBottom: `1px solid ${T.border}`, fontFamily: T.mono,
};
