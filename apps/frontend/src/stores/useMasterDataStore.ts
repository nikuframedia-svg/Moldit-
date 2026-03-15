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
  _version: number;
}

interface MasterDataActions {
  setMachineOverride: (id: string, override: Partial<MachineOverride>) => void;
  setToolOverride: (id: string, override: Partial<ToolOverride>) => void;
  setProductOverride: (id: string, override: Partial<ProductOverride>) => void;
  setRoutingOverride: (toolId: string, override: Partial<RoutingOverride>) => void;
  clearOverride: (type: 'machine' | 'tool' | 'product' | 'routing', id: string) => void;
  clearFieldOverride: (type: 'tool' | 'machine', id: string, field: string) => void;
  clearAll: () => void;
}

const INITIAL_STATE: MasterDataState = {
  machineOverrides: {},
  toolOverrides: {},
  productOverrides: {},
  routingOverrides: {},
  _version: 0,
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
          _version: s._version + 1,
        })),

      setToolOverride: (id, override) =>
        set((s) => ({
          toolOverrides: {
            ...s.toolOverrides,
            [id]: { ...s.toolOverrides[id], id, ...override },
          },
          _version: s._version + 1,
        })),

      setProductOverride: (id, override) =>
        set((s) => ({
          productOverrides: {
            ...s.productOverrides,
            [id]: { ...s.productOverrides[id], id, ...override },
          },
          _version: s._version + 1,
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
            _version: s._version + 1,
          };
        }),

      clearOverride: (type, id) =>
        set((s) => {
          if (type === 'machine') {
            const { [id]: _, ...rest } = s.machineOverrides;
            return { machineOverrides: rest, _version: s._version + 1 };
          }
          if (type === 'tool') {
            const { [id]: _, ...rest } = s.toolOverrides;
            return { toolOverrides: rest, _version: s._version + 1 };
          }
          if (type === 'product') {
            const { [id]: _, ...rest } = s.productOverrides;
            return { productOverrides: rest, _version: s._version + 1 };
          }
          const { [id]: _, ...rest } = s.routingOverrides;
          return { routingOverrides: rest, _version: s._version + 1 };
        }),

      clearFieldOverride: (type, id, field) =>
        set((s) => {
          if (type === 'tool') {
            const entry = s.toolOverrides[id];
            if (!entry) return {};
            const updated = { ...entry };
            delete (updated as Record<string, unknown>)[field];
            const remaining = Object.keys(updated).filter((k) => k !== 'id');
            if (remaining.length === 0) {
              const { [id]: _, ...rest } = s.toolOverrides;
              return { toolOverrides: rest, _version: s._version + 1 };
            }
            return {
              toolOverrides: { ...s.toolOverrides, [id]: updated },
              _version: s._version + 1,
            };
          }
          // type === 'machine'
          const entry = s.machineOverrides[id];
          if (!entry) return {};
          const updated = { ...entry };
          delete (updated as Record<string, unknown>)[field];
          const remaining = Object.keys(updated).filter((k) => k !== 'id');
          if (remaining.length === 0) {
            const { [id]: _, ...rest } = s.machineOverrides;
            return { machineOverrides: rest, _version: s._version + 1 };
          }
          return {
            machineOverrides: { ...s.machineOverrides, [id]: updated },
            _version: s._version + 1,
          };
        }),

      clearAll: () => set((s) => ({ ...INITIAL_STATE, _version: s._version + 1 })),
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

/** Selector for cache invalidation — changes whenever any override is set/cleared */
export const overridesVersionSelector = (s: MasterDataState & MasterDataActions): number =>
  s._version;
