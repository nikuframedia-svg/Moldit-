/** Glossary — termos proibidos → portugues simples.
 *
 * Regra: nunca mostrar jargao tecnico ao utilizador.
 * Usar t("makespan") em vez de "Makespan" directamente.
 */

const GLOSSARY: Record<string, string> = {
  // Scheduling
  makespan: "dias totais",
  makespan_total_dias: "dias totais de producao",
  compliance: "cumprimento",
  deadline_compliance: "cumprimento de prazos",
  weighted_score: "pontuacao global",
  utilization: "ocupacao",
  utilization_balance: "equilibrio de carga",
  total_setups: "trocas de trabalho",
  setup: "preparacao",
  setup_h: "tempo de preparacao",
  slot: "espaco",
  buffer: "margem",
  throughput: "capacidade",
  bottleneck: "gargalo",
  stress: "carga",
  stress_pct: "nivel de carga",
  regime_h: "horas de trabalho",

  // Risk & ML
  monte_carlo: "simulacao de risco",
  surrogate: "modelo rapido",
  prob_atraso: "probabilidade de atraso",
  confianca: "confianca",
  previsao_ml: "previsao do sistema",
  shap: "contribuicao de factores",
  cold_start: "fase de aprendizagem",
  anomaly: "anomalia",
  calibration: "calibracao",

  // Operations
  dag: "sequencia de dependencias",
  caminho_critico: "sequencia mais longa",
  predecessores: "operacoes anteriores",
  sucessores: "operacoes seguintes",
  slack: "margem de tempo",
  flexibilidade: "flexibilidade",

  // Domain
  molde: "molde",
  operacao: "operacao",
  maquina: "maquina",
  turno: "turno",
  competencias: "competencias",
  zona: "zona",
  deficit: "pessoas em falta",
  forecast: "previsao",
};

/** Translate a technical term to simple Portuguese.
 *  Returns the key itself if no translation exists. */
export function t(key: string): string {
  return GLOSSARY[key] ?? key;
}

/** Capitalize first letter. */
export function T(key: string): string {
  const val = t(key);
  return val.charAt(0).toUpperCase() + val.slice(1);
}

export default GLOSSARY;
