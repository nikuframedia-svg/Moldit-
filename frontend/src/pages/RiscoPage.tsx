/** RISCO — Cockpit de risco e saude do plano.
 *
 * 1. Health Score (left) + Heatmap maquinas x dias (right)
 * 2. Porque dos atrasos (late deliveries with root cause)
 * 3. Moldes em risco (table)
 * 4. Cobertura do plano
 * 5. Sugestoes automaticas
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";
import { getRisk, getLateDeliveries, getCoverage } from "../api/endpoints";
import { Card } from "../components/ui/Card";
import { Num } from "../components/ui/Num";
import { Pill } from "../components/ui/Pill";
import { Dot } from "../components/ui/Dot";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Divider } from "../components/ui/Divider";
import { Label } from "../components/ui/Label";
import { ExplainBox } from "../components/ExplainBox";
import type { RiskResult, LateDeliveryReport, TardyAnalysis, CoverageReport, HeatmapCell } from "../api/types";

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

const ROOT_CAUSE_LABELS: Record<string, { label: string; color: string }> = {
  capacity: { label: "Capacidade", color: T.red },
  dependency_chain: { label: "Dependencias", color: T.orange },
  setup_overhead: { label: "Trocas", color: T.yellow },
  priority_conflict: { label: "Prioridades", color: T.blue },
};

/* ── Heatmap types ────────────���───────────────────────────── */

function buildHeatmap(
  risk: RiskResult | null,
  stress: { maquina_id: string; stress_pct: number; pico_dia: number }[],
): { machines: string[]; days: number[]; cells: Map<string, number> } {
  const cells = new Map<string, number>();
  let machines: string[] = [];
  let days: number[] = [];

  if (risk?.heatmap && risk.heatmap.length > 0) {
    const hm = risk.heatmap as HeatmapCell[];
    const machSet = new Set<string>();
    const daySet = new Set<number>();
    for (const c of hm) {
      machSet.add(c.machine_id);
      daySet.add(c.day_idx);
      cells.set(`${c.machine_id}|${c.day_idx}`, c.utilization * 100);
    }
    machines = [...machSet].sort();
    days = [...daySet].sort((a, b) => a - b);
  } else if (stress.length > 0) {
    machines = stress.map((s) => s.maquina_id).sort();
    days = Array.from({ length: 14 }, (_, i) => i);
    for (const s of stress) {
      for (let d = 0; d < 14; d++) {
        const dist = Math.abs(d - s.pico_dia);
        const pct = Math.max(0, s.stress_pct - dist * 5);
        cells.set(`${s.maquina_id}|${d}`, pct);
      }
    }
  }

  if (days.length > 21) days = days.slice(0, 21);
  return { machines, days, cells };
}

/* ── Component ───────────────────���────────────────────────── */

