// Moldit Planner — API Types

export interface Operacao {
  op_id: number;
  molde: string;
  componente: string;
  nome: string;
  codigo: string;
  nome_completo: string;
  duracao_h: number;
  work_h: number;
  progresso: number;
  work_restante_h: number;
  recurso: string | null;
  grupo_recurso: string | null;
  e_condicional: boolean;
  e_2a_placa: boolean;
  deadline_semana: string | null;
  notas: string | null;
}

export interface Molde {
  id: string;
  cliente: string;
  deadline: string;
  data_ensaio: string | null;
  componentes: string[];
  total_ops: number;
  ops_concluidas: number;
  progresso: number;
  total_work_h: number;
}

export interface SegmentoMoldit {
  op_id: number;
  molde: string;
  maquina_id: string;
  dia: number;
  inicio_h: number;
  fim_h: number;
  duracao_h: number;
  setup_h: number;
  e_2a_placa: boolean;
  e_continuacao: boolean;
  progresso_antes: number;
}

export interface ScoreMoldit {
  makespan_total_dias: number;
  makespan_por_molde: Record<string, number>;
  deadline_compliance: number;
  total_setups: number;
  utilization: Record<string, number>;
  utilization_balance: number;
  weighted_score: number;
  ops_agendadas: number;
  ops_total: number;
}

export interface MaquinaStatus {
  maquina_id: string;
  total_horas: number;
  capacidade: number;
  stress_pct: number;
  pico_dia: number;
  pico_horas: number;
}

export interface DeadlineStatus {
  molde: string;
  deadline: string;
  conclusao_prevista: number;
  dias_atraso: number;
  operacoes_pendentes: number;
  on_time: boolean;
}

export interface MolditConfig {
  name: string;
  machines: Record<string, { group: string; regime_h: number; setup_h: number }>;
  holidays: string[];
  scoring: {
    weight_makespan: number;
    weight_deadline_compliance: number;
    weight_setups: number;
    weight_utilization_balance: number;
  };
}

export interface CTPMolde {
  molde: string;
  feasible: boolean;
  conclusao_dia: number;
  slack_dias: number;
  dias_extra: number;
}

export type MutationType =
  | 'machine_down' | 'overtime' | 'deadline_change' | 'priority_boost'
  | 'add_holiday' | 'remove_holiday' | 'force_machine' | 'op_done';

export interface MutationMoldit {
  type: MutationType;
  params: Record<string, unknown>;
}

export interface DeltaReport {
  makespan_before: number;
  makespan_after: number;
  compliance_before: number;
  compliance_after: number;
  setups_before: number;
  setups_after: number;
  balance_before: number;
  balance_after: number;
  summary: string;
}

export interface SimulateResponse {
  segmentos: SegmentoMoldit[];
  score: ScoreMoldit;
  delta: DeltaReport;
  time_ms: number;
  summary: string;
}

export interface ConsoleData {
  state: { color: string; phrase: string };
  actions: {
    severity: string;
    title: string;
    detail: string;
    suggestion: string | null;
    category: string;
    deadline: string;
    client: string;
  }[];
  machines: { machine_id: string; utilization_pct: number; setup_count: number }[];
  expedition: { client: string; ready: number; partial: number; not_ready: number; total: number }[];
  tomorrow: Record<string, unknown> | null;
  summary: { text: string; color: string }[];
}

export interface RiskResult {
  health_score: number;
  bottleneck_machines: MaquinaStatus[];
  heatmap: { maquina_id: string; dia: number; stress_pct: number }[];
  proposals: { titulo: string; descricao: string; impacto: string }[];
}

export interface JournalEntry {
  step: string;
  severity: string;
  message: string;
  metadata?: Record<string, unknown>;
  elapsed_ms: number;
}

export interface ChatResponse {
  response: string;
  widgets: unknown[];
  tools_used: number;
}

export interface LoadResponse {
  status: string;
  n_operacoes: number;
  n_moldes: number;
  n_maquinas: number;
  n_segmentos: number;
  score: ScoreMoldit;
  warnings: string[];
}

// ── Mold Explorer Types ─────────────────────────────────────

export interface SlackInfo {
  op_id: number;
  earliest_start_h: number;
  latest_start_h: number;
  slack_h: number;
  no_caminho_critico: boolean;
}

export interface ExplorerOp {
  op_id: number;
  nome: string;
  codigo: string;
  maquina: string;
  dia: number;
  inicio_h: number;
  fim_h: number;
  work_h: number;
  setup_h: number;
  predecessores: number[];
  sucessores: number[];
  slack_h: number;
  maquinas_alternativas: number;
  no_caminho_critico: boolean;
  flexibilidade: 'verde' | 'azul' | 'laranja' | 'vermelho' | 'cinzento';
  earliest_start: { dia: number; hora: number };
  latest_start: { dia: number; hora: number };
}

export interface GhostOp {
  op_id: number;
  molde: string;
  maquina: string;
  dia: number;
  inicio_h: number;
  fim_h: number;
}

export interface ExplorerDep {
  de: number;
  para: number;
  no_critico: boolean;
}

export interface MoldExplorerData {
  molde: { id: string; deadline: string; progresso: number; status: string };
  operacoes: ExplorerOp[];
  fantasmas: GhostOp[];
  dependencias: ExplorerDep[];
}

