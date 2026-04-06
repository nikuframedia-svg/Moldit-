/** ML / Intelligence store ��� Zustand. */

import { create } from "zustand";
import {
  getMLStatus,
  getMLEvolution,
  predictBulk,
  getAnalogues,
  getRankingMatrix,
  getAnomalies,
  trainML,
} from "../api/endpoints";
import type {
  MLStatus,
  EvolutionPoint,
  DurationPrediction,
  AnalogoResult,
  RankingMatrix,
  AnomalyResult,
  TrainReport,
} from "../api/types";

interface MLState {
  status: MLStatus | null;
  evolution: EvolutionPoint[];
  predictions: DurationPrediction[];
  analogues: AnalogoResult[];
  ranking: RankingMatrix | null;
  anomalies: AnomalyResult[];
  loading: boolean;
  error: string | null;

  refreshStatus: () => Promise<void>;
  loadPredictions: () => Promise<void>;
  loadAnalogues: (moldeId: string) => Promise<void>;
  loadRanking: () => Promise<void>;
  loadAnomalies: () => Promise<void>;
  loadEvolution: () => Promise<void>;
  triggerTrain: () => Promise<TrainReport | null>;
  clear: () => void;
}

export const useMLStore = create<MLState>((set) => ({
  status: null,
  evolution: [],
  predictions: [],
  analogues: [],
  ranking: null,
  anomalies: [],
  loading: false,
  error: null,

  refreshStatus: async () => {
    try {
      const status = await getMLStatus();
      set({ status });
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  loadEvolution: async () => {
    try {
      const evolution = await getMLEvolution();
      set({ evolution });
    } catch {
      /* ignore if not available */
    }
  },

  loadPredictions: async () => {
    set({ loading: true });
    try {
      const predictions = await predictBulk();
      set({ predictions, loading: false });
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  loadAnalogues: async (moldeId: string) => {
    try {
      const analogues = await getAnalogues(moldeId);
      set({ analogues });
    } catch {
      set({ analogues: [] });
    }
  },

  loadRanking: async () => {
    try {
      const ranking = await getRankingMatrix();
      set({ ranking });
    } catch {
      set({ ranking: null });
    }
  },

  loadAnomalies: async () => {
    try {
      const anomalies = await getAnomalies();
      set({ anomalies });
    } catch {
      set({ anomalies: [] });
    }
  },

  triggerTrain: async () => {
    set({ loading: true });
    try {
      const report = await trainML();
      set({ loading: false });
      return report;
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
      return null;
    }
  },

  clear: () =>
    set({
      status: null,
      evolution: [],
      predictions: [],
      analogues: [],
      ranking: null,
      anomalies: [],
      loading: false,
      error: null,
    }),
}));
