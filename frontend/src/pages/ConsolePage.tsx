import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { getConsole } from "../api/endpoints";
import { useDataStore } from "../stores/useDataStore";
import type { ConsoleData } from "../api/types";
import { Card } from "../components/ui/Card";
import { Num } from "../components/ui/Num";
import { Label } from "../components/ui/Label";
import { Dot } from "../components/ui/Dot";
import { Divider } from "../components/ui/Divider";
import { ProgressBar } from "../components/ui/ProgressBar";
import { TH } from "../constants/thresholds";

export function ConsolePage() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const score = useDataStore((s) => s.score);
  const stress = useDataStore((s) => s.stress);
  const deadlines = useDataStore((s) => s.deadlines);

  useEffect(() => {
    getConsole(0)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <div style={{ color: T.red, padding: 24 }}>{error}</div>;
  if (!score) return <div style={{ color: T.secondary, padding: 24 }}>A carregar...</div>;

  const complianceColor = (score.deadline_compliance ?? 0) >= TH.COMPLIANCE_GREEN ? T.green
    : (score.deadline_compliance ?? 0) >= TH.COMPLIANCE_ORANGE ? T.orange : T.red;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* State Banner */}
      {data && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "16px 20px",
            background: T.card,
            borderRadius: T.radius,
            border: `0.5px solid ${T.border}`,
          }}
        >
          <Dot color={T.green} size={8} />
          <span style={{ fontSize: 15, fontWeight: 500, color: T.primary, flex: 1 }}>{data.state_phrase}</span>
        </div>
      )}

      {/* KPI Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <Card style={{ padding: 16 }}>
          <Label>Makespan</Label>
          <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 3 }}>
            <Num size={28} color={T.primary}>{score.makespan_total_dias}</Num>
            <span style={{ fontSize: 13, color: T.tertiary, fontWeight: 500 }}>dias</span>
          </div>
        </Card>
        <Card style={{ padding: 16 }}>
          <Label>Compliance</Label>
          <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 3 }}>
            <Num size={28} color={complianceColor}>{score.deadline_compliance?.toFixed(1)}</Num>
            <span style={{ fontSize: 13, color: T.tertiary, fontWeight: 500 }}>%</span>
          </div>
        </Card>
        <Card style={{ padding: 16 }}>
          <Label>Setups</Label>
          <div style={{ marginTop: 8 }}>
            <Num size={28} color={T.primary}>{score.total_setups}</Num>
          </div>
        </Card>
        <Card style={{ padding: 16 }}>
          <Label>Balanceamento</Label>
          <div style={{ marginTop: 8 }}>
            <Num size={28} color={score.utilization_balance < 0.15 ? T.green : T.orange}>
              {(score.utilization_balance * 100).toFixed(0)}%
            </Num>
          </div>
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Day Summary + Alerts */}
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px 12px" }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: T.primary }}>Resumo do Dia</span>
          </div>
          {data?.day_summary && (
            <div style={{ padding: "0 20px 12px" }}>
              {Object.entries(data.day_summary).map(([key, val]) => (
                <div key={key} style={{ fontSize: 12, lineHeight: 1.7, color: T.secondary }}>
                  {key}: {String(val)}
                </div>
              ))}
            </div>
          )}
          {data?.action_items && data.action_items.length > 0 && (
            <>
              <Divider />
              <div style={{ padding: "12px 20px 4px" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>Alertas</span>
              </div>
              {data.action_items.map((a, i) => {
                const c = a.severity === "critical" ? T.red : a.severity === "warning" ? T.orange : T.blue;
                return (
                  <div key={i}>
                    {i > 0 && <Divider />}
                    <div style={{ padding: "10px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Dot color={c} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>{a.title}</span>
                      </div>
                      <p style={{ fontSize: 12, color: T.secondary, lineHeight: 1.55, margin: "4px 0 0 14px" }}>{a.detail}</p>
                    </div>
                  </div>
                );
              })}
            </>
          )}
          {!data?.day_summary && (!data?.action_items || data.action_items.length === 0) && (
            <div style={{ padding: "14px 20px", color: T.tertiary, fontSize: 13 }}>Sem dados para este dia</div>
          )}
        </Card>

        {/* Right column: Stress + Deadlines */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Stress Bars */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px 12px" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: T.primary }}>Stress Maquinas</span>
            </div>
            {stress.map((m, i) => {
              const pct = m.stress_pct;
              const c = pct > TH.STRESS_RED ? T.red : pct > TH.STRESS_ORANGE ? T.orange : pct > TH.STRESS_WARN ? T.blue : T.green;
              return (
                <div key={i}>
                  {i > 0 && <Divider />}
                  <div style={{ padding: "12px 20px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.primary, fontFamily: T.mono }}>{m.maquina_id}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: c, fontFamily: T.mono }}>{pct.toFixed(0)}%</span>
                    </div>
                    <ProgressBar value={pct} color={c} />
                    <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: T.tertiary }}>{m.total_horas.toFixed(0)}h total</span>
                      <span style={{ fontSize: 11, color: T.secondary, fontFamily: T.mono }}>{m.capacidade}h cap</span>
                    </div>
                  </div>
                </div>
              );
            })}
            {stress.length === 0 && (
              <div style={{ padding: "14px 20px", color: T.tertiary, fontSize: 13 }}>Sem dados de stress</div>
            )}
          </Card>

          {/* Upcoming Deadlines */}
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px 12px" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: T.primary }}>Prazos Proximos</span>
            </div>
            {deadlines.slice(0, 6).map((d, i) => {
              const c = d.on_time ? T.green : d.dias_atraso > 5 ? T.red : T.orange;
              return (
                <div key={i}>
                  {i > 0 && <Divider />}
                  <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Dot color={c} size={6} />
                      <span style={{ fontSize: 13, fontWeight: 500, color: T.primary }}>{d.molde}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: T.secondary, fontFamily: T.mono }}>{d.deadline}</span>
                      <span style={{ fontSize: 11, color: c, fontFamily: T.mono, fontWeight: 600 }}>
                        {d.on_time ? "OK" : `+${d.dias_atraso}d`}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {deadlines.length === 0 && (
              <div style={{ padding: "14px 20px", color: T.tertiary, fontSize: 13 }}>Sem prazos</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
