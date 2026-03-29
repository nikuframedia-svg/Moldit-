import { useEffect, useMemo, useState } from "react";
import { T } from "../theme/tokens";
import { getConfig, getOps, updateConfig, editMachine, addHoliday, removeHoliday, applyPreset } from "../api/endpoints";
import type { MolditConfig, Operacao, ScoreMoldit } from "../api/types";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { Divider } from "../components/ui/Divider";
import { useDataStore } from "../stores/useDataStore";

type Section = "geral" | "maquinas" | "feriados" | "presets" | "operacoes";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "geral", label: "Geral" },
  { id: "maquinas", label: "Maquinas" },
  { id: "presets", label: "Presets" },
  { id: "feriados", label: "Feriados" },
  { id: "operacoes", label: "Operacoes" },
];

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

const inputStyle: React.CSSProperties = {
  background: T.elevated, border: `0.5px solid ${T.border}`,
  borderRadius: 6, padding: "4px 8px", fontSize: 12,
  color: T.primary, fontFamily: T.mono, outline: "none",
  width: 100, textAlign: "right",
};

const btnStyle: React.CSSProperties = {
  background: T.elevated, border: `0.5px solid ${T.border}`,
  borderRadius: 8, padding: "6px 14px", cursor: "pointer",
  fontSize: 12, color: T.secondary, fontFamily: "inherit",
};

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
      <span style={{ fontSize: 12, color: T.secondary }}>{label}</span>
      <span style={{ fontSize: 12, color: T.primary, fontFamily: T.mono }}>{String(value)}</span>
    </div>
  );
}

// ── Score Delta Banner ──────────────────────────────────────────

function ScoreDelta({ prev, curr, onClear }: { prev: ScoreMoldit; curr: ScoreMoldit; onClear: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClear, 6000);
    return () => clearTimeout(t);
  }, [onClear]);

  const items = [
    { l: "Makespan", p: prev.makespan_total_dias, c: curr.makespan_total_dias, u: "d" },
    { l: "Compliance", p: prev.deadline_compliance, c: curr.deadline_compliance, u: "%" },
    { l: "Setups", p: prev.total_setups, c: curr.total_setups },
  ];

  return (
    <div style={{
      display: "flex", gap: 16, alignItems: "center",
      padding: "10px 16px", background: T.green + "12",
      border: `0.5px solid ${T.green}40`, borderRadius: 10,
    }}>
      <span style={{ fontSize: 12, color: T.green, fontWeight: 600 }}>Guardado</span>
      {items.map((it) => {
        const changed = it.p !== it.c;
        const fmt = (v: unknown) => typeof v === "number" ? (v % 1 === 0 ? String(v) : (v as number).toFixed(1)) : String(v);
        return (
          <span key={it.l} style={{ fontSize: 11, color: changed ? T.primary : T.tertiary, fontFamily: T.mono }}>
            {it.l}: {fmt(it.p)}-&gt;{fmt(it.c)}{it.u ?? ""}
          </span>
        );
      })}
    </div>
  );
}

// ── Presets ──────────────────────────────────────────────────────

const PRESETS = [
  { id: "rapido", label: "Rapido (Makespan)", color: T.red, desc: "Minimiza o tempo total de producao." },
  { id: "equilibrado", label: "Equilibrado", color: T.blue, desc: "Balanco entre todos os objectivos." },
  { id: "min_setups", label: "Min Setups", color: T.orange, desc: "Minimiza trocas de ferramenta / setup." },
  { id: "compliance", label: "Max Compliance", color: T.green, desc: "Maximiza cumprimento de prazos." },
];

// ── Main ConfigPage ──────────────────────────────────────────────

