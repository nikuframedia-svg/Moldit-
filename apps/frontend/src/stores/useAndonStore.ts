// ═══════════════════════════════════════════════════════════
//  Andon Store — Active downtime tracking per machine.
//  Runtime only (no persistence). Backed by events API.
// ═══════════════════════════════════════════════════════════

import { create } from 'zustand';

export type AndonCategory =
  | 'avaria_mecanica'
  | 'setup_prolongado'
  | 'falta_material'
  | 'problema_qualidade'
  | 'manutencao_preventiva';

export interface ActiveDowntime {
  machineId: string;
  category: AndonCategory;
  /** Estimated duration in minutes. null = "Nao sei" */
  estimatedMin: number | null;
  /** Date.now() when downtime was registered */
  startedAt: number;
  /** Event ID returned by backend (or generated locally) */
  downEventId: string;
}

interface AndonActions {
  openDrawer: (machineId: string) => void;
  closeDrawer: () => void;
  registerDowntime: (dt: ActiveDowntime) => void;
  clearDowntime: (machineId: string) => void;
}

interface AndonState {
  /** Active downtimes keyed by machineId */
  downtimes: Record<string, ActiveDowntime>;
  /** Machine ID for which the drawer is open, or null */
  drawerMachineId: string | null;
  actions: AndonActions;
}

export const useAndonStore = create<AndonState>((set) => ({
  downtimes: {},
  drawerMachineId: null,
  actions: {
    openDrawer: (machineId) => set({ drawerMachineId: machineId }),
    closeDrawer: () => set({ drawerMachineId: null }),
    registerDowntime: (dt) => set((s) => ({ downtimes: { ...s.downtimes, [dt.machineId]: dt } })),
    clearDowntime: (machineId) =>
      set((s) => {
        const { [machineId]: _, ...rest } = s.downtimes;
        return { downtimes: rest };
      }),
  },
}));

// ── Atomic selector hooks ─────────────────────────────────────

export const useAndonDowntimes = () => useAndonStore((s) => s.downtimes);
export const useAndonDrawerMachine = () => useAndonStore((s) => s.drawerMachineId);
export const useAndonActions = () => useAndonStore((s) => s.actions);