export default function RiscoPage() {
  const stress = useDataStore((s) => s.stress);
  const deadlines = useDataStore((s) => s.deadlines);
  const moldes = useDataStore((s) => s.moldes);
  const navigateTo = useAppStore((s) => s.navigateTo);
  const setStatus = useAppStore((s) => s.setStatus);

  const [risk, setRisk] = useState<RiskResult | null>(null);
  const [lateReport, setLateReport] = useState<LateDeliveryReport | null>(null);
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      getRisk().then(setRisk),
      getLateDeliveries().then(setLateReport).catch(() => setLateReport(null)),
      getCoverage().then(setCoverage).catch(() => setCoverage(null)),
    ])
      .catch((e) => setStatus("error", e.message ?? "Erro ao carregar risco"))
      .finally(() => setLoading(false));
  }, [setStatus, deadlines.length, stress.length]);

  const score = risk?.health_score ?? 0;
  const lateCount = deadlines.filter((d) => !d.on_time).length;
  const atRiskCount = deadlines.filter((d) => d.on_time && d.dias_atraso > 0 && d.dias_atraso <= 5).length;
  const riskMoldes = deadlines.filter((d) => !d.on_time || (d.on_time && d.dias_atraso > 0 && d.dias_atraso <= 5));
  const { machines, days, cells } = buildHeatmap(risk, stress);

  // Late delivery analyses
  const analyses: TardyAnalysis[] = lateReport?.analyses ?? [];

  if (loading) {
    return <div style={{ fontSize: 14, color: T.secondary, padding: 32 }}>A carregar analise de risco...</div>;
  }

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
              <div />
              {days.map((d) => (
                <div
                  key={d}
                  style={{ fontSize: 9, color: T.tertiary, textAlign: "center", fontFamily: T.mono, padding: "2px 0" }}
                >
                  D{d + 1}
                </div>
              ))}
              {machines.map((mId) => (
                <div key={mId} style={{ display: "contents" }}>
                  <div
                    style={{
                      fontSize: 10, fontFamily: T.mono, color: T.secondary,
                      display: "flex", alignItems: "center", paddingRight: 6,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}
                    title={mId}
                  >
                    {mId}
                  </div>
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
                          display: "flex", alignItems: "center", justifyContent: "center",
                          minHeight: 22, minWidth: 28,
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

      {/* ── 2. Porque dos atrasos (Late Deliveries) ──────────────── */}
      {analyses.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Label>Porque dos atrasos ({analyses.length})</Label>

          {lateReport?.suggestion && (
            <ExplainBox headline={lateReport.suggestion} color="orange" />
          )}

          {analyses.map((a, i) => {
            const cause = ROOT_CAUSE_LABELS[a.root_cause] ?? { label: a.root_cause, color: T.tertiary };
            const moldeName = moldes.find((m) => m.id === a.molde_id)?.cliente;
            return (
              <Card key={i} style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <Dot color={T.red} size={8} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.primary, fontFamily: T.mono }}>
                        {a.molde_id}
                      </span>
                      {moldeName && (
                        <span style={{ fontSize: 12, color: T.secondary }}>{moldeName}</span>
                      )}
                      <Pill color={cause.color}>{cause.label}</Pill>
                      <span style={{ fontSize: 12, fontFamily: T.mono, color: T.red, fontWeight: 600 }}>
                        -{a.delay_dias}d
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: T.secondary, lineHeight: 1.5 }}>
                      {a.explanation}
                    </div>
                    {a.competing_moldes && a.competing_moldes.length > 0 && (
                      <div style={{ fontSize: 12, color: T.tertiary, marginTop: 4 }}>
                        Compete com: {a.competing_moldes.join(", ")} pela mesma maquina
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── 3. Moldes em risco (table) ────────────────────────── */}
      {riskMoldes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Label>Moldes em risco ({riskMoldes.length})</Label>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "24px 1fr 1fr 80px 100px 80px",
              gap: 8, padding: "6px 12px",
              fontSize: 10, color: T.tertiary, fontWeight: 600,
              textTransform: "uppercase" as const, letterSpacing: "0.04em",
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

          {riskMoldes.map((d) => {
            const molde = moldes.find((m) => m.id === d.molde);
            const semaforo = d.on_time
              ? d.dias_atraso >= -3 ? T.orange : T.green
              : T.red;
            return (
              <div
                key={d.molde}
                onClick={() => navigateTo("moldes", { moldeId: d.molde })}
                style={{
                  display: "grid",
                  gridTemplateColumns: "24px 1fr 1fr 80px 100px 80px",
                  gap: 8, padding: "8px 12px",
                  cursor: "pointer", borderRadius: T.radiusSm,
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
                  {molde?.cliente ?? "\u2014"}
                </span>
                <span style={{ fontSize: 12, color: T.secondary, fontFamily: T.mono }}>
                  {d.deadline}
                </span>
                <span style={{ fontSize: 12, color: T.secondary, fontFamily: T.mono }}>
                  {d.operacoes_pendentes} ops
                </span>
                <span
                  style={{
                    fontSize: 12, fontWeight: 600, fontFamily: T.mono,
                    color: folgaColor(-d.dias_atraso), textAlign: "right",
                  }}
                >
                  {d.dias_atraso <= 0 ? `+${Math.abs(d.dias_atraso)}d` : `-${d.dias_atraso}d`}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 4. Cobertura do plano ��───────────────────────────────── */}
      {coverage && (
        <Card style={{ padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <Label style={{ margin: 0 }}>Cobertura do plano</Label>
            <span style={{
              fontSize: 14, fontFamily: T.mono, fontWeight: 600,
              color: coverage.overall_coverage_pct >= 100 ? T.green : coverage.overall_coverage_pct >= 90 ? T.orange : T.red,
            }}>
              {Math.round(coverage.overall_coverage_pct)}%
            </span>
          </div>
          <ProgressBar
            value={coverage.overall_coverage_pct}
            color={coverage.overall_coverage_pct >= 100 ? T.green : coverage.overall_coverage_pct >= 90 ? T.orange : T.red}
            height={6}
          />
          {coverage.overall_coverage_pct >= 100 ? (
            <div style={{ fontSize: 12, color: T.green, marginTop: 8 }}>
              Todas as operacoes tem maquina atribuida.
            </div>
          ) : (
            <div style={{ fontSize: 12, color: T.secondary, marginTop: 8 }}>
              {coverage.uncovered_ops?.length ?? 0} operacoes sem maquina atribuida.
              {coverage.summary && ` ${coverage.summary}`}
            </div>
          )}
        </Card>
      )}

      {/* ─��� 5. Sugestoes automaticas ──────────────────────────── */}
      {risk?.proposals && risk.proposals.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Label>Sugestoes automaticas</Label>
          {risk.proposals.map((p: any, i: number) => (
            <ExplainBox
              key={i}
              headline={p.titulo ?? p.description ?? "Sugestao"}
              detail={p.descricao ?? p.estimated_impact}
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
