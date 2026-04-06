/** MOLDES — "Como está cada molde?"
 *
 * Integrates: Gantt + Explorer + Deadlines + Simulator + Risk + ML + Reports.
 * MoldGantt/OpTable/OptionsPanel reused intact from mold-explorer.
 */

import { useEffect, useState } from "react";
import { T, moldeColor } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useMoldExplorerStore } from "../stores/useMoldExplorerStore";
import { useMLStore } from "../stores/useMLStore";
import { MoldHeader } from "../components/MoldHeader";
import { SimulatorPanel } from "../components/SimulatorPanel";
import { RiskPanel } from "../components/RiskPanel";
import { AnalogyPanel } from "../components/AnalogyPanel";
import { ExplainBox } from "../components/ExplainBox";
import { MoldGantt } from "../components/mold-explorer/MoldGantt";
import { OpTable } from "../components/mold-explorer/OpTable";
import { OptionsPanel } from "../components/mold-explorer/OptionsPanel";
import { getAnalogues, predictBulk } from "../api/endpoints";
import type { DurationPrediction, AnalogoResult } from "../api/types";

type Panel = "simulator" | "risk" | "analogues" | null;

export default function MoldesPage() {
  const moldes = useDataStore((s) => s.moldes);
  const deadlines = useDataStore((s) => s.deadlines);
  const { selectedMoldeId, explorerData, selectMolde, selectedOpId, loadingExplorer } = useMoldExplorerStore();
  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [mlPredictions, setMlPredictions] = useState<DurationPrediction[]>([]);
  const [topAnalogue, setTopAnalogue] = useState<AnalogoResult | null>(null);

  // Auto-select first mold
  useEffect(() => {
    if (!selectedMoldeId && moldes.length > 0) {
      selectMolde(moldes[0].id);
    }
  }, [moldes, selectedMoldeId]);

  // Fetch ML predictions + top analogue for selected mold
  useEffect(() => {
    if (!selectedMoldeId) return;

    // ML bulk predictions
    predictBulk()
      .then((preds) => {
        setMlPredictions(preds);
      })
      .catch(() => setMlPredictions([]));

    // Top analogue
    getAnalogues(selectedMoldeId)
      .then((analogues) => {
        setTopAnalogue(analogues.length > 0 ? analogues[0] : null);
      })
      .catch(() => setTopAnalogue(null));
  }, [selectedMoldeId]);

  const currentMolde = moldes.find((m) => m.id === selectedMoldeId);
  const currentDeadline = deadlines.find((d) => d.molde === selectedMoldeId);

  const togglePanel = (panel: Panel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

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
                  {m.id}
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

        {/* Action bar */}
        <div style={{ display: "flex", gap: 10, paddingTop: 8, flexWrap: "wrap" }}>
          <ActionButton label="E se...?" active={activePanel === "simulator"} onClick={() => togglePanel("simulator")} />
          <ActionButton label="Qual o risco?" active={activePanel === "risk"} onClick={() => togglePanel("risk")} />
          <ActionButton label="Moldes semelhantes" active={activePanel === "analogues"} onClick={() => togglePanel("analogues")} />
          <ActionButton
            label="Relatorio cliente"
            active={false}
            onClick={() => window.open(`/api/reports/client?molde_id=${selectedMoldeId}`, "_blank")}
          />
        </div>
      </div>

      {/* Lateral panels */}
      {activePanel === "simulator" && <SimulatorPanel onClose={() => setActivePanel(null)} />}
      {activePanel === "risk" && selectedMoldeId && <RiskPanel moldeId={selectedMoldeId} onClose={() => setActivePanel(null)} />}
      {activePanel === "analogues" && selectedMoldeId && <AnalogyPanel moldeId={selectedMoldeId} onClose={() => setActivePanel(null)} />}
    </div>
  );
}

function ActionButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 18px", borderRadius: 8,
        border: active ? `1px solid ${T.blue}` : `1px solid ${T.border}`,
        background: active ? `${T.blue}15` : "transparent",
        color: active ? T.blue : T.secondary,
        fontSize: 13, fontWeight: active ? 600 : 400,
        cursor: "pointer", fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}
