/**
 * useMasterDataStore — Persistent store for manual overrides on master data.
 *
 * Edits made in the DataPage tabs (Machines, Tools, Products, Routings)
 * are stored here and overlay the ISOP-loaded data from useDataStore.
 * Persisted via localStorage so overrides survive page reloads.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface MachineOverride {
  id: string;
  area?: string;
  status?: 'running' | 'down';
  capacityPerDay?: number;
}

export interface ToolOverride {
  id: string;
  m?: string;
  alt?: string;
  s?: number;
  pH?: number;
  op?: number;
}

export interface ProductOverride {
  id: string;
  pH?: number;
  twin?: string;
}

export interface RoutingOverride {
  toolId: string;
  useAlternatives: boolean;
  altMachines: string[];
  speedCoefficients: number[];
}

interface MasterDataState {
  machineOverrides: Record<string, MachineOverride>;
  toolOverrides: Record<string, ToolOverride>;
  productOverrides: Record<string, ProductOverride>;
  routingOverrides: Record<string, RoutingOverride>;
}

interface MasterDataActions {
  setMachineOverride: (id: string, override: Partial<MachineOverride>) => void;
  setToolOverride: (id: string, override: Partial<ToolOverride>) => void;
  setProductOverride: (id: string, override: Partial<ProductOverride>) => void;
  setRoutingOverride: (toolId: string, override: Partial<RoutingOverride>) => void;
  clearOverride: (type: 'machine' | 'tool' | 'product' | 'routing', id: string) => void;
  clearAll: () => void;
}

const INITIAL_STATE: MasterDataState = {
  machineOverrides: {},
  toolOverrides: {},
  productOverrides: {},
  routingOverrides: {},
};

export const useMasterDataStore = create<MasterDataState & MasterDataActions>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setMachineOverride: (id, override) =>
        set((s) => ({
          machineOverrides: {
            ...s.machineOverrides,
            [id]: { ...s.machineOverrides[id], id, ...override },
          },
        })),

      setToolOverride: (id, override) =>
        set((s) => ({
          toolOverrides: {
            ...s.toolOverrides,
            [id]: { ...s.toolOverrides[id], id, ...override },
          },
        })),

      setProductOverride: (id, override) =>
        set((s) => ({
          productOverrides: {
            ...s.productOverrides,
            [id]: { ...s.productOverrides[id], id, ...override },
          },
        })),

      setRoutingOverride: (toolId, override) =>
        set((s) => {
          const existing = s.routingOverrides[toolId];
          const merged: RoutingOverride = {
            toolId: existing?.toolId ?? toolId,
            useAlternatives: existing?.useAlternatives ?? true,
            altMachines: existing?.altMachines ?? [],
            speedCoefficients: existing?.speedCoefficients ?? [],
            ...override,
          };
          return {
            routingOverrides: { ...s.routingOverrides, [toolId]: merged },
          };
        }),

      clearOverride: (type, id) =>
        set((s) => {
          const key = `${type}Overrides` as keyof MasterDataState;
          const current = s[key] as Record<string, unknown>;
          const { [id]: _, ...rest } = current;
          return { [key]: rest } as Partial<MasterDataState>;
        }),

      clearAll: () => set(INITIAL_STATE),
    }),
    {
      name: 'pp1-master-overrides',
    },
  ),
);

/** Count total overrides across all types */
export function useOverrideCount(): number {
  const m = useMasterDataStore((s) => Object.keys(s.machineOverrides).length);
  const t = useMasterDataStore((s) => Object.keys(s.toolOverrides).length);
  const p = useMasterDataStore((s) => Object.keys(s.productOverrides).length);
  const r = useMasterDataStore((s) => Object.keys(s.routingOverrides).length);
  return m + t + p + r;
}
