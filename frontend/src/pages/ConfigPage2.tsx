/** CONFIG — "Preciso de mudar algo."
 *
 * 8 tabs: Maquinas, Feriados, Turnos, Operadores, Preferencias, Aprendizagem, Relatorios, Journal
 * Each tab has explanation at the top.
 */

import React, { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import {
  getConfig, updateConfig, editMachine, addHoliday, removeHoliday,
  applyPreset, getCalibration, getMLStatus, getMLEvolution,
  getOperadores, addOperador, deleteOperador, getJournal,
  trainML, bootstrapML, getReportPreview,
} from "../api/endpoints";
import type { MolditConfig, JournalEntry, EvolutionPoint } from "../api/types";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { ExplainBox } from "../components/ExplainBox";
import { useAppStore } from "../stores/useAppStore";
import { useDataStore } from "../stores/useDataStore";
import LineChart from "../components/ml/LineChart";

type Tab = "maquinas" | "feriados" | "turnos" | "operadores" | "presets" | "pesos" | "aprendizagem" | "relatorios" | "journal";

const TABS: { id: Tab; label: string; desc: string }[] = [
  { id: "maquinas", label: "Maquinas", desc: "Gerir maquinas: activar, desactivar, alterar tempos de troca." },
  { id: "feriados", label: "Feriados", desc: "Adicionar ou remover feriados. O plano recalcula ao guardar." },
  { id: "turnos", label: "Turnos", desc: "Configurar horarios de cada turno de trabalho." },
  { id: "operadores", label: "Operadores", desc: "Lista de pessoas e as suas competencias." },
  { id: "presets", label: "Preferencias", desc: "Escolher como o sistema planeia. 4 opcoes disponiveis." },
  { id: "pesos", label: "Pesos", desc: "Ajustar a importancia de cada criterio no planeamento." },
  { id: "aprendizagem", label: "Aprendizagem", desc: "Como o sistema esta a aprender com os moldes concluidos." },
  { id: "relatorios", label: "Relatorios", desc: "Gerar relatorios de producao para consulta ou envio ao cliente." },
  { id: "journal", label: "Historico", desc: "Registo de actividades e eventos do sistema." },
];

const thStyle: React.CSSProperties = {
  fontSize: 11, color: T.tertiary, fontWeight: 500, textAlign: "left" as const,
  padding: "8px 12px", borderBottom: `1px solid ${T.border}`,
  position: "sticky" as const, top: 0, background: T.card,
};
const tdStyle: React.CSSProperties = {
  fontSize: 12, color: T.primary, padding: "6px 12px",
  borderBottom: `1px solid ${T.border}`, fontFamily: T.mono,
};

const PRESETS = [
  { id: "rapido", label: "Rapido", desc: "Minimizar tempo total de producao.", color: T.blue },
  { id: "equilibrado", label: "Equilibrado", desc: "Balanco entre tempo, trocas e carga.", color: T.green },
  { id: "min_setups", label: "Menos trocas", desc: "Reduzir trocas de trabalho entre moldes.", color: T.orange },
  { id: "balanceado", label: "Carga equilibrada", desc: "Distribuir trabalho por todas as maquinas.", color: T.purple },
];

export default function ConfigPage2() {
  const [tab, setTab] = useState<Tab>("maquinas");
  const [config, setConfig] = useState<MolditConfig | null>(null);
  const [msg, setMsg] = useState("");
  const refreshAll = useDataStore((s) => s.refreshAll);

  useEffect(() => { getConfig().then(setConfig).catch((e: any) => setMsg(e.message ?? "Erro ao carregar configuracao")); }, []);

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 3000); };
  const reloadConfig = () => { getConfig().then(setConfig); refreshAll(); };
  const currentTab = TABS.find((t) => t.id === tab);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              padding: "8px 14px", borderRadius: T.radiusSm, border: "none",
              cursor: "pointer", fontSize: 13, fontFamily: "inherit",
              fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? T.primary : T.secondary,
              background: tab === t.id ? T.elevated : "transparent",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {currentTab && <div style={{ fontSize: 13, color: T.secondary }}>{currentTab.desc}</div>}
      {msg && <div style={{ fontSize: 12, color: T.green, padding: "6px 12px", background: `${T.green}10`, borderRadius: 6 }}>{msg}</div>}

      {tab === "maquinas" && <MaquinasTab config={config} onSave={() => { reloadConfig(); showMsg("Maquina actualizada."); }} />}
      {tab === "feriados" && <FeriadosTab config={config} onSave={() => { reloadConfig(); showMsg("Feriados actualizados."); }} />}
      {tab === "turnos" && <TurnosTab config={config} />}
      {tab === "operadores" && <OperadoresTab />}
      {tab === "presets" && <PresetsTab onApply={(name) => { applyPreset(name).then(() => { reloadConfig(); showMsg(`Preset '${name}' aplicado.`); }); }} />}
      {tab === "pesos" && <PesosTab config={config} onSave={(updates) => { updateConfig(updates).then(() => { reloadConfig(); showMsg("Pesos actualizados."); }); }} />}
      {tab === "aprendizagem" && <AprendizagemTab />}
      {tab === "relatorios" && <RelatoriosTab />}
      {tab === "journal" && <JournalTab />}
    </div>
  );
}

