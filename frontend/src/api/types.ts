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
  conclusao_prevista: string;
  dias_atraso: number;
  operacoes_pendentes: number;
  on_time: boolean;
  progresso: number;
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
  molde_id: string;
  target_week: string;
  feasible: boolean;
  slack_dias: number;
  dias_extra: number;
  reason: string;
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

export interface PatternAlert {
  maquina_id: string;
  tipo: string;
  descricao: string;
  n_ocorrencias: number;
  acao_sugerida: string;
}

export type AnomalyOrPattern = AnomalyResult | PatternAlert;

// ── Analytics: Proposals ────────────────────────────────────────

export interface Proposal {
  id: string;
  type: string;
  description: string;
  estimated_impact: string;
  affected_ops: number[];
  machine_from: string | null;
  machine_to: string | null;
  priority: number;
}

export interface ProposalsResponse {
  proposals: Proposal[];
  current_makespan: number;
  current_setups: number;
  summary: string;
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

// ── Today / Trust / Coverage / Late / Learning ──────────────────

export interface TodayInfo {
  today: string;
  data_referencia: string;
}

export interface TrustDimension {
  name: string;
  score: number;
  details: string[];
}

export interface TrustIndex {
  score: number;
  gate: string;
  n_ops: number;
  n_issues: number;
  dimensions: TrustDimension[];
}

export interface TimelineData {
  timeline: Record<string, TimelineSegment[]>;
}

export interface TimelineSegment {
  op_id: number;
  molde: string;
  dia: number;
  inicio_h: number;
  fim_h: number;
  duracao_h: number;
  setup_h: number;
  e_2a_placa: boolean;
  e_continuacao: boolean;
}

export interface BottleneckEntry {
  maquina_id: string;
  stress_pct: number;
  total_horas: number;
  capacidade: number;
}

export interface BottlenecksData {
  bottlenecks: BottleneckEntry[];
}

export interface MoldeDetail {
  molde: Record<string, unknown>;
  operacoes: Operacao[];
  segmentos: SegmentoMoldit[];
  caminho_critico: number[];
}

export interface SimulateApplyResponse {
  status: string;
  score: ScoreMoldit;
  score_previous: ScoreMoldit;
  summary: string;
  n_segments_before: number;
  n_segments_after: number;
  time_ms: number;
  can_revert: boolean;
}

export interface RevertResponse {
  status: string;
  score: ScoreMoldit;
}

export interface CanRevertResponse {
  can_revert: boolean;
}

export interface MachineEventInput {
  maquina_id: string;
  tipo: string;
  inicio: string;
  fim?: string;
  duracao_h?: number;
  planeado?: boolean;
  notas?: string;
}

export interface MachineEvent {
  id: number;
  maquina_id: string;
  tipo: string;
  inicio: string;
  fim: string | null;
  duracao_h: number;
  planeado: boolean;
  notas: string;
  created_at: string;
}

// ── Alerts (full lifecycle) ──────────────────────────────────────

export interface AlertSuggestion {
  acao: string;
  impacto: string;
  esforco: string;      // "baixo" | "medio" | "alto"
  mutation_type: string | null;
  mutation_params: Record<string, unknown>;
}

export interface MolditAlert {
  id: string;
  regra: string;        // "R1", "R2", ...
  severidade: string;   // "critico" | "aviso" | "info"
  titulo: string;
  mensagem: string;
  timestamp: string;    // ISO 8601
  moldes_afetados: string[];
  maquinas_afetadas: string[];
  operacoes: number[];
  impacto_dias: number;
  sugestoes: AlertSuggestion[];
  estado: string;       // "ativo" | "reconhecido" | "resolvido" | "ignorado"
}

/** @deprecated Use MolditAlert instead — kept for backward compat */
export interface Alert {
  id: string;
  tipo: string;
  severidade: string;
  estado: string;
  titulo: string;
  descricao: string;
  molde: string;
  maquina_id: string;
  created_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  note: string;
}

export interface AlertStats {
  total: number;
  por_severidade: Record<string, number>;
  por_estado: Record<string, number>;
}

export interface AlertEvaluateResult {
  total: number;
  critico: number;
  aviso: number;
  info: number;
  alerts: MolditAlert[];
}

// ── Reports ─────────────────────────────────────────────────────

export interface SendReportRequest {
  tipo: string;
  destinatarios: string[];
  molde_id?: string;
  date?: string;
  notas?: string;
}

// ── Explain ─────────────────────────────────────────────────────

export interface ExplainCard {
  id: string;
  frase: string;
  cor: string;
  valor?: string;
}

export interface ExplainInicio {
  frase_resumo: { text: string; color: string };
  cartoes: ExplainCard[];
  alertas: Record<string, unknown>[];
}

export interface ExplainMolde {
  frase_resumo: string;
  deadline: { frase: string; cor: string };
  analogo: string | null;
  operacoes_ml: { op_id: number; frase_ml: string }[];
}

export interface ExplainEquipa {
  frase_resumo: string;
  pessoas: { nome: string; frase: string }[];
  problemas: string[];
}

// ── Workforce Gaps ──────────────────────────────────────────────

export interface CompetencyGap {
  competencia: string;
  maquinas_que_exigem: number;
  nivel_minimo_max: number;
  zonas: string[];
  operadores_qualificados_A: number;
  operadores_qualificados_B: number;
  total_qualificados: number;
  deficit: number;
  cobertura_pct: number;
}

export interface CompetencyGapsData {
  total_competencias: number;
  gaps_criticos: number;
  gaps: CompetencyGap[];
}

// ── Copilot Health ──────────────────────────────────────────────

export interface CopilotHealth {
  status: string;
  has_data: boolean;
  n_segments: number;
}

// ── ML Ingest / Bootstrap / Config ──────────────────────────────

export interface MLIngestRequest {
  molde_id: string;
  cliente?: string;
  data_inicio: string;
  data_conclusao: string;
  data_deadline: string;
  n_operacoes?: number;
  work_total_h?: number;
  makespan_planeado_dias?: number;
  makespan_real_dias?: number;
  operacoes?: Record<string, unknown>[];
}

export interface MLConfigUpdate {
  usar_previsoes_ml?: boolean;
  min_confianca?: number;
}

// ── Analytics: Coverage ─────────────────────────────────────────

export interface MoldCoverage {
  molde_id: string;
  total_ops: number;
  ops_agendadas: number;
  cobertura_pct: number;
  ops_sem_maquina: number;
  dag_gaps: number;
}

export interface CoverageReport {
  overall_coverage_pct: number;
  molds: MoldCoverage[];
  uncovered_ops: number[];
  summary: string;
}

// ── Analytics: Late Delivery ────────────────────────────────────

export interface TardyAnalysis {
  molde_id: string;
  op_id: number;
  maquina_id: string;
  deadline_dia: number;
  completion_dia: number;
  delay_dias: number;
  root_cause: string;   // "capacity" | "setup_overhead" | "priority_conflict" | "dependency_chain"
  explanation: string;
  capacity_gap_h: number;
  competing_moldes: string[];
}

export interface LateDeliveryReport {
  tardy_count: number;
  by_cause: Record<string, number>;
  analyses: TardyAnalysis[];
  worst_machine: string | null;
  suggestion: string;
}

// ── Risk (full typed structures) ────────────────────────────────

export interface OpRisk {
  op_id: number;
  molde: string;
  machine_id: string;
  edd: number;
  completion_day: number;
  slack_days: number;
  slack_min: number;
  risk_score: number;   // 0.0 to 1.0
  risk_level: string;   // "low" | "medium" | "high" | "critical"
  binding_constraint: string;  // "capacity" | "crew" | "none"
}

export interface MachineRiskDetail {
  machine_id: string;
  peak_utilization: number;
  avg_utilization: number;
  critical_op_count: number;
  bottleneck_score: number;
}

export interface HeatmapCell {
  machine_id: string;
  day_idx: number;
  utilization: number;
  min_slack_min: number;
  risk_level: string;   // "low" | "medium" | "high" | "critical"
}

export interface RiskResultFull {
  health_score: number;
  op_risks: OpRisk[];
  machine_risks: MachineRiskDetail[];
  heatmap: HeatmapCell[];
  critical_count: number;
  top_risks: OpRisk[];
  bottleneck: string;
  surrogate_otd_prob: number | null;
  surrogate_confidence: string | null;
  mc_otd_p50: number | null;
  mc_otd_p80: number | null;
  mc_otd_p95: number | null;
  mc_tardy_expected: number | null;
  mc_runs: number | null;
}

// ── Rules ───────────────────────────────────────────────────────

export interface SchedulerRule {
  id: string;
  [key: string]: unknown;
}

export type RulesData = SchedulerRule[];

// ── Reports ─────────────────────────────────────────────────────

export interface ReportMeta {
  tipo: string;         // "diario" | "semanal" | "cliente"
  destinatarios: string[];
  molde_id: string;
  date: string;
  notas: string;
}

// ── Learning ────────────────────────────────────────────────────

export interface LearningData {
  [key: string]: unknown;
}

// ── Deadline Status (full response shape) ───────────────────────

export interface DeadlineStatusFull {
  molde: string;
  deadline: string;
  conclusao_prevista: string | number;
  dias_atraso: number;
  on_time: boolean;
  operacoes_pendentes: number;
  progresso: number;
}
