/** REGRAS — "Como funciona o planeador?"
 *
 * Inquiry screen (read-only). Equivalente ao DSPJOB do AS/400.
 * Mostra todas as regras activas do scheduler com valores dinamicos.
 */

import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { getConfig } from "../api/endpoints";
import type { MolditConfig } from "../api/types";
import { Card } from "../components/ui/Card";
import { useAppStore } from "../stores/useAppStore";

interface Regra {
  regra: string;
  valor: string;
  descricao: string;
}

interface Categoria {
  nome: string;
  regras: Regra[];
}

function buildRegras(cfg: MolditConfig): Categoria[] {
  const c = cfg as any;
  const wMakespan = c.weight_makespan ?? cfg.scoring?.weight_makespan ?? 5;
  const wCompliance = c.weight_deadline_compliance ?? cfg.scoring?.weight_deadline_compliance ?? 8;
  const wSetups = c.weight_setups ?? cfg.scoring?.weight_setups ?? 3;
  const wBalance = c.weight_balance ?? cfg.scoring?.weight_utilization_balance ?? 4;
  const nMachines = Object.keys(cfg.machines ?? c.machines ?? {}).length;
  const nHolidays = (cfg.holidays ?? c.holidays ?? []).length;

  return [
    {
      nome: "Prioridade",
      regras: [
        { regra: "Prazo mais proximo primeiro", valor: "Activo", descricao: "Moldes com prazo mais cedo tem prioridade" },
        { regra: "Boost de urgencia", valor: "k1=1.5, k2=0.5", descricao: "Quanto mais urgente, mais sobe na fila" },
        { regra: "Caminho critico primeiro", valor: "Activo", descricao: "A sequencia mais longa tem prioridade" },
      ],
    },
    {
      nome: "Atribuicao",
      regras: [
        { regra: "Maquina menos carregada", valor: "Activo", descricao: "Escolhe a maquina com menos trabalho" },
        { regra: "Desconto de troca", valor: "25%", descricao: "Prefere maquina com tipo ja montado" },
        { regra: "Dedicacao de bancada", valor: "Activo", descricao: "Respeita bancadas dedicadas a moldes" },
        { regra: "2a Placa CNC", valor: "Activo", descricao: "Permite trabalho paralelo em CNC" },
        { regra: "Maquinas configuradas", valor: `${nMachines}`, descricao: `${nMachines} maquinas disponiveis no sistema` },
      ],
    },
    {
      nome: "Tempo",
      regras: [
        { regra: "Respeitar turnos", valor: "7h-15h30 / 15h30-23h", descricao: "Operacoes dentro do horario definido" },
        { regra: "Respeitar feriados", valor: `${nHolidays} dias`, descricao: "Sem trabalho nos feriados configurados" },
        { regra: "Subcontratacao", valor: "Activo", descricao: "Trabalho externo nao ocupa maquinas internas" },
      ],
    },
    {
      nome: "Pontuacao",
      regras: [
        { regra: "Peso: dias totais", valor: `${wMakespan} de 10`, descricao: "Importancia de acabar rapidamente" },
        { regra: "Peso: cumprimento de prazos", valor: `${wCompliance} de 10`, descricao: "Importancia de entregar no prazo" },
        { regra: "Peso: trocas de trabalho", valor: `${wSetups} de 10`, descricao: "Importancia de evitar mudancas" },
        { regra: "Peso: equilibrio de carga", valor: `${wBalance} de 10`, descricao: "Importancia de distribuir trabalho" },
      ],
    },
    {
      nome: "Optimizacao",
      regras: [
        { regra: "Melhoria local (VNS)", valor: "Activo, 100 iter", descricao: "Tenta melhorar apos construir o plano" },
        { regra: "Nunca aceitar pior", valor: "Activo", descricao: "So aceita mudancas que melhoram o resultado" },
        { regra: "Alerta sobrecarga", valor: "Activo", descricao: "Avisa quando ha carga excessiva" },
      ],
    },
  ];
}

export default function RegrasPage() {
  const [cfg, setCfg] = useState<MolditConfig | null>(null);
  const setStatus = useAppStore((s) => s.setStatus);

  useEffect(() => {
    getConfig().then(setCfg).catch((e) => setStatus("error", e.message ?? "Erro ao carregar configuracao"));
  }, [setStatus]);

  if (!cfg) return <div style={{ padding: 24, color: T.tertiary }}>A carregar regras...</div>;

  const categorias = buildRegras(cfg);

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: T.primary, marginBottom: 8 }}>
        Como funciona o planeador?
      </div>
      <div style={{ fontSize: 13, color: T.tertiary, marginBottom: 24 }}>
        Todas as regras que o sistema segue para construir o plano de producao.
      </div>

      {categorias.map((cat) => (
        <Card key={cat.nome} style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
          <div
            style={{
              padding: "10px 16px",
              background: "rgba(255,255,255,0.03)",
              borderBottom: `0.5px solid ${T.border}`,
              fontSize: 13,
              fontWeight: 700,
              color: T.primary,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {cat.nome}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {cat.regras.map((r, i) => (
                <tr
                  key={i}
                  style={{
                    borderBottom: i < cat.regras.length - 1 ? `0.5px solid ${T.border}` : "none",
                  }}
                >
                  <td style={{ padding: "10px 16px", fontSize: 13, color: T.primary, width: "35%" }}>
                    {r.regra}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      fontSize: 13,
                      fontFamily: T.mono,
                      color: T.blue,
                      width: "20%",
                    }}
                  >
                    {r.valor}
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 12, color: T.secondary }}>
                    {r.descricao}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <div style={{ fontSize: 12, color: T.tertiary, marginTop: 16, textAlign: "center", paddingBottom: 24 }}>
        Para alterar valores, ir a{" "}
        <button
          onClick={() => useAppStore.getState().setPage("config")}
          style={{
            background: "none",
            border: "none",
            color: T.blue,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: 12,
            textDecoration: "underline",
            padding: 0,
          }}
        >
          CONFIG &gt; Pesos
        </button>
      </div>
    </div>
  );
}
