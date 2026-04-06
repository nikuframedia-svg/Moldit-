/** SimulatorPanel — "E se...?" lateral panel.
 *
 * Questions in plain Portuguese. Delta breakdown before→after.
 * "Aplicar" button to save simulation results.
 */

import { useState } from "react";
import { T } from "../theme/tokens";
import { useSimulatorStore } from "../stores/useSimulatorStore";
import { useDataStore } from "../stores/useDataStore";
import { simulate } from "../api/endpoints";
import { ExplainBox } from "./ExplainBox";

const MUTATION_LABELS: Record<string, string> = {
  machine_down: "E se uma maquina parar?",
  overtime: "E se autorizarmos horas extra?",
  deadline_change: "E se o prazo mudar?",
  priority_boost: "E se um molde for prioritario?",
  op_done: "E se uma operacao ficasse pronta agora?",
  force_machine: "E se forcar uma maquina?",
};

const PARAM_LABELS: Record<string, Record<string, string>> = {
  machine_down: { maquina_id: "Maquina", dias: "Quantos dias?" },
  overtime: { maquina_id: "Maquina", horas: "Quantas horas extra?" },
  deadline_change: { molde: "Molde", nova_data: "Nova data" },
  priority_boost: { molde: "Molde" },
  op_done: { op_id: "Operacao (ID)" },
  force_machine: { op_id: "Operacao (ID)", maquina_id: "Maquina" },
};

interface Props { onClose: () => void }

export function SimulatorPanel({ onClose }: Props) {
  const { mutations, result, addMutation, removeMutation, updateMutationType, updateMutationParam, setResult } = useSimulatorStore();
  const score = useDataStore((s) => s.score);
  const refreshAll = useDataStore((s) => s.refreshAll);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  const handleSimulate = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await simulate(mutations.map((m) => ({ tipo: m.tipo, params: m.params })));
      setResult(res);
    } catch (e: any) {
      setError(e?.message || "Erro na simulacao.");
    }
    setLoading(false);
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      // Use simulate-apply endpoint to persist
      const { post } = await import("../api/client");
      await post("/api/data/simulate-apply", { mutations: mutations.map((m) => ({ tipo: m.tipo, params: m.params })) });
      await refreshAll();
      setResult(null);
    } catch (e: any) {
      setError(e?.message || "Erro ao aplicar.");
    }
    setApplying(false);
  };

  // Delta computation
  const beforeMakespan = score?.makespan_total_dias || 0;
  const afterMakespan = result?.score?.makespan_total_dias || 0;
  const beforeComp = score?.deadline_compliance || 0;
  const afterComp = result?.score?.deadline_compliance || 0;
  const beforeSetups = score?.total_setups || 0;
  const afterSetups = result?.score?.total_setups || 0;

  return (
    <div
      style={{
        width: 360, height: "100%", background: T.elevated,
        borderLeft: `1px solid ${T.border}`, padding: 20,
        display: "flex", flexDirection: "column", gap: 16, overflow: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: T.primary }}>E se...?</span>
        <button onClick={onClose} style={{ background: "transparent", border: "none", color: T.secondary, cursor: "pointer", fontSize: 18 }}>x</button>
      </div>

      <div style={{ fontSize: 13, color: T.secondary, lineHeight: 1.5 }}>
        Teste cenarios. Os resultados aparecem imediatamente.
      </div>

      {/* Mutations */}
      {mutations.map((m) => (
        <div key={m._key} style={{ background: T.card, borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <select
              value={m.tipo}
              onChange={(e) => updateMutationType(m._key, e.target.value)}
              style={{ flex: 1, padding: "6px 8px", borderRadius: 6, background: T.elevated, color: T.primary, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: "inherit" }}
            >
              {Object.entries(MUTATION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <button onClick={() => removeMutation(m._key)} style={{ background: "transparent", border: "none", color: T.red, cursor: "pointer", fontSize: 14, marginLeft: 8 }}>x</button>
          </div>
          {Object.entries(PARAM_LABELS[m.tipo] || {}).map(([param, label]) => (
            <div key={param}>
              <div style={{ fontSize: 11, color: T.tertiary, marginBottom: 2 }}>{label}</div>
              <input
                value={m.params[param] ?? ""}
                onChange={(e) => updateMutationParam(m._key, param, e.target.value)}
                style={{ width: "100%", padding: "5px 8px", borderRadius: 6, background: T.bg, color: T.primary, border: `1px solid ${T.border}`, fontSize: 12, fontFamily: T.mono }}
              />
            </div>
          ))}
        </div>
      ))}

      <button
        onClick={addMutation}
        style={{ padding: "6px 12px", borderRadius: 6, border: `1px dashed ${T.border}`, background: "transparent", color: T.secondary, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
      >
        + Adicionar cenario
      </button>

      {mutations.length > 0 && (
        <button
          onClick={handleSimulate}
          disabled={loading}
          style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: T.blue, color: "#fff", fontSize: 13, fontWeight: 600, cursor: loading ? "wait" : "pointer", fontFamily: "inherit" }}
        >
          {loading ? "A simular..." : "Simular"}
        </button>
      )}

      {error && <div style={{ fontSize: 12, color: T.red }}>{error}</div>}

      {/* Delta result — before → after */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>Resultado</div>

          <ExplainBox
            headline={result.summary || "Simulacao concluida."}
            color={afterComp >= 95 ? "green" : afterComp >= 80 ? "orange" : "red"}
          />

          {/* Delta grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 4, fontSize: 12, background: T.card, borderRadius: 8, padding: 12 }}>
            <div style={{ color: T.tertiary, fontWeight: 600 }}>Antes</div>
            <div />
            <div style={{ color: T.tertiary, fontWeight: 600 }}>Depois</div>

            <DeltaRow label="Tempo total" before={`${beforeMakespan}d`} after={`${afterMakespan}d`} better={afterMakespan < beforeMakespan} />
            <DeltaRow label="Prazos" before={`${beforeComp.toFixed(1)}%`} after={`${afterComp.toFixed(1)}%`} better={afterComp > beforeComp} />
            <DeltaRow label="Trocas" before={`${Math.round(beforeSetups)}h`} after={`${Math.round(afterSetups)}h`} better={afterSetups < beforeSetups} />
          </div>

          {/* Apply button */}
          <button
            onClick={handleApply}
            disabled={applying}
            style={{
              padding: "8px 16px", borderRadius: 8, border: "none",
              background: T.green, color: T.bg, fontSize: 13, fontWeight: 600,
              cursor: applying ? "wait" : "pointer", fontFamily: "inherit",
            }}
          >
            {applying ? "A aplicar..." : "Aplicar este cenario"}
          </button>
        </div>
      )}
    </div>
  );
}

function DeltaRow({ label, before, after, better }: { label: string; before: string; after: string; better: boolean }) {
  return (
    <>
      <div style={{ fontFamily: T.mono, color: T.secondary }}>{before}</div>
      <div style={{ color: T.tertiary, textAlign: "center" }}>→</div>
      <div style={{ fontFamily: T.mono, color: better ? T.green : T.orange, fontWeight: 600 }}>{after}</div>
    </>
  );
}
