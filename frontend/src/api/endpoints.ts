/** Typed endpoint functions — one per backend route. */

import { get, getText, post, put, del, upload } from "./client";
import type {
  AlertEvaluateResult,
  AlertStats,
  AnalogoResult,
  AnomalyResult,
  BottlenecksData,
  CalibrationData,
  CanRevertResponse,
  ChatResponse,
  CompetencyGapsData,
  ConsoleData,
  CopilotHealth,
  CoverageReport,
  CTPMolde,
  DeadlineStatus,
  DurationPrediction,
  EvolutionPoint,
  ExecutionLog,
  ExplainEquipa,
  ExplainInicio,
  ExplainMolde,
  ForecastEntry,
  JournalEntry,
  LateDeliveryReport,
  LoadResponse,
  MachineEvent,
  MachineEventInput,
  MachineScoreML,
  MaquinaStatus,
  MLConfigUpdate,
  MLIngestRequest,
  MLStatus,
  MoldeDetail,
  MoldExplorerData,
  Molde,
  MolditAlert,
  MolditConfig,
  MutationMoldit,
  Operacao,
  Operador,
  ProposalsResponse,
  OpOptions,
  RankingMatrix,
  RevertResponse,
  RiskPrediction,
  RiskResult,
  ScoreMoldit,
  SegmentoMoldit,
  SendReportRequest,
  SimulateApplyResponse,
  SimulateResponse,
  TimelineData,
  TodayInfo,
  TrainReport,
  TrustIndex,
  WorkforceAllocation,
  WorkforceConflict,
} from "./types";

// ── Core ─────────────────────────────────────────────────────

export const getScore = () => get<ScoreMoldit>("/api/data/score");
export const getSegments = () => get<SegmentoMoldit[]>("/api/data/segments");
export const getMoldes = () => get<Molde[]>("/api/data/moldes");
export const getOps = () => get<Operacao[]>("/api/data/ops");
export const getStress = () => get<MaquinaStatus[]>("/api/data/stress");
export const getDeadlines = () => get<DeadlineStatus[]>("/api/data/deadlines");
export const getJournal = () => get<JournalEntry[]>("/api/data/journal");
export const getToday = () => get<TodayInfo>("/api/data/today");
export const getTrust = () => get<TrustIndex>("/api/data/trust");
export const getTimeline = () => get<TimelineData>("/api/data/timeline");
export const getBottlenecks = () => get<BottlenecksData>("/api/data/bottlenecks");
export const getCoverage = () => get<CoverageReport>("/api/data/coverage");
export const getLateDeliveries = () => get<LateDeliveryReport>("/api/data/late");
export const getProposals = () => get<ProposalsResponse>("/api/data/proposals");
export const getRules = () => get<Record<string, unknown>[]>("/api/data/rules");
export const getLearning = () => get<Record<string, unknown> | null>("/api/data/learning");
export const getMoldeDetail = (moldeId: string) =>
  get<MoldeDetail>(`/api/data/moldes/${encodeURIComponent(moldeId)}`);

// ── Config ──────────────────────────────────────────────────

export const getConfig = () => get<MolditConfig>("/api/data/config");
export const updateConfig = (updates: Record<string, unknown>) =>
  put<{ status: string; changed: string[]; score: ScoreMoldit }>("/api/data/config", updates);

// ── Master Data Mutations ────────────────────────────────────

export const editMachine = (mid: string, updates: Record<string, unknown>) =>
  put<{ status: string; score: ScoreMoldit }>(`/api/data/machines/${encodeURIComponent(mid)}`, updates);

export const addHoliday = (date: string) =>
  post<{ status: string }>("/api/data/holidays", { data: date });

export const removeHoliday = (date: string) =>
  del<{ status: string }>(`/api/data/holidays/${encodeURIComponent(date)}`);

export const applyPreset = (name: string) =>
  post<{ status: string; changed: string[]; score: ScoreMoldit }>(`/api/data/presets/${name}`, {});

// ── Console ──────────────────────────────────────────────────

export const getConsole = (dayIdx = 0) =>
  get<ConsoleData>(`/api/console?day_idx=${dayIdx}`);

// ── Actions ──────────────────────────────────────────────────

export const simulate = (mutations: MutationMoldit[]) =>
  post<SimulateResponse>("/api/data/simulate", { mutations });

export const checkCTP = (moldeId: string, targetWeek: string) =>
  post<CTPMolde>("/api/data/ctp", { molde_id: moldeId, target_week: targetWeek });

export const recalculate = () =>
  post<{ status: string; score: ScoreMoldit; time_ms: number; n_segments: number }>(
    "/api/data/recalculate",
    {},
  );

