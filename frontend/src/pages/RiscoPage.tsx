/** RISCO — Cockpit de risco e saude do plano.
 *
 * 1. Health Score (left) + Heatmap maquinas x dias (right)
 * 2. Moldes em risco (table)
 * 3. Sugestoes automaticas
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";
import { getRisk } from "../api/endpoints";
import { Card } from "../components/ui/Card";
import { Num } from "../components/ui/Num";
import { Pill } from "../components/ui/Pill";
import { Dot } from "../components/ui/Dot";
import { Divider } from "../components/ui/Divider";
import { Label } from "../components/ui/Label";
import { ExplainBox } from "../components/ExplainBox";
import type { RiskResult } from "../api/types";

/* ── helpers ─────────────────────────────────────────────── */

function stressColor(pct: number): string {
  if (pct > 95) return T.red;
  if (pct > 85) return T.orange;
  if (pct > 70) return T.blue;
  return T.green;
}

function healthColor(score: number): string {
  if (score >= 80) return T.green;
  if (score >= 50) return T.orange;
  return T.red;
}

function folgaColor(dias: number): string {
  if (dias <= 0) return T.red;
  if (dias <= 3) return T.orange;
  return T.green;
}

/* ── Heatmap types ────────────────────────────────────────── */

interface HeatCell {
  maquina_id: string;
  dia: number;
  stress_pct: number;
}

/** Build heatmap grid from risk.heatmap or fallback to stress array */
function buildHeatmap(
  risk: RiskResult | null,
  stress: { maquina_id: string; stress_pct: number; pico_dia: number }[],
): { machines: string[]; days: number[]; cells: Map<string, number> } {
  const cells = new Map<string, number>();
  let machines: string[] = [];
  let days: number[] = [];

  if (risk?.heatmap && risk.heatmap.length > 0) {
    const hm = risk.heatmap as HeatCell[];
    const machSet = new Set<string>();
    const daySet = new Set<number>();
    for (const c of hm) {
      machSet.add(c.maquina_id);
      daySet.add(c.dia);
      cells.set(`${c.maquina_id}|${c.dia}`, c.stress_pct);
    }
    machines = [...machSet].sort();
    days = [...daySet].sort((a, b) => a - b);
  } else if (stress.length > 0) {
    // Fallback: one column per machine showing overall stress
    machines = stress.map((s) => s.maquina_id).sort();
    days = Array.from({ length: 14 }, (_, i) => i);
    for (const s of stress) {
      for (let d = 0; d < 14; d++) {
        // Distribute stress with some variation around peak
        const dist = Math.abs(d - s.pico_dia);
        const pct = Math.max(0, s.stress_pct - dist * 5);
        cells.set(`${s.maquina_id}|${d}`, pct);
      }
    }
  }

  // Limit to 14 days
  if (days.length > 14) days = days.slice(0, 14);

  return { machines, days, cells };
}

/* ── Component ────────────────────────────────────────────── */

