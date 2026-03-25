import { useEffect, useState } from "react";
import { T } from "../theme/tokens";
import { getConfig } from "../api/endpoints";
import type { FactoryConfig } from "../api/types";
import { Card } from "../components/ui/Card";
import { Label } from "../components/ui/Label";
import { Dot } from "../components/ui/Dot";

interface SchedulerRule {
  id: string;
  categoria: string;
  descricao: string;
  valor: string;
  activo: boolean;
}

function buildRules(config: FactoryConfig): SchedulerRule[] {
  return [
    { id: "R01", categoria: "Lotes", descricao: "Modo eco lot — arredondamento ao lote economico", valor: String(config.eco_lot_mode), activo: true },
    { id: "R02", categoria: "JIT", descricao: "Backward scheduling — produzir o mais tarde possivel", valor: config.jit_enabled ? "Activo" : "Inactivo", activo: config.jit_enabled },
    { id: "R03", categoria: "JIT", descricao: "Buffer JIT — margem de seguranca", valor: `${(config.jit_buffer_pct * 100).toFixed(0)}%`, activo: config.jit_enabled },
    { id: "R04", categoria: "JIT", descricao: "Threshold JIT — limite para activar", valor: `${config.jit_threshold}%`, activo: config.jit_enabled },
    { id: "R05", categoria: "Dispatch", descricao: "Max dias consecutivos por run", valor: `${config.max_run_days} dias`, activo: true },
    { id: "R06", categoria: "Dispatch", descricao: "Gap maximo entre EDDs no mesmo run", valor: `${config.max_edd_gap} dias`, activo: true },
    { id: "R07", categoria: "Dispatch", descricao: "Tolerancia para swap de EDD", valor: `${config.edd_swap_tolerance} dias`, activo: true },
    { id: "R08", categoria: "Dispatch", descricao: "Janela de campanha (agrupamento ferramentas)", valor: `${config.campaign_window} dias`, activo: true },
    { id: "R09", categoria: "Dispatch", descricao: "Threshold de urgencia", valor: `${config.urgency_threshold} dias`, activo: true },
    { id: "R10", categoria: "Dispatch", descricao: "Interleave de urgentes entre runs", valor: config.interleave_enabled ? "Activo" : "Inactivo", activo: config.interleave_enabled },
    { id: "R11", categoria: "Scoring", descricao: "Peso earliness na funcao objectivo", valor: String(config.weight_earliness), activo: true },
    { id: "R12", categoria: "Scoring", descricao: "Peso setups na funcao objectivo", valor: String(config.weight_setups), activo: true },
    { id: "R13", categoria: "Scoring", descricao: "Peso balance na funcao objectivo", valor: String(config.weight_balance), activo: true },
    { id: "R14", categoria: "Capacidade", descricao: "OEE default aplicado a todas as operacoes", valor: String(config.oee_default), activo: true },
    { id: "R15", categoria: "Capacidade", descricao: "Capacidade diaria por maquina", valor: `${config.day_capacity_min} min`, activo: true },
  ];
}

const thStyle: React.CSSProperties = {
  fontSize: 11, color: T.tertiary, fontWeight: 500, textAlign: "left",
  padding: "8px 12px", borderBottom: `1px solid ${T.border}`,
  textTransform: "uppercase", letterSpacing: "0.04em",
};

const tdStyle: React.CSSProperties = {
  fontSize: 12, color: T.primary, padding: "6px 12px",
  borderBottom: `1px solid ${T.border}`,
};

export function RulesPage() {
  const [config, setConfig] = useState<FactoryConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConfig()
      .then(setConfig)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div style={{ color: T.red, padding: 24 }}>{error}</div>;
  if (!config) return <div style={{ color: T.secondary, padding: 24 }}>A carregar...</div>;

  const rules = buildRules(config);
  const categorias = [...new Set(rules.map((r) => r.categoria))];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ fontSize: 13, color: T.secondary }}>
        {rules.length} regras activas do scheduler. Editaveis em Configuracao → Parametros.
      </div>

      {categorias.map((cat) => (
        <Card key={cat} style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px 8px" }}>
            <Label>{cat}</Label>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: 50 }}>ID</th>
                <th style={thStyle}>Descricao</th>
                <th style={{ ...thStyle, width: 120 }}>Valor</th>
                <th style={{ ...thStyle, width: 60 }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {rules.filter((r) => r.categoria === cat).map((r) => (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, fontFamily: T.mono, color: T.tertiary }}>{r.id}</td>
                  <td style={{ ...tdStyle, fontFamily: "inherit" }}>{r.descricao}</td>
                  <td style={{ ...tdStyle, fontFamily: T.mono, fontWeight: 600 }}>{r.valor}</td>
                  <td style={tdStyle}><Dot color={r.activo ? T.green : T.tertiary} size={6} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
