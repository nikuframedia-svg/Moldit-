import { create } from "zustand";

export type StatusLevel = "idle" | "ok" | "warning" | "error";

interface AppState {
  activePage: string;
  chatOpen: boolean;
  hasData: boolean;
  isUploading: boolean;

  // StatusBar (linha 23 AS/400)
  statusMsg: string;
  statusLevel: StatusLevel;
  statusTime: string;

  setPage: (page: string) => void;
  toggleChat: () => void;
  setHasData: (v: boolean) => void;
  setUploading: (v: boolean) => void;
  setStatus: (level: StatusLevel, msg: string) => void;
}

function now() {
  return new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const useAppStore = create<AppState>((set) => ({
  activePage: "consola",
  chatOpen: false,
  hasData: false,
  isUploading: false,
  statusMsg: "",
  statusLevel: "idle",
  statusTime: "",

  setPage: (page) => set({ activePage: page }),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setHasData: (v) => set({ hasData: v }),
  setUploading: (v) => set({ isUploading: v }),
  setStatus: (level, msg) => set({ statusLevel: level, statusMsg: msg, statusTime: now() }),
}));
