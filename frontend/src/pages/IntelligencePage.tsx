/** Inteligencia (ML) Page — 5 tabs for Machine Learning insights. */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { Num } from "../components/ui/Num";
import { Pill } from "../components/ui/Pill";
import { useMLStore } from "../stores/useMLStore";
import { useDataStore } from "../stores/useDataStore";
import LineChart from "../components/ml/LineChart";
import ScatterPlot from "../components/ml/ScatterPlot";
import ShapBars from "../components/ml/ShapBars";
import ConfidenceBadge from "../components/ml/ConfidenceBadge";
import PhaseIndicator from "../components/ml/PhaseIndicator";
import {
  predictDuration,
  feedbackAnalogy,
  bootstrapSynthetic,
  updateMLConfig,
} from "../api/endpoints";
import type {
  DurationPrediction,
  MLModelStatus,
  MachineScoreML,
  ShapContribution,
} from "../api/types";

type Tab = "dashboard" | "previsoes" | "analogos" | "ranking" | "anomalias";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard ML" },
  { id: "previsoes", label: "Previsoes" },
  { id: "analogos", label: "Analogos" },
  { id: "ranking", label: "Ranking Maquinas" },
  { id: "anomalias", label: "Anomalias" },
];

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  fontSize: 11,
  fontWeight: 600,
  color: T.secondary,
  borderBottom: `1px solid ${T.border}`,
  position: "sticky",
  top: 0,
  background: T.card,
};

const tdStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  borderBottom: `1px solid ${T.border}20`,
};

export default function IntelligencePage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const {
    status, evolution, predictions, analogues, ranking, anomalies,
    refreshStatus, loadEvolution, loadPredictions, loadAnalogues,
    loadRanking, loadAnomalies, triggerTrain, loading,
  } = useMLStore();
  const moldes = useDataStore((s) => s.moldes);

  useEffect(() => {
    refreshStatus();
    loadEvolution();
  }, []);

  useEffect(() => {
    if (tab === "previsoes") loadPredictions();
    if (tab === "analogos" && moldes.length > 0) loadAnalogues(moldes[0].id);
    if (tab === "ranking") loadRanking();
    if (tab === "anomalias") loadAnomalies();
  }, [tab]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px",
              borderRadius: T.radiusSm,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? T.primary : T.secondary,
              background: tab === t.id ? T.elevated : "transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DashboardTab />}
      {tab === "previsoes" && <PrevisoesTab predictions={predictions} loading={loading} />}
      {tab === "analogos" && <AnalogosTab />}
      {tab === "ranking" && <RankingTab />}
      {tab === "anomalias" && <AnomaliasTab />}
    </div>
  );
}

/* ── Tab 1: Dashboard ML ────────────────────────────────────────── */

