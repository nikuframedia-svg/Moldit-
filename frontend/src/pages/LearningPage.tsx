import { useState, useEffect, useMemo, type CSSProperties } from "react";
import { T } from "../theme/tokens";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { ProgressBar } from "../components/ui/ProgressBar";
import { getCalibration, getExecutionLogs } from "../api/endpoints";
import type { CalibrationData, CalibrationFactor, MachineReliability, ExecutionLog } from "../api/types";
import { Num } from "../components/ui/Num";

type Tab = "calibracao" | "maquinas" | "historico" | "evolucao";

const TABS: { id: Tab; label: string }[] = [
  { id: "calibracao", label: "Calibracao" },
  { id: "maquinas", label: "Maquinas" },
  { id: "historico", label: "Historico" },
  { id: "evolucao", label: "Evolucao" },
];

const thStyle: CSSProperties = {
  fontSize: 11, color: T.tertiary, fontWeight: 500, textAlign: "left" as const,
  padding: "8px 12px", borderBottom: `1px solid ${T.border}`,
  position: "sticky" as const, top: 0, background: T.card,
  textTransform: "uppercase" as const, letterSpacing: "0.04em",
};

const tdStyle: CSSProperties = {
  fontSize: 12, color: T.primary, padding: "6px 12px",
  borderBottom: `1px solid ${T.border}`, fontFamily: T.mono,
};

function ratioColor(ratio: number): string {
  if (ratio < 1.05) return T.green;
  if (ratio <= 1.2) return T.orange;
  return T.red;
}