/* ── Maquinas ──────────────────────────────────────── */
function MaquinasTab({ config, onSave }: { config: MolditConfig | null; onSave: () => void }) {
  if (!config?.machines) return <div style={{ color: T.secondary }}>Sem dados de maquinas.</div>;
  const machines = Object.entries(config.machines);
  return (
    <Card style={{ padding: 0, overflow: "auto", maxHeight: 500 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th style={thStyle}>Maquina</th><th style={thStyle}>Grupo</th><th style={thStyle}>Regime (h/dia)</th><th style={thStyle}>Troca (h)</th></tr></thead>
        <tbody>
          {machines.map(([id, m]: [string, any]) => (
            <tr key={id}>
              <td style={tdStyle}>{id}</td>
              <td style={tdStyle}>{m.group || "-"}</td>
              <td style={tdStyle}>{m.regime_h || 16}</td>
              <td style={tdStyle}>
                <input defaultValue={m.setup_h ?? 1} type="number" step="0.5"
                  onBlur={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v)) editMachine(id, { setup_h: v }).then(onSave); }}
                  style={{ width: 60, padding: "3px 6px", borderRadius: 4, background: T.bg, color: T.primary, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: T.mono }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ── Feriados ──────────────────────────────────────── */
function FeriadosTab({ config, onSave }: { config: MolditConfig | null; onSave: () => void }) {
  const [newDate, setNewDate] = useState("");
  const holidays = config?.holidays || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
          style={{ padding: "6px 10px", borderRadius: 6, background: T.elevated, color: T.primary, border: `1px solid ${T.border}`, fontSize: 13, fontFamily: "inherit" }} />
        <button onClick={() => { if (newDate) addHoliday(newDate).then(() => { onSave(); setNewDate(""); }); }}
          style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: T.blue, color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          Adicionar
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {holidays.map((h: string) => (
          <span key={h} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, background: T.elevated, color: T.primary, display: "flex", alignItems: "center", gap: 6 }}>
            {h}
            <button onClick={() => removeHoliday(h).then(onSave)} style={{ background: "transparent", border: "none", color: T.red, cursor: "pointer", fontSize: 14 }}>x</button>
          </span>
        ))}
        {holidays.length === 0 && <span style={{ color: T.tertiary, fontSize: 12 }}>Sem feriados configurados.</span>}
      </div>
    </div>
  );
}

/* ── Turnos ──────────────────────────────────────── */
function TurnosTab(_props: { config: MolditConfig | null }) {
  const turnos = [
    { nome: "Manha", inicio: "08:00", fim: "16:00" },
    { nome: "Tarde", inicio: "16:00", fim: "00:00" },
    { nome: "Noite", inicio: "00:00", fim: "08:00" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ExplainBox headline="Os turnos definem os horarios de trabalho. Para alterar, edite o regime de horas por maquina na tab Maquinas." color="blue" />
      <Card style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={thStyle}>Turno</th><th style={thStyle}>Inicio</th><th style={thStyle}>Fim</th></tr></thead>
          <tbody>
            {turnos.map((t) => (
              <tr key={t.nome}><td style={tdStyle}>{t.nome}</td><td style={tdStyle}>{t.inicio}</td><td style={tdStyle}>{t.fim}</td></tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ── Operadores ──────────────────────────────────────── */
function OperadoresTab() {
  const [ops, setOps] = useState<any[]>([]);
  const [formNome, setFormNome] = useState("");
  const [formTurno, setFormTurno] = useState("manha");
  const [formZona, setFormZona] = useState("CNC");
  const setStatus = useAppStore((s) => s.setStatus);
  useEffect(() => { getOperadores().then(setOps).catch((e: any) => setStatus("error", e.message ?? "Erro ao carregar operadores")); }, []);
  const handleAdd = async () => {
    if (!formNome) return;
    await addOperador({ nome: formNome, turno: formTurno, zona: formZona, competencias: [formZona], disponivel: true });
    setFormNome("");
    getOperadores().then(setOps);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
        <div><div style={{ fontSize: 11, color: T.tertiary, marginBottom: 2 }}>Nome</div>
          <input value={formNome} onChange={(e) => setFormNome(e.target.value)} placeholder="Nome"
            style={{ padding: "6px 10px", borderRadius: 6, background: T.elevated, color: T.primary, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit" }} /></div>
        <div><div style={{ fontSize: 11, color: T.tertiary, marginBottom: 2 }}>Turno</div>
          <select value={formTurno} onChange={(e) => setFormTurno(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, background: T.elevated, color: T.primary, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit" }}>
            <option value="manha">Manha</option><option value="tarde">Tarde</option><option value="noite">Noite</option></select></div>
        <div><div style={{ fontSize: 11, color: T.tertiary, marginBottom: 2 }}>Zona</div>
          <select value={formZona} onChange={(e) => setFormZona(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: 6, background: T.elevated, color: T.primary, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit" }}>
            <option value="CNC">CNC</option><option value="Erosao">Erosao</option><option value="Montagem">Montagem</option><option value="Bancada">Bancada</option></select></div>
        <button onClick={handleAdd} style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: T.blue, color: "#fff", fontSize: 12, cursor: "pointer", fontFamily: "inherit", height: 32 }}>
          Adicionar</button>
      </div>
      <Card style={{ padding: 0, overflow: "auto", maxHeight: 400 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={thStyle}>Nome</th><th style={thStyle}>Turno</th><th style={thStyle}>Zona</th><th style={thStyle}>Competencias</th><th style={thStyle}></th></tr></thead>
          <tbody>{ops.map((o: any) => (
            <tr key={o.id}><td style={tdStyle}>{o.nome}</td><td style={tdStyle}>{o.turno}</td><td style={tdStyle}>{o.zona}</td>
              <td style={tdStyle}>{(o.competencias || []).join(", ")}</td>
              <td style={tdStyle}><button onClick={() => { if (confirm(`Remover ${o.nome}?`)) deleteOperador(o.id).then(() => getOperadores().then(setOps)); }}
                style={{ background: "transparent", border: "none", color: T.red, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>Remover</button></td></tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}

/* ── Presets ──────────────────────────────────────── */
function PresetsTab({ onApply }: { onApply: (name: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
      {PRESETS.map((p) => (
        <Card key={p.id}>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.primary, marginBottom: 4 }}>{p.label}</div>
          <div style={{ fontSize: 13, color: T.secondary, marginBottom: 12, lineHeight: 1.5 }}>{p.desc}</div>
          <button onClick={() => { if (confirm(`Aplicar preset '${p.label}'?`)) onApply(p.id); }}
            style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: p.color, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            Aplicar</button>
        </Card>
      ))}
    </div>
  );
}

/* ── Pesos de Scoring ──────────────────────────────── */
function PesosTab({ config, onSave }: { config: MolditConfig | null; onSave: (u: Record<string, unknown>) => void }) {
  const scoring = (config as any)?.scoring || {};
  const [edits, setEdits] = useState<Record<string, number>>({});
  const WEIGHTS = [
    { key: "weight_makespan", label: "Tempo total de producao", desc: "Quanto menor, melhor" },
    { key: "weight_deadline_compliance", label: "Cumprimento de prazos", desc: "Percentagem de moldes dentro do prazo" },
    { key: "weight_setups", label: "Trocas de trabalho", desc: "Minimizar tempo perdido em trocas" },
    { key: "weight_utilization", label: "Distribuicao de carga", desc: "Equilibrar trabalho entre maquinas" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {WEIGHTS.map((w) => {
        const current = edits[w.key] ?? scoring[w.key] ?? 1;
        return (
          <Card key={w.key}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.primary }}>{w.label}</div>
                <div style={{ fontSize: 12, color: T.secondary }}>{w.desc}</div>
              </div>
              <input type="number" step="0.1" min="0" max="10" value={current}
                onChange={(e) => setEdits({ ...edits, [w.key]: parseFloat(e.target.value) || 0 })}
                style={{ width: 70, padding: "4px 8px", borderRadius: 6, background: T.bg, color: T.primary, border: `1px solid ${T.border}`, fontSize: 14, fontFamily: T.mono, textAlign: "center" as const }} />
            </div>
          </Card>
        );
      })}
      {Object.keys(edits).length > 0 && (
        <button onClick={() => { onSave(edits); setEdits({}); }}
          style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: T.blue, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", alignSelf: "flex-start" }}>
          Guardar pesos</button>
      )}
    </div>
  );
}

/* ── Aprendizagem (ML) ──────────────────────────────── */
function AprendizagemTab() {
  const [mlStatus, setMlStatus] = useState<any>(null);
  const [calibration, setCalibration] = useState<any>(null);
  const [evolution, setEvolution] = useState<EvolutionPoint[]>([]);
  const [training, setTraining] = useState(false);
  const [trainMsg, setTrainMsg] = useState("");
  const setStatus = useAppStore((s) => s.setStatus);

  useEffect(() => {
    getMLStatus().then(setMlStatus).catch((e: any) => setStatus("error", e.message ?? "Erro ao carregar estado ML"));
    getCalibration().then(setCalibration).catch((e: any) => setStatus("error", e.message ?? "Erro ao carregar calibracao"));
    getMLEvolution().then(setEvolution).catch((e: any) => setStatus("error", e.message ?? "Erro ao carregar evolucao ML"));
  }, []);

  const handleTrain = async () => {
    setTraining(true); setTrainMsg("");
    try {
      const r = await trainML();
      setTrainMsg(`Treino concluido. ${r.models_trained.length} modelos actualizados em ${r.duration_s.toFixed(1)}s.`);
      getMLStatus().then(setMlStatus);
      getMLEvolution().then(setEvolution);
    } catch { setTrainMsg("Erro no treino."); }
    setTraining(false);
  };

  // Generate phrases
  const frases: string[] = [];
  if (mlStatus) {
    frases.push(mlStatus.n_projetos > 0
      ? `O sistema ja aprendeu com ${mlStatus.n_projetos} moldes.`
      : "O sistema ainda nao tem dados historicos."
    );
    if (mlStatus.last_retrain) frases.push(`Ultima atualizacao: ${mlStatus.last_retrain.slice(0, 16).replace("T", " ")}.`);
    frases.push(`${mlStatus.models_active?.length || 0} de 5 modelos activos.`);
  }
  if (calibration?.fiabilidade) {
    const fiab = Object.values(calibration.fiabilidade) as any[];
    if (fiab.length > 0) {
      const best = fiab.reduce((a: any, b: any) => a.uptime_pct > b.uptime_pct ? a : b);
      const worst = fiab.reduce((a: any, b: any) => a.uptime_pct < b.uptime_pct ? a : b);
      frases.push(`A ${worst.maquina_id} tem ${((1 - worst.uptime_pct) * 100).toFixed(0)}% de tempo parado. A ${best.maquina_id} e a mais fiavel (${(best.uptime_pct * 100).toFixed(0)}% activa).`);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Phrases */}
      {frases.map((f, i) => <ExplainBox key={i} headline={f} color="blue" />)}

      {/* Evolution chart */}
      {evolution.length >= 2 && (
        <Card>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary, marginBottom: 8 }}>Evolucao da precisao das previsoes</div>
          <LineChart
            data={evolution.map((e) => ({ date: e.date, value: e.mae }))}
            color={T.blue} label="Erro medio (horas)" formatY={(v) => v.toFixed(2) + "h"}
            width={600} height={200}
          />
        </Card>
      )}

      {/* Calibration factors table */}
      {calibration?.fatores && Object.keys(calibration.fatores).length > 0 && (
        <Card style={{ padding: 0, overflow: "auto", maxHeight: 300 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={thStyle}>Tipo operacao</th><th style={thStyle}>Ratio (real/plano)</th>
              <th style={thStyle}>Desvio</th><th style={thStyle}>Amostras</th><th style={thStyle}>Confianca</th>
            </tr></thead>
            <tbody>
              {Object.entries(calibration.fatores).map(([code, f]: [string, any]) => (
                <tr key={code}>
                  <td style={tdStyle}>{code}</td>
                  <td style={{ ...tdStyle, color: f.ratio_media > 1.15 ? T.red : f.ratio_media > 1.05 ? T.orange : T.green }}>
                    {f.ratio_media.toFixed(3)}
                  </td>
                  <td style={tdStyle}>{f.ratio_std.toFixed(3)}</td>
                  <td style={tdStyle}>{f.n_amostras}</td>
                  <td style={tdStyle}>{(f.confianca * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Train/Bootstrap buttons */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={handleTrain} disabled={training}
          style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: T.blue, color: "#fff", fontSize: 13, fontWeight: 600, cursor: training ? "wait" : "pointer", fontFamily: "inherit" }}>
          {training ? "..." : "Actualizar previsoes"}
        </button>
        {trainMsg && <span style={{ fontSize: 12, color: T.green }}>{trainMsg}</span>}
      </div>

      {/* Bootstrap ML — import historical data */}
      <BootstrapSection />
    </div>
  );
}

/* ── Bootstrap ML ────────────────────────────────────── */
function BootstrapSection() {
  const [json, setJson] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!json.trim()) return;
    setLoading(true);
    setMsg("");
    try {
      const projetos = JSON.parse(json);
      await bootstrapML(Array.isArray(projetos) ? projetos : [projetos]);
      setMsg("Importacao concluida. Os modelos vao melhorar com estes dados.");
      setJson("");
    } catch (e: any) {
      setMsg(e.message ?? "Erro na importacao. Verifique o formato JSON.");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>Importar historico</div>
      <div style={{ fontSize: 12, color: T.tertiary }}>
        Cole aqui os dados de projectos concluidos (JSON) para melhorar as previsoes.
      </div>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        placeholder='[{"molde_id": "M100", "cliente": "BMW", "n_operacoes": 45, ...}]'
        rows={4}
        style={{
          padding: "10px 12px", borderRadius: 8,
          border: `1px solid ${T.border}`, background: T.elevated,
          color: T.primary, fontSize: 12, fontFamily: T.mono,
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={handleImport}
          disabled={loading || !json.trim()}
          style={{
            padding: "6px 16px", borderRadius: 6, border: "none",
            background: loading || !json.trim() ? T.tertiary : T.blue,
            color: "#fff", fontSize: 12, fontWeight: 600,
            cursor: loading || !json.trim() ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {loading ? "A importar..." : "Importar"}
        </button>
        {msg && <span style={{ fontSize: 12, color: msg.includes("Erro") ? T.red : T.green }}>{msg}</span>}
      </div>
    </div>
  );
}

/* ── Relatorios ──────────────────────────────────────── */
function RelatoriosTab() {
  const moldes = useDataStore((s) => s.moldes);
  const [selectedMolde, setSelectedMolde] = useState("");
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const setStatus = useAppStore((s) => s.setStatus);

  const handlePreview = async (tipo: string) => {
    setLoading(true);
    setPreview("");
    try {
      const html = await getReportPreview(tipo, selectedMolde || undefined);
      setPreview(typeof html === "string" ? html : JSON.stringify(html));
    } catch (e: any) {
      setStatus("error", e.message ?? "Erro ao gerar relatorio");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Report type buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <Card
          style={{ cursor: "pointer", textAlign: "center", padding: "20px 16px" }}
          onClick={() => handlePreview("diario")}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>{"\uD83D\uDCCB"}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.primary }}>Relatorio do dia</div>
          <div style={{ fontSize: 12, color: T.secondary, marginTop: 4 }}>Resumo da producao de hoje</div>
        </Card>

        <Card
          style={{ cursor: "pointer", textAlign: "center", padding: "20px 16px" }}
          onClick={() => handlePreview("semanal")}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>{"\uD83D\uDCC6"}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.primary }}>Relatorio da semana</div>
          <div style={{ fontSize: 12, color: T.secondary, marginTop: 4 }}>Resumo semanal completo</div>
        </Card>

        <Card
          style={{ cursor: "pointer", textAlign: "center", padding: "20px 16px" }}
          onClick={() => {
            if (!selectedMolde) {
              setStatus("warning", "Seleccione um molde primeiro.");
              return;
            }
            handlePreview("cliente");
          }}
        >
          <div style={{ fontSize: 24, marginBottom: 8 }}>{"\uD83D\uDCE7"}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.primary }}>Relatorio para cliente</div>
          <div style={{ fontSize: 12, color: T.secondary, marginTop: 4 }}>Para enviar ao cliente</div>
        </Card>
      </div>

      {/* Molde selector for client report */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 11, color: T.tertiary }}>Molde (para relatorio de cliente)</label>
        <select
          value={selectedMolde}
          onChange={(e) => setSelectedMolde(e.target.value)}
          style={{
            padding: "8px 12px", borderRadius: 6,
            border: `1px solid ${T.border}`, background: T.elevated,
            color: T.primary, fontSize: 13, fontFamily: "inherit",
            maxWidth: 300,
          }}
        >
          <option value="">Todos os moldes</option>
          {moldes.map((m) => (
            <option key={m.id} value={m.id}>{m.id} — {m.cliente}</option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ fontSize: 13, color: T.secondary, padding: 16 }}>A gerar relatorio...</div>
      )}

      {/* Preview */}
      {preview && !loading && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: 16, fontSize: 13,
              lineHeight: 1.6, maxHeight: 500, overflow: "auto",
              background: "#fff", color: "#000",
            }}
            dangerouslySetInnerHTML={{ __html: preview }}
          />
        </Card>
      )}
    </div>
  );
}

/* ── Journal ──────────────────────────────────────── */
function JournalTab() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const setStatus = useAppStore((s) => s.setStatus);
  useEffect(() => { getJournal().then(setEntries).catch((e: any) => setStatus("error", e.message ?? "Erro ao carregar historico")); }, []);
  if (entries.length === 0) return <ExplainBox headline="Sem registos de actividade." color="blue" />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {entries.map((j, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "4px 0" }}>
          <Pill color={j.severity === "error" ? T.red : j.severity === "warning" ? T.orange : T.green}>
            {j.step}
          </Pill>
          <span style={{ color: T.secondary, flex: 1 }}>{j.message}</span>
          {j.elapsed_ms > 0 && <span style={{ color: T.tertiary, fontFamily: T.mono, fontSize: 10 }}>{j.elapsed_ms}ms</span>}
        </div>
      ))}
    </div>
  );
}
