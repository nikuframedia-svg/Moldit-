/** RISCO — "O que pode correr mal? Porque ha atrasos?"
 *
 * Heatmap + atrasos + causas-raiz + previsoes + gargalos + cobertura.
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";
import { getRisk } from "../api/endpoints";
import { Card } from "../components/ui/Card";
import { ExplainBox } from "../components/ExplainBox";
import { ProgressBar } from "../components/ui/ProgressBar";
import type { RiskResult } from "../api/types";

export default function RiscoPage() {
  const stress = useDataStore((s) => s.stress);
  const deadlines = useDataStore((s) => s.deadlines);
  const setPage = useAppStore((s) => s.setPage);
  const setStatus = useAppStore((s) => s.setStatus);
  const [risk, setRisk] = useState<RiskResult | null>(null);

  useEffect(() => {
    getRisk().then(setRisk).catch((e) => setStatus("error", e.message ?? "Erro ao carregar risco"));
  }, [setStatus]);

  const lateDeadlines = deadlines.filter((d) => !d.on_time);
  const healthScore = risk?.health_score ?? 0;
  const healthColor = healthScore >= 80 ? T.green : healthScore >= 50 ? T.orange : T.red;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>

      {/* 1. Resumo */}
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 42, fontWeight: 700, fontFamily: T.mono, color: healthColor }}>
            {Math.round(healthScore)}
          </div>
          <div style={{ fontSize: 11, color: T.tertiary }}>Saude global</div>
        </div>
        <div style={{ flex: 1 }}>
          <ExplainBox
            headline={
              lateDeadlines.length === 0
                ? "Todos os moldes dentro do prazo. Nenhum risco critico identificado."
                : `${lateDeadlines.length} molde${lateDeadlines.length > 1 ? "s" : ""} em risco de atraso. Atencao necessaria.`
            }
            color={lateDeadlines.length === 0 ? "green" : "orange"}
          />
        </div>
      </div>

      {/* 2. Heatmap (maquinas x stress) */}
      {stress.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Carga das maquinas
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(stress.length, 8)}, 1fr)`, gap: 6 }}>
            {[...stress].sort((a, b) => b.stress_pct - a.stress_pct).map((m, i) => {
              const color = m.stress_pct > 95 ? T.red : m.stress_pct > 85 ? T.orange : m.stress_pct > 60 ? T.blue : T.green;
              return (
                <Card key={i} onClick={() => setPage("producao")} style={{ cursor: "pointer", padding: "8px 10px", borderLeft: `3px solid ${color}` }}>
                  <div style={{ fontSize: 12, fontFamily: T.mono, fontWeight: 600, color: T.primary }}>{m.maquina_id}</div>
                  <div style={{ marginTop: 4 }}>
                    <ProgressBar value={m.stress_pct} color={color} height={4} />
                  </div>
                  <div style={{ fontSize: 10, color: T.tertiary, marginTop: 2 }}>{Math.round(m.stress_pct)}% | pico D{m.pico_dia + 1}</div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Atrasos */}
      {lateDeadlines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Moldes atrasados ({lateDeadlines.length})
          </div>
          {lateDeadlines.map((d, i) => (
            <Card key={i} onClick={() => setPage("moldes")} style={{ cursor: "pointer", borderLeft: `3px solid ${T.red}` }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>{d.molde}</span>
                  <span style={{ fontSize: 12, color: T.secondary, marginLeft: 8 }}>
                    Prazo: {d.deadline} | {Math.abs(d.dias_atraso)} dias de atraso
                  </span>
                </div>
                <span style={{ fontSize: 12, color: T.red, fontWeight: 600 }}>
                  {d.operacoes_pendentes} ops pendentes
                </span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 4. Gargalos (top 5) */}
      {risk?.bottleneck_machines && risk.bottleneck_machines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Gargalos — maquinas mais sobrecarregadas
          </div>
          {risk.bottleneck_machines.slice(0, 5).map((m, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px" }}>
              <span style={{ fontSize: 12, fontFamily: T.mono, color: T.primary, width: 80 }}>{m.maquina_id}</span>
              <div style={{ flex: 1 }}>
                <ProgressBar value={m.stress_pct} color={m.stress_pct > 90 ? T.red : T.orange} height={6} />
              </div>
              <span style={{ fontSize: 11, fontFamily: T.mono, color: T.secondary }}>{Math.round(m.stress_pct)}%</span>
            </div>
          ))}
        </div>
      )}

      {/* 5. Propostas */}
      {risk?.proposals && risk.proposals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Sugestoes automaticas
          </div>
          {risk.proposals.map((p, i) => (
            <ExplainBox key={i} headline={p.titulo} detail={p.descricao} source={p.impacto} color="blue" />
          ))}
        </div>
      )}
    </div>
  );
}
