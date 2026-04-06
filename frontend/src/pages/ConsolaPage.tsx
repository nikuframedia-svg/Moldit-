/** CONSOLA — "Director's Cockpit"
 *
 * Centro de comando. Tabela de moldes como linhas principais.
 * Banner de estado + decisoes pendentes + maquinas (stress).
 */

import { useEffect, useMemo, useState } from "react";
import { T } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";
import { getConsole } from "../api/endpoints";
import { Card } from "../components/ui/Card";
import { Dot } from "../components/ui/Dot";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Pill } from "../components/ui/Pill";
import { Divider } from "../components/ui/Divider";
import { Num } from "../components/ui/Num";
import { Label } from "../components/ui/Label";
import type { ConsoleData } from "../api/types";

// ── Helpers ─────────────────────────────────────────────────────

function semaforoColor(folga: number): string {
  if (folga < 0) return T.red;
  if (folga <= 2) return T.orange;
  return T.green;
}

function folgaLabel(folga: number): string {
  if (folga > 0) return `+${folga}d`;
  if (folga === 0) return "0d";
  return `${folga}d`;
}

function severityColor(sev: string): string {
  if (sev === "critical" || sev === "critico") return T.red;
  if (sev === "warning" || sev === "aviso") return T.orange;
  return T.green;
}

// ── Component ───────────────────────────────────────────────────