export const simulateApply = (mutations: MutationMoldit[]) =>
  post<SimulateApplyResponse>("/api/data/simulate-apply", { mutations });

export const revertSimulation = () =>
  post<RevertResponse>("/api/data/revert", {});

export const canRevert = () =>
  get<CanRevertResponse>("/api/data/can-revert");

export const addExecutionLog = (body: {
  op_id: number;
  molde: string;
  maquina_id: string;
  codigo: string;
  work_h_planeado: number;
  work_h_real: number;
  setup_h_planeado?: number;
  setup_h_real?: number;
  dia_planeado?: number;
  dia_real?: number;
  motivo_desvio?: string;
  reportado_por?: string;
}) => post<{ id: number; status: string }>("/api/data/execution-log", body);

export const addMachineEvent = (body: MachineEventInput) =>
  post<{ id: number; status: string }>("/api/data/machine-event", body);

export const getMachineEvents = (maquinaId?: string, limit = 100) => {
  const q = new URLSearchParams();
  if (maquinaId) q.set("maquina_id", maquinaId);
  q.set("limit", String(limit));
  return get<MachineEvent[]>(`/api/data/machine-events?${q.toString()}`);
};

export const updateOperators = (body: Record<string, number>) =>
  put<{ status: string; changed?: string[]; score: ScoreMoldit; score_anterior: ScoreMoldit }>(
    "/api/data/operators",
    body,
  );

// ── Upload ───────────────────────────────────────────────────

export const uploadProject = (file: File) =>
  upload<LoadResponse>("/api/data/load", file);

// ── Risk ─────────────────────────────────────────────────────

export const getRisk = () => get<RiskResult>("/api/data/risk");

// ── Chat ─────────────────────────────────────────────────────

export const chatCopilot = (messages: { role: string; content: string }[]) =>
  post<ChatResponse>("/api/copilot/chat", { messages });

// ── Explorer ────────────────────────────────────────────────

export const getExplorerData = (moldeId: string) =>
  get<MoldExplorerData>(`/api/explorer/moldes/${encodeURIComponent(moldeId)}`);

export const getOpOptions = (opId: number) =>
  get<OpOptions>(`/api/explorer/operacoes/${opId}/opcoes`);

export const applyOpChange = (opId: number, body: { target_machine: string }) =>
  post<MoldExplorerData>(`/api/explorer/operacoes/${opId}/apply`, body);

// ── Module A: Learning & Calibration ────────────────────────────

export const getCalibration = () =>
  get<CalibrationData>("/api/data/calibration");

export const getExecutionLogs = (params?: { codigo?: string; maquina_id?: string }) => {
  const q = new URLSearchParams();
  if (params?.codigo) q.set("codigo", params.codigo);
  if (params?.maquina_id) q.set("maquina_id", params.maquina_id);
  return get<ExecutionLog[]>(`/api/data/execution-log?${q.toString()}`);
};

// ── Module D: Workforce ─────────────────────────────────────────

export const getOperadores = () =>
  get<Operador[]>("/api/workforce/operadores");

export const addOperador = (op: Partial<Operador>) =>
  post<{ id: string; status: string }>("/api/workforce/operadores", op);

export const deleteOperador = (id: string) =>
  del<{ status: string }>(`/api/workforce/operadores/${encodeURIComponent(id)}`);

export const getWorkforceConflicts = (dia?: number) => {
  const q = dia !== undefined ? `?dia=${dia}` : "";
  return get<WorkforceConflict[]>(`/api/workforce/conflicts${q}`);
};

export const autoAllocate = (dia: number, turno: string) =>
  post<WorkforceAllocation[]>("/api/workforce/auto-allocate", { dia, turno });

export const getWorkforceForecast = (semanas = 4) =>
  get<ForecastEntry[]>(`/api/workforce/forecast?semanas=${semanas}`);

// ── ML / Inteligência ─────────────────────────────────────────────

export const getMLStatus = () =>
  get<MLStatus>("/api/ml/status");

export const getMLEvolution = () =>
  get<EvolutionPoint[]>("/api/ml/evolution");

export const predictDuration = (opId: number) =>
  get<DurationPrediction>(`/api/ml/predict/duration/${opId}`);

export const predictRisk = (moldeId: string) =>
  get<RiskPrediction>(`/api/ml/predict/risk/${encodeURIComponent(moldeId)}`);

export const predictBulk = () =>
  get<DurationPrediction[]>("/api/ml/predict/bulk");

export const getAnalogues = (moldeId: string) =>
  get<AnalogoResult[]>(`/api/ml/analogues/${encodeURIComponent(moldeId)}`);

export const feedbackAnalogy = (body: {
  molde_id: string;
  analogo_id: string;
  util: boolean;
}) => post<{ status: string }>("/api/ml/feedback/analogy", body);

