/** Typed endpoint functions — one per backend route. */

import { get, post, put, del, upload } from "./client";
import type {
  ChatResponse,
  ConsoleData,
  CTPMolde,
  DeadlineStatus,
  JournalEntry,
  LoadResponse,
  MaquinaStatus,
  MoldExplorerData,
  Molde,
  MolditConfig,
  MutationMoldit,
  OpOptions,
  Operacao,
  RiskResult,
  ScoreMoldit,
  SegmentoMoldit,
  SimulateResponse,
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

export const previewOpChange = (opId: number, body: { target_machine: string; target_day?: number }) =>
  post<{ op_id: number; target_machine: string; impacto: Record<string, number>; cascata: unknown[] }>(
    `/api/explorer/operacoes/${opId}/preview`, body,
  );

export const applyOpChange = (opId: number, body: { target_machine: string }) =>
  post<MoldExplorerData>(`/api/explorer/operacoes/${opId}/apply`, body);
