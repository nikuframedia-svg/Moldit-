import { useState } from "react";
import { T } from "../theme/tokens";
import { simulate, checkCTP } from "../api/endpoints";
import { useDataStore } from "../stores/useDataStore";
import { useSimulatorStore } from "../stores/useSimulatorStore";
import type { MutationType } from "../api/types";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { Num } from "../components/ui/Num";
import { Pill } from "../components/ui/Pill";
import { Divider } from "../components/ui/Divider";

// ── Mutation schema ──────────────────────────────────────────

interface ParamField {
  key: string;
  label: string;
  type: "text" | "number";
}

interface MutationDef {
  value: MutationType;
  label: string;
  category: string;
  fields: ParamField[];
}

const MUTATION_TYPES: MutationDef[] = [
  // Capacity
  { value: "machine_down", label: "Maquina Parada", category: "Capacidade", fields: [
    { key: "machine_id", label: "Maquina", type: "text" },
    { key: "start_day", label: "De Dia", type: "number" },
    { key: "end_day", label: "Ate Dia", type: "number" },
  ]},
  { value: "overtime", label: "Horas Extra", category: "Capacidade", fields: [
    { key: "machine_id", label: "Maquina", type: "text" },
    { key: "extra_h", label: "Horas Extra", type: "number" },
  ]},
  { value: "force_machine", label: "Forcar Maquina", category: "Capacidade", fields: [
    { key: "op_id", label: "Op ID", type: "number" },
    { key: "machine_id", label: "Para Maquina", type: "text" },
  ]},
  // Prazos
  { value: "deadline_change", label: "Alterar Deadline", category: "Prazos", fields: [
    { key: "molde", label: "Molde", type: "text" },
    { key: "new_deadline", label: "Nova Deadline", type: "text" },
  ]},
  { value: "priority_boost", label: "Prioridade Molde", category: "Prazos", fields: [
    { key: "molde", label: "Molde", type: "text" },
    { key: "boost", label: "Boost (1-10)", type: "number" },
  ]},
  // Calendario
  { value: "add_holiday", label: "Adicionar Feriado", category: "Calendario", fields: [
    { key: "date", label: "Data (YYYY-MM-DD)", type: "text" },
  ]},
  { value: "remove_holiday", label: "Remover Feriado", category: "Calendario", fields: [
    { key: "date", label: "Data (YYYY-MM-DD)", type: "text" },
  ]},
  // Progresso
  { value: "op_done", label: "Marcar Op Concluida", category: "Progresso", fields: [
    { key: "op_id", label: "Op ID", type: "number" },
  ]},
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
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  width: 160,
  cursor: "pointer",
};