export default function RiscoPage() {
  const stress = useDataStore((s) => s.stress);
  const deadlines = useDataStore((s) => s.deadlines);
  const moldes = useDataStore((s) => s.moldes);
  const navigateTo = useAppStore((s) => s.navigateTo);
  const setStatus = useAppStore((s) => s.setStatus);
  const [risk, setRisk] = useState<RiskResult | null>(null);

  useEffect(() => {
    getRisk()
      .then(setRisk)
      .catch((e) => setStatus("error", e.message ?? "Erro ao carregar risco"));
  }, [setStatus, deadlines.length, stress.length]);

  const score = risk?.health_score ?? 0;
  const lateCount = deadlines.filter((d) => !d.on_time).length;
  const atRiskCount = deadlines.filter((d) => d.on_time && d.dias_atraso >= -3).length;
  const riskMoldes = deadlines.filter((d) => !d.on_time || d.dias_atraso >= -3);
  const { machines, days, cells } = buildHeatmap(risk, stress);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1200 }}>

      {/* ── 1. Health Score + Heatmap ───────────────────────────── */}
      <div style={{ display: "flex", gap: 20, alignItems: "stretch" }}>

        {/* Left 1/3 — Health Score */}
        <Card style={{ flex: "0 0 260px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Label>Saude do plano</Label>
          <Num size={56} color={healthColor(score)}>
            {Math.round(score)}
          </Num>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
            {lateCount > 0 && (
              <Pill color={T.red}>{lateCount} atrasado{lateCount > 1 ? "s" : ""}</Pill>
            )}
            {atRiskCount > 0 && (
              <Pill color={T.orange}>{atRiskCount} em risco</Pill>
            )}
            {lateCount === 0 && atRiskCount === 0 && (
              <Pill color={T.green}>Tudo dentro do prazo</Pill>
            )}
          </div>
        </Card>

        {/* Right 2/3 — Heatmap */}
        <Card style={{ flex: 1, overflow: "auto", padding: 14 }}>
          <Label style={{ marginBottom: 8, display: "block" }}>Heatmap maquinas x dias</Label>
          {machines.length === 0 ? (
            <div style={{ fontSize: 12, color: T.tertiary, padding: 20, textAlign: "center" }}>
              Sem dados de carga. Carregue um ficheiro .mpp primeiro.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: `100px repeat(${days.length}, 1fr)`, gap: 2 }}>
              {/* Header row */}
              <div />
              {days.map((d) => (
                <div
                  key={d}
                  style={{
                    fontSize: 9,
                    color: T.tertiary,
                    textAlign: "center",
                    fontFamily: T.mono,
                    padding: "2px 0",
                  }}
                >
                  D{d + 1}
                </div>
              ))}

              {/* Machine rows */}
              {machines.map((mId) => (
                <div key={mId} style={{ display: "contents" }}>
                  {/* Machine label */}
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: T.mono,
                      color: T.secondary,
                      display: "flex",
                      alignItems: "center",
                      paddingRight: 6,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={mId}
                  >
                    {mId}
                  </div>
                  {/* Cells */}
                  {days.map((d) => {
                    const pct = cells.get(`${mId}|${d}`) ?? 0;
                    const bg = stressColor(pct);
                    return (
                      <div
                        key={d}
                        title={`${mId} D${d + 1}: ${Math.round(pct)}%`}
                        style={{
                          background: pct > 0 ? `${bg}${pct > 85 ? "cc" : pct > 50 ? "80" : "40"}` : "rgba(255,255,255,0.02)",
                          borderRadius: 3,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minHeight: 22,
                          minWidth: 28,
                        }}
                      >
                        {pct > 0 && (
                          <span style={{ fontSize: 8, color: T.primary, fontFamily: T.mono, opacity: 0.9 }}>
                            {Math.round(pct)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* ── 2. Moldes em risco (table) ────────────────────────── */}
      {riskMoldes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Label>Moldes em risco ({riskMoldes.length})</Label>

          {/* Table header */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "24px 1fr 1fr 80px 100px 80px",
              gap: 8,
              padding: "6px 12px",
              fontSize: 10,
              color: T.tertiary,
              fontWeight: 600,
              textTransform: "uppercase" as const,
              letterSpacing: "0.04em",
            }}
          >
            <span />
            <span>Molde</span>
            <span>Cliente</span>
            <span>Prazo</span>
            <span>Ops restantes</span>
            <span style={{ textAlign: "right" }}>Folga</span>
          </div>

          <Divider />

          {/* Table rows */}
          {riskMoldes.map((d) => {
            const molde = moldes.find((m) => m.id === d.molde);
            const semaforo = d.on_time
              ? d.dias_atraso >= -3
                ? T.orange
                : T.green
              : T.red;
            return (
              <div
                key={d.molde}
                onClick={() => navigateTo("moldes", { moldeId: d.molde })}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr 1fr 80px 100px 80px",
                  gap: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                  borderRadius: T.radiusSm,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = T.hover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ display: "flex", alignItems: "center" }}>
                  <Dot color={semaforo} size={8} />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, color: T.primary, fontFamily: T.mono }}>
                  {d.molde}
                </span>
                <span style={{ fontSize: 12, color: T.secondary }}>
                  {molde?.cliente ?? "—"}
                </span>
                <span style={{ fontSize: 12, color: T.secondary, fontFamily: T.mono }}>
                  {d.deadline}
                </span>
                <span style={{ fontSize: 12, color: T.secondary, fontFamily: T.mono }}>
                  {d.operacoes_pendentes} ops
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: T.mono,
                    color: folgaColor(-d.dias_atraso),
                    textAlign: "right",
                  }}
                >
                  {d.dias_atraso <= 0
                    ? `+${Math.abs(d.dias_atraso)}d`
                    : `-${d.dias_atraso}d`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 3. Sugestoes automaticas ──────────────────────────── */}
      {risk?.proposals && risk.proposals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Label>Sugestoes automaticas</Label>
          {risk.proposals.map((p, i) => (
            <ExplainBox
              key={i}
              headline={p.titulo}
              detail={p.descricao}
              source={p.impacto}
              color="blue"
              action={{
                label: "Simular",
                onClick: () => navigateTo("simulador", { mutationType: "machine_down" }),
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
