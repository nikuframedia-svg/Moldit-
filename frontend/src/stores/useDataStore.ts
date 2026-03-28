import { create } from "zustand";
import { getScore, getSegments, getLots, getConfig, getLearning, simulateApply, revertSimulation } from "../api/endpoints";
import type { Score, Segment, Lot, FactoryConfig, LearningInfo, MutationInput, SimulateApplyResponse } from "../api/types";

interface DataState {
  score: Score | null;
  segments: Segment[] | null;
  lots: Lot[] | null;
  config: FactoryConfig | null;
  learning: LearningInfo | null;

  // Simulation state
  isSimulated: boolean;
  simulationSummary: string[];
  canRevert: boolean;

  refreshAll: () => Promise<void>;
  applySimulation: (mutations: MutationInput[]) => Promise<SimulateApplyResponse>;
  revert: () => Promise<void>;
  clear: () => void;
}

export const useDataStore = create<DataState>((set, get) => ({
  score: null,
  segments: null,
  lots: null,
  config: null,
  learning: null,

  isSimulated: false,
  simulationSummary: [],
  canRevert: false,

  refreshAll: async () => {
    const results = await Promise.allSettled([
      getScore(),
      getSegments(),
      getLots(),
      getConfig(),
      getLearning(),
    ]);
    set({
      score: results[0].status === "fulfilled" ? results[0].value : null,
      segments: results[1].status === "fulfilled" ? results[1].value : null,
      lots: results[2].status === "fulfilled" ? results[2].value : null,
      config: results[3].status === "fulfilled" ? results[3].value : null,
      learning: results[4].status === "fulfilled" ? results[4].value : null,
    });
  },

  applySimulation: async (mutations) => {
    const resp = await simulateApply(mutations);
    await get().refreshAll();
    set({ isSimulated: true, simulationSummary: resp.summary, canRevert: resp.can_revert });
    return resp;
  },

  revert: async () => {
    await revertSimulation();
    await get().refreshAll();
    set({ isSimulated: false, simulationSummary: [], canRevert: false });
  },

  clear: () => set({
    score: null, segments: null, lots: null, config: null, learning: null,
    isSimulated: false, simulationSummary: [], canRevert: false,
  }),
}));
