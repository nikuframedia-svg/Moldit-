import { create } from "zustand";
import type { MutationMoldit, MutationType, SimulateResponse, CTPMolde } from "../api/types";

interface SimulatorState {
  mutations: (MutationMoldit & { _key: number })[];
  result: SimulateResponse | null;
  ctpResult: CTPMolde | null;
  nextKey: number;

  setMutations: (m: (MutationMoldit & { _key: number })[]) => void;
  setResult: (r: SimulateResponse | null) => void;
  setCtpResult: (r: CTPMolde | null) => void;
  addMutation: () => number;
  removeMutation: (key: number) => void;
  updateMutationType: (key: number, type: MutationType) => void;
  updateMutationParam: (key: number, paramKey: string, value: string) => void;
  clear: () => void;
}

export const useSimulatorStore = create<SimulatorState>((set, get) => ({
  mutations: [],
  result: null,
  ctpResult: null,
  nextKey: 0,

  setMutations: (m) => set({ mutations: m }),
  setResult: (r) => set({ result: r }),
  setCtpResult: (r) => set({ ctpResult: r }),

  addMutation: () => {
    const { mutations, nextKey } = get();
    set({
      mutations: [...mutations, { type: "machine_down" as MutationType, params: {}, _key: nextKey }],
      nextKey: nextKey + 1,
    });
    return nextKey;
  },

  removeMutation: (key) => set((s) => ({
    mutations: s.mutations.filter((m) => m._key !== key),
  })),

  updateMutationType: (key, type) => set((s) => ({
    mutations: s.mutations.map((m) => m._key === key ? { ...m, type, params: {} } : m),
  })),

  updateMutationParam: (key, paramKey, value) => set((s) => ({
    mutations: s.mutations.map((m) =>
      m._key === key ? { ...m, params: { ...m.params, [paramKey]: value } } : m,
    ),
  })),

  clear: () => set({ mutations: [], result: null, ctpResult: null, nextKey: 0 }),
}));
