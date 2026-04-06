import { create } from "zustand";

interface AppState {
  activePage: string;
  chatOpen: boolean;
  hasData: boolean;
  isUploading: boolean;

  setPage: (page: string) => void;
  toggleChat: () => void;
  setHasData: (v: boolean) => void;
  setUploading: (v: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activePage: "inicio",
  chatOpen: false,
  hasData: false,
  isUploading: false,

  setPage: (page) => set({ activePage: page }),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setHasData: (v) => set({ hasData: v }),
  setUploading: (v) => set({ isUploading: v }),
}));