export interface MachineOption {
  maquina: string;
  dia: number;
  inicio: number;
  fim: number;
  setup_delta: number;
  impacto: {
    makespan_delta: number;
    compliance_delta: number;
    setups_delta: number;
    balance_delta: number;
    score_delta: number;
  };
  cascata: { op_id: number; molde: string; efeito: string; severidade: string }[];
}

export interface OpOptions {
  op_id: number;
  situacao_atual: { maquina: string; dia: number; inicio: number; fim: number };
  opcoes_maquina: MachineOption[];
  opcoes_timing: {
    earliest: { dia: number; hora: number };
    latest: { dia: number; hora: number };
    atual: { dia: number; hora: number };
  };
  opcoes_sequencia: { trocar_com: number; descricao: string; setup_delta: number }[];
}

// ── Module A: Calibration & Learning ─────────────────────────────

export interface CalibrationFactor {
  codigo: string;
  ratio_media: number;
  ratio_std: number;
  n_amostras: number;
  confianca: number;
}

export interface MachineReliability {
  maquina_id: string;
  uptime_pct: number;
  mtbf_h: number;
  mttr_h: number;
  n_eventos: number;
}

export interface CalibrationData {
  fatores: Record<string, CalibrationFactor>;
  fiabilidade: Record<string, MachineReliability>;
}

export interface ExecutionLog {
  id: number;
  op_id: number;
  molde: string;
  maquina_id: string;
  codigo: string;
  work_h_planeado: number;
  work_h_real: number;
  setup_h_planeado: number;
  setup_h_real: number;
  dia_planeado: number;
  dia_real: number;
  motivo_desvio: string;
  reportado_por: string;
  created_at: string;
}

// ── Module C: Alerts ─────────────────────────────────────────────

export interface AlertSuggestion {
  acao: string;
  impacto: string;
  esforco: string;
}

export interface MolditAlert {
  id: string;
  regra: string;
  severidade: "critico" | "aviso" | "info" | "positivo";
  titulo: string;
  mensagem: string;
  timestamp: string;
  moldes_afetados: string[];
  maquinas_afetadas: string[];
  impacto_dias: number;
  sugestoes: AlertSuggestion[];
  estado: string;
}

export interface AlertStats {
  critico: number;
  aviso: number;
  info: number;
  total: number;
}

// ── Module D: Workforce ──────────────────────────────────────────

export interface Operador {
  id: string;
  nome: string;
  competencias: string[];
  nivel: Record<string, number>;
  turno: string;
  zona: string;
  disponivel: boolean;
  horas_semanais: number;
}

export interface WorkforceConflict {
  tipo: string;
  dia: number;
  turno: string;
  maquinas: string[];
  operadores_necessarios: number;
  operadores_disponiveis: number;
  deficit: number;
  descricao: string;
  severidade: string;
}

export interface WorkforceAllocation {
  dia: number;
  turno: string;
  maquina_id: string;
  operador_id: string;
  auto: boolean;
}

export interface ForecastEntry {
  semana: number;
  zona: string;
  turno: string;
  necessarios: number;
  disponiveis: number;
  deficit: number;
  horas_extra_h: number;
}

// ── ML Types ─────────────────────────────────────────────────────

export interface ShapContribution {
  feature: string;
  contribuicao_h: number;
  descricao: string;
}

export interface DurationPrediction {
  op_id: number;
  estimado_mpp: number;
  previsao_ml: number;
  intervalo_p10: number;
  intervalo_p90: number;
  ratio: number;
  confianca: number;
  explicacao: ShapContribution[];
}

export interface RiskPrediction {
  molde_id: string;
  prob_atraso: number;
  dias_atraso_esperado: number;
  top_fatores_risco: string[];
  molde_analogo_que_atrasou: string;
  recomendacao: string;
}

export interface AnalogoResult {
  projeto_id: string;
  molde_id: string;
  similaridade: number;
  n_ops: number;
  makespan_real_dias: number;
  compliance: boolean;
  nota: string;
}

export interface MachineScoreML {
  maquina: string;
  ratio_medio: number;
  ratio_std: number;
  n_amostras: number;
  percentil_95: number;
  taxa_problemas: number;
}

export interface AnomalyResult {
  op_id: number;
  tipo: string;
  projecao_h: number;
  esperado_h: number;
  desvio_pct: number;
  acao_sugerida: string;
  timestamp: string;
}

export interface MLModelStatus {
  name: string;
  version: string;
  health: string;
  last_train: string;
  metrics: Record<string, number>;
  n_samples: number;
}

export interface MLStatus {
  phase: string;
  phase_label: string;
  n_projetos: number;
  models: MLModelStatus[];
  last_retrain: string;
  models_active: string[];
  min_confianca: number;
  message: string;
}

export interface EvolutionPoint {
  date: string;
  mae: number;
  coverage: number;
  n_samples: number;
}

export interface TrainReport {
  status: string;
  models_trained: string[];
  duration_s: number;
  metrics: Record<string, Record<string, number>>;
  warnings: string[];
}

export interface RankingMatrix {
  tipos: string[];
  maquinas: string[];
  data: Record<string, MachineScoreML[]>;
}
