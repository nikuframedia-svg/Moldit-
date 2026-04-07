/** REGRAS — "Como funciona o planeador?"
 *
 * Mostra TODOS os parametros que afectam o plano, com valores reais
 * do config, agrupados por tema, com explicacoes em PT.
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { getConfig } from "../api/endpoints";
import type { MolditConfig } from "../api/types";
import { Card } from "../components/ui/Card";
import { ProgressBar } from "../components/ui/ProgressBar";
import { Pill } from "../components/ui/Pill";
import { useAppStore } from "../stores/useAppStore";

// ── Helpers ────────────────────────────────────────────────

function minToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function formatHoliday(iso: string): string {
  const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${MESES[d.getMonth()]}`;
}

const thStyle: React.CSSProperties = {
  fontSize: 11, color: T.tertiary, fontWeight: 500, textAlign: "left",
  padding: "6px 12px", borderBottom: `1px solid ${T.border}`,
};
const tdStyle: React.CSSProperties = {
  fontSize: 12, color: T.primary, padding: "6px 12px",
  borderBottom: `1px solid ${T.border}`,
};

// ── Component ──────────────────────────────────────────────

export default function RegrasPage() {
  const [cfg, setCfg] = useState<MolditConfig | null>(null);
  const setStatus = useAppStore((s) => s.setStatus);
  const navigateTo = useAppStore((s) => s.navigateTo);

  useEffect(() => {
    getConfig().then(setCfg).catch((e) => setStatus("error", e.message ?? "Erro ao carregar configuracao"));
  }, [setStatus]);

  if (!cfg) return <div style={{ padding: 24, color: T.tertiary }}>A carregar regras...</div>;

  const c = cfg as any;
  const machines = Object.entries(c.machines ?? {}) as [string, any][];
  const shifts = (c.shifts ?? []) as { id: string; start_min: number; end_min: number; duration_min: number; label: string }[];
  const holidays = (c.holidays ?? []) as string[];

  // Machine groups
  const groupMap = new Map<string, { count: number; regime: number }>();
  for (const [, m] of machines) {
    const g = m.group || "Outro";
    const r = m.regime_h ?? 16;
    const prev = groupMap.get(g);
    if (!prev) groupMap.set(g, { count: 1, regime: r });
    else groupMap.set(g, { count: prev.count + 1, regime: r });
  }
  const groups = [...groupMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const activeMachines = machines.filter(([, m]) => m.active !== false).length;

  // Weights (normalise to 0-10 scale for display)
  const wMk = c.weight_makespan ?? 0.35;
  const wDc = c.weight_deadline_compliance ?? 0.35;
  const wSt = c.weight_setups ?? 0.15;
  const wBa = c.weight_balance ?? 0.15;
  const wTotal = wMk + wDc + wSt + wBa || 1;

  // Next holiday
  const today = new Date().toISOString().slice(0, 10);
  const nextHoliday = holidays.filter((h) => h >= today).sort()[0];

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: T.primary, marginBottom: 4 }}>
          Como funciona o planeador?
        </div>
        <div style={{ fontSize: 13, color: T.tertiary }}>
          Todos os parametros que afectam o plano de producao. Valores reais da configuracao actual.
        </div>
      </div>

      {/* ═══ 1. HORARIO DE FABRICA ═══ */}
      <Section title="Horario de fabrica">
        {/* Turnos reais */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          {shifts.map((s) => (
            <div key={s.id} style={{
              flex: 1, padding: "10px 14px", borderRadius: T.radiusSm,
              border: `1px solid ${T.border}`, textAlign: "center",
            }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.primary }}>Turno {s.label || s.id}</div>
              <div style={{ fontSize: 12, color: T.secondary, marginTop: 2 }}>
                {minToTime(s.start_min)} — {minToTime(s.end_min)}
              </div>
              <div style={{ fontSize: 10, color: T.tertiary, marginTop: 2 }}>{Math.round(s.duration_min / 60 * 10) / 10}h</div>
            </div>
          ))}
        </div>

        {/* Regime visual 8/16/24 */}
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          {[
            { label: "1 Turno (8h)", desc: "Manha", h: 8 },
            { label: "2 Turnos (16h)", desc: "Manha + Tarde", h: 16 },
            { label: "3 Turnos (24h)", desc: "Continuo", h: 24 },
          ].map((t) => {
            const count = machines.filter(([, m]) => (m.regime_h ?? 16) === t.h).length;
            const isActive = count > 0;
            return (
              <div key={t.h} style={{
                flex: 1, padding: "10px 14px", borderRadius: T.radiusSm,
                border: `1.5px solid ${isActive ? T.blue : T.border}`,
                background: isActive ? `${T.blue}10` : "transparent", textAlign: "center",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? T.blue : T.tertiary }}>{t.label}</div>
                <div style={{ fontSize: 11, color: T.tertiary, marginTop: 2 }}>{t.desc}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: isActive ? T.primary : T.tertiary, marginTop: 4 }}>{count} maquinas</div>
              </div>
            );
          })}
          {/* External */}
          {machines.filter(([, m]) => (m.regime_h ?? 16) === 0).length > 0 && (
            <div style={{
              flex: 1, padding: "10px 14px", borderRadius: T.radiusSm,
              border: `1px solid ${T.border}`, textAlign: "center",
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.tertiary }}>Externo</div>
              <div style={{ fontSize: 11, color: T.tertiary, marginTop: 2 }}>Subcontratacao</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: T.primary, marginTop: 4 }}>
                {machines.filter(([, m]) => (m.regime_h ?? 16) === 0).length} recursos
              </div>
            </div>
          )}
        </div>

        {/* Groups table */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Grupo</th>
              <th style={thStyle}>Maquinas</th>
              <th style={thStyle}>Regime</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([g, { count, regime }]) => (
              <tr key={g}>
                <td style={tdStyle}>{g}</td>
                <td style={{ ...tdStyle, fontFamily: T.mono }}>{count}</td>
                <td style={tdStyle}>
                  <Pill color={regime === 0 ? T.tertiary : regime >= 24 ? T.blue : regime >= 16 ? T.green : T.orange}>
                    {regime === 0 ? "Externo" : `${regime}h/dia`}
                  </Pill>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Holidays */}
        <div style={{ marginTop: 14, fontSize: 12, color: T.secondary }}>
          <span style={{ fontWeight: 600 }}>{holidays.length} feriados</span> configurados.
          {nextHoliday && <> Proximo: <span style={{ color: T.primary }}>{formatHoliday(nextHoliday)}</span></>}
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
          {holidays.map((h) => (
            <span key={h} style={{ fontSize: 10, color: T.tertiary, padding: "2px 6px", background: T.elevated, borderRadius: 3 }}>
              {formatHoliday(h)}
            </span>
          ))}
        </div>
      </Section>

      {/* ═══ 2. PRIORIDADE ═══ */}
      <Section title="Prioridade — como decide a ordem">
        <RuleRow
          regra="Sensibilidade de urgencia"
          valor={`k1 = ${c.atcs_k1 ?? 1.5}`}
          desc="Quanto maior, mais prioridade a moldes com prazo proximo. 1.0 = normal, 2.0 = muito agressivo."
        />
        <RuleRow
          regra="Limiar de urgencia"
          valor={`${c.urgency_threshold ?? 5} dias`}
          desc={`Moldes a menos de ${c.urgency_threshold ?? 5} dias do prazo sao tratados como urgentes.`}
        />
        <RuleRow
          regra="Bonus caminho critico"
          valor="1.2x"
          desc="A sequencia mais longa de operacoes tem 20% mais prioridade."
        />
        <RuleRow
          regra="Prazo mais proximo primeiro"
          valor="Activo"
          desc="Moldes com prazo de entrega mais cedo sao agendados primeiro."
        />
      </Section>

      {/* ═══ 3. ATRIBUICAO ═══ */}
      <Section title="Atribuicao — como escolhe a maquina">
        <RuleRow
          regra="Maquinas configuradas"
          valor={`${machines.length} (${activeMachines} activas)`}
          desc="Total de maquinas no sistema. Operacoes so podem ir para maquinas compativeis."
        />
        <RuleRow
          regra="Maquina menos carregada"
          valor="Activo"
          desc="Quando ha varias maquinas possiveis, escolhe a que tem menos trabalho acumulado."
        />
        <RuleRow
          regra="Desconto de troca"
          valor="0.5h"
          desc="Se o molde ja esta montado na maquina, descontamos 0.5h — evita trocas desnecessarias."
        />
        <RuleRow
          regra="Bancadas dedicadas"
          valor="Activo"
          desc="Algumas bancadas so trabalham em moldes especificos para evitar erros."
        />
        <RuleRow
          regra="2a Placa CNC"
          valor="Activo"
          desc="Permite que 2 operacoes corram em paralelo na mesma CNC com prato duplo."
        />
      </Section>

      {/* ═══ 4. PONTUACAO ═══ */}
      <Section title="Pontuacao — o que o sistema valoriza">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <WeightBar label="Cumprimento de prazos" value={wDc / wTotal} raw={wDc} desc="Entregar no prazo e o mais importante?" />
          <WeightBar label="Dias totais de producao" value={wMk / wTotal} raw={wMk} desc="Acabar rapidamente conta muito?" />
          <WeightBar label="Trocas de trabalho" value={wSt / wTotal} raw={wSt} desc="Evitar mudancas de molde nas maquinas?" />
          <WeightBar label="Equilibrio de carga" value={wBa / wTotal} raw={wBa} desc="Distribuir trabalho pelas maquinas?" />
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button
            onClick={() => navigateTo("config")}
            style={{
              padding: "6px 14px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`,
              background: "transparent", color: T.blue, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            Alterar pesos
          </button>
        </div>

        {/* Presets */}
        <div style={{ marginTop: 14, fontSize: 12, color: T.secondary }}>
          <span style={{ fontWeight: 600 }}>Presets disponiveis:</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {[
            { id: "rapido", label: "Rapido", desc: "Prioriza prazos (60%) e velocidade (25%)" },
            { id: "equilibrado", label: "Equilibrado", desc: "Peso igual em tudo" },
            { id: "min_setups", label: "Menos trocas", desc: "Minimiza mudancas de molde (50%)" },
            { id: "balanceado", label: "Carga equilibrada", desc: "Distribui trabalho pelas maquinas (45%)" },
          ].map((p) => (
            <div key={p.id} style={{
              padding: "6px 10px", borderRadius: T.radiusSm, border: `1px solid ${T.border}`,
              fontSize: 11, color: T.secondary,
            }}>
              <span style={{ fontWeight: 600, color: T.primary }}>{p.label}</span>
              <span style={{ marginLeft: 4 }}>{"\u2014"} {p.desc}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ═══ 5. OPTIMIZACAO ═══ */}
      <Section title="Optimizacao — como melhora o plano">
        <RuleRow
          regra="Melhoria local (VNS)"
          valor={c.vns_enabled !== false ? "Activo" : "Desactivado"}
          desc="Depois de construir o plano, o sistema tenta melhorar trocando operacoes entre maquinas."
        />
        <RuleRow
          regra="Iteracoes de melhoria"
          valor={`${c.vns_max_iter ?? 150}`}
          desc="Quantas tentativas de melhoria faz. Mais iteracoes = plano melhor mas mais lento."
        />
        <RuleRow
          regra="Buffer de seguranca"
          valor={`${c.lst_safety_buffer ?? 2} dias`}
          desc={`O sistema deixa ${c.lst_safety_buffer ?? 2} dias de margem antes de cada prazo.`}
        />
        <RuleRow
          regra="Tolerancia de troca"
          valor={`${c.edd_swap_tolerance ?? 5} dias`}
          desc="Pode trocar operacoes que estejam a menos de 5 dias de distancia no plano."
        />
        <RuleRow
          regra="Horizonte maximo"
          valor={`${c.max_run_days ?? 5} dias`}
          desc="Numero maximo de dias que o scheduler considera por iteracao."
        />
        <RuleRow
          regra="OEE por defeito"
          valor={`${Math.round((c.oee_default ?? 0.66) * 100)}%`}
          desc="Eficiencia media assumida para as maquinas. 66% significa que por cada hora disponivel, usa-se 40 minutos."
        />
      </Section>

      {/* Footer */}
      <div style={{ fontSize: 12, color: T.tertiary, textAlign: "center", paddingBottom: 24 }}>
        Para alterar valores, ir a{" "}
        <button onClick={() => navigateTo("config")} style={{
          background: "none", border: "none", color: T.blue, cursor: "pointer",
          fontFamily: "inherit", fontSize: 12, textDecoration: "underline", padding: 0,
        }}>
          Configuracao
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card style={{ padding: 0, overflow: "hidden" }}>
      <div style={{
        padding: "10px 16px", background: "rgba(255,255,255,0.03)",
        borderBottom: `0.5px solid ${T.border}`,
        fontSize: 13, fontWeight: 700, color: T.primary,
        textTransform: "uppercase", letterSpacing: "0.05em",
      }}>
        {title}
      </div>
      <div style={{ padding: "14px 16px" }}>{children}</div>
    </Card>
  );
}

function RuleRow({ regra, valor, desc }: { regra: string; valor: string; desc: string }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: `0.5px solid ${T.border}` }}>
      <div style={{ width: "30%", fontSize: 13, color: T.primary }}>{regra}</div>
      <div style={{ width: "15%", fontSize: 13, fontFamily: T.mono, color: T.blue }}>{valor}</div>
      <div style={{ flex: 1, fontSize: 12, color: T.secondary }}>{desc}</div>
    </div>
  );
}

function WeightBar({ label, value, desc }: { label: string; value: number; raw?: number; desc: string }) {
  const pct = Math.round(value * 100);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 13, color: T.primary }}>{label}</span>
        <span style={{ fontSize: 12, fontFamily: T.mono, color: T.blue }}>{pct}%</span>
      </div>
      <ProgressBar value={pct} color={pct > 30 ? T.blue : T.tertiary} height={6} />
      <div style={{ fontSize: 11, color: T.tertiary, marginTop: 2 }}>{desc}</div>
    </div>
  );
}
