/** Typed endpoint functions — one per backend route. */

import { get, post, put, upload } from "./client";
import type {
  ChatResponse,
  ClientOrders,
  ConsoleData,
  CoverageAudit,
  CTPResult,
  EOp,
  ExpeditionKPIs,
  FactoryConfig,
  JournalEntry,
  LateDeliveryReport,
  LoadResponse,
  Lot,
  MutationInput,
  RiskResult,
  Score,
  Segment,
  SimulateResponse,
  StockProjection,
  StockSummary,
  TrustIndex,
  WorkforceForecast,
} from "./types";

// ── Core ─────────────────────────────────────────────────────

export const getToday = () => get<{ today_idx: number; date: string }>("/api/data/today");
export const getScore = () => get<Score>("/api/data/score");
export const getSegments = () => get<Segment[]>("/api/data/segments");
export const getLots = () => get<Lot[]>("/api/data/lots");
export const getTrust = () => get<TrustIndex>("/api/data/trust");
export const getJournal = () => get<JournalEntry[]>("/api/data/journal");

// ── Analytics ────────────────────────────────────────────────

export const getStockSummary = () => get<StockSummary[]>("/api/data/stock");
export const getStockDetail = (sku: string) =>
  get<StockProjection>(`/api/data/stock/${encodeURIComponent(sku)}`);
export const getExpedition = () => get<ExpeditionKPIs>("/api/data/expedition");
export const getOrders = () => get<ClientOrders[]>("/api/data/orders");
export const getCoverage = () => get<CoverageAudit>("/api/data/coverage");
export const getRisk = () => get<RiskResult>("/api/data/risk");
export const getLateDeliveries = () => get<LateDeliveryReport>("/api/data/late");
export const getWorkforce = (window = 10) =>
  get<WorkforceForecast>(`/api/data/workforce?window=${window}`);

// ── Config / Master Data ─────────────────────────────────────

export const getConfig = () => get<FactoryConfig>("/api/data/config");
export const updateConfig = (updates: Record<string, unknown>) =>
  put<{ status: string; changed: string[]; score: Score }>("/api/data/config", updates);
export const getOps = () => get<EOp[]>("/api/data/ops");
export const getRules = () => get<{ id: string; tipo: string; descricao: string }[]>("/api/data/rules");

// ── Console ──────────────────────────────────────────────────

export const getConsole = (dayIdx = 0) =>
  get<ConsoleData>(`/api/console?day_idx=${dayIdx}`);

// ── Actions ──────────────────────────────────────────────────

export const simulate = (mutations: MutationInput[]) =>
  post<SimulateResponse>("/api/data/simulate", { mutations });

export const checkCTP = (sku: string, qty: number, deadline: number) =>
  post<CTPResult>("/api/data/ctp", { sku, qty, deadline });

export const recalculate = () =>
  post<{ status: string; score: Score; score_previous: Score; time_ms: number; n_segments: number }>(
    "/api/data/recalculate",
    {},
  );

// ── Upload ───────────────────────────────────────────────────

export const uploadISOP = (file: File) =>
  upload<LoadResponse>("/api/data/load", file);

// ── Chat ─────────────────────────────────────────────────────

export const chatCopilot = (messages: { role: string; content: string }[]) =>
  post<ChatResponse>("/api/copilot/chat", { messages });