export default function ConsolaPage() {
  const moldes = useDataStore((s) => s.moldes);
  const deadlines = useDataStore((s) => s.deadlines);
  const stress = useDataStore((s) => s.stress);
  const segmentos = useDataStore((s) => s.segmentos);
  const config = useDataStore((s) => s.config);
  const setPage = useAppStore((s) => s.setPage);
  const setStatus = useAppStore((s) => s.setStatus);

  const [consoleData, setConsoleData] = useState<ConsoleData | null>(null);

  useEffect(() => {
    getConsole(0)
      .then(setConsoleData)
      .catch((e) => setStatus("error", e.message ?? "Erro ao carregar consola"));
  }, [setStatus]);

  // ── Merge moldes + deadlines ────────────────────────────────

  const deadlineMap = useMemo(() => {
    const m = new Map<string, (typeof deadlines)[number]>();
    for (const d of deadlines) m.set(d.molde, d);
    return m;
  }, [deadlines]);

  // Find current op/machine per mold from segmentos (latest scheduled segment)
  const currentActivity = useMemo(() => {
    const map = new Map<string, { opId: number; maquina: string }>();
    for (const seg of segmentos) {
      const prev = map.get(seg.molde);
      if (!prev || seg.dia > 0) {
        // keep the last segment (highest dia) as the "current" activity
        if (!prev || seg.dia + seg.inicio_h > (map.get(seg.molde)?.opId ?? -1)) {
          map.set(seg.molde, { opId: seg.op_id, maquina: seg.maquina_id });
        }
      }
    }
    // Actually, pick the segment with highest dia (most recent scheduled)
    const best = new Map<string, { opId: number; maquina: string; dia: number; inicio: number }>();
    for (const seg of segmentos) {
      const prev = best.get(seg.molde);
      if (!prev || seg.dia > prev.dia || (seg.dia === prev.dia && seg.inicio_h > prev.inicio)) {
        best.set(seg.molde, { opId: seg.op_id, maquina: seg.maquina_id, dia: seg.dia, inicio: seg.inicio_h });
      }
    }
    const result = new Map<string, { opId: number; maquina: string }>();
    for (const [k, v] of best) result.set(k, { opId: v.opId, maquina: v.maquina });
    return result;
  }, [segmentos]);

  const rows = useMemo(() => {
    return moldes
      .map((m) => {
        const dl = deadlineMap.get(m.id);
        const diasAtraso = dl?.dias_atraso ?? 0;
        const onTime = dl?.on_time ?? true;
        const folga = onTime ? Math.abs(diasAtraso) : -Math.abs(diasAtraso);
        const activity = currentActivity.get(m.id);
        return {
          molde: m,
          deadline: dl,
          folga,
          opId: activity?.opId ?? null,
          maquina: activity?.maquina ?? null,
        };
      })
      .sort((a, b) => a.folga - b.folga);
  }, [moldes, deadlineMap, currentActivity]);

  // ── Banner counters ────────────────────────────────────────

  const atrasados = deadlines.filter((d) => !d.on_time).length;
  const emRisco = deadlines.filter((d) => d.on_time && d.dias_atraso >= 0 && d.dias_atraso <= 2).length;
  const ok = deadlines.length - atrasados - emRisco;

  const bannerColor = atrasados > 0 ? T.red : emRisco > 0 ? T.orange : T.green;
  const bannerPhrase = atrasados > 0
    ? `${atrasados} molde${atrasados > 1 ? "s" : ""} atrasado${atrasados > 1 ? "s" : ""} \u2014 precisa${atrasados > 1 ? "m" : ""} de decisao agora`
    : emRisco > 0
      ? `${emRisco} molde${emRisco > 1 ? "s" : ""} sem margem. Resto dentro do prazo.`
      : "Todos dentro do prazo. Producao a correr bem.";

  // ── Actions (decisoes pendentes) ────────────────────────────

  const actions = consoleData?.actions ?? [];

  // ── Maquinas sorted by stress ───────────────────────────────

  const sortedStress = useMemo(
    () => [...stress].sort((a, b) => b.stress_pct - a.stress_pct),
    [stress],
  );

  const machineGroup = (mid: string): string => {
    if (!config?.machines) return "";
    const m = config.machines[mid];
    return m?.group ?? "";
  };

  // ── Table header style ──────────────────────────────────────

  const thStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: T.tertiary,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "8px 10px",
    textAlign: "left",
    borderBottom: `0.5px solid ${T.border}`,
  };

  const tdStyle: React.CSSProperties = {
    fontSize: 13,
    color: T.primary,
    padding: "10px 10px",
    borderBottom: `0.5px solid ${T.border}`,
    verticalAlign: "middle",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 1100 }}>

      {/* ═══ 1. Banner de Estado ═══ */}
      <Card style={{ padding: "16px 20px" }} data-testid="banner-estado">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Dot color={bannerColor} size={12} />
          <div style={{ flex: 1, fontSize: 20, fontWeight: 600, color: bannerColor, lineHeight: 1.4 }}>
            {bannerPhrase}
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ textAlign: "center" }}>
              <Num size={22} color={T.red}>{atrasados}</Num>
              <div><Label>Atrasados</Label></div>
            </div>
            <div style={{ textAlign: "center" }}>
              <Num size={22} color={T.orange}>{emRisco}</Num>
              <div><Label>Risco</Label></div>
            </div>
            <div style={{ textAlign: "center" }}>
              <Num size={22} color={T.green}>{ok}</Num>
              <div><Label>OK</Label></div>
            </div>
          </div>
        </div>
      </Card>

      {/* ═══ 2. Tabela de Moldes ═══ */}
      <Card style={{ padding: 0, overflow: "hidden" }} data-testid="tabela-moldes">
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 28 }} />
              <th style={thStyle}>Molde</th>
              <th style={thStyle}>Cliente</th>
              <th style={thStyle}>Prazo</th>
              <th style={thStyle}>Operacao actual</th>
              <th style={thStyle}>Maquina</th>
              <th style={{ ...thStyle, width: 160 }}>Progresso</th>
              <th style={{ ...thStyle, width: 70, textAlign: "right" }}>Folga</th>
              <th style={{ ...thStyle, width: 130 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const sem = semaforoColor(row.folga);
              const prog = row.molde.progresso;
              return (
                <tr
                  key={row.molde.id}
                  onClick={() => setPage("moldes")}
                  style={{ cursor: "pointer", transition: "background 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = T.hover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ ...tdStyle, textAlign: "center" }}>
                    <Dot color={sem} size={8} />
                  </td>
                  <td style={{ ...tdStyle, fontFamily: T.mono, fontWeight: 600, fontSize: 13 }}>
                    {row.molde.id}
                  </td>
                  <td style={{ ...tdStyle, color: T.secondary }}>
                    {row.molde.cliente}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: T.mono, fontSize: 12 }}>
                    {row.deadline?.deadline ?? row.molde.deadline}
                  </td>
                  <td style={{ ...tdStyle, fontSize: 12, color: T.secondary }}>
                    {row.opId != null ? `Op #${row.opId}` : "\u2014"}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: T.mono, fontSize: 12 }}>
                    {row.maquina ?? "\u2014"}
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <ProgressBar
                          value={prog}
                          color={sem}
                          height={6}
                        />
                      </div>
                      <span style={{ fontSize: 11, fontFamily: T.mono, color: T.secondary, width: 36, textAlign: "right" }}>
                        {Math.round(prog)}%
                      </span>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontFamily: T.mono, fontWeight: 600, color: sem }}>
                    {folgaLabel(row.folga)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPage("simulador");
                      }}
                      style={{
                        padding: "5px 12px",
                        borderRadius: 8,
                        border: `1px solid ${T.border}`,
                        background: "transparent",
                        color: T.blue,
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "inherit",
                        cursor: "pointer",
                        transition: "background 0.15s",
                        whiteSpace: "nowrap",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = `${T.blue}12`)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      Entrega a tempo?
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...tdStyle, textAlign: "center", color: T.tertiary, padding: 40 }}>
                  Sem dados de moldes. Carregue um ficheiro .mpp para comecar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {/* ═══ 3. Two Columns: Decisoes + Maquinas ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>

        {/* ── Left: Decisoes pendentes ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <Label style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            Decisoes pendentes ({actions.length})
          </Label>
          {actions.length === 0 && (
            <Card style={{ padding: 16 }}>
              <span style={{ fontSize: 13, color: T.tertiary }}>
                Nenhuma decisao pendente. Producao alinhada.
              </span>
            </Card>
          )}
          {actions.map((a, i) => (
            <div key={i}>
              {i > 0 && <Divider />}
              <Card style={{ borderRadius: i === 0 ? `${T.radius}px ${T.radius}px 0 0` : i === actions.length - 1 ? `0 0 ${T.radius}px ${T.radius}px` : 0, border: "none", borderLeft: `0.5px solid ${T.border}`, borderRight: `0.5px solid ${T.border}`, padding: "14px 18px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                  <Dot color={severityColor(a.severity)} size={8} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.primary, marginBottom: 4 }}>
                      {a.title}
                    </div>
                    <div style={{ fontSize: 12, color: T.secondary, lineHeight: 1.5 }}>
                      {a.detail}
                    </div>
                    {a.suggestion && (
                      <div style={{ marginTop: 10 }}>
                        <Pill color={T.blue}>{a.suggestion}</Pill>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          ))}
        </div>

        {/* ── Right: Maquinas (stress) ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <Label style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            Maquinas ({sortedStress.length})
          </Label>
          <Card style={{ padding: "8px 0" }}>
            {sortedStress.length === 0 && (
              <div style={{ padding: "12px 16px", fontSize: 12, color: T.tertiary }}>
                Sem dados de maquinas.
              </div>
            )}
            {sortedStress.map((m, i) => {
              const stressColor = m.stress_pct > 95 ? T.red : m.stress_pct > 80 ? T.orange : T.green;
              const grupo = machineGroup(m.maquina_id);
              return (
                <div
                  key={m.maquina_id}
                  onClick={() => setPage("producao")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 14px",
                    cursor: "pointer",
                    transition: "background 0.15s",
                    borderTop: i > 0 ? `0.5px solid ${T.border}` : "none",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = T.hover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ width: 70 }}>
                    <span style={{ fontSize: 12, fontFamily: T.mono, color: T.primary, fontWeight: 600 }}>
                      {m.maquina_id}
                    </span>
                  </div>
                  {grupo && (
                    <span style={{ fontSize: 10, color: T.tertiary, width: 50 }}>
                      {grupo}
                    </span>
                  )}
                  <div style={{ flex: 1 }}>
                    <ProgressBar value={m.stress_pct} color={stressColor} height={5} />
                  </div>
                  <span style={{ fontSize: 11, fontFamily: T.mono, fontWeight: 600, color: stressColor, width: 38, textAlign: "right" }}>
                    {Math.round(m.stress_pct)}%
                  </span>
                </div>
              );
            })}
          </Card>
        </div>
      </div>
    </div>
  );
}
