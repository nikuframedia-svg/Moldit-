// compute/types.ts — Shared types for Intelligence compute modules

export interface SnapshotCustomer {
  customer_id: string;
  code: string;
  name: string;
}
export interface SnapshotItem {
  item_id: string;
  sku: string;
  name: string;
  parent_sku?: string;
  lot_economic_qty?: number;
}
export interface SnapshotResource {
  resource_id?: string;
  id?: string;
  code: string;
  name?: string;
}
export interface SnapshotTool {
  tool_id: string;
  code: string;
  name?: string;
}
export interface SnapshotRoutingOp {
  operation_id: string;
  sequence: number;
  resource_code: string;
  alt_resources: string[];
  tool_code: string;
  setup_time: number;
  setup_time_uom?: string;
  rate_pieces_per_hour: number;
  operators_required: number;
}
export interface SnapshotRouting {
  routing_id: string;
  item_sku: string;
  operations: SnapshotRoutingOp[];
}
export interface SnapshotSeriesEntry {
  item_sku: string;
  date: string;
  value: number;
  customer_code?: string;
}
export interface SnapshotFixture {
  master_data: {
    customers: SnapshotCustomer[];
    items: SnapshotItem[];
    resources: SnapshotResource[];
    tools: SnapshotTool[];
  };
  routing: SnapshotRouting[];
  series: SnapshotSeriesEntry[];
  trust_index: { overall: number; by_domain: Record<string, number> };
}

export interface NkTool {
  id: string;
  m: string;
  alt: string;
  s: number;
  pH: number;
  op: number;
  skus: string[];
  nm: string[];
  lt: number;
  stk: number;
}
export interface NkMachine {
  id: string;
  area: string;
  man: number[];
}
export interface NkData {
  dates: string[];
  days_label: string[];
  mo: { PG1: number[]; PG2: number[] };
  machines: NkMachine[];
  tools: NkTool[];
}

export interface DateContext {
  allDates: string[];
  workingDates: string[];
  isWorking: Record<string, boolean>;
}
