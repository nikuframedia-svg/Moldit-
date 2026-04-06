/** SIMULADOR — "E se...? Consigo entregar a tempo?"
 *
 * Construtor de cenarios (8 tipos) + resultados delta + CTP.
 */

import { useState } from "react";
import { T } from "../theme/tokens";
import { useSimulatorStore } from "../stores/useSimulatorStore";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";
import { simulate, checkCTP } from "../api/endpoints";
import { Card } from "../components/ui/Card";
import { ExplainBox } from "../components/ExplainBox";
import { Modal } from "../components/ui/Modal";
import type { MutationType, SimulateResponse, CTPMolde } from "../api/types";

const MUTATION_TYPES: { type: MutationType; label: string; desc: string }[] = [
  { type: "machine_down", label: "Maquina parada", desc: "Simular avaria ou manutencao" },
  { type: "overtime", label: "Hora extra", desc: "Estender horario de maquina" },
  { type: "deadline_change", label: "Mudar prazo", desc: "Alterar deadline de um molde" },
  { type: "priority_boost", label: "Subir prioridade", desc: "Aumentar prioridade de molde" },
  { type: "add_holiday", label: "Adicionar feriado", desc: "Novo dia sem producao" },
  { type: "remove_holiday", label: "Remover feriado", desc: "Trabalhar num feriado" },
  { type: "force_machine", label: "Forcar maquina", desc: "Obrigar operacao a ir para maquina" },
  { type: "op_done", label: "Operacao concluida", desc: "Marcar operacao como feita" },
];

