/** INICIO — "Como está a fábrica hoje?"
 *
 * Layout: Frase-resumo → 4 cartões → Alertas → Journal recente → Mini-Gantt → Footer
 * All numbers have phrases. Zero jargon.
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";
import { recalculate, getConsole, getJournal } from "../api/endpoints";
import { StatusCard } from "../components/StatusCard";
import { AlertCard } from "../components/AlertCard";
import { MiniGantt } from "../components/MiniGantt";
import { ExplainBox } from "../components/ExplainBox";
import { Card } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { TH } from "../constants/thresholds";
import type { ConsoleData, JournalEntry } from "../api/types";

const IMPACTO_MAP: Record<string, string> = {
  deadline: "Se nao agir, o molde vai falhar o prazo de entrega.",
  bottleneck: "Se a maquina avariar ou atrasar, pode afetar varios moldes.",  // category from backend
  conditional: "Esta operacao precisa de decisao para o planeamento continuar.",
  critical: "Situacao critica que pode afetar a producao de hoje.",
};

export default function InicioPage() {
  const score = useDataStore((s) => s.score);
  const deadlines = useDataStore((s) => s.deadlines);
  const stress = useDataStore((s) => s.stress);
  const refreshAll = useDataStore((s) => s.refreshAll);
  const [consoleData, setConsoleData] = useState<ConsoleData | null>(null);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [recalcing, setRecalcing] = useState(false);

  useEffect(() => {
    getConsole(0).then(setConsoleData).catch(() => {});
    getJournal().then((j) => setJournal(j.slice(0, 5))).catch(() => {});
  }, []);

  const handleRecalc = async () => {
    setRecalcing(true);
    try {
      await recalculate();
      await refreshAll();
      const cd = await getConsole(0);
      setConsoleData(cd);
    } catch {}
    setRecalcing(false);
  };

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

  // Frase-resumo
  const statePhrase = consoleData?.state?.phrase
    || (lateDeadlines.length > 0
      ? `O ${lateDeadlines[0].molde} precisa de atencao: atrasado ${Math.abs(lateDeadlines[0].dias_atraso || 0)} dias.`
      : "Hoje esta tudo dentro do prazo. Nenhum problema identificado.");
  const stateColor = consoleData?.state?.color || (lateDeadlines.length > 0 ? "orange" : "green");
  const colorMap: Record<string, string> = { red: T.red, orange: T.orange, green: T.green };

  const actions = consoleData?.actions || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 900 }}>
      {/* 1. Frase-resumo (24px) */}
      <div style={{ fontSize: 22, fontWeight: 600, color: colorMap[stateColor] || T.green, lineHeight: 1.4 }}>
        {statePhrase}
      </div>

      {/* 2. 4 cartões de estado */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <StatusCard
          valor={`${makespan} dias`}
          frase={
            makespan === 0 ? "Sem dados."
            : compliance >= TH.COMPLIANCE_GREEN ? "Dentro do prazo."
            : `Producao total. ${lateDeadlines.length} molde${lateDeadlines.length !== 1 ? "s" : ""} atrasado${lateDeadlines.length !== 1 ? "s" : ""}.`
          }
          cor={compliance >= TH.COMPLIANCE_GREEN ? "green" : compliance >= TH.COMPLIANCE_ORANGE ? "orange" : "red"}
        />
        <StatusCard
          valor={`${onTimeCount} de ${deadlines.length}`}
          frase={
            deadlines.length === 0 ? "Sem moldes."
            : onTimeCount === deadlines.length ? "Todos os moldes dentro do prazo."
            : `${lateDeadlines.length} atrasado${lateDeadlines.length !== 1 ? "s" : ""}: ${lateDeadlines.map((d) => d.molde).slice(0, 3).join(", ")}.`
          }
          cor={onTimeCount === deadlines.length ? "green" : "orange"}
        />
        <StatusCard
          valor={`${Math.round(avgStress)}%`}
          frase={
            !busiestMachine ? "Sem dados."
            : `Carga media. A mais ocupada: ${busiestMachine.maquina_id} (${Math.round(busiestMachine.stress_pct)}%).`
          }
          cor={maxStress > TH.STRESS_RED ? "red" : maxStress > TH.STRESS_ORANGE ? "orange" : "green"}
        />
        <StatusCard
          valor={`${Math.round(setups)}h`}
          frase={
            setups < 30 ? "Poucas trocas de trabalho."
            : setups < 60 ? `Normal para ${deadlines.length} moldes em paralelo.`
            : "Muitas trocas. Considere o preset 'Menos trocas'."
          }
          cor={setups > 60 ? "orange" : "green"}
        />
      </div>

      {/* 3. Alertas (max 5) com O QUÊ + PORQUE + IMPACTO + AÇÃO */}
      {actions.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary }}>
            Alertas ({actions.length})
          </div>
          {actions.slice(0, 5).map((a, i) => (
            <AlertCard
              key={i}
              titulo={a.title || ""}
              porque={a.detail || ""}
              impacto={IMPACTO_MAP[a.category] || IMPACTO_MAP[a.severity] || ""}
              opcoes={
                a.suggestion
                  ? [{ texto: a.suggestion }]
                  : []
              }
              severidade={a.severity || "warning"}
            />
          ))}
        </div>
      ) : (
        <ExplainBox headline="Nenhum problema identificado. Tudo a correr como planeado." color="green" />
      )}

      {/* 4. Journal recente (últimas 5 entradas) */}
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

      {/* 5. Mini-Gantt */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: T.secondary, marginBottom: 8 }}>
          Visao geral da producao (clicar para ver moldes)
        </div>
        <MiniGantt />
      </div>

      {/* 6. Footer actions */}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={handleRecalc}
          disabled={recalcing}
          style={{
            padding: "8px 20px", borderRadius: 8, border: "none",
            background: T.blue, color: "#fff", fontSize: 13,
            cursor: recalcing ? "wait" : "pointer", opacity: recalcing ? 0.6 : 1,
            fontFamily: "inherit", fontWeight: 600,
          }}
        >
          {recalcing ? "A recalcular..." : "Recalcular plano"}
        </button>
        <button
          onClick={() => refreshAll()}
          style={{
            padding: "8px 20px", borderRadius: 8,
            border: `1px solid ${T.border}`, background: "transparent",
            color: T.secondary, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Actualizar dados
        </button>
        <button
          onClick={() => window.open("/api/reports/preview", "_blank")}
          style={{
            padding: "8px 20px", borderRadius: 8,
            border: `1px solid ${T.border}`, background: "transparent",
            color: T.secondary, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Gerar relatorio
        </button>
      </div>
    </div>
  );
}