function formatRatioPct(ratio: number): string {
  const pct = (ratio - 1) * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(0)}%`;
}

export function LearningPage() {
  const [tab, setTab] = useState<Tab>("calibracao");
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [logs, setLogs] = useState<ExecutionLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    getCalibration()
      .then(setCalibration)
      .catch((e) => { console.error(e); setError(String(e)); });
  }, []);

  useEffect(() => {
    if (tab === "historico" || tab === "evolucao") {
      getExecutionLogs()
        .then(setLogs)
        .catch((e) => { console.error(e); setLogsError(String(e)); });
    }
  }, [tab]);

  const fatores: CalibrationFactor[] = useMemo(() => {
    if (!calibration) return [];
    return Object.values(calibration.fatores);
  }, [calibration]);

  const fiabilidade: MachineReliability[] = useMemo(() => {
    if (!calibration) return [];
    return Object.values(calibration.fiabilidade);
  }, [calibration]);

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    if (!search) return logs;
    const q = search.toLowerCase();
    return logs.filter((l) => l.codigo.toLowerCase().includes(q));
  }, [logs, search]);

  const avgRatio = useMemo(() => {
    if (!logs || logs.length === 0) return null;
    const sum = logs.reduce((acc, l) => acc + (l.work_h_planeado > 0 ? l.work_h_real / l.work_h_planeado : 1), 0);
    return sum / logs.length;
  }, [logs]);

  if (error) return <div style={{ color: T.red, padding: 24 }}>{error}</div>;

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

      {/* ── Calibracao ── */}
      {tab === "calibracao" && (
        <>
          {!calibration ? (
            <div style={{ color: T.secondary, padding: 24 }}>A carregar...</div>
          ) : fatores.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center" as const, padding: 24, color: T.secondary, fontSize: 13 }}>
                Sem dados de calibracao. Complete operacoes no Explorador para comecar a aprender.
              </div>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: "auto", maxHeight: 500 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Codigo</th>
                    <th style={thStyle}>Ratio</th>
                    <th style={thStyle}>Desvio</th>
                    <th style={thStyle}>Amostras</th>
                    <th style={thStyle}>Confianca</th>
                  </tr>
                </thead>
                <tbody>
                  {fatores.map((f) => (
                    <tr key={f.codigo}>
                      <td style={tdStyle}>{f.codigo}</td>
                      <td style={{ ...tdStyle, color: ratioColor(f.ratio_media), fontWeight: 600 }}>
                        {formatRatioPct(f.ratio_media)}
                      </td>
                      <td style={tdStyle}>{f.ratio_std.toFixed(2)}</td>
                      <td style={tdStyle}>{f.n_amostras}</td>
                      <td style={{ ...tdStyle, width: 120 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <ProgressBar
                            value={f.confianca * 100}
                            color={f.confianca >= 0.8 ? T.green : f.confianca >= 0.5 ? T.orange : T.secondary}
                          />
                          <span style={{ fontSize: 11, color: T.secondary, fontFamily: T.mono, minWidth: 32 }}>
                            {(f.confianca * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {/* ── Maquinas ── */}
      {tab === "maquinas" && (
        <>
          {!calibration ? (
            <div style={{ color: T.secondary, padding: 24 }}>A carregar...</div>
          ) : fiabilidade.length === 0 ? (
            <Card>
              <div style={{ textAlign: "center" as const, padding: 24, color: T.secondary, fontSize: 13 }}>
                Sem eventos de maquina registados.
              </div>
            </Card>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 12 }}>
              {fiabilidade.map((m) => {
                const uptimeColor = m.uptime_pct >= 95 ? T.green : m.uptime_pct >= 90 ? T.orange : T.red;
                return (
                  <Card key={m.maquina_id} style={{ flex: "1 1 calc(50% - 6px)", minWidth: 280 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: T.primary, fontFamily: T.mono }}>
                        {m.maquina_id}
                      </span>
                      <span style={{ fontSize: 11, color: T.secondary }}>
                        {m.n_eventos} eventos
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 8 }}>
                      <Num size={28} color={uptimeColor}>{m.uptime_pct.toFixed(1)}</Num>
                      <span style={{ fontSize: 13, color: T.tertiary, fontWeight: 500 }}>% uptime</span>
                    </div>
                    <ProgressBar value={m.uptime_pct} color={uptimeColor} />
                    <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
                      <div>
                        <Label>MTBF</Label>
                        <div style={{ fontSize: 12, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>
                          {m.mtbf_h.toFixed(0)}h
                        </div>
                      </div>
                      <div>
                        <Label>MTTR</Label>
                        <div style={{ fontSize: 12, fontFamily: T.mono, color: T.primary, marginTop: 2 }}>
                          {m.mttr_h.toFixed(1)}h
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Historico ── */}
      {tab === "historico" && (
        <>
          {logsError && <div style={{ color: T.red, padding: 24 }}>{logsError}</div>}
          {!logs && !logsError && (
            <div style={{ color: T.secondary, padding: 24 }}>A carregar...</div>
          )}
          {logs && (
            <>
              <input
                type="text"
                placeholder="Filtrar por codigo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  background: T.elevated, border: `0.5px solid ${T.border}`,
                  borderRadius: 8, padding: "6px 12px", fontSize: 12,
                  color: T.primary, fontFamily: T.mono, outline: "none", width: 280,
                }}
              />
              {filteredLogs.length === 0 ? (
                <Card>
                  <div style={{ textAlign: "center" as const, padding: 24, color: T.secondary, fontSize: 13 }}>
                    Sem registos de execucao.
                  </div>
                </Card>
              ) : (
                <Card style={{ padding: 0, overflow: "auto", maxHeight: 500 }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Op</th>
                        <th style={thStyle}>Molde</th>
                        <th style={thStyle}>Maquina</th>
                        <th style={thStyle}>Codigo</th>
                        <th style={thStyle}>Planeado (h)</th>
                        <th style={thStyle}>Real (h)</th>
                        <th style={thStyle}>Ratio</th>
                        <th style={thStyle}>Desvio</th>
                        <th style={thStyle}>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogs.map((l) => {
                        const ratio = l.work_h_planeado > 0 ? l.work_h_real / l.work_h_planeado : 1;
                        return (
                          <tr key={l.id}>
                            <td style={tdStyle}>{l.op_id}</td>
                            <td style={{ ...tdStyle, fontFamily: T.sans }}>{l.molde}</td>
                            <td style={tdStyle}>{l.maquina_id}</td>
                            <td style={tdStyle}>{l.codigo}</td>
                            <td style={tdStyle}>{l.work_h_planeado.toFixed(1)}</td>
                            <td style={tdStyle}>{l.work_h_real.toFixed(1)}</td>
                            <td style={{ ...tdStyle, color: ratioColor(ratio), fontWeight: 600 }}>
                              {ratio.toFixed(2)}
                            </td>
                            <td style={{ ...tdStyle, fontFamily: T.sans, color: T.secondary }}>
                              {l.motivo_desvio || "-"}
                            </td>
                            <td style={{ ...tdStyle, color: T.secondary }}>{l.created_at}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
        </>
      )}

      {/* ── Evolucao ── */}
      {tab === "evolucao" && (
        <Card>
          <div style={{ textAlign: "center" as const, padding: 48 }}>
            <div style={{ fontSize: 14, color: T.secondary, marginBottom: 16 }}>
              Grafico de evolucao disponivel apos 20+ operacoes concluidas.
            </div>
            {logs && (
              <div style={{ display: "flex", justifyContent: "center", gap: 24 }}>
                <div>
                  <Label>Operacoes Registadas</Label>
                  <div style={{ marginTop: 4 }}>
                    <Num size={28} color={T.primary}>{logs.length}</Num>
                  </div>
                </div>
                {avgRatio !== null && (
                  <div>
                    <Label>Ratio Medio</Label>
                    <div style={{ marginTop: 4 }}>
                      <Num size={28} color={ratioColor(avgRatio)}>{avgRatio.toFixed(2)}</Num>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!logs && (
              <div style={{ color: T.tertiary, fontSize: 13 }}>A carregar...</div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
