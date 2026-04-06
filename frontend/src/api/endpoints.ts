/** Typed endpoint functions — one per backend route. */

import { get, post, put, del, upload } from "./client";
import type {
  CalibrationData,
  ChatResponse,
  ConsoleData,
  CTPMolde,
  DeadlineStatus,
  ExecutionLog,
  ForecastEntry,
  JournalEntry,
  LoadResponse,
  MaquinaStatus,
  MoldExplorerData,
  Molde,
  MolditConfig,
  MutationMoldit,
  Operador,
  OpOptions,
  Operacao,
  RiskResult,
  ScoreMoldit,
  SegmentoMoldit,
  SimulateResponse,
  WorkforceAllocation,
  WorkforceConflict,
  MLStatus,
  EvolutionPoint,
  DurationPrediction,
  RiskPrediction,
  AnalogoResult,
  AnomalyResult,
  TrainReport,
  RankingMatrix,
} from "./types";

// ── Core ─────────────────────────────────────────────────────

export const getScore = () => get<ScoreMoldit>("/api/data/score");
export const getSegments = () => get<SegmentoMoldit[]>("/api/data/segments");
export const getMoldes = () => get<Molde[]>("/api/data/moldes");
export const getOps = () => get<Operacao[]>("/api/data/ops");
export const getStress = () => get<MaquinaStatus[]>("/api/data/stress");
export const getDeadlines = () => get<DeadlineStatus[]>("/api/data/deadlines");
export const getJournal = () => get<JournalEntry[]>("/api/data/journal");

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

export const checkCTP = (molde: string) =>
  post<CTPMolde>("/api/data/ctp", { molde });

export const recalculate = () =>
  post<{ status: string; score: ScoreMoldit; time_ms: number; n_segments: number }>(
    "/api/data/recalculate",
    {},
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

