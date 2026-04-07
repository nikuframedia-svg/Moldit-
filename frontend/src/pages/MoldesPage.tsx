/** MOLDES — "Como está cada molde?"
 *
 * Integrates: Gantt + Explorer + Deadlines + Simulator + Risk + ML + Reports.
 * MoldGantt/OpTable/OptionsPanel reused intact from mold-explorer.
 */

import { useEffect, useState } from "react";
import { T, moldeColor } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useMoldExplorerStore } from "../stores/useMoldExplorerStore";
import { useAppStore } from "../stores/useAppStore";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { MoldHeader } from "../components/MoldHeader";
import { ExplainBox } from "../components/ExplainBox";
import { MoldGantt } from "../components/mold-explorer/MoldGantt";
import { OpTable } from "../components/mold-explorer/OpTable";
import { OptionsPanel } from "../components/mold-explorer/OptionsPanel";
import { getAnalogues, predictBulk, feedbackAnalogy } from "../api/endpoints";
import type { DurationPrediction, AnalogoResult } from "../api/types";

export default function MoldesPage() {
  const moldes = useDataStore((s) => s.moldes);
  const deadlines = useDataStore((s) => s.deadlines);
  const operacoes = useDataStore((s) => s.operacoes);
  const segmentos = useDataStore((s) => s.segmentos);
  const { selectedMoldeId, explorerData, selectMolde, selectedOpId, loadingExplorer } = useMoldExplorerStore();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const setStatus = useAppStore((s) => s.setStatus);
  const pageContext = useAppStore((s) => s.pageContext);
  const [mlPredictions, setMlPredictions] = useState<DurationPrediction[]>([]);
  const [topAnalogue, setTopAnalogue] = useState<AnalogoResult | null>(null);

  // Auto-select first mold
  useEffect(() => {
    if (!selectedMoldeId && moldes.length > 0) {
      selectMolde(moldes[0].id);
    }
  }, [moldes, selectedMoldeId]);

  // Navigate to specific mold from pageContext
  useEffect(() => {
    if (pageContext?.moldeId && moldes.length > 0) {
      selectMolde(pageContext.moldeId);
    }
  }, [pageContext?.moldeId, moldes.length]);

  // Fetch ML predictions + top analogue for selected mold
  useEffect(() => {
    if (!selectedMoldeId) return;

    // ML bulk predictions
    predictBulk()
      .then((preds) => {
        setMlPredictions(preds);
      })
      .catch(() => { setMlPredictions([]); setStatus("warning", "Previsoes ML indisponiveis"); });

    // Top analogue
    getAnalogues(selectedMoldeId)
      .then((analogues) => {
        setTopAnalogue(analogues.length > 0 ? analogues[0] : null);
      })
      .catch(() => setTopAnalogue(null));
  }, [selectedMoldeId]);

  const currentMolde = moldes.find((m) => m.id === selectedMoldeId);
  const currentDeadline = deadlines.find((d) => d.molde === selectedMoldeId);

  // Build analogue phrase
  const analogoFrase = topAnalogue
    ? `Molde parecido com ${topAnalogue.molde_id} (${(topAnalogue.similaridade * 100).toFixed(0)}% semelhanca). ${topAnalogue.compliance ? "Esse cumpriu o prazo." : `Esse atrasou.`}`
    : undefined;

  // ML predictions for current mold operations
  const moldePredictions = mlPredictions.filter((p) => {
    // Filter by ops in current mold (if we have explorer data)
    if (!explorerData) return false;
    return explorerData.operacoes.some((op: any) => op.op_id === p.op_id);
  });

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Main content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", gap: 16 }}>
        {/* Mold tabs */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {moldes.map((m) => {
            const active = m.id === selectedMoldeId;
            const dl = deadlines.find((d) => d.molde === m.id);
            const isLate = dl && !dl.on_time;
            return (
              <button
                key={m.id}
                onClick={() => selectMolde(m.id)}
                style={{
                  padding: "8px 16px", borderRadius: T.radiusSm,
                  border: active ? `1px solid ${T.blue}` : `1px solid ${T.border}`,
                  background: active ? `${T.blue}15` : "transparent",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                  fontFamily: "inherit",
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: isLate ? T.red : moldeColor(m.id) }} />
                <span style={{ fontSize: 13, fontWeight: active ? 700 : 400, color: active ? T.primary : T.secondary }}>
                  {m.id}{m.cliente ? ` (${m.cliente})` : ""}
                </span>
              </button>
            );
          })}
        </div>

        {/* Mold header with progress + deadline + ML analogue */}
        {currentMolde && (
          <MoldHeader
            moldeId={currentMolde.id}
            cliente={currentMolde.cliente}
            progresso={currentMolde.progresso}
            opsDone={currentMolde.ops_concluidas}
            opsTotal={currentMolde.total_ops}
            deadlineFrase={
              currentDeadline
                ? currentDeadline.on_time
                  ? `Dentro do prazo. Conclusao prevista: ${currentDeadline.conclusao_prevista || "?"}.`
                  : `Atrasado ${Math.abs(currentDeadline.dias_atraso || 0)} dias.`
                : undefined
            }
            deadlineCor={currentDeadline ? (currentDeadline.on_time ? "green" : "red") : undefined}
            analogoFrase={analogoFrase}
          />
        )}

        {/* Analogue feedback buttons */}
        {topAnalogue && selectedMoldeId && (
          <div style={{ display: "flex", gap: 6, marginTop: -8, paddingLeft: 4 }}>
            <button
              onClick={() => feedbackAnalogy({ molde_id: selectedMoldeId, analogo_id: topAnalogue.molde_id, util: true })}
              style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.green, fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}
            >
              Acertou
            </button>
            <button
              onClick={() => feedbackAnalogy({ molde_id: selectedMoldeId, analogo_id: topAnalogue.molde_id, util: false })}
              style={{ background: "transparent", border: `1px solid ${T.border}`, color: T.tertiary, fontSize: 10, padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}
            >
              Falhou
            </button>
          </div>
        )}

        {/* ML predictions summary (if available) */}
        {moldePredictions.length > 0 && (
          <div style={{ padding: "0 4px" }}>
            {(() => {
              const totalMpp = moldePredictions.reduce((s, p) => s + p.estimado_mpp, 0);
              const totalMl = moldePredictions.reduce((s, p) => s + p.previsao_ml, 0);
              const deltaPct = totalMpp > 0 ? ((totalMl - totalMpp) / totalMpp) * 100 : 0;
              if (Math.abs(deltaPct) < 3) return null;
              return (
                <ExplainBox
                  headline={`O sistema preve que este molde vai demorar ${Math.round(totalMl)}h em vez das ${Math.round(totalMpp)}h estimadas (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(0)}%).`}
                  source={`Baseado no historico de operacoes semelhantes`}
                  color={deltaPct > 15 ? "orange" : deltaPct < -5 ? "green" : "blue"}
                />
              );
            })()}
          </div>
        )}

        {/* Pipeline: sequencia de operacoes do molde */}
        {selectedMoldeId && operacoes.length > 0 && (
          <Card style={{ padding: "12px 16px", overflow: "auto" }}>
            <Label style={{ marginBottom: 8 }}>Sequencia de operacoes</Label>
            <div style={{ display: "flex", gap: 2, minWidth: "max-content" }}>
              {operacoes
                .filter((op) => op.molde === selectedMoldeId)
                .sort((a, b) => a.op_id - b.op_id)
                .map((op) => {
                  const isDone = op.progresso >= 100;
                  const isInProgress = op.progresso > 0 && op.progresso < 100;
                  const isScheduled = segmentos.some((s) => s.op_id === op.op_id);
                  const hasNoSlot = !isDone && !isScheduled;
                  const bg = isDone ? `${T.green}30` : isInProgress ? `${T.blue}30` : hasNoSlot ? `${T.red}15` : T.elevated;
                  const border = isDone ? T.green : isInProgress ? T.blue : hasNoSlot ? T.red : T.border;
                  const nameShort = (op.nome || "").split(" \u00BB ").pop()?.trim() || `Op ${op.op_id}`;
                  return (
                    <div
                      key={op.op_id}
                      title={`${op.nome_completo || op.nome}\n${op.recurso || "Sem maquina"}\n${op.work_h}h`}
                      style={{
                        padding: "4px 8px", borderRadius: 4,
                        background: bg, border: `1px ${hasNoSlot ? "dashed" : "solid"} ${border}`,
                        fontSize: 9, color: T.primary, whiteSpace: "nowrap",
                        minWidth: 60, textAlign: "center",
                        opacity: isDone ? 0.6 : 1,
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{nameShort.length > 12 ? nameShort.slice(0, 12) + "\u2026" : nameShort}</div>
                      <div style={{ color: T.tertiary, fontSize: 8 }}>
                        {isDone ? "Concluida" : isInProgress ? `${Math.round(op.progresso)}%` : hasNoSlot ? "Sem slot" : op.recurso || ""}
                      </div>
                    </div>
                  );
                })}
            </div>
            <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 10, color: T.tertiary }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: `${T.green}30`, border: `1px solid ${T.green}`, borderRadius: 2, marginRight: 4 }} />Concluida</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: `${T.blue}30`, border: `1px solid ${T.blue}`, borderRadius: 2, marginRight: 4 }} />Em curso</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: T.elevated, border: `1px solid ${T.border}`, borderRadius: 2, marginRight: 4 }} />Agendada</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, background: `${T.red}15`, border: `1px dashed ${T.red}`, borderRadius: 2, marginRight: 4 }} />Sem slot</span>
            </div>
          </Card>
        )}

        {/* Navigation shortcuts (ABOVE the table so user sees them) */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <NavButton label="Simular este molde" onClick={() => navigateTo("simulador", { moldeId: selectedMoldeId ?? undefined })} />
          <NavButton label="Ver risco" onClick={() => navigateTo("risco")} />
          <NavButton
            label="Relatorio cliente"
            onClick={() => window.open(`/api/reports/client?molde_id=${selectedMoldeId}`, "_blank")}
          />
        </div>

        {/* Gantt + OpTable + OptionsPanel (reused intact) */}
        {loadingExplorer && (
          <div style={{ padding: 32, color: T.secondary }}>A carregar dados do molde...</div>
        )}
        {explorerData && (
          <>
            <MoldGantt />
            <OpTable />
            {selectedOpId != null && <OptionsPanel />}
          </>
        )}
      </div>
    </div>
  );
}

function NavButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 18px", borderRadius: 8,
        border: `1px solid ${T.border}`,
        background: "transparent",
        color: T.secondary,
        fontSize: 13, fontWeight: 400,
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}
