import { create } from "zustand";

interface AppState {
  activePage: string;
  chatOpen: boolean;
  hasData: boolean;
  isUploading: boolean;
  trustScore: number | null;
  trustGate: string | null;

  setPage: (page: string) => void;
  toggleChat: () => void;
  setHasData: (v: boolean) => void;
  setUploading: (v: boolean) => void;
  setTrust: (score: number, gate: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activePage: "console",
  chatOpen: false,
  hasData: false,
  isUploading: false,
  trustScore: null,
  trustGate: null,

  setPage: (page) => set({ activePage: page }),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setHasData: (v) => set({ hasData: v }),
  setUploading: (v) => set({ isUploading: v }),
  setTrust: (score, gate) => set({ trustScore: score, trustGate: gate }),
}));
