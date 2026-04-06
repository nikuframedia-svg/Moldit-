import { create } from "zustand";
import { getExplorerData, getOpOptions, applyOpChange } from "../api/endpoints";
import { useDataStore } from "./useDataStore";
import type { MoldExplorerData, OpOptions, MachineOption } from "../api/types";

interface MoldExplorerState {
  selectedMoldeId: string | null;
  explorerData: MoldExplorerData | null;
  selectedOpId: number | null;
  opcoes: OpOptions | null;
  hoveredOption: MachineOption | null;
  loadingExplorer: boolean;
  loadingOpcoes: boolean;
  error: string | null;

  selectMolde: (moldeId: string) => Promise<void>;
  selectOp: (opId: number | null) => Promise<void>;
  hoverOption: (opt: MachineOption | null) => void;
  applyChange: (opId: number, targetMachine: string) => Promise<void>;
  clearSelection: () => void;
}

export const useMoldExplorerStore = create<MoldExplorerState>((set) => ({
  selectedMoldeId: null,
  explorerData: null,
  selectedOpId: null,
  opcoes: null,
  hoveredOption: null,
  loadingExplorer: false,
  loadingOpcoes: false,
  error: null,

  selectMolde: async (moldeId: string) => {
    set({ selectedMoldeId: moldeId, loadingExplorer: true, error: null, selectedOpId: null, opcoes: null });
    try {
      const data = await getExplorerData(moldeId);
      set({ explorerData: data, loadingExplorer: false });
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), loadingExplorer: false });
    }
  },

  selectOp: async (opId: number | null) => {
    if (opId === null) {
      set({ selectedOpId: null, opcoes: null, hoveredOption: null });
      return;
    }
    set({ selectedOpId: opId, loadingOpcoes: true, hoveredOption: null });
    try {
      const opts = await getOpOptions(opId);
      set({ opcoes: opts, loadingOpcoes: false });
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), loadingOpcoes: false });
    }
  },

  hoverOption: (opt: MachineOption | null) => {
    set({ hoveredOption: opt });
  },

  applyChange: async (opId: number, targetMachine: string) => {
    set({ loadingExplorer: true });
    try {
      const data = await applyOpChange(opId, { target_machine: targetMachine });
      set({ explorerData: data, loadingExplorer: false, selectedOpId: null, opcoes: null, hoveredOption: null });
      // Sync global data after local change
      useDataStore.getState().refreshAll();
    } catch (e: unknown) {
      set({ error: e instanceof Error ? e.message : String(e), loadingExplorer: false });
    }
  },

  clearSelection: () => {
    set({ selectedOpId: null, opcoes: null, hoveredOption: null });
  },
}));
