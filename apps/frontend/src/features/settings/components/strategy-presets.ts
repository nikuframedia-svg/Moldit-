/**
 * Strategy presets, types, and filter logic for L6 multi-step strategies.
 */

import type { StepFilter, StrategyStep } from './StrategyStepEditor';

export interface StrategyPreset {
  id: string;
  name: string;
  steps: StrategyStep[];
  isCustom: boolean;
}

export const INCOMPOL_STANDARD: StrategyStep[] = [
  {
    id: 's1',
    name: 'Encomendas criticas forward',
    filter: 'deadline_close',
    rule: 'ATCS',
    direction: 'forward',
    guard: 'none',
    weights: { otd: 80, setup: 10, utilization: 10 },
  },
  {
    id: 's2',
    name: 'Resto com setup grouping',
    filter: 'deadline_far',
    rule: 'ATCS',
    direction: 'forward',
    guard: 'none',
    weights: { otd: 40, setup: 40, utilization: 20 },
  },
  {
    id: 's3',
    name: 'Preencher com lote economico',
    filter: 'capacity_free',
    rule: 'WSPT',
    direction: 'forward',
    guard: 'no_delay',
    weights: { otd: 20, setup: 20, utilization: 60 },
  },
];

export const DEFAULT_PRESETS: StrategyPreset[] = [
  { id: 'incompol_standard', name: 'Incompol Standard', steps: INCOMPOL_STANDARD, isCustom: false },
  {
    id: 'max_otd',
    name: 'Maximo OTD-D',
    steps: [
      {
        id: 'otd1',
        name: 'Todas por EDD',
        filter: 'all',
        rule: 'EDD',
        direction: 'forward',
        guard: 'none',
        weights: { otd: 100, setup: 0, utilization: 0 },
      },
    ],
    isCustom: false,
  },
  {
    id: 'min_setup',
    name: 'Setup Minimo',
    steps: [
      {
        id: 'su1',
        name: 'Agrupar por familia',
        filter: 'all',
        rule: 'ATCS',
        direction: 'forward',
        guard: 'none',
        weights: { otd: 10, setup: 80, utilization: 10 },
      },
    ],
    isCustom: false,
  },
];

export function matchesFilter(
  filter: StepFilter,
  op: { d: number[] },
  _toolMap: Record<string, { sH: number; pH: number }>,
  nDays: number,
): boolean {
  const totalDemand = op.d.reduce((s, v) => s + Math.max(v, 0), 0);
  if (filter === 'all') return true;
  if (filter === 'deadline_close') return totalDemand > 0 && nDays <= 5;
  if (filter === 'deadline_far') return nDays > 5;
  if (filter === 'capacity_free') return totalDemand === 0;
  return true;
}