function DashboardTab() {
  const { status, evolution, triggerTrain, refreshStatus, loading } = useMLStore();
  const [training, setTraining] = useState(false);

  if (!status) {
    return <Card style={{ padding: 32, textAlign: "center", color: T.secondary }}>A carregar estado ML...</Card>;
  }

  const handleTrain = async () => {
    setTraining(true);
    await triggerTrain();
    await refreshStatus();
    setTraining(false);
  };

  const handleBootstrap = async () => {
    setTraining(true);
    await bootstrapSynthetic(20);
    await triggerTrain();
    await refreshStatus();
    setTraining(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Phase indicator */}
      <PhaseIndicator
        phase={status.phase}
        label={status.phase_label}
        message={status.message}
      />

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <Card style={{ textAlign: "center" }}>
          <Label>Projectos</Label>
          <Num size={36}>{status.n_projetos}</Num>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <Label>Modelos Activos</Label>
          <Num size={36} color={status.models_active.length > 0 ? T.green : T.red}>
            {status.models_active.length}/5
          </Num>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <Label>Ultimo Retrain</Label>
          <div style={{ fontSize: 13, color: T.secondary, marginTop: 4 }}>
            {status.last_retrain ? status.last_retrain.slice(0, 16) : "Nunca"}
          </div>
        </Card>
        <Card style={{ textAlign: "center" }}>
          <Label>Accoes</Label>
          <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 4 }}>
            <button
              onClick={handleTrain}
              disabled={training}
              style={{
                padding: "6px 12px", borderRadius: 6, border: "none",
                background: T.blue, color: "#fff", fontSize: 11,
                cursor: training ? "wait" : "pointer", opacity: training ? 0.5 : 1,
              }}
            >
              {training ? "..." : "Treinar"}
            </button>
            {status.n_projetos === 0 && (
              <button
                onClick={handleBootstrap}
                disabled={training}
                style={{
                  padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.border}`,
                  background: "transparent", color: T.secondary, fontSize: 11,
                  cursor: training ? "wait" : "pointer",
                }}
              >
                Bootstrap
              </button>
            )}
          </div>
        </Card>
      </div>

      {/* Model cards */}
      <Label>Modelos</Label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {status.models.map((m: MLModelStatus) => (
          <ModelCard key={m.name} model={m} />
        ))}
      </div>

      {/* Evolution chart */}
      {evolution.length >= 2 && (
        <Card>
          <Label>Evolucao do Erro de Previsao</Label>
          <div style={{ marginTop: 8 }}>
            <LineChart
              data={evolution.map((e) => ({ date: e.date, value: e.mae }))}
              color={T.blue}
              label="MAE (horas)"
              formatY={(v) => v.toFixed(2) + "h"}
              width={700}
              height={220}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

function ModelCard({ model }: { model: MLModelStatus }) {
  const healthColor =
    model.health === "saudavel" ? T.green :
    model.health === "degradado" ? T.orange : T.tertiary;

  const mainMetric = Object.entries(model.metrics)[0];

  return (
    <Card style={{ textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: healthColor }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: T.primary }}>
          {model.name.replace("_", " ")}
        </span>
      </div>
      {mainMetric && (
        <div style={{ fontSize: 20, fontWeight: 700, color: healthColor, fontFamily: T.mono }}>
          {typeof mainMetric[1] === "number" ? mainMetric[1].toFixed(3) : mainMetric[1]}
        </div>
      )}
      <div style={{ fontSize: 10, color: T.secondary, marginTop: 2 }}>
        {model.n_samples} amostras
      </div>
    </Card>
  );
}

/* ── Tab 2: Previsoes ───────────────────────────────────────────── */

function PrevisoesTab({ predictions, loading }: { predictions: DurationPrediction[]; loading: boolean }) {
  const [expandedOp, setExpandedOp] = useState<number | null>(null);
  const [shapData, setShapData] = useState<ShapContribution[]>([]);
  const [mlEnabled, setMlEnabled] = useState(false);

  if (loading) {
    return <Card style={{ padding: 32, textAlign: "center", color: T.secondary }}>A carregar previsoes...</Card>;
  }
  if (predictions.length === 0) {
    return <Card style={{ padding: 32, textAlign: "center", color: T.secondary }}>Sem previsoes ML disponiveis. Treine os modelos primeiro.</Card>;
  }

  const totalMpp = predictions.reduce((s, p) => s + p.estimado_mpp, 0);
  const totalMl = predictions.reduce((s, p) => s + p.previsao_ml, 0);
  const deltaPct = totalMpp > 0 ? ((totalMl - totalMpp) / totalMpp) * 100 : 0;

  const handleExpand = async (opId: number) => {
    if (expandedOp === opId) {
      setExpandedOp(null);
      return;
    }
    setExpandedOp(opId);
    try {
      const detail = await predictDuration(opId);
      setShapData(detail.explicacao || []);
    } catch {
      setShapData([]);
    }
  };

  const handleToggleML = async () => {
    const newVal = !mlEnabled;
    setMlEnabled(newVal);
    await updateMLConfig({ usar_previsoes_ml: newVal });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Summary + Toggle */}
      <div style={{ display: "flex", gap: 12 }}>
        <Card style={{ flex: 1 }}>
          <Label>Resumo</Label>
          <div style={{ fontSize: 13, color: T.primary, marginTop: 4 }}>
            O ML preve que este molde vai demorar{" "}
            <strong style={{ fontFamily: T.mono }}>{totalMl.toFixed(0)}h</strong> em vez das{" "}
            <strong style={{ fontFamily: T.mono }}>{totalMpp.toFixed(0)}h</strong> estimadas
            <span style={{ color: deltaPct > 0 ? T.orange : T.green, fontWeight: 600 }}>
              {" "}({deltaPct > 0 ? "+" : ""}{deltaPct.toFixed(1)}%)
            </span>
          </div>
        </Card>
        <Card style={{ width: 220, textAlign: "center" }}>
          <Label>Usar ML no Scheduler</Label>
          <button
            onClick={handleToggleML}
            style={{
              marginTop: 8, padding: "6px 20px", borderRadius: 6, border: "none",
              background: mlEnabled ? T.green : T.tertiary,
              color: mlEnabled ? T.bg : T.primary,
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            {mlEnabled ? "ON" : "OFF"}
          </button>
        </Card>
      </div>

      {/* Scatter plot */}
      <Card>
        <Label>Estimado .mpp vs Previsao ML</Label>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "center" }}>
          <ScatterPlot
            data={predictions.map((p) => ({
              estimado: p.estimado_mpp,
              previsao: p.previsao_ml,
              label: `Op ${p.op_id}`,
            }))}
            width={500}
            height={300}
          />
        </div>
      </Card>

      {/* Predictions table */}
      <Card style={{ padding: 0, overflow: "auto", maxHeight: 500 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Op</th>
              <th style={thStyle}>Estimado</th>
              <th style={thStyle}>ML</th>
              <th style={thStyle}>P10-P90</th>
              <th style={thStyle}>Delta</th>
              <th style={thStyle}>Confianca</th>
            </tr>
          </thead>
          <tbody>
            {predictions.map((p) => {
              const delta = p.previsao_ml - p.estimado_mpp;
              const deltaPctRow = p.estimado_mpp > 0 ? (delta / p.estimado_mpp) * 100 : 0;
              const rowColor =
                Math.abs(deltaPctRow) < 15 ? undefined :
                Math.abs(deltaPctRow) < 30 ? `${T.orange}10` : `${T.red}10`;

              return (
                <React.Fragment key={p.op_id}>
                  <tr
                    onClick={() => handleExpand(p.op_id)}
                    style={{ cursor: "pointer", background: rowColor }}
                  >
                    <td style={tdStyle}>{p.op_id}</td>
                    <td style={{ ...tdStyle, fontFamily: T.mono }}>{p.estimado_mpp.toFixed(1)}h</td>
                    <td style={{ ...tdStyle, fontFamily: T.mono, fontWeight: 600 }}>{p.previsao_ml.toFixed(1)}h</td>
                    <td style={{ ...tdStyle, fontFamily: T.mono, color: T.secondary, fontSize: 11 }}>
                      [{p.intervalo_p10.toFixed(1)} - {p.intervalo_p90.toFixed(1)}]
                    </td>
                    <td style={{ ...tdStyle, fontFamily: T.mono, color: delta > 0 ? T.orange : T.green }}>
                      {delta > 0 ? "+" : ""}{delta.toFixed(1)}h
                    </td>
                    <td style={tdStyle}>
                      <ConfidenceBadge value={p.confianca} />
                    </td>
                  </tr>
                  {expandedOp === p.op_id && (
                    <tr>
                      <td colSpan={6} style={{ padding: "12px 16px", background: T.elevated }}>
                        <Label>Explicacao SHAP</Label>
                        <div style={{ marginTop: 8 }}>
                          <ShapBars contributions={shapData} />
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ── Tab 3: Analogos ────────────────────────────────────────────── */

function AnalogosTab() {
  const { analogues, loadAnalogues } = useMLStore();
  const moldes = useDataStore((s) => s.moldes);
  const [selectedMolde, setSelectedMolde] = useState(moldes[0]?.id ?? "");

  useEffect(() => {
    if (selectedMolde) loadAnalogues(selectedMolde);
  }, [selectedMolde]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Mold selector */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Label>Molde:</Label>
        <select
          value={selectedMolde}
          onChange={(e) => setSelectedMolde(e.target.value)}
          style={{
            padding: "6px 12px", borderRadius: 6,
            background: T.elevated, color: T.primary, border: `1px solid ${T.border}`,
            fontSize: 13,
          }}
        >
          {moldes.map((m) => (
            <option key={m.id} value={m.id}>{m.id}</option>
          ))}
        </select>
      </div>

      {analogues.length === 0 ? (
        <Card style={{ padding: 32, textAlign: "center", color: T.secondary }}>
          Sem analogos encontrados. Precisa de mais dados historicos.
        </Card>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {analogues.map((a) => (
            <AnalogoCard key={a.projeto_id} analogo={a} moldeId={selectedMolde} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnalogoCard({ analogo: a, moldeId }: { analogo: import("../api/types").AnalogoResult; moldeId: string }) {
  const [feedbackGiven, setFeedbackGiven] = useState(false);

  const handleFeedback = async (util: boolean) => {
    await feedbackAnalogy({ molde_id: moldeId, analogo_id: a.projeto_id, util });
    setFeedbackGiven(true);
  };

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontWeight: 600, color: T.primary, fontSize: 14 }}>{a.molde_id}</span>
        <Pill color={a.compliance ? T.green : T.red}>
          {a.compliance ? "OK" : "Atrasou"}
        </Pill>
      </div>

      <div style={{ fontSize: 24, fontWeight: 700, color: T.blue, fontFamily: T.mono, marginBottom: 4 }}>
        {(a.similaridade * 100).toFixed(0)}%
      </div>
      <div style={{ fontSize: 11, color: T.secondary, marginBottom: 8 }}>similaridade</div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 12, marginBottom: 8 }}>
        <span style={{ color: T.secondary }}>Operacoes:</span>
        <span style={{ fontFamily: T.mono }}>{a.n_ops}</span>
        <span style={{ color: T.secondary }}>Makespan real:</span>
        <span style={{ fontFamily: T.mono }}>{a.makespan_real_dias}d</span>
      </div>

      <div style={{ fontSize: 11, color: T.secondary, marginBottom: 8, fontStyle: "italic" }}>
        {a.nota}
      </div>

      {!feedbackGiven ? (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => handleFeedback(true)}
            style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: `1px solid ${T.green}40`, background: "transparent", color: T.green, fontSize: 11, cursor: "pointer" }}
          >
            Util
          </button>
          <button
            onClick={() => handleFeedback(false)}
            style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: `1px solid ${T.red}40`, background: "transparent", color: T.red, fontSize: 11, cursor: "pointer" }}
          >
            Nao util
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: T.green, textAlign: "center" }}>Feedback registado</div>
      )}
    </Card>
  );
}

/* ── Tab 4: Ranking Maquinas ────────────────────────────────────── */

function RankingTab() {
  const { ranking } = useMLStore();

  if (!ranking || ranking.tipos.length === 0) {
    return <Card style={{ padding: 32, textAlign: "center", color: T.secondary }}>Sem dados de ranking. Treine os modelos primeiro.</Card>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card style={{ padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Tipo Operacao</th>
              <th style={thStyle}>Melhor Maquina</th>
              <th style={thStyle}>Ratio</th>
              <th style={thStyle}>Amostras</th>
              <th style={thStyle}>Pior Maquina</th>
              <th style={thStyle}>Ratio</th>
              <th style={thStyle}>Diferenca</th>
            </tr>
          </thead>
          <tbody>
            {ranking.tipos.map((tipo) => {
              const machines = ranking.data[tipo] || [];
              if (machines.length === 0) return null;
              const best = machines[0];
              const worst = machines[machines.length - 1];
              const diff = worst.ratio_medio - best.ratio_medio;

              return (
                <tr key={tipo}>
                  <td style={{ ...tdStyle, fontWeight: 600 }}>{tipo}</td>
                  <td style={{ ...tdStyle, color: T.green }}>{best.maquina}</td>
                  <td style={{ ...tdStyle, fontFamily: T.mono, color: T.green }}>{best.ratio_medio.toFixed(3)}</td>
                  <td style={{ ...tdStyle, color: T.secondary }}>{best.n_amostras}</td>
                  <td style={{ ...tdStyle, color: T.red }}>{worst.maquina}</td>
                  <td style={{ ...tdStyle, fontFamily: T.mono, color: T.red }}>{worst.ratio_medio.toFixed(3)}</td>
                  <td style={{ ...tdStyle, fontFamily: T.mono, color: diff > 0.1 ? T.orange : T.secondary }}>
                    {diff > 0 ? "+" : ""}{diff.toFixed(3)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {/* Heatmap */}
      <Card>
        <Label>Heatmap: Ratio por Tipo x Maquina</Label>
        <div style={{ overflow: "auto", marginTop: 8 }}>
          <div style={{ display: "inline-grid", gridTemplateColumns: `120px repeat(${ranking.maquinas.length}, 64px)`, gap: 2, fontSize: 10 }}>
            {/* Header row */}
            <div />
            {ranking.maquinas.map((m) => (
              <div key={m} style={{ textAlign: "center", color: T.secondary, padding: 4, transform: "rotate(-45deg)", transformOrigin: "center", height: 50, display: "flex", alignItems: "end", justifyContent: "center" }}>
                {m}
              </div>
            ))}

            {/* Data rows */}
            {ranking.tipos.map((tipo) => {
              const machines = ranking.data[tipo] || [];
              const scoreMap: Record<string, MachineScoreML> = {};
              machines.forEach((m) => { scoreMap[m.maquina] = m; });

              return (
                <React.Fragment key={tipo}>
                  <div style={{ color: T.primary, fontWeight: 600, padding: "4px 8px", display: "flex", alignItems: "center" }}>
                    {tipo}
                  </div>
                  {ranking.maquinas.map((maq) => {
                    const s = scoreMap[maq];
                    if (!s) {
                      return <div key={maq} style={{ background: T.elevated, borderRadius: 4, padding: 4, textAlign: "center", color: T.tertiary }}>-</div>;
                    }
                    const color =
                      s.ratio_medio <= 1.05 ? T.green :
                      s.ratio_medio <= 1.15 ? T.orange : T.red;
                    return (
                      <div
                        key={maq}
                        title={`${maq}: ratio=${s.ratio_medio.toFixed(3)}, n=${s.n_amostras}`}
                        style={{
                          background: `${color}20`,
                          border: `1px solid ${color}40`,
                          borderRadius: 4,
                          padding: 4,
                          textAlign: "center",
                          fontFamily: T.mono,
                          color,
                          fontWeight: 600,
                        }}
                      >
                        {s.ratio_medio.toFixed(2)}
                      </div>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ── Tab 5: Anomalias ───────────────────────────────────────────── */

function AnomaliasTab() {
  const { anomalies } = useMLStore();

  if (anomalies.length === 0) {
    return <Card style={{ padding: 32, textAlign: "center", color: T.secondary }}>Sem anomalias detectadas. Sistema a funcionar normalmente.</Card>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Label>Anomalias Activas ({anomalies.length})</Label>
      {anomalies.map((a, i) => {
        const isPattern = "descricao" in a;
        const severity = (a.desvio_pct ?? 0) > 30 ? T.red : T.orange;

        return (
          <Card key={i} style={{ borderLeft: `3px solid ${severity}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {a.op_id !== undefined && (
                  <span style={{ fontWeight: 600, fontSize: 13 }}>Op {a.op_id}</span>
                )}
                <Pill color={severity}>{a.tipo ?? (a as any).tipo}</Pill>
              </div>
              {a.timestamp && (
                <span style={{ fontSize: 10, color: T.secondary }}>{a.timestamp}</span>
              )}
            </div>

            {!isPattern && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12, marginBottom: 6 }}>
                <div>
                  <span style={{ color: T.secondary }}>Projecao: </span>
                  <span style={{ fontFamily: T.mono }}>{a.projecao_h?.toFixed(1)}h</span>
                </div>
                <div>
                  <span style={{ color: T.secondary }}>Esperado: </span>
                  <span style={{ fontFamily: T.mono }}>{a.esperado_h?.toFixed(1)}h</span>
                </div>
                <div>
                  <span style={{ color: T.secondary }}>Desvio: </span>
                  <span style={{ fontFamily: T.mono, color: severity }}>+{a.desvio_pct?.toFixed(0)}%</span>
                </div>
              </div>
            )}

            {"descricao" in a && (
              <div style={{ fontSize: 12, color: T.primary, marginBottom: 6 }}>
                {(a as any).descricao}
              </div>
            )}

            <div style={{ fontSize: 11, color: T.blue, fontStyle: "italic" }}>
              {a.acao_sugerida ?? (a as any).acao_sugerida}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// Need React import for Fragment usage
import React from "react";
