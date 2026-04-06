/** SIMULADOR — Cockpit de simulacao e CTP.
 *
 * 1. Mutation type buttons (8 cenarios)
 * 2. Parameters card (adapts to mutation type)
 * 3. Results (human-readable before/after + phrase)
 * 4. CTP section (bottom)
 */

import { useState, useEffect } from "react";
import { T } from "../theme/tokens";
import { useSimulatorStore } from "../stores/useSimulatorStore";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";
import { simulate, checkCTP, simulateApply, canRevert, revertSimulation } from "../api/endpoints";
import { Card } from "../components/ui/Card";
import { Num } from "../components/ui/Num";
import { Pill } from "../components/ui/Pill";
import { Divider } from "../components/ui/Divider";
import { Label } from "../components/ui/Label";
import { Modal } from "../components/ui/Modal";
import type { MutationType, SimulateResponse, CTPMolde } from "../api/types";

/* ── All 8 mutation presets ──────────────────────────────── */

const MAIN_MUTATIONS: { type: MutationType; label: string; icon: string }[] = [
  { type: "machine_down", label: "Maquina avariada", icon: "\u26A0" },
  { type: "overtime", label: "Turno extra", icon: "\u23F0" },
  { type: "deadline_change", label: "Mudar prazo", icon: "\uD83D\uDCC5" },
  { type: "priority_boost", label: "Subir prioridade", icon: "\u2B06" },
  { type: "add_holiday", label: "Adicionar feriado", icon: "\uD83C\uDF34" },
  { type: "remove_holiday", label: "Tirar feriado", icon: "\u2716" },
  { type: "force_machine", label: "Forcar maquina", icon: "\u21C4" },
  { type: "op_done", label: "Operacao concluida", icon: "\u2714" },
];

/* ── Human-readable mutation descriptions ────────────────── */

function describeMutation(type: MutationType, machine: string, days: number, moldeId: string): string {
  switch (type) {
    case "machine_down":
      return `${machine || "Maquina"} parada durante ${days} dia${days > 1 ? "s" : ""}`;
    case "overtime":
      return `Turno extra de 8h na ${machine || "maquina"} durante ${days} dia${days > 1 ? "s" : ""}`;
    case "deadline_change":
      return `Alterar prazo do ${moldeId || "molde"} em ${days} dia${days > 1 ? "s" : ""}`;
    case "priority_boost":
      return `Subir prioridade do ${moldeId || "molde"}`;
    case "add_holiday":
      return `Adicionar ${days} dia${days > 1 ? "s" : ""} de feriado`;
    case "remove_holiday":
      return `Trabalhar em ${days} dia${days > 1 ? "s" : ""} de feriado`;
    case "force_machine":
      return `Forcar operacao para a ${machine || "maquina"}`;
    case "op_done":
      return `Marcar operacao como concluida`;
    default:
      return `Cenario: ${type}`;
  }
}

function describeImpact(delta: SimulateResponse["delta"]): string {
  const parts: string[] = [];

  const compBefore = Math.round(delta.compliance_before * 100);
  const compAfter = Math.round(delta.compliance_after * 100);
  if (compAfter < compBefore) {
    parts.push(`A percentagem de entregas a tempo desce de ${compBefore}% para ${compAfter}%.`);
  } else if (compAfter > compBefore) {
    parts.push(`A pontualidade melhora de ${compBefore}% para ${compAfter}%.`);
  }

  const mkBefore = Math.round(delta.makespan_before);
  const mkAfter = Math.round(delta.makespan_after);
  if (mkAfter > mkBefore) {
    parts.push(`A producao total demora mais ${mkAfter - mkBefore} dia${mkAfter - mkBefore > 1 ? "s" : ""}.`);
  } else if (mkAfter < mkBefore) {
    parts.push(`A producao total encurta ${mkBefore - mkAfter} dia${mkBefore - mkAfter > 1 ? "s" : ""}.`);
  }

  if (parts.length === 0) {
    return "Sem impacto significativo no plano.";
  }
  return parts.join(" ");
}

/* ── Which params each mutation needs ────────────────────── */

function needsMachine(type: MutationType): boolean {
  return ["machine_down", "overtime", "force_machine"].includes(type);
}

function needsDays(type: MutationType): boolean {
  return ["machine_down", "overtime", "deadline_change", "add_holiday", "remove_holiday"].includes(type);
}

