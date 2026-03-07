/**
 * useUIStore — Shared UI state across all pages.
 *
 * Manages: command palette visibility, focus strip context,
 * context panel state, temporal zoom level.
 * Persists user preferences (zoom, collapse states) via localStorage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TemporalZoom = 'shift' | 'day' | 'week';

export interface FocusContext {
  machine?: string | null;
  day?: string | null;
  dayIdx?: number | null;
  scenario?: string | null;
  toolId?: string | null;
}

interface UIStoreState {
  /** Command palette open/closed */
  commandPaletteOpen: boolean;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  toggleCommandPalette: () => void;

  /** Focus strip — shared context across pages */
  focus: FocusContext;
  setFocus: (ctx: Partial<FocusContext>) => void;
  clearFocus: () => void;

  /** Context panel open/closed + selected entity */
  contextPanelOpen: boolean;
  contextEntity: { type: string; id: string } | null;
  openContextPanel: (entity: { type: string; id: string }) => void;
  closeContextPanel: () => void;

  /** Temporal zoom level (persisted) */
  temporalZoom: TemporalZoom;
  setTemporalZoom: (zoom: TemporalZoom) => void;

  /** Selected day index for Centro de Comando Diario (persisted) */
  selectedDayIdx: number;
  setSelectedDayIdx: (idx: number) => void;
}

const useUIStore = create<UIStoreState>()(
  persist(
    (set) => ({
      // Command palette
      commandPaletteOpen: false,
      openCommandPalette: () => set({ commandPaletteOpen: true }),
      closeCommandPalette: () => set({ commandPaletteOpen: false }),
      toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

      // Focus strip
      focus: {},
      setFocus: (ctx) => set((s) => ({ focus: { ...s.focus, ...ctx } })),
      clearFocus: () => set({ focus: {} }),

      // Context panel
      contextPanelOpen: false,
      contextEntity: null,
      openContextPanel: (entity) => set({ contextPanelOpen: true, contextEntity: entity }),
      closeContextPanel: () => set({ contextPanelOpen: false, contextEntity: null }),

      // Temporal zoom
      temporalZoom: 'day',
      setTemporalZoom: (zoom) => set({ temporalZoom: zoom }),

      // Selected day for Comando Diario
      selectedDayIdx: 0,
      setSelectedDayIdx: (idx) => set({ selectedDayIdx: idx }),
    }),
    {
      name: 'pp1-ui-state',
      partialize: (state) => ({
        temporalZoom: state.temporalZoom,
        selectedDayIdx: state.selectedDayIdx,
      }),
    },
  ),
);

export default useUIStore;
