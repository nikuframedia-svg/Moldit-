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
  state_phrase: string;
  machines_today: MaquinaStatus[];
  deadlines_week: DeadlineStatus[];
  day_summary: Record<string, unknown> | null;
  action_items: { severity: string; title: string; detail: string }[];
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
  n_ops: number;
  n_segments: number;
  score: ScoreMoldit;
  time_ms: number;
}