function needsMolde(type: MutationType): boolean {
  return ["deadline_change", "priority_boost", "op_done"].includes(type);
}

/* ── Component ────────────────────────────────────────────── */

export default function SimuladorPage() {
  const {
    addMutation,
    updateMutationType,
    setResult: storeSetResult,
    clear,
  } = useSimulatorStore();

  const moldes = useDataStore((s) => s.moldes);
  const stress = useDataStore((s) => s.stress);
  const setStatus = useAppStore((s) => s.setStatus);
  const pageContext = useAppStore((s) => s.pageContext);

  const [selectedType, setSelectedType] = useState<MutationType>("machine_down");
  const [selectedMachine, setSelectedMachine] = useState("");
  const [selectedMolde, setSelectedMolde] = useState("");
  const [days, setDays] = useState(1);
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Revert state
  const [canRev, setCanRev] = useState(false);

  // CTP state
  const [ctpMolde, setCtpMolde] = useState("");
  const [ctpWeek, setCtpWeek] = useState("");
  const [ctpResult, setCtpResult] = useState<CTPMolde | null>(null);
  const [ctpLoading, setCtpLoading] = useState(false);

  // Apply pageContext (navigate from other pages)
  useEffect(() => {
    if (pageContext?.moldeId) {
      setCtpMolde(pageContext.moldeId);
      setSelectedMolde(pageContext.moldeId);
    }
    if (pageContext?.mutationType) setSelectedType(pageContext.mutationType as MutationType);
  }, [pageContext]);

  // Check revert availability
  useEffect(() => {
    canRevert().then((r) => setCanRev(r.can_revert)).catch(() => setCanRev(false));
  }, [result]);

  /* ── Handlers ───────────────────────────────────────────── */

  const handleSimulate = async () => {
    if (needsMachine(selectedType) && !selectedMachine) {
      setStatus("warning", "Seleccione uma maquina.");
      return;
    }
    if (needsMolde(selectedType) && !selectedMolde) {
      setStatus("warning", "Seleccione um molde.");
      return;
    }

    const mutation = {
      type: selectedType,
      params: buildParams(selectedType, selectedMachine, days, selectedMolde),
    };

    setSimulating(true);
    setStatus("warning", "A simular cenario...");
    try {
      const r = await simulate([mutation]);
      setResult(r);
      storeSetResult(r);
      setStatus("ok", `Simulacao completa em ${r.time_ms}ms.`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro na simulacao.";
      setStatus("error", msg);
    }
    setSimulating(false);
  };

  const handleApply = async () => {
    setShowConfirm(false);
    setStatus("warning", "A aplicar simulacao...");
    try {
      const mutation = {
        type: selectedType,
        params: buildParams(selectedType, selectedMachine, days, selectedMolde),
      };
      await simulateApply([mutation]);
      await useDataStore.getState().refreshAll();
      setStatus("ok", "Simulacao aplicada ao plano real.");
      setResult(null);
      clear();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao aplicar.";
      setStatus("error", msg);
    }
  };

  const handleDiscard = () => {
    setResult(null);
    storeSetResult(null);
  };

  const handleCTP = async () => {
    if (!ctpMolde || !ctpWeek) return;
    setCtpLoading(true);
    setStatus("warning", "A verificar viabilidade...");
    try {
      const r = await checkCTP(ctpMolde, ctpWeek);
      setCtpResult(r);
      setStatus("ok", r.feasible ? "Entrega viavel!" : "Entrega nao viavel.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro no CTP.";
      setStatus("error", msg);
    }
    setCtpLoading(false);
  };

  /* ── Derived ────────────────────────────────────────────── */

  const otdBefore = result ? Math.round(result.delta.compliance_before * 100) : null;
  const otdAfter = result ? Math.round(result.delta.compliance_after * 100) : null;
  const otdImproved = otdBefore !== null && otdAfter !== null && otdAfter >= otdBefore;

  const affectedMoldes = result
    ? [...new Set(result.segmentos.map((s) => s.molde))]
    : [];

  const canSimulate =
    (!needsMachine(selectedType) || selectedMachine) &&
    (!needsMolde(selectedType) || selectedMolde);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 900 }}>

      {/* ── 1. Mutation Type Buttons ──────────────────────────── */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {MAIN_MUTATIONS.map((mt) => {
          const active = selectedType === mt.type;
          return (
            <button
              key={mt.type}
              data-testid={`btn-mutation-${mt.type}`}
              onClick={() => setSelectedType(mt.type)}
              style={{
                padding: "10px 16px",
                borderRadius: T.radiusSm,
                border: `1.5px solid ${active ? T.blue : T.border}`,
                background: active ? `${T.blue}20` : "transparent",
                color: active ? T.blue : T.secondary,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span style={{ fontSize: 14 }}>{mt.icon}</span>
              {mt.label}
            </button>
          );
        })}
      </div>

      {/* ── 2. Parameters Card ────────────────────────────────── */}
      <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Label>Parametros do cenario</Label>

        {/* Machine selector (only if needed) */}
        {needsMachine(selectedType) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: T.tertiary }}>Maquina</label>
            <select
              value={selectedMachine}
              onChange={(e) => setSelectedMachine(e.target.value)}
              style={{
                padding: "10px 14px", borderRadius: 8,
                border: `1px solid ${T.border}`, background: T.elevated,
                color: T.primary, fontSize: 13, fontFamily: T.mono,
              }}
            >
              <option value="">Seleccionar maquina...</option>
              {[...stress]
                .sort((a, b) => b.stress_pct - a.stress_pct)
                .map((m) => (
                  <option key={m.maquina_id} value={m.maquina_id}>
                    {m.maquina_id} — {Math.round(m.stress_pct)}% carga
                  </option>
                ))}
            </select>
          </div>
        )}

        {/* Molde selector (only if needed) */}
        {needsMolde(selectedType) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: T.tertiary }}>Molde</label>
            <select
              value={selectedMolde}
              onChange={(e) => setSelectedMolde(e.target.value)}
              style={{
                padding: "10px 14px", borderRadius: 8,
                border: `1px solid ${T.border}`, background: T.elevated,
                color: T.primary, fontSize: 13, fontFamily: "inherit",
              }}
            >
              <option value="">Seleccionar molde...</option>
              {moldes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.cliente}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Days input (only if needed) */}
        {needsDays(selectedType) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: T.tertiary }}>Dias (1-14)</label>
            <input
              type="number"
              min={1}
              max={14}
              value={days}
              onChange={(e) => setDays(Math.min(14, Math.max(1, Number(e.target.value))))}
              style={{
                padding: "10px 14px", borderRadius: 8,
                border: `1px solid ${T.border}`, background: T.elevated,
                color: T.primary, fontSize: 13, fontFamily: T.mono, width: 120,
              }}
            />
          </div>
        )}

        {/* Scenario description */}
        <div style={{ fontSize: 12, color: T.secondary, fontStyle: "italic" }}>
          {describeMutation(selectedType, selectedMachine, days, selectedMolde)}
        </div>

        {/* BIG Simulate button */}
        <button
          onClick={handleSimulate}
          disabled={simulating || !canSimulate}
          data-testid="btn-simulate"
          style={{
            padding: "14px 0", borderRadius: 10, border: "none",
            background: simulating || !canSimulate ? T.tertiary : T.blue,
            color: "#fff", fontSize: 16, fontWeight: 700,
            cursor: simulating || !canSimulate ? "not-allowed" : "pointer",
            fontFamily: "inherit", width: "100%",
            transition: "all 0.15s", opacity: simulating ? 0.7 : 1,
          }}
        >
          {simulating ? "A simular..." : "Simular"}
        </button>
      </Card>

      {/* ── 3. Results ────────────────────────────────────────── */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Human-readable impact phrase */}
          <Card style={{ padding: "14px 18px", borderLeft: `3px solid ${otdImproved ? T.green : T.red}` }}>
            <div style={{ fontSize: 14, color: T.primary, lineHeight: 1.5 }}>
              {describeImpact(result.delta)}
            </div>
          </Card>

          {/* OTD Before -> After */}
          <div style={{ display: "flex", gap: 16, alignItems: "center", justifyContent: "center" }}>
            <Card style={{ flex: 1, textAlign: "center", padding: 20 }}>
              <Label>Entregas a tempo antes</Label>
              <div style={{ marginTop: 6 }}>
                <Num size={40} color={T.secondary}>{otdBefore}%</Num>
              </div>
            </Card>

            <div style={{ fontSize: 28, color: T.tertiary, flexShrink: 0 }}>{"\u2192"}</div>

            <Card
              style={{
                flex: 1, textAlign: "center", padding: 20,
                borderColor: otdImproved ? `${T.green}40` : `${T.red}40`,
              }}
            >
              <Label>Entregas a tempo depois</Label>
              <div style={{ marginTop: 6 }}>
                <Num size={40} color={otdImproved ? T.green : T.red}>{otdAfter}%</Num>
              </div>
            </Card>
          </div>

          {/* Moldes afectados */}
          {affectedMoldes.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label>Moldes afectados</Label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {affectedMoldes.map((m) => (
                  <Pill key={m} color={T.blue}>{m}</Pill>
                ))}
              </div>
            </div>
          )}

          {/* Summary / Suggestions */}
          {result.summary && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Label>Sugestoes</Label>
              {result.summary.split("\n").filter(Boolean).map((line, i) => (
                <div key={i} style={{ fontSize: 13, color: T.secondary, display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <span style={{ color: T.blue, flexShrink: 0 }}>{"\u2192"}</span>
                  <span>{line}</span>
                </div>
              ))}
            </div>
          )}

          {/* Apply / Discard */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => setShowConfirm(true)}
              style={{
                padding: "12px 28px", borderRadius: 10, border: "none",
                background: T.blue, color: "#fff", fontSize: 14, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Aplicar ao plano real
            </button>
            <button
              onClick={handleDiscard}
              style={{
                padding: "12px 28px", borderRadius: 10,
                border: `1px solid ${T.border}`, background: "transparent",
                color: T.secondary, fontSize: 14, fontWeight: 500,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Descartar
            </button>
            {canRev && (
              <button
                onClick={async () => {
                  setStatus("warning", "A reverter...");
                  try {
                    await revertSimulation();
                    await useDataStore.getState().refreshAll();
                    setCanRev(false);
                    setStatus("ok", "Plano revertido.");
                  } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : "Erro ao reverter";
                    setStatus("error", msg);
                  }
                }}
                style={{
                  padding: "12px 28px", borderRadius: 10,
                  border: `1px solid ${T.orange}`, background: "transparent",
                  color: T.orange, fontSize: 14, fontWeight: 500,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Desfazer ultima aplicacao
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 4. CTP Section ────────────────────────────────────── */}
      <Divider />

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: T.primary }}>
          Consigo entregar a tempo?
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
          {/* Molde selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 200 }}>
            <label style={{ fontSize: 11, color: T.tertiary }}>Molde</label>
            <select
              value={ctpMolde}
              onChange={(e) => { setCtpMolde(e.target.value); setCtpResult(null); }}
              style={{
                padding: "10px 14px", borderRadius: 8,
                border: `1px solid ${T.border}`, background: T.elevated,
                color: T.primary, fontSize: 13, fontFamily: "inherit",
              }}
            >
              <option value="">Seleccionar molde...</option>
              {moldes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} — {m.cliente}
                </option>
              ))}
            </select>
          </div>

          {/* Week input */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 100 }}>
            <label style={{ fontSize: 11, color: T.tertiary }}>Semana</label>
            <input
              value={ctpWeek}
              onChange={(e) => { setCtpWeek(e.target.value); setCtpResult(null); }}
              placeholder="S20"
              style={{
                padding: "10px 14px", borderRadius: 8,
                border: `1px solid ${T.border}`, background: T.elevated,
                color: T.primary, fontSize: 13, fontFamily: T.mono,
              }}
            />
          </div>

          {/* Verificar button */}
          <button
            onClick={handleCTP}
            disabled={!ctpMolde || !ctpWeek || ctpLoading}
            data-testid="btn-ctp"
            style={{
              padding: "10px 24px", borderRadius: 8, border: "none",
              background: ctpMolde && ctpWeek && !ctpLoading ? T.blue : T.tertiary,
              color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: ctpMolde && ctpWeek && !ctpLoading ? "pointer" : "not-allowed",
              fontFamily: "inherit", height: 42,
            }}
          >
            {ctpLoading ? "A verificar..." : "Verificar"}
          </button>
        </div>

        {/* CTP Result */}
        {ctpResult && (
          <Card
            style={{
              display: "flex", flexDirection: "column", gap: 12,
              borderLeft: `4px solid ${ctpResult.feasible ? T.green : T.red}`,
            }}
          >
            <div style={{ textAlign: "center" }}>
              <Num size={56} color={ctpResult.feasible ? T.green : T.red}>
                {ctpResult.feasible ? "SIM" : "NAO"}
              </Num>
            </div>

            <div style={{ fontSize: 15, color: T.primary, textAlign: "center", lineHeight: 1.6, fontWeight: 500 }}>
              {ctpResult.feasible
                ? `Entrega viavel na semana ${ctpWeek} com ${ctpResult.slack_dias} dias de folga.`
                : `Nao e possivel. Faltam ${ctpResult.dias_extra} dias.`}
            </div>

            {ctpResult.reason && (
              <div style={{ fontSize: 13, color: T.secondary, textAlign: "center" }}>
                {ctpResult.reason}
              </div>
            )}

            {/* Recovery options if NAO */}
            {!ctpResult.feasible && (
              <Card style={{ background: T.elevated, padding: 14 }}>
                <Label style={{ marginBottom: 8, display: "block" }}>Opcoes de recuperacao</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <RecoveryOption
                    text="Activar regime de pico (16h/24h) nas maquinas criticas"
                    impact={`Pode recuperar ~${Math.min(ctpResult.dias_extra, 5)} dias`}
                    onClick={() => {
                      const key = addMutation();
                      updateMutationType(key, "overtime");
                      setSelectedType("overtime");
                      setStatus("ok", "Cenario 'turno extra' adicionado. Configure e simule.");
                    }}
                  />
                  <RecoveryOption
                    text="Redistribuir carga para maquinas alternativas"
                    impact="Reduz bottleneck e paraleliza trabalho"
                    onClick={() => {
                      const key = addMutation();
                      updateMutationType(key, "force_machine");
                      setSelectedType("force_machine");
                      setStatus("ok", "Cenario 'forcar maquina' adicionado. Configure e simule.");
                    }}
                  />
                  <RecoveryOption
                    text="Repriorizar: adiar moldes menos urgentes"
                    impact="Liberta capacidade para este molde"
                    onClick={() => {
                      const key = addMutation();
                      updateMutationType(key, "priority_boost");
                      setSelectedType("priority_boost");
                      setStatus("ok", "Cenario 'subir prioridade' adicionado. Configure e simule.");
                    }}
                  />
                </div>
              </Card>
            )}
          </Card>
        )}
      </div>

      {/* ── Confirm modal ─────────────────────────────────────── */}
      {showConfirm && (
        <Modal title="Confirmar aplicacao" onClose={() => setShowConfirm(false)}>
          <p style={{ fontSize: 13, color: T.secondary, marginBottom: 16 }}>
            Tem a certeza? Esta accao altera o plano real de producao.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleApply}
              style={{
                padding: "8px 18px", borderRadius: 8, border: "none",
                background: T.red, color: "#fff", fontSize: 13, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Sim, aplicar
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              style={{
                padding: "8px 18px", borderRadius: 8,
                border: `1px solid ${T.border}`, background: "transparent",
                color: T.secondary, fontSize: 13, cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancelar
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────── */

function buildParams(type: MutationType, machine: string, days: number, moldeId: string): Record<string, unknown> {
  switch (type) {
    case "machine_down":
      return { maquina_id: machine, dias: days };
    case "overtime":
      return { maquina_id: machine, dias: days, horas_extra: 8 };
    case "deadline_change":
      return { molde_id: moldeId, dias: days };
    case "priority_boost":
      return { molde_id: moldeId };
    case "add_holiday":
      return { dias: days };
    case "remove_holiday":
      return { dias: days };
    case "force_machine":
      return { maquina_id: machine };
    case "op_done":
      return { molde_id: moldeId };
    default:
      return { maquina_id: machine, dias: days };
  }
}

function RecoveryOption({ text, impact, onClick }: { text: string; impact: string; onClick?: () => void }) {
  return (
    <div
      style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: onClick ? "pointer" : "default" }}
      onClick={onClick}
    >
      <span style={{ color: T.orange, fontSize: 14, flexShrink: 0, lineHeight: 1.4 }}>{"\u25B8"}</span>
      <div>
        <div style={{ fontSize: 12, color: T.primary, lineHeight: 1.4 }}>{text}</div>
        <div style={{ fontSize: 11, color: T.tertiary, marginTop: 2 }}>{impact}</div>
      </div>
    </div>
  );
}
