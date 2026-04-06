/** CONSOLA — "Como esta a fabrica hoje? Que acoes tenho pendentes?"
 *
 * Centro de operacoes. Pagina por defeito.
 * 8 seccoes: estado, alertas, anomalias, indicadores, maquinas, expedicoes, preparacao, resumo.
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";
import { getConsole, getJournal, getDeadlines as fetchDeadlines } from "../api/endpoints";
import { StatusCard } from "../components/StatusCard";
import { AlertCard } from "../components/AlertCard";
import { MiniGantt } from "../components/MiniGantt";
import { ExplainBox } from "../components/ExplainBox";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { ProgressBar } from "../components/ui/ProgressBar";
import { TH } from "../constants/thresholds";
import type { ConsoleData, JournalEntry } from "../api/types";

const IMPACTO_MAP: Record<string, string> = {
  deadline: "Se nao agir, o molde vai falhar o prazo de entrega.",
  bottleneck: "Se a maquina avariar ou atrasar, pode afetar varios moldes.",
  conditional: "Esta operacao precisa de decisao para o planeamento continuar.",
  critical: "Situacao critica que pode afetar a producao de hoje.",
};

export default function ConsolaPage() {
  const score = useDataStore((s) => s.score);
  const deadlines = useDataStore((s) => s.deadlines);
  const stress = useDataStore((s) => s.stress);
  const refreshAll = useDataStore((s) => s.refreshAll);
  const setPage = useAppStore((s) => s.setPage);
  const setStatus = useAppStore((s) => s.setStatus);
  const [consoleData, setConsoleData] = useState<ConsoleData | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [dayIdx, setDayIdx] = useState(0);

  useEffect(() => {
    getConsole(dayIdx).then(setConsoleData).catch((e) => setStatus("error", e.message ?? "Erro ao carregar consola"));
    getJournal().then((j) => setJournal(j.slice(0, 10))).catch((e) => setStatus("error", e.message ?? "Erro ao carregar journal"));
  }, [dayIdx, setStatus]);

  // Compute values
  const lateDeadlines = deadlines.filter((d) => !d.on_time);
  const onTimeCount = deadlines.length - lateDeadlines.length;
  const maxStress = stress.length > 0 ? Math.max(...stress.map((s) => s.stress_pct)) : 0;
  const busiestMachine = stress.length > 0
    ? stress.reduce((a, b) => (a.stress_pct > b.stress_pct ? a : b))
    : null;
  const avgStress = stress.length > 0
    ? stress.reduce((s, m) => s + m.stress_pct, 0) / stress.length
    : 0;
  const makespan = score?.makespan_total_dias || 0;
  const setups = score?.total_setups || 0;
  const compliance = score?.deadline_compliance || 0;

  // State phrase
  const statePhrase = consoleData?.state?.phrase
    || (lateDeadlines.length > 0
      ? `O ${lateDeadlines[0].molde} precisa de atencao: atrasado ${Math.abs(lateDeadlines[0].dias_atraso || 0)} dias.`
      : "Hoje esta tudo dentro do prazo. Nenhum problema identificado.");
  const stateColor = consoleData?.state?.color || (lateDeadlines.length > 0 ? "orange" : "green");
  const colorMap: Record<string, string> = { red: T.red, orange: T.orange, green: T.green };

  const actions = consoleData?.actions || [];
  const machines = consoleData?.machines || [];
  const expedition = consoleData?.expedition || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 1000 }}>

      {/* 1. Banner de Estado */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 14, height: 14, borderRadius: "50%",
          background: colorMap[stateColor] || T.green,
          flexShrink: 0,
        }} />
        <div style={{ flex: 1, fontSize: 22, fontWeight: 600, color: colorMap[stateColor] || T.green, lineHeight: 1.4 }}>
          {statePhrase}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setDayIdx(Math.max(0, dayIdx - 1))} disabled={dayIdx === 0}
            style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.secondary, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
            ←
          </button>
          <span style={{ padding: "4px 8px", fontSize: 12, color: T.tertiary, alignSelf: "center" }}>
            {dayIdx === 0 ? "Hoje" : dayIdx === 1 ? "Amanha" : `+${dayIdx} dias`}
          </span>
          <button onClick={() => setDayIdx(dayIdx + 1)}
            style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: "transparent", color: T.secondary, cursor: "pointer", fontFamily: "inherit", fontSize: 12 }}>
            →
          </button>
        </div>
      </div>

      {/* 2. Faixa de Alertas */}
      {actions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Alertas ({actions.length})
          </div>
          {actions.slice(0, 8).map((a, i) => (
            <AlertCard
              key={i}
              titulo={a.title || ""}
              porque={a.detail || ""}
              impacto={IMPACTO_MAP[a.category] || IMPACTO_MAP[a.severity] || ""}
              opcoes={a.suggestion ? [{ texto: a.suggestion }] : []}
              severidade={a.severity || "warning"}
            />
          ))}
        </div>
      ) : (
        <ExplainBox headline="Nenhum problema identificado. Tudo a correr como planeado." color="green" />
      )}

      {/* 3. 6 Indicadores */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
        <StatusCard valor={`${makespan} dias`} frase="Tempo total de producao"
          cor={compliance >= TH.COMPLIANCE_GREEN ? "green" : "orange"} />
        <StatusCard valor={`${onTimeCount}/${deadlines.length}`} frase="Dentro do prazo"
          cor={onTimeCount === deadlines.length ? "green" : "orange"} />
        <StatusCard valor={`${lateDeadlines.length}`} frase="Moldes atrasados"
          cor={lateDeadlines.length === 0 ? "green" : "red"} />
        <StatusCard valor={`${Math.round(setups)}h`} frase="Trocas de trabalho"
          cor={setups > 60 ? "orange" : "green"} />
        <StatusCard valor={`${Math.round(avgStress)}%`} frase="Ocupacao media"
          cor={maxStress > TH.STRESS_RED ? "red" : maxStress > TH.STRESS_ORANGE ? "orange" : "green"} />
        <StatusCard valor={busiestMachine ? `${Math.round(busiestMachine.stress_pct)}%` : "--"}
          frase={busiestMachine ? `${busiestMachine.maquina_id}` : "Sem dados"}
          cor={maxStress > TH.STRESS_RED ? "red" : "green"} />
      </div>

      {/* 4. Maquinas Hoje */}
      {machines.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Maquinas ({machines.length})
          </div>
          {[...machines].sort((a, b) => b.utilization_pct - a.utilization_pct).slice(0, 12).map((m, i) => (
            <div
              key={i}
              onClick={() => setPage("producao")}
              style={{
                display: "flex", alignItems: "center", gap: 10, padding: "6px 10px",
                borderRadius: 6, cursor: "pointer",
                background: m.utilization_pct > 95 ? `${T.red}08` : "transparent",
              }}
            >
              <span style={{ fontSize: 12, fontFamily: T.mono, color: T.primary, width: 80 }}>
                {m.machine_id}
              </span>
              <div style={{ flex: 1 }}>
                <ProgressBar
                  value={m.utilization_pct}
                  color={m.utilization_pct > 95 ? T.red : m.utilization_pct > 85 ? T.orange : T.green}
                  height={6}
                />
              </div>
              <span style={{ fontSize: 11, fontFamily: T.mono, color: T.secondary, width: 40, textAlign: "right" }}>
                {Math.round(m.utilization_pct)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 5. Expedicoes Esta Semana */}
      {expedition.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Expedicoes esta semana
          </div>
          {expedition.map((e, i) => (
            <Card key={i} onClick={() => setPage("moldes")} style={{ cursor: "pointer", padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: T.primary }}>{e.client}</span>
                  <span style={{ fontSize: 12, color: T.secondary, marginLeft: 8 }}>
                    {e.ready}/{e.total} prontos
                  </span>
                </div>
                {e.not_ready > 0 && (
                  <Pill color={T.orange}>{e.not_ready} por concluir</Pill>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 6. Mini-Gantt */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary, marginBottom: 8 }}>
          Visao geral da producao
        </div>
        <MiniGantt />
      </div>

      {/* 7. Journal (Resumo do Dia) */}
      {journal.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Actividade recente
          </div>
          {journal.map((j, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <Pill color={j.severity === "error" ? T.red : j.severity === "warning" ? T.orange : T.green}>
                {j.step}
              </Pill>
              <span style={{ color: T.secondary, flex: 1 }}>{j.message}</span>
              {j.elapsed_ms > 0 && (
                <span style={{ color: T.tertiary, fontFamily: T.mono, fontSize: 10 }}>
                  {j.elapsed_ms}ms
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