export function ConfigPage() {
  const refreshAll = useDataStore((s) => s.refreshAll);
  const [config, setConfig] = useState<MolditConfig | null>(null);
  const [ops, setOps] = useState<Operacao[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("geral");
  const [opsSearch, setOpsSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [delta, setDelta] = useState<{ prev: ScoreMoldit; curr: ScoreMoldit } | null>(null);
  const [newHoliday, setNewHoliday] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  // Scoring edits
  const [scoringEdits, setScoringEdits] = useState<Record<string, number>>({});
  const scoringHasChanges = Object.keys(scoringEdits).length > 0;

  useEffect(() => {
    Promise.all([getConfig(), getOps()])
      .then(([c, o]) => { setConfig(c); setOps(o); })
      .catch((e) => setError(String(e)));
  }, []);

  const filteredOps = useMemo(() => {
    if (!ops) return [];
    if (!opsSearch) return ops;
    const q = opsSearch.toLowerCase();
    return ops.filter((o) =>
      o.molde.toLowerCase().includes(q) ||
      o.nome.toLowerCase().includes(q) ||
      (o.recurso ?? "").toLowerCase().includes(q)
    );
  }, [ops, opsSearch]);

  // Group ops by mold
  const opsByMolde = useMemo(() => {
    const map = new Map<string, Operacao[]>();
    for (const op of filteredOps) {
      const list = map.get(op.molde) ?? [];
      list.push(op);
      map.set(op.molde, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredOps]);

  const reload = async () => {
    const fresh = await getConfig();
    setConfig(fresh);
    refreshAll();
  };

  const showDelta = (prev: ScoreMoldit, curr: ScoreMoldit) => setDelta({ prev, curr });

  const withSave = async (fn: () => Promise<{ score?: ScoreMoldit; [k: string]: unknown }>) => {
    setSaving(true);
    try {
      await fn();
      await reload();
    } catch (e) {
      alert(`Erro: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveScoring = async () => {
    if (!scoringHasChanges || !config) return;
    setSaving(true);
    setMsg(null);
    try {
      const updates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(scoringEdits)) {
        updates[`scoring.${k}`] = v;
      }
      const res = await updateConfig(updates);
      setScoringEdits({});
      const fresh = await getConfig();
      setConfig(fresh);
      showDelta(config as unknown as ScoreMoldit, res.score);
      refreshAll();
    } catch (e) {
      setMsg(`Erro: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePreset = async (name: string) => {
    if (!confirm(`Aplicar preset "${name}"?`)) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await applyPreset(name);
      const fresh = await getConfig();
      setConfig(fresh);
      setMsg(`Preset "${name}" aplicado (${res.changed.length} parametros)`);
      refreshAll();
    } catch (e) {
      setMsg(`Erro: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <div style={{ color: T.red, padding: 24 }}>{error}</div>;
  if (!config) return <div style={{ color: T.secondary, padding: 24 }}>A carregar...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Section tabs */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              background: section === s.id ? T.elevated : "transparent",
              border: `0.5px solid ${section === s.id ? T.borderHover : T.border}`,
              color: section === s.id ? T.primary : T.secondary,
              borderRadius: 8, padding: "5px 12px", cursor: "pointer",
              fontSize: 12, fontWeight: section === s.id ? 600 : 400, fontFamily: "inherit",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Score delta banner */}
      {delta && <ScoreDelta prev={delta.prev} curr={delta.curr} onClear={() => setDelta(null)} />}

      {/* ── GERAL ──────────────────────────────────────────────── */}
      {section === "geral" && (
        <Card>
          <KV label="Nome" value={config.name} />
          <KV label="Maquinas" value={Object.keys(config.machines).length} />
          <KV label="Feriados" value={config.holidays.length} />
          <Divider />
          <div style={{ paddingTop: 8 }}>
            <Label style={{ marginBottom: 8 }}>Pesos de Scoring</Label>
            {config.scoring && Object.entries(config.scoring).map(([key, val]) => {
              const editVal = scoringEdits[key];
              return (
                <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
                  <span style={{ fontSize: 12, color: T.secondary }}>{key.replace("weight_", "")}</span>
                  <input
                    type="number" step="0.1"
                    value={editVal !== undefined ? editVal : val}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (isNaN(v)) return;
                      if (v === val) {
                        const next = { ...scoringEdits };
                        delete next[key];
                        setScoringEdits(next);
                      } else {
                        setScoringEdits({ ...scoringEdits, [key]: v });
                      }
                    }}
                    style={{ ...inputStyle, width: 80, borderColor: key in scoringEdits ? T.blue : T.border }}
                  />
                </div>
              );
            })}
            {scoringHasChanges && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={handleSaveScoring} disabled={saving} style={{ ...btnStyle, background: T.blue, color: "#fff", border: "none" }}>
                  {saving ? "..." : "Guardar"}
                </button>
                <button onClick={() => setScoringEdits({})} style={btnStyle}>Cancelar</button>
              </div>
            )}
            {msg && <span style={{ fontSize: 11, color: msg.startsWith("Erro") ? T.red : T.green, marginTop: 4, display: "block" }}>{msg}</span>}
          </div>
        </Card>
      )}

      {/* ── MAQUINAS ───────────────────────────────────── */}
      {section === "maquinas" && (
        <Card style={{ padding: 0, overflow: "auto", maxHeight: 500 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Maquina</th>
                <th style={thStyle}>Grupo</th>
                <th style={thStyle}>Regime (h/dia)</th>
                <th style={thStyle}>Setup (h)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.machines).map(([id, m]) => (
                <tr key={id}>
                  <td style={tdStyle}>{id}</td>
                  <td style={{ ...tdStyle, fontFamily: T.sans }}>{m.group}</td>
                  <td style={tdStyle}>{m.regime_h}</td>
                  <td style={tdStyle}>
                    <input
                      type="number" step="0.25" min="0"
                      disabled={saving}
                      defaultValue={m.setup_h}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val !== m.setup_h) {
                          withSave(() => editMachine(id, { setup_h: val }));
                        }
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      style={{ ...inputStyle, width: 70 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ── PRESETS ────────────────────────────────────── */}
      {section === "presets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {PRESETS.map((p) => (
            <Card key={p.id} style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 14, fontWeight: 600, color: p.color }}>{p.label}</span>
                  <div style={{ fontSize: 12, color: T.secondary, marginTop: 2 }}>{p.desc}</div>
                </div>
                <button
                  onClick={() => handlePreset(p.id)}
                  disabled={saving}
                  style={{
                    background: p.color + "18",
                    border: `0.5px solid ${p.color}50`,
                    borderRadius: 8, padding: "6px 16px", cursor: "pointer",
                    fontSize: 12, fontWeight: 500, color: p.color, fontFamily: "inherit",
                    opacity: saving ? 0.5 : 1,
                  }}
                >
                  Aplicar
                </button>
              </div>
            </Card>
          ))}
          {msg && <span style={{ fontSize: 11, color: msg.startsWith("Erro") ? T.red : T.green }}>{msg}</span>}
        </div>
      )}

      {/* ── FERIADOS ──────────────────────────────────── */}
      {section === "feriados" && (
        <Card>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input
              type="date"
              value={newHoliday}
              onChange={(e) => setNewHoliday(e.target.value)}
              style={{ ...inputStyle, width: 160, textAlign: "left" }}
            />
            <button
              disabled={!newHoliday || saving}
              onClick={async () => {
                await withSave(() => addHoliday(newHoliday));
                setNewHoliday("");
              }}
              style={{ ...btnStyle, color: T.blue, borderColor: T.blue + "50", opacity: !newHoliday || saving ? 0.5 : 1 }}
            >
              Adicionar
            </button>
          </div>
          {config.holidays.length === 0 ? (
            <div style={{ color: T.secondary, fontSize: 13 }}>Sem feriados configurados.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {config.holidays.map((h) => (
                <span key={h} style={{
                  fontSize: 12, fontFamily: T.mono, color: T.primary,
                  background: T.elevated, padding: "4px 10px", borderRadius: 6,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {h}
                  <button
                    disabled={saving}
                    onClick={() => {
                      if (confirm(`Remover feriado ${h}?`)) {
                        withSave(() => removeHoliday(h));
                      }
                    }}
                    style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 13, fontFamily: "inherit", padding: 0, opacity: saving ? 0.5 : 1 }}
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── OPERACOES (read-only, grouped by mold) ────── */}
      {section === "operacoes" && (
        <>
          <input
            type="text"
            placeholder="Filtrar molde, nome, recurso..."
            value={opsSearch}
            onChange={(e) => setOpsSearch(e.target.value)}
            style={{
              background: T.elevated, border: `0.5px solid ${T.border}`,
              borderRadius: 8, padding: "6px 12px", fontSize: 12,
              color: T.primary, fontFamily: T.mono, outline: "none", width: 280,
            }}
          />
          {opsByMolde.map(([molde, moldeOps]) => (
            <Card key={molde} style={{ padding: 0, overflow: "auto" }}>
              <div style={{ padding: "12px 16px 8px" }}>
                <Label>{molde} ({moldeOps.length} operacoes)</Label>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Op ID</th>
                    <th style={thStyle}>Nome</th>
                    <th style={thStyle}>Componente</th>
                    <th style={thStyle}>Recurso</th>
                    <th style={thStyle}>Duracao (h)</th>
                    <th style={thStyle}>Progresso</th>
                    <th style={thStyle}>Restante (h)</th>
                  </tr>
                </thead>
                <tbody>
                  {moldeOps.map((op) => (
                    <tr key={op.op_id}>
                      <td style={tdStyle}>{op.op_id}</td>
                      <td style={{ ...tdStyle, fontFamily: T.sans }}>{op.nome}</td>
                      <td style={{ ...tdStyle, fontFamily: T.sans }}>{op.componente}</td>
                      <td style={tdStyle}>{op.recurso ?? "-"}</td>
                      <td style={tdStyle}>{op.duracao_h.toFixed(1)}</td>
                      <td style={tdStyle}>{(op.progresso * 100).toFixed(0)}%</td>
                      <td style={tdStyle}>{op.work_restante_h.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
          {opsByMolde.length === 0 && (
            <div style={{ color: T.secondary, fontSize: 13 }}>Sem operacoes disponiveis.</div>
          )}
        </>
      )}
    </div>
  );
}
