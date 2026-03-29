import { create } from "zustand";
import { getScore, getSegments, getMoldes, getOps, getStress, getConfig, getDeadlines, recalculate as doRecalculate } from "../api/endpoints";
import type { ScoreMoldit, SegmentoMoldit, Molde, Operacao, DeadlineStatus, MaquinaStatus, MolditConfig } from "../api/types";

interface DataState {
  score: ScoreMoldit | null;
  segmentos: SegmentoMoldit[];
  moldes: Molde[];
  operacoes: Operacao[];
  deadlines: DeadlineStatus[];
  stress: MaquinaStatus[];
  config: MolditConfig | null;
  loading: boolean;
  error: string | null;

  refreshAll: () => Promise<void>;
  recalculate: () => Promise<void>;
  clear: () => void;
}

export const useDataStore = create<DataState>((set) => ({
  score: null,
  segmentos: [],
  moldes: [],
  operacoes: [],
  deadlines: [],
  stress: [],
  config: null,
  loading: false,
  error: null,

  refreshAll: async () => {
    set({ loading: true, error: null });
    try {
      const results = await Promise.allSettled([
        getScore(),
        getSegments(),
        getMoldes(),
        getOps(),
        getStress(),
        getConfig(),
        getDeadlines(),
      ]);
      set({
        score: results[0].status === "fulfilled" ? results[0].value : null,
        segmentos: results[1].status === "fulfilled" ? results[1].value : [],
        moldes: results[2].status === "fulfilled" ? results[2].value : [],
        operacoes: results[3].status === "fulfilled" ? results[3].value : [],
        stress: results[4].status === "fulfilled" ? results[4].value : [],
        config: results[5].status === "fulfilled" ? results[5].value : null,
        deadlines: results[6].status === "fulfilled" ? results[6].value : [],
        loading: false,
      });
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  recalculate: async () => {
    set({ loading: true });
    try {
      await doRecalculate();
      const store = useDataStore.getState();
      await store.refreshAll();
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), loading: false });
    }
  },

  clear: () => set({
    score: null, segmentos: [], moldes: [], operacoes: [], deadlines: [], stress: [], config: null,
  }),
}));