const btnStyle: React.CSSProperties = {
  background: T.blue,
  border: "none",
  borderRadius: 8,
  padding: "6px 16px",
  color: "#fff",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

// ── Delta Card helper ────────────────────────────────────────

function DeltaCard({ label, before, after, suffix = "", higher = false }: {
  label: string;
  before: number;
  after: number;
  suffix?: string;
  higher?: boolean;
}) {
  const improved = higher ? after > before : after < before;
  const worsened = higher ? after < before : after > before;
  const color = improved ? T.green : worsened ? T.red : T.secondary;

  return (
    <Card style={{ textAlign: "center" }}>
      <Label>{label}</Label>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 4, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: T.tertiary, fontFamily: T.mono }}>
          {typeof before === "number" && before % 1 !== 0 ? before.toFixed(1) : before}{suffix}
        </span>
        <span style={{ fontSize: 12, color }}>{" \u2192 "}</span>
        <Num size={20} color={color}>
          {typeof after === "number" && after % 1 !== 0 ? after.toFixed(1) : after}{suffix}
        </Num>
      </div>
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────

export function SimulatorPage() {
  const {
    mutations, result, ctpResult,
    addMutation, removeMutation, updateMutationType, updateMutationParam,
    setResult, setCtpResult,
  } = useSimulatorStore();
  const refreshAll = useDataStore((s) => s.refreshAll);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // CTP
  const [ctpMolde, setCtpMolde] = useState("");
  const [ctpLoading, setCtpLoading] = useState(false);
  const [ctpError, setCtpError] = useState<string | null>(null);

  const runSimulation = async () => {
    const validMutations = mutations.filter((m) => m.type).map(({ type, params }) => ({ type, params }));
    if (validMutations.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await simulate(validMutations);
      setResult(res);
      refreshAll();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const runCTP = async () => {
    if (!ctpMolde) return;
    setCtpLoading(true);
    setCtpError(null);
    try {
      const res = await checkCTP(ctpMolde);
      setCtpResult(res);
    } catch (e: unknown) {
      setCtpError(String(e));
    } finally {
      setCtpLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* ── Mutation Builder ── */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: T.primary }}>Simulador de Cenarios</span>
          <button data-testid="btn-add-mutation" onClick={addMutation} style={{ ...btnStyle, background: T.elevated, color: T.blue, border: `0.5px solid ${T.border}` }}>
            + Adicionar Mutacao
          </button>
        </div>

        {mutations.length === 0 ? (
          <Card>
            <div style={{ textAlign: "center", padding: 24, color: T.secondary, fontSize: 13 }}>
              Adiciona mutacoes para simular cenarios what-if: maquina parada, horas extra, alteracao de prazos, etc.
            </div>
          </Card>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {mutations.map((m) => {
              const schema = MUTATION_TYPES.find((t) => t.value === m.type);
              return (
                <Card key={m._key} style={{ padding: "10px 16px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      value={m.type}
                      onChange={(e) => updateMutationType(m._key, e.target.value as MutationType)}
                      style={selectStyle}
                    >
                      {MUTATION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.category}: {t.label}</option>
                      ))}
                    </select>

                    {schema?.fields.map((f) => (
                      <input
                        key={f.key}
                        type={f.type}
                        placeholder={f.label}
                        value={(m.params[f.key] as string) ?? ""}
                        onChange={(e) => updateMutationParam(m._key, f.key, e.target.value)}
                        style={inputStyle}
                      />
                    ))}

                    <button
                      onClick={() => removeMutation(m._key)}
                      style={{ background: "transparent", border: "none", color: T.red, cursor: "pointer", fontSize: 14, padding: "2px 6px" }}
                    >
                      x
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
          <button
            data-testid="btn-simulate"
            onClick={runSimulation}
            disabled={loading || mutations.filter((m) => m.type).length === 0}
            style={{
              ...btnStyle,
              opacity: loading || mutations.filter((m) => m.type).length === 0 ? 0.5 : 1,
            }}
          >
            {loading ? "A simular..." : "Simular"}
          </button>
          {error && <span style={{ fontSize: 12, color: T.red }}>{error}</span>}
        </div>
      </div>

      {/* ── Delta Results ── */}
      {result && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <DeltaCard label="Makespan" before={result.delta.makespan_before} after={result.delta.makespan_after} suffix="d" />
            <DeltaCard label="Compliance" before={result.delta.compliance_before} after={result.delta.compliance_after} suffix="%" higher />
            <DeltaCard label="Setups" before={result.delta.setups_before} after={result.delta.setups_after} />
            <DeltaCard label="Balanceamento" before={result.delta.balance_before} after={result.delta.balance_after} />
          </div>

          {result.summary && (
            <Card>
              <Label style={{ marginBottom: 8 }}>Resumo</Label>
              <div style={{ fontSize: 12, color: T.secondary, lineHeight: 1.8 }}>{result.summary}</div>
            </Card>
          )}

          <span style={{ fontSize: 11, color: T.tertiary }}>Tempo: {result.time_ms.toFixed(0)}ms</span>
        </>
      )}

      <Divider />

      {/* ── CTP ── */}
      <div>
        <span style={{ fontSize: 15, fontWeight: 600, color: T.primary }}>CTP - Verificacao de Prazo</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input
            type="text"
            placeholder="Molde (ex: M1234)"
            value={ctpMolde}
            onChange={(e) => setCtpMolde(e.target.value)}
            style={{ ...inputStyle, width: 200 }}
          />
          <button
            data-testid="btn-ctp"
            onClick={runCTP}
            disabled={ctpLoading || !ctpMolde}
            style={{ ...btnStyle, opacity: ctpLoading || !ctpMolde ? 0.5 : 1 }}
          >
            {ctpLoading ? "A verificar..." : "Verificar"}
          </button>
        </div>
        {ctpError && <div style={{ fontSize: 12, color: T.red, marginTop: 8 }}>{ctpError}</div>}
      </div>

      {ctpResult && (
        <Card>
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <Pill color={ctpResult.feasible ? T.green : T.red}>
              {ctpResult.feasible ? "Viavel" : "Inviavel"}
            </Pill>
            <span style={{ fontSize: 13, fontFamily: T.mono, color: T.primary }}>{ctpResult.molde}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div>
              <Label>Conclusao (dia)</Label>
              <div style={{ fontSize: 14, fontFamily: T.mono, color: T.primary, marginTop: 4 }}>
                Dia {ctpResult.conclusao_dia}
              </div>
            </div>
            <div>
              <Label>Slack (dias)</Label>
              <div style={{ fontSize: 14, fontFamily: T.mono, color: ctpResult.slack_dias >= 0 ? T.green : T.red, marginTop: 4 }}>
                {ctpResult.slack_dias >= 0 ? `+${ctpResult.slack_dias}` : ctpResult.slack_dias}
              </div>
            </div>
            <div>
              <Label>Dias Extra</Label>
              <div style={{ fontSize: 14, fontFamily: T.mono, color: T.primary, marginTop: 4 }}>
                {ctpResult.dias_extra}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