export default function SimuladorPage() {
  const { mutations, addMutation, removeMutation, updateMutationType, updateMutationParam, clear } = useSimulatorStore();
  const moldes = useDataStore((s) => s.moldes);
  const setStatus = useAppStore((s) => s.setStatus);

  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [ctpMolde, setCtpMolde] = useState("");
  const [ctpWeek, setCtpWeek] = useState("");
  const [ctpResult, setCtpResult] = useState<CTPMolde | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSimulate = async () => {
    if (mutations.length === 0) return;
    setSimulating(true);
    setStatus("warning", `A simular ${mutations.length} mudanca${mutations.length > 1 ? "s" : ""}...`);
    try {
      const r = await simulate(mutations.map((m) => ({ type: m.type, params: m.params })));
      setResult(r);
      setStatus("ok", `Simulacao completa em ${r.time_ms}ms.`);
    } catch (e: any) {
      setStatus("error", e.message ?? "Erro na simulacao.");
    }
    setSimulating(false);
  };

  const handleCTP = async () => {
    if (!ctpMolde || !ctpWeek) return;
    setStatus("warning", "A verificar viabilidade...");
    try {
      const r = await checkCTP(ctpMolde, ctpWeek);
      setCtpResult(r);
      setStatus("ok", r.feasible ? "Entrega viavel!" : "Entrega nao viavel.");
    } catch (e: any) {
      setStatus("error", e.message ?? "Erro no CTP.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>

      {/* 1. Construtor de Cenarios */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Cenario ({mutations.length} mudanca{mutations.length !== 1 ? "s" : ""})
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {MUTATION_TYPES.map((mt) => (
              <button
                key={mt.type}
                onClick={() => {
                  addMutation();
                  // Update the type of the newly added mutation
                  const store = useSimulatorStore.getState();
                  const last = store.mutations[store.mutations.length - 1];
                  if (last && mt.type !== "machine_down") updateMutationType(last._key, mt.type);
                }}
                title={mt.desc}
                style={{
                  padding: "4px 10px", borderRadius: 6,
                  border: `1px solid ${T.border}`, background: "transparent",
                  color: T.secondary, fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                + {mt.label}
              </button>
            ))}
          </div>
        </div>

        {mutations.map((m, i) => (
          <Card key={m._key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.primary, minWidth: 140 }}>
              {MUTATION_TYPES.find((mt) => mt.type === m.type)?.label || m.type}
            </span>
            <span style={{ fontSize: 11, color: T.tertiary, flex: 1 }}>
              {JSON.stringify(m.params)}
            </span>
            <button
              onClick={() => removeMutation(m._key)}
              style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 14, fontFamily: "inherit" }}
            >
              x
            </button>
          </Card>
        ))}

        {mutations.length > 0 && (
          <button
            onClick={handleSimulate}
            disabled={simulating}
            data-testid="btn-simulate"
            style={{
              padding: "10px 24px", borderRadius: 8, border: "none",
              background: T.blue, color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: simulating ? "wait" : "pointer", fontFamily: "inherit",
              opacity: simulating ? 0.6 : 1, alignSelf: "flex-start",
            }}
          >
            {simulating ? "A simular..." : "Simular cenario"}
          </button>
        )}
      </div>

      {/* 2. Resultados */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>Resultados</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            <DeltaCard label="Dias totais" before={result.delta.makespan_before} after={result.delta.makespan_after} unit="dias" />
            <DeltaCard label="Cumprimento" before={result.delta.compliance_before * 100} after={result.delta.compliance_after * 100} unit="%" invert />
            <DeltaCard label="Trocas" before={result.delta.setups_before} after={result.delta.setups_after} unit="h" />
            <DeltaCard label="Equilibrio" before={result.delta.balance_before * 100} after={result.delta.balance_after * 100} unit="%" invert />
          </div>

          <ExplainBox headline={result.summary || result.delta.makespan_after < result.delta.makespan_before ? "A simulacao melhora o plano." : "A simulacao piora o plano."} color={result.delta.makespan_after <= result.delta.makespan_before ? "green" : "orange"} />

          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowConfirm(true)}
              style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: T.blue, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Aplicar ao plano real
            </button>
            <button
              onClick={() => { setResult(null); }}
              style={{ padding: "8px 18px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.secondary, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* 3. CTP — Consigo Entregar? */}
      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
          Consigo entregar a tempo?
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={ctpMolde}
            onChange={(e) => { setCtpMolde(e.target.value); setCtpResult(null); }}
            style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.elevated, color: T.primary, fontSize: 12, fontFamily: "inherit" }}
          >
            <option value="">Seleccionar molde...</option>
            {moldes.map((m) => (
              <option key={m.id} value={m.id}>{m.id} — {m.cliente}</option>
            ))}
          </select>
          <input
            value={ctpWeek}
            onChange={(e) => { setCtpWeek(e.target.value); setCtpResult(null); }}
            placeholder="S20"
            style={{ padding: "8px 12px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.elevated, color: T.primary, fontSize: 12, fontFamily: "inherit", width: 80 }}
          />
          <button
            onClick={handleCTP}
            disabled={!ctpMolde || !ctpWeek}
            data-testid="btn-ctp"
            style={{ padding: "8px 18px", borderRadius: 6, border: "none", background: T.blue, color: "#fff", fontSize: 12, fontWeight: 600, cursor: ctpMolde && ctpWeek ? "pointer" : "not-allowed", fontFamily: "inherit", opacity: ctpMolde && ctpWeek ? 1 : 0.5 }}
          >
            Verificar
          </button>
        </div>

        {ctpResult && (
          <Card style={{ borderLeft: `3px solid ${ctpResult.feasible ? T.green : T.red}` }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: ctpResult.feasible ? T.green : T.red }}>
              {ctpResult.feasible ? "SIM — entrega viavel" : "NAO — entrega nao viavel"}
            </div>
            <div style={{ fontSize: 12, color: T.secondary, marginTop: 4 }}>
              {ctpResult.reason}
              {ctpResult.feasible
                ? ` Margem de ${ctpResult.slack_dias} dias.`
                : ` Precisa de mais ${ctpResult.dias_extra} dias.`
              }
            </div>
          </Card>
        )}
      </div>

      {/* Confirm modal */}
      {showConfirm && (
        <Modal title="Confirmar aplicacao" onClose={() => setShowConfirm(false)}>
          <p style={{ fontSize: 13, color: T.secondary, marginBottom: 16 }}>
            Tem a certeza? Esta accao altera o plano real de producao.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={async () => {
                setShowConfirm(false);
                setStatus("warning", "A aplicar simulacao...");
                try {
                  const { simulateApply } = await import("../api/endpoints");
                  const muts = useSimulatorStore.getState().mutations;
                  await simulateApply(muts.map(m => ({ type: m.type, params: m.params })));
                  const { useDataStore } = await import("../stores/useDataStore");
                  await useDataStore.getState().refreshAll();
                  setStatus("ok", "Simulacao aplicada ao plano real.");
                  setResult(null);
                  clear();
                } catch (e: any) {
                  setStatus("error", e.message ?? "Erro ao aplicar.");
                }
              }}
              style={{ padding: "8px 18px", borderRadius: 8, border: "none", background: T.red, color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Sim, aplicar
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              style={{ padding: "8px 18px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.secondary, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}
            >
              Cancelar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DeltaCard({ label, before, after, unit, invert }: {
  label: string; before: number; after: number; unit: string; invert?: boolean;
}) {
  const delta = after - before;
  const better = invert ? delta >= 0 : delta <= 0;
  return (
    <Card style={{ textAlign: "center", padding: "10px 8px" }}>
      <div style={{ fontSize: 10, color: T.tertiary, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: T.mono, color: T.primary }}>
        {Math.round(after)}{unit}
      </div>
      <div style={{ fontSize: 11, fontFamily: T.mono, color: better ? T.green : T.red }}>
        {delta > 0 ? "+" : ""}{Math.round(delta)}{unit}
      </div>
    </Card>
  );
}
