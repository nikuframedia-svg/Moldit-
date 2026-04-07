/** ALERTAS — "Que problemas tem a producao?"
 *
 * Lista de alertas activos com ciclo de vida: reconhecer, resolver, ignorar.
 */

import { useEffect, useMemo, useState } from "react";
import { T } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";
import { getAlerts, getAlertStats, acknowledgeAlert, resolveAlert, ignoreAlert, evaluateAlerts } from "../api/endpoints";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { MolditAlert, AlertStats } from "../api/types";

type Filter = "todos" | "critico" | "aviso" | "info";

const SEV_COLOR: Record<string, string> = {
  critico: T.red, aviso: T.orange, info: T.blue, positivo: T.green,
};

export default function AlertasPage() {
  const setStatus = useAppStore((s) => s.setStatus);
  const [alerts, setAlerts] = useState<MolditAlert[]>([]);
  const [stats, setStats] = useState<AlertStats | null>(null);
  const [filter, setFilter] = useState<Filter>("todos");
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([getAlerts(), getAlertStats()]);
      setAlerts(a);
      setStats(s);
    } catch (e: any) {
      setStatus("error", e.message ?? "Erro ao carregar alertas");
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const handleAction = async (id: string, action: "ack" | "resolve" | "ignore") => {
    try {
      if (action === "ack") await acknowledgeAlert(id);
      else if (action === "resolve") await resolveAlert(id);
      else await ignoreAlert(id);
      setStatus("ok", `Alerta ${action === "ack" ? "reconhecido" : action === "resolve" ? "resolvido" : "ignorado"}.`);
      await fetchData();
    } catch (e: any) {
      setStatus("error", e.message ?? "Erro na accao");
    }
  };

  const handleEvaluate = async () => {
    setStatus("warning", "A reavaliar regras...");
    try {
      await evaluateAlerts();
      await fetchData();
      setStatus("ok", "Regras reavaliadas.");
    } catch (e: any) {
      setStatus("error", e.message ?? "Erro ao reavaliar");
    }
  };

  const filtered = filter === "todos" ? alerts : alerts.filter((a) => a.severidade === filter);

  // Group repeated alerts by regra (e.g. 104x R8 "setup evitavel")
  const grouped = useMemo(() => {
    const byRule = new Map<string, MolditAlert[]>();
    for (const a of filtered) {
      const key = a.regra;
      if (!byRule.has(key)) byRule.set(key, []);
      byRule.get(key)!.push(a);
    }
    // Sort: critical first, then by count descending
    return [...byRule.entries()].sort((a, b) => {
      const sevOrder: Record<string, number> = { critico: 0, aviso: 1, info: 2 };
      const sa = sevOrder[a[1][0].severidade] ?? 3;
      const sb = sevOrder[b[1][0].severidade] ?? 3;
      if (sa !== sb) return sa - sb;
      return b[1].length - a[1].length;
    });
  }, [filtered]);

  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      {stats && (
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <StatBadge label="Criticos" count={stats.por_severidade?.critico ?? 0} color={T.red} />
          <StatBadge label="Avisos" count={stats.por_severidade?.aviso ?? 0} color={T.orange} />
          <StatBadge label="Info" count={stats.por_severidade?.info ?? 0} color={T.blue} />
          <StatBadge label="Total" count={stats.total} color={T.secondary} />
          <div style={{ flex: 1 }} />
          <button onClick={handleEvaluate}
            style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.secondary, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            Reavaliar regras
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 4 }}>
        {(["todos", "critico", "aviso", "info"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: "6px 14px", borderRadius: 6, border: filter === f ? `1px solid ${T.blue}` : `1px solid ${T.border}`, background: filter === f ? `${T.blue}15` : "transparent", color: filter === f ? T.primary : T.secondary, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            {f === "todos" ? "Todos" : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: T.secondary }}>A carregar...</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: T.tertiary, padding: 24, textAlign: "center" }}>
          Nenhum alerta {filter !== "todos" ? `de tipo "${filter}"` : "activo"}.
        </div>
      ) : (
        grouped.map(([regra, group]) => {
          const first = group[0];
          const isExpanded = expandedRules.has(regra) || group.length <= 3;
          const shown = isExpanded ? group : [first];

          return (
            <div key={regra}>
              {/* Group header when >3 alerts of same rule */}
              {group.length > 3 && (
                <div
                  onClick={() => setExpandedRules((prev) => {
                    const next = new Set(prev);
                    if (next.has(regra)) next.delete(regra); else next.add(regra);
                    return next;
                  })}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", cursor: "pointer",
                    fontSize: 13, fontWeight: 600, color: T.secondary,
                  }}
                >
                  <Pill color={SEV_COLOR[first.severidade] || T.secondary}>{first.severidade}</Pill>
                  <span>{first.titulo} ({group.length}x)</span>
                  <span style={{ fontSize: 11, color: T.tertiary, marginLeft: "auto" }}>
                    {isExpanded ? "Fechar" : "Expandir"}
                  </span>
                </div>
              )}

              {shown.map((a) => (
                <Card key={a.id} style={{ borderLeft: `3px solid ${SEV_COLOR[a.severidade] || T.border}`, marginBottom: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      {group.length <= 3 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                          <Pill color={SEV_COLOR[a.severidade] || T.secondary}>{a.severidade}</Pill>
                          <span style={{ fontSize: 10, color: T.tertiary }}>{a.regra}</span>
                        </div>
                      )}
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.primary, marginBottom: 4 }}>{a.titulo}</div>
                      <div style={{ fontSize: 12, color: T.secondary, marginBottom: 6 }}>{a.mensagem}</div>
                      {(a.moldes_afetados?.length > 0 || a.maquinas_afetadas?.length > 0) && (
                        <div style={{ fontSize: 11, color: T.tertiary, marginBottom: 4 }}>
                          {a.moldes_afetados?.length > 0 && `Moldes: ${a.moldes_afetados.join(", ")}. `}
                          {a.maquinas_afetadas?.length > 0 && `Maquinas: ${a.maquinas_afetadas.join(", ")}.`}
                        </div>
                      )}
                      {a.impacto_dias > 0 && (
                        <div style={{ fontSize: 11, color: T.orange }}>Impacto: {a.impacto_dias} dia{a.impacto_dias > 1 ? "s" : ""}</div>
                      )}
                      {a.sugestoes?.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {a.sugestoes.map((s: any, i: number) => (
                            <button key={i}
                              onClick={() => setStatus("ok", `Accao simulada: ${s.acao}`)}
                              style={{
                                background: T.elevated, border: `0.5px solid ${T.border}`,
                                color: T.blue, fontSize: 11, fontWeight: 500, padding: "6px 12px",
                                borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                              }}
                            >
                              {s.acao} <span style={{ color: T.green, marginLeft: 4 }}>({s.impacto})</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                      <ActionBtn label="Reconhecer" onClick={() => handleAction(a.id, "ack")} />
                      <ActionBtn label="Resolver" onClick={() => handleAction(a.id, "resolve")} color={T.green} />
                      <ActionBtn label="Ignorar" onClick={() => handleAction(a.id, "ignore")} color={T.tertiary} />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function StatBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 18, fontWeight: 700, fontFamily: T.mono, color }}>{count}</span>
      <span style={{ fontSize: 11, color: T.tertiary }}>{label}</span>
    </div>
  );
}

function ActionBtn({ label, onClick, color }: { label: string; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick}
      style={{ padding: "3px 10px", borderRadius: 4, border: `1px solid ${T.border}`, background: "transparent", color: color || T.secondary, fontSize: 10, cursor: "pointer", fontFamily: "inherit" }}>
      {label}
    </button>
  );
}
