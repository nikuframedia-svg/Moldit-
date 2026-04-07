/** EQUIPA — "Quem faz o quê amanhã?"
 *
 * Layout: Day selector → Frase-resumo → Zones → Problems → People → Forecast → Auto-allocate
 * Everything in phrases — no complex charts.
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { Card } from "../components/ui/Card";
import {
  getOperadores,
  getWorkforceConflicts,
  getWorkforceForecast,
  autoAllocate,
  getCompetencyGaps,
} from "../api/endpoints";
import { useAppStore } from "../stores/useAppStore";
import { useDataStore } from "../stores/useDataStore";
import type { Operador, WorkforceConflict, ForecastEntry, CompetencyGap } from "../api/types";

type DaySel = "hoje" | "amanha" | "semana";
type Turno = "manha" | "tarde" | "noite";

export default function EquipaPage() {
  const [day, setDay] = useState<DaySel>("amanha");
  const [turno, setTurno] = useState<Turno>("manha");
  const [operadores, setOperadores] = useState<Operador[]>([]);
  const [conflicts, setConflicts] = useState<WorkforceConflict[]>([]);
  const [forecast, setForecast] = useState<ForecastEntry[]>([]);
  const [gaps, setGaps] = useState<CompetencyGap[]>([]);
  const [loading, setLoading] = useState(true);
  const [allocMsg, setAllocMsg] = useState("");
  const setStatus = useAppStore((s) => s.setStatus);
  const navigateTo = useAppStore((s) => s.navigateTo);

  useEffect(() => {
    setLoading(true);
    setAllocMsg("");

    const dayIdx = day === "hoje" ? 0 : day === "amanha" ? 1 : 0;

    const fetches: Promise<unknown>[] = [
      getOperadores(),
      getWorkforceConflicts(dayIdx),
    ];

    // For "semana", also fetch forecast
    if (day === "semana") {
      fetches.push(getWorkforceForecast(4));
    }

    Promise.allSettled(fetches).then((results) => {
      if (results[0].status === "fulfilled") setOperadores(results[0].value as Operador[]);
      if (results[1].status === "fulfilled") setConflicts(results[1].value as WorkforceConflict[]);
      if (results[2]?.status === "fulfilled") setForecast(results[2].value as ForecastEntry[]);
      setLoading(false);
    });

    // Competency gaps (independent fetch)
    getCompetencyGaps()
      .then((data) => {
        const withDeficit = (data.gaps ?? []).filter((g) => g.deficit > 0);
        setGaps(withDeficit);
      })
      .catch(() => setGaps([]));
  }, [day]);

  const dayLabel = day === "hoje" ? "Hoje" : day === "amanha" ? "Amanha" : "Esta semana";
  const disponiveis = operadores.filter((o) => o.disponivel);
  const total = operadores.length;
  const deficit = total - disponiveis.length;

  // Group by zone
  const zones = new Map<string, Operador[]>();
  for (const op of operadores) {
    const z = op.zona || "Outra";
    if (!zones.has(z)) zones.set(z, []);
    zones.get(z)!.push(op);
  }

  const dayIdx = day === "hoje" ? 0 : 1;

  const handleAutoAllocate = async () => {
    setStatus("warning", "A distribuir equipa...");
    try {
      const result = await autoAllocate(dayIdx, turno);
      const count = Array.isArray(result) ? result.length : 0;
      setAllocMsg(`Distribuicao aplicada. ${count} alocacoes feitas.`);
      setStatus("ok", `Distribuicao concluida. ${count} alocacoes.`);
      const newConflicts = await getWorkforceConflicts(dayIdx);
      setConflicts(newConflicts);
      useDataStore.getState().refreshAll();
    } catch (e: any) {
      setAllocMsg("Erro na distribuicao automatica.");
      setStatus("error", e.message ?? "Erro na distribuicao automatica.");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      {/* Day selector + Turno selector */}
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {(["hoje", "amanha", "semana"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDay(d)}
              style={{
                padding: "8px 20px", borderRadius: T.radiusSm,
                border: day === d ? `1px solid ${T.blue}` : `1px solid ${T.border}`,
                background: day === d ? `${T.blue}15` : "transparent",
                color: day === d ? T.primary : T.secondary,
                fontSize: 13, fontWeight: day === d ? 600 : 400,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {d === "hoje" ? "Hoje" : d === "amanha" ? "Amanha" : "Esta semana"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["manha", "tarde", "noite"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTurno(t)}
              style={{
                padding: "6px 14px", borderRadius: T.radiusSm,
                border: turno === t ? `1px solid ${T.blue}` : `1px solid ${T.border}`,
                background: turno === t ? `${T.blue}15` : "transparent",
                color: turno === t ? T.primary : T.tertiary,
                fontSize: 12, fontWeight: turno === t ? 600 : 400,
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {t === "manha" ? "Manha" : t === "tarde" ? "Tarde" : "Noite"}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state when no operators */}
      {!loading && total === 0 ? (
        <Card style={{ padding: "32px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: T.primary, marginBottom: 8 }}>
            Nenhum operador configurado.
          </div>
          <div style={{ fontSize: 13, color: T.secondary, marginBottom: 16 }}>
            Adicione operadores para ver a gestao de equipa, turnos e conflitos.
          </div>
          <button
            onClick={() => navigateTo("config")}
            style={{
              padding: "8px 20px", borderRadius: T.radiusSm, border: "none",
              background: T.blue, color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Ir para Configuracao
          </button>
        </Card>
      ) : null}

      {/* Frase-resumo */}
      {loading ? (
        <div style={{ color: T.secondary }}>A carregar...</div>
      ) : total > 0 ? (
        <div style={{ fontSize: 18, fontWeight: 600, color: deficit > 0 ? T.orange : T.green, lineHeight: 1.4 }}>
          {day === "semana"
            ? `Esta semana: ${total} operadores na equipa. ${deficit > 0 ? `${deficit} em falta.` : "Todos disponiveis."}`
            : deficit > 0
              ? `${dayLabel} precisamos de ${total} operadores. Temos ${disponiveis.length}. Faltam ${deficit}.`
              : `${dayLabel} temos todos os ${total} operadores disponiveis.`
          }
        </div>
      ) : null}

      {/* Zone blocks */}
      <div style={{ display: total > 0 ? "grid" : "none", gridTemplateColumns: `repeat(${Math.min(zones.size, 4)}, 1fr)`, gap: 12 }}>
        {Array.from(zones.entries()).map(([zona, ops]) => {
          const disp = ops.filter((o) => o.disponivel).length;
          const zoneDeficit = ops.length - disp;
          return (
            <Card key={zona} style={{ borderLeft: `3px solid ${zoneDeficit > 0 ? T.orange : T.green}` }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: T.primary }}>{zona}</div>
              <div style={{ fontSize: 12, color: T.secondary, marginTop: 4 }}>
                {disp} de {ops.length} operadores disponiveis
              </div>
              {zoneDeficit > 0 && (
                <div style={{ fontSize: 11, color: T.orange, marginTop: 2 }}>
                  Faltam {zoneDeficit}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Conflicts with action buttons */}
      {total > 0 && conflicts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Problemas ({conflicts.length})
          </div>
          {conflicts.map((c, i) => (
            <Card key={i} style={{ borderLeft: `3px solid ${T.orange}` }}>
              <div style={{ fontSize: 13, color: T.primary, marginBottom: 4 }}>
                {c.tipo || `Faltam ${c.deficit || 0} operadores`}
              </div>
              <div style={{ fontSize: 12, color: T.secondary, marginBottom: 6 }}>
                Maquinas: {(c.maquinas || []).join(", ") || "?"}. Necessarios: {c.operadores_necessarios || "?"}. Disponiveis: {c.operadores_disponiveis || "?"}.
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={handleAutoAllocate}
                  style={{
                    padding: "4px 12px", borderRadius: 6, border: "none",
                    background: T.blue, color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  Resolver automaticamente
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Person list with phrases */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary, marginBottom: 4 }}>
          Pessoas ({operadores.length})
        </div>
        {operadores.map((op) => (
          <div
            key={op.id}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "8px 12px", borderRadius: 6,
              background: op.disponivel ? "transparent" : `${T.red}08`,
            }}
          >
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: op.disponivel ? T.green : T.red, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>{op.nome}</div>
              <div style={{ fontSize: 12, color: T.secondary }}>
                {op.disponivel
                  ? `${op.zona || "?"}, turno ${op.turno || "?"}. Competencias: ${(op.competencias || []).join(", ") || "nenhuma"}.`
                  : "Indisponivel."
                }
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Weekly forecast (when "semana" selected) */}
      {day === "semana" && forecast.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Previsao semanal
          </div>
          <Card style={{ padding: 0, overflow: "auto", maxHeight: 300 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Semana", "Zona", "Turno", "Necessarios", "Disponiveis", "Deficit"].map((h) => (
                    <th key={h} style={{ fontSize: 11, color: T.tertiary, padding: "6px 10px", textAlign: "left", borderBottom: `1px solid ${T.border}`, background: T.card }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {forecast.map((f, i) => (
                  <tr key={i}>
                    <td style={{ padding: "4px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}20` }}>{f.semana}</td>
                    <td style={{ padding: "4px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}20` }}>{f.zona}</td>
                    <td style={{ padding: "4px 10px", fontSize: 12, borderBottom: `1px solid ${T.border}20` }}>{f.turno}</td>
                    <td style={{ padding: "4px 10px", fontSize: 12, fontFamily: T.mono, borderBottom: `1px solid ${T.border}20` }}>{f.necessarios}</td>
                    <td style={{ padding: "4px 10px", fontSize: 12, fontFamily: T.mono, borderBottom: `1px solid ${T.border}20` }}>{f.disponiveis}</td>
                    <td style={{ padding: "4px 10px", fontSize: 12, fontFamily: T.mono, color: f.deficit > 0 ? T.red : T.green, borderBottom: `1px solid ${T.border}20` }}>
                      {f.deficit > 0 ? `-${f.deficit}` : "OK"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* Competency gaps */}
      {gaps.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Faltam competencias ({gaps.length})
          </div>
          {gaps.map((g, i) => (
            <Card key={i} style={{ borderLeft: `3px solid ${T.orange}`, padding: "12px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>
                {g.competencia}
              </div>
              <div style={{ fontSize: 12, color: T.secondary, marginTop: 4 }}>
                Precisas de {g.total_qualificados + g.deficit}, tens {g.total_qualificados}. Faltam {g.deficit}.
                {g.zonas && g.zonas.length > 0 && ` Zonas: ${g.zonas.join(", ")}.`}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Auto-allocate + feedback */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          onClick={handleAutoAllocate}
          style={{
            padding: "8px 20px", borderRadius: 8, border: "none",
            background: T.blue, color: "#fff", fontSize: 13, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Distribuir automaticamente
        </button>
        {allocMsg && <span style={{ fontSize: 12, color: T.green }}>{allocMsg}</span>}
      </div>
    </div>
  );
}
