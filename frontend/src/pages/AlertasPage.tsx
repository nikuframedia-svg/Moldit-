/** ALERTAS — "Que problemas tem a producao?"
 *
 * Lista de alertas activos com ciclo de vida: reconhecer, resolver, ignorar.
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { useAppStore } from "../stores/useAppStore";
import { getAlerts, getAlertStats, acknowledgeAlert, resolveAlert, ignoreAlert, evaluateAlerts } from "../api/endpoints";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import type { Alert, AlertStats } from "../api/types";

type Filter = "todos" | "critico" | "aviso" | "info";

const SEV_COLOR: Record<string, string> = {
  critico: T.red, aviso: T.orange, info: T.blue, positivo: T.green,
};

export default function AlertasPage() {
  const setStatus = useAppStore((s) => s.setStatus);
  const [alerts, setAlerts] = useState<Alert[]>([]);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 900 }}>
      {stats && (
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <StatBadge label="Criticos" count={stats.critico} color={T.red} />
          <StatBadge label="Avisos" count={stats.aviso} color={T.orange} />
          <StatBadge label="Info" count={stats.info} color={T.blue} />
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
        filtered.map((a) => (
          <Card key={a.id} style={{ borderLeft: `3px solid ${SEV_COLOR[a.severidade] || T.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Pill color={SEV_COLOR[a.severidade] || T.secondary}>{a.severidade}</Pill>
                  <span style={{ fontSize: 10, color: T.tertiary }}>{a.regra}</span>
                </div>
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
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                    {a.sugestoes.map((s: any, i: number) => (
                      <div key={i} style={{ fontSize: 11, color: T.green }}>→ {s.acao} ({s.impacto})</div>
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
        ))
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
