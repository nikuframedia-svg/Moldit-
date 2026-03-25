import { useEffect, useMemo, useState } from "react";
import { T } from "../theme/tokens";
import { getConfig, getOps, updateConfig } from "../api/endpoints";
import type { FactoryConfig, EOp } from "../api/types";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { Dot } from "../components/ui/Dot";
import { Divider } from "../components/ui/Divider";
import { useDataStore } from "../stores/useDataStore";

type Section = "geral" | "turnos" | "maquinas" | "ferramentas" | "gemeas" | "operadores" | "feriados" | "parametros" | "operacoes";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "geral", label: "Geral" },
  { id: "turnos", label: "Turnos" },
  { id: "maquinas", label: "Maquinas" },
  { id: "ferramentas", label: "Ferramentas" },
  { id: "gemeas", label: "Gemeas" },
  { id: "operadores", label: "Operadores" },
  { id: "feriados", label: "Feriados" },
  { id: "parametros", label: "Parametros" },
  { id: "operacoes", label: "Operacoes" },
];

const thStyle: React.CSSProperties = {
  fontSize: 11,
  color: T.tertiary,
  fontWeight: 500,
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: `1px solid ${T.border}`,
  position: "sticky",
  top: 0,
  background: T.card,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const tdStyle: React.CSSProperties = {
  fontSize: 12,
  color: T.primary,
  padding: "6px 12px",
  borderBottom: `1px solid ${T.border}`,
  fontFamily: T.mono,
};

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}>
      <span style={{ fontSize: 12, color: T.secondary }}>{label}</span>
      <span style={{ fontSize: 12, color: T.primary, fontFamily: T.mono }}>{String(value)}</span>
    </div>
  );
}

const TUNABLES: { key: string; label: string; type: "number" | "boolean" | "select"; options?: string[] }[] = [
  { key: "oee_default", label: "OEE Default", type: "number" },
  { key: "jit_enabled", label: "JIT Activo", type: "boolean" },
  { key: "jit_buffer_pct", label: "JIT Buffer %", type: "number" },
  { key: "jit_threshold", label: "JIT Threshold", type: "number" },
  { key: "max_run_days", label: "Max Run Days", type: "number" },
  { key: "max_edd_gap", label: "Max EDD Gap", type: "number" },
  { key: "edd_swap_tolerance", label: "EDD Swap Tolerance", type: "number" },
  { key: "campaign_window", label: "Campaign Window", type: "number" },
  { key: "urgency_threshold", label: "Urgency Threshold", type: "number" },
  { key: "interleave_enabled", label: "Interleave Activo", type: "boolean" },
  { key: "weight_earliness", label: "Peso Earliness", type: "number" },
  { key: "weight_setups", label: "Peso Setups", type: "number" },
  { key: "weight_balance", label: "Peso Balance", type: "number" },
  { key: "eco_lot_mode", label: "Eco Lot Mode", type: "select", options: ["hard", "soft"] },
];

const inputStyle: React.CSSProperties = {
  background: T.elevated,
  border: `0.5px solid ${T.border}`,
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 12,
  color: T.primary,
  fontFamily: T.mono,
  outline: "none",
  width: 100,
  textAlign: "right",
};

