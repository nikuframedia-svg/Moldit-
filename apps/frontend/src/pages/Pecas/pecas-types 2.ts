export type SortField =
  | 'sku'
  | 'tool'
  | 'machine'
  | 'backlog'
  | 'demand'
  | 'stock'
  | 'produced'
  | 'coverage'
  | 'pH';

export type SortDir = 'asc' | 'desc';

export interface PecaRow {
  opId: string;
  sku: string;
  name: string;
  tool: string;
  machine: string;
  alt: string | null;
  backlog: number;
  demand: number;
  totalDemand: number;
  stock: number;
  lotEco: number;
  pH: number;
  setupH: number;
  operators: number;
  produced: number;
  coverage: number;
  daily: number[];
  toolIdx: number;
}
