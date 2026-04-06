/** RiskPanel — "Qual o risco?" lateral panel.
 *
 * Shows risk analysis in plain Portuguese.
 * Never says "Monte Carlo", "P50", or "compliance".
 * Uses per-mold ML risk prediction + global risk data.
 */

import React, { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { getRisk, predictRisk, checkCTP } from "../api/endpoints";
import { ExplainBox } from "./ExplainBox";
import type { RiskPrediction, CTPMolde } from "../api/types";

interface Props {
  moldeId: string;
  onClose: () => void;
}

export function RiskPanel({ moldeId, onClose }: Props) {
  const [risk, setRisk] = useState<any>(null);
  const [mlRisk, setMlRisk] = useState<RiskPrediction | null>(null);
  const [ctp, setCtp] = useState<CTPMolde | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      getRisk(),
      predictRisk(moldeId).catch(() => null),
      checkCTP(moldeId).catch(() => null),
    ]).then(([riskRes, mlRes, ctpRes]) => {
      if (riskRes.status === "fulfilled") setRisk(riskRes.value);
      if (mlRes.status === "fulfilled" && mlRes.value) setMlRisk(mlRes.value as RiskPrediction);
      if (ctpRes.status === "fulfilled" && ctpRes.value) setCtp(ctpRes.value as CTPMolde);
      setLoading(false);
    });
  }, [moldeId]);

  if (loading) {
    return (
      <PanelShell title="Qual o risco?" onClose={onClose}>
        <div style={{ color: T.secondary }}>A calcular...</div>
      </PanelShell>
    );
  }

  // Prefer ML per-mold risk, fallback to global
  const probCumprir = mlRisk
    ? (1 - mlRisk.prob_atraso) * 100
    : (risk?.compliance_p80 || risk?.mc_compliance_p80 || 0.75) * 100;

  const diasAtraso = mlRisk?.dias_atraso_esperado || 0;
  const p50 = risk?.makespan_p50 || risk?.mc_p50 || 0;
  const p90 = risk?.makespan_p95 || risk?.mc_p95 || 0;

  return (
    <PanelShell title="Qual o risco?" onClose={onClose}>
      {/* Main risk headline */}
      <ExplainBox
        headline={
          probCumprir >= 90
            ? `Risco baixo. Ha ${probCumprir.toFixed(0)}% de probabilidade de cumprir o prazo.`
            : probCumprir >= 70
              ? `Risco moderado. Ha ${probCumprir.toFixed(0)}% de probabilidade de cumprir o prazo.`
              : `Risco alto. So ha ${probCumprir.toFixed(0)}% de probabilidade de cumprir o prazo.`
        }
        detail={[
          "Simulamos centenas de cenarios possiveis, variando os tempos de cada operacao com base no que aconteceu em moldes anteriores.",
          "",
          "Se tudo correr normalmente:",
          `  Acabamos em ${p50} dias.`,
          "",
          "No pior cenario realista (5% de chance):",
          `  Acabamos em ${p90} dias.`,
          diasAtraso > 0 ? `\nAtraso esperado se houver problemas: ${diasAtraso} dias.` : "",
        ].filter(Boolean).join("\n")}
        source={mlRisk
          ? "Previsao baseada no historico real desta fabrica"
          : "Simulacao de cenarios"
        }
        color={probCumprir >= 90 ? "green" : probCumprir >= 70 ? "orange" : "red"}
      />

      {/* ML top risk factors */}
      {mlRisk && mlRisk.top_fatores_risco.length > 0 && (
        <ExplainBox
          headline="Principais fatores de risco"
          detail={mlRisk.top_fatores_risco.map((f, i) => `${i + 1}. ${f}`).join("\n")}
          color="orange"
        />
      )}

      {/* ML recommendation */}
      {mlRisk?.recomendacao && (
        <ExplainBox headline={mlRisk.recomendacao} color="blue" />
      )}

      {/* CTP feasibility */}
      {ctp && (
        <ExplainBox
          headline={
            ctp.feasible
              ? `Producao viavel. Folga de ${ctp.slack_dias || 0} dias.`
              : `Producao inviavel com o plano actual. Faltam ${ctp.extra_dias || 0} dias.`
          }
          color={ctp.feasible ? "green" : "red"}
          source="Verificacao de capacidade"
        />
      )}

      {/* Proposals from global risk */}
      {risk?.proposals && risk.proposals.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary, marginBottom: 8 }}>
            Sugestoes para reduzir o risco
          </div>
          {risk.proposals.map((p: any, i: number) => (
            <ExplainBox
              key={i}
              headline={p.descricao || p.description || ""}
              detail={p.impacto || p.impact || ""}
              color="blue"
            />
          ))}
        </div>
      )}
    </PanelShell>
  );
}

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 360, height: "100%", background: T.elevated,
        borderLeft: `1px solid ${T.border}`, padding: 20,
        display: "flex", flexDirection: "column", gap: 16, overflow: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: T.primary }}>{title}</span>
        <button
          onClick={onClose}
          style={{ background: "transparent", border: "none", color: T.secondary, cursor: "pointer", fontSize: 18 }}
        >
          x
        </button>
      </div>
      {children}
    </div>
  );
}