export const getRankingMatrix = () =>
  get<RankingMatrix>("/api/ml/ranking/matrix");

export const getAnomalies = () =>
  get<AnomalyResult[]>("/api/ml/anomalies");

export const trainML = () =>
  post<TrainReport>("/api/ml/train", {});

export const getMachineRanking = (tipoOperacao: string) =>
  get<MachineScoreML[]>(`/api/ml/ranking/${encodeURIComponent(tipoOperacao)}`);

export const bootstrapML = (projetos: Record<string, unknown>[]) =>
  post<Record<string, unknown>>("/api/ml/bootstrap", { projetos });

export const ingestProject = (body: MLIngestRequest) =>
  post<{ status: string; projeto_id: string }>("/api/ml/ingest", body);

export const updateMLConfig = (body: MLConfigUpdate) =>
  put<{ status: string }>("/api/ml/config", body);

// ── Alerts ──────────────────────────────────────────────────────

export const getAlerts = (params?: { severidade?: string; estado?: string }) => {
  const q = new URLSearchParams();
  if (params?.severidade) q.set("severidade", params.severidade);
  if (params?.estado) q.set("estado", params.estado);
  const qs = q.toString();
  return get<MolditAlert[]>(`/api/alerts/${qs ? `?${qs}` : ""}`);
};

export const getAlertStats = () =>
  get<AlertStats>("/api/alerts/stats");

export const getAlertDetail = (id: string) =>
  get<MolditAlert>(`/api/alerts/${encodeURIComponent(id)}`);

export const acknowledgeAlert = (id: string) =>
  put<{ status: string; id: string }>(`/api/alerts/${encodeURIComponent(id)}/acknowledge`, {});

export const resolveAlert = (id: string, note = "") =>
  put<{ status: string; id: string }>(`/api/alerts/${encodeURIComponent(id)}/resolve`, { note });

export const ignoreAlert = (id: string) =>
  put<{ status: string; id: string }>(`/api/alerts/${encodeURIComponent(id)}/ignore`, {});

export const evaluateAlerts = () =>
  post<AlertEvaluateResult>("/api/alerts/evaluate", {});

// ── Workforce (additional) ──────────────────────────────────────

export const updateOperador = (id: string, body: Partial<Operador>) =>
  put<{ status: string; operador: Operador }>(
    `/api/workforce/operadores/${encodeURIComponent(id)}`,
    body,
  );

export const getCompetencyGaps = () =>
  get<CompetencyGapsData>("/api/workforce/gaps");

// ── Explorer (additional) ───────────────────────────────────────

export const previewOpChange = (opId: number, body: { target_machine: string; target_day?: number }) =>
  post<Record<string, unknown>>(`/api/explorer/operacoes/${opId}/preview`, body);

export const completeOperation = (opId: number, body: {
  work_h_real: number;
  setup_h_real?: number;
  motivo_desvio?: string;
  reportado_por?: string;
}) => post<{ status: string; op_id: number; score: ScoreMoldit }>(
  `/api/explorer/operacoes/${opId}/complete`,
  body,
);

// ── Reports ─────────────────────────────────────────────────────

export const getDailyReport = (date?: string) => {
  const q = date ? `?date=${encodeURIComponent(date)}` : "";
  return get<Blob>(`/api/reports/daily${q}`);
};

export const getWeeklyReport = (week?: string) => {
  const q = week ? `?week=${encodeURIComponent(week)}` : "";
  return get<Blob>(`/api/reports/weekly${q}`);
};

export const getClientReport = (moldeId: string) =>
  get<Blob>(`/api/reports/client?molde_id=${encodeURIComponent(moldeId)}`);

export const getReportPreview = (tipo = "diario", moldeId?: string, date?: string) => {
  const q = new URLSearchParams({ tipo });
  if (moldeId) q.set("molde_id", moldeId);
  if (date) q.set("date", date);
  return getText(`/api/reports/preview?${q.toString()}`);
};

export const sendReport = (body: SendReportRequest) =>
  post<{ status: string; enviado_para: string[] }>("/api/reports/send", body);

// ── Copilot (additional) ────────────────────────────────────────

export const getCopilotHealth = () =>
  get<CopilotHealth>("/api/copilot/health");

// ── Explain ─────────────────────────────────────────────────────

export const getExplainInicio = () =>
  get<ExplainInicio>("/api/explain/inicio");

export const getExplainMolde = (moldeId: string) =>
  get<ExplainMolde>(`/api/explain/molde/${encodeURIComponent(moldeId)}`);

export const getExplainEquipa = (dia?: number) => {
  const q = dia !== undefined ? `?dia=${dia}` : "";
  return get<ExplainEquipa>(`/api/explain/equipa${q}`);
};