function ParametrosEditor({ config, onSaved }: { config: FactoryConfig; onSaved: (c: FactoryConfig) => void }) {
  const refreshAll = useDataStore((s) => s.refreshAll);
  const [edits, setEdits] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const hasChanges = Object.keys(edits).length > 0;

  const getValue = (key: string) => {
    if (key in edits) return edits[key];
    return (config as Record<string, unknown>)[key];
  };

  const handleChange = (key: string, value: unknown, type: "number" | "boolean" | "select") => {
    const original = (config as Record<string, unknown>)[key];
    const parsed = type === "boolean" ? value : type === "select" ? value : Number(value);
    if (parsed === original) {
      const next = { ...edits };
      delete next[key];
      setEdits(next);
    } else {
      setEdits({ ...edits, [key]: parsed });
    }
  };

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await updateConfig(edits);
      setEdits({});
      setMsg(`Guardado (${res.changed.length} parametros). Score: ${JSON.stringify(res.score)}`);
      // Refresh config locally
      const fresh = await import("../api/endpoints").then((m) => m.getConfig());
      onSaved(fresh);
      refreshAll();
    } catch (e) {
      setMsg(`Erro: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      {TUNABLES.map((t) => (
        <div key={t.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0" }}>
          <span style={{ fontSize: 12, color: T.secondary }}>{t.label}</span>
          {t.type === "boolean" ? (
            <button
              onClick={() => handleChange(t.key, !getValue(t.key), "boolean")}
              style={{
                background: getValue(t.key) ? T.green + "22" : T.red + "22",
                border: `0.5px solid ${getValue(t.key) ? T.green : T.red}`,
                borderRadius: 6, padding: "3px 12px", cursor: "pointer",
                fontSize: 12, color: getValue(t.key) ? T.green : T.red, fontFamily: "inherit",
              }}
            >
              {getValue(t.key) ? "Sim" : "Nao"}
            </button>
          ) : t.type === "select" ? (
            <select
              value={String(getValue(t.key) ?? "")}
              onChange={(e) => handleChange(t.key, e.target.value, "select")}
              style={{
                ...inputStyle,
                width: 120,
                cursor: "pointer",
                textAlign: "left",
                borderColor: t.key in edits ? T.blue : T.border,
              }}
            >
              {t.options?.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input
              type="number"
              step="any"
              value={String(getValue(t.key) ?? "")}
              onChange={(e) => handleChange(t.key, e.target.value, "number")}
              style={{
                ...inputStyle,
                borderColor: t.key in edits ? T.blue : T.border,
              }}
            />
          )}
        </div>
      ))}

      <Divider />

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          style={{
            background: hasChanges ? T.blue : T.elevated,
            border: "none",
            borderRadius: 8,
            padding: "6px 20px",
            cursor: hasChanges ? "pointer" : "default",
            fontSize: 12,
            fontWeight: 600,
            color: hasChanges ? "#fff" : T.tertiary,
            fontFamily: "inherit",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "A guardar..." : "Guardar"}
        </button>
        {hasChanges && (
          <button
            onClick={() => setEdits({})}
            style={{
              background: "transparent", border: `0.5px solid ${T.border}`,
              borderRadius: 8, padding: "6px 14px", cursor: "pointer",
              fontSize: 12, color: T.secondary, fontFamily: "inherit",
            }}
          >
            Cancelar
          </button>
        )}
        {msg && <span style={{ fontSize: 11, color: msg.startsWith("Erro") ? T.red : T.green }}>{msg}</span>}
      </div>
    </Card>
  );
}

export function ConfigPage() {
  const [config, setConfig] = useState<FactoryConfig | null>(null);
  const [ops, setOps] = useState<EOp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("geral");
  const [opsSearch, setOpsSearch] = useState("");

  useEffect(() => {
    Promise.all([getConfig(), getOps()])
      .then(([c, o]) => { setConfig(c); setOps(o); })
      .catch((e) => setError(String(e)));
  }, []);

  const filteredOps = useMemo(() => {
    if (!ops) return [];
    if (!opsSearch) return ops;
    const q = opsSearch.toLowerCase();
    return ops.filter((o) => o.sku.toLowerCase().includes(q) || o.client.toLowerCase().includes(q) || o.machine.toLowerCase().includes(q));
  }, [ops, opsSearch]);

  if (error) return <div style={{ color: T.red, padding: 24 }}>{error}</div>;
  if (!config) return <div style={{ color: T.secondary, padding: 24 }}>A carregar...</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              background: section === s.id ? T.elevated : "transparent",
              border: `0.5px solid ${section === s.id ? T.borderHover : T.border}`,
              color: section === s.id ? T.primary : T.secondary,
              borderRadius: 8,
              padding: "5px 12px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: section === s.id ? 600 : 400,
              fontFamily: "inherit",
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "geral" && (
        <Card>
          <KV label="Nome" value={config.name} />
          <KV label="Site" value={config.site} />
          <KV label="Timezone" value={config.timezone} />
          <KV label="Capacidade Diaria (min)" value={config.day_capacity_min} />
          <KV label="OEE Default" value={config.oee_default} />
          <KV label="Eco Lot Mode" value={config.eco_lot_mode} />
        </Card>
      )}

      {section === "turnos" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>ID</th>
                <th style={thStyle}>Label</th>
                <th style={thStyle}>Inicio (min)</th>
                <th style={thStyle}>Fim (min)</th>
                <th style={thStyle}>Duracao (min)</th>
              </tr>
            </thead>
            <tbody>
              {config.shifts.map((s) => (
                <tr key={s.id}>
                  <td style={tdStyle}>{s.id}</td>
                  <td style={{ ...tdStyle, fontFamily: T.sans }}>{s.label}</td>
                  <td style={tdStyle}>{s.start_min}</td>
                  <td style={tdStyle}>{s.end_min}</td>
                  <td style={tdStyle}>{s.duration_min}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {section === "maquinas" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Maquina</th>
                <th style={thStyle}>Grupo</th>
                <th style={thStyle}>Activa</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.machines).map(([id, m]) => (
                <tr key={id}>
                  <td style={tdStyle}>{id}</td>
                  <td style={{ ...tdStyle, fontFamily: T.sans }}>{m.group}</td>
                  <td style={tdStyle}><Dot color={m.active ? T.green : T.red} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {section === "ferramentas" && (
        <Card style={{ padding: 0, overflow: "auto", maxHeight: 500 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Ferramenta</th>
                <th style={thStyle}>Maquina Primaria</th>
                <th style={thStyle}>Alternativa</th>
                <th style={thStyle}>Setup (h)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.tools).map(([id, t]) => (
                <tr key={id}>
                  <td style={tdStyle}>{id}</td>
                  <td style={tdStyle}>{t.primary}</td>
                  <td style={tdStyle}>{t.alt ?? "-"}</td>
                  <td style={tdStyle}>{t.setup_hours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {section === "gemeas" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {config.twins.length === 0 ? (
            <div style={{ padding: 20, color: T.secondary, fontSize: 13 }}>Sem pecas gemeas configuradas.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>Ferramenta</th>
                  <th style={thStyle}>SKU A</th>
                  <th style={thStyle}>SKU B</th>
                </tr>
              </thead>
              <tbody>
                {config.twins.map((tw, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{tw.tool_id}</td>
                    <td style={tdStyle}>{tw.sku_a}</td>
                    <td style={tdStyle}>{tw.sku_b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {section === "operadores" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Grupo/Turno</th>
                <th style={thStyle}>Operadores</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(config.operators).map(([key, count]) => (
                <tr key={key}>
                  <td style={{ ...tdStyle, fontFamily: T.sans }}>{key}</td>
                  <td style={tdStyle}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {section === "feriados" && (
        <Card>
          {config.holidays.length === 0 ? (
            <div style={{ color: T.secondary, fontSize: 13 }}>Sem feriados configurados.</div>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {config.holidays.map((h) => (
                <span key={h} style={{ fontSize: 12, fontFamily: T.mono, color: T.primary, background: T.elevated, padding: "4px 10px", borderRadius: 6 }}>
                  {h}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {section === "parametros" && (
        <ParametrosEditor config={config} onSaved={(c) => setConfig(c)} />
      )}

      {section === "operacoes" && (
        <>
          <input
            type="text"
            placeholder="Filtrar SKU, cliente, maquina..."
            value={opsSearch}
            onChange={(e) => setOpsSearch(e.target.value)}
            style={{
              background: T.elevated,
              border: `0.5px solid ${T.border}`,
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 12,
              color: T.primary,
              fontFamily: T.mono,
              outline: "none",
              width: 280,
            }}
          />
          <Card style={{ padding: 0, overflow: "auto", maxHeight: 600 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>SKU</th>
                  <th style={thStyle}>Cliente</th>
                  <th style={thStyle}>Maquina</th>
                  <th style={thStyle}>Ferramenta</th>
                  <th style={thStyle}>Alt</th>
                  <th style={thStyle}>Pcs/H</th>
                  <th style={thStyle}>Setup (h)</th>
                  <th style={thStyle}>Eco Lot</th>
                  <th style={thStyle}>Stock</th>
                  <th style={thStyle}>OEE</th>
                </tr>
              </thead>
              <tbody>
                {filteredOps.map((op) => (
                  <tr key={op.id}>
                    <td style={tdStyle}>{op.sku}</td>
                    <td style={{ ...tdStyle, fontFamily: T.sans }}>{op.client}</td>
                    <td style={tdStyle}>{op.machine}</td>
                    <td style={tdStyle}>{op.tool}</td>
                    <td style={tdStyle}>{op.alt_machine ?? "-"}</td>
                    <td style={tdStyle}>{op.pcs_hour}</td>
                    <td style={tdStyle}>{op.setup_hours}</td>
                    <td style={tdStyle}>{op.eco_lot.toLocaleString()}</td>
                    <td style={tdStyle}>{op.stock.toLocaleString()}</td>
                    <td style={tdStyle}>{op.oee}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
