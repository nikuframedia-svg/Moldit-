// Nikufra factory data types
// Matches the NikufraPlan component data structures exactly

export interface NikufraMachine {
  id: string; // e.g. "PRM019"
  area: string; // "PG1" or "PG2"
  man: number[]; // MAN minutes per day (variable-length)
  status?: 'running' | 'down'; // from ISOP "Estado Máq." column
}

export interface NikufraTool {
  id: string; // e.g. "BFP079"
  m: string; // primary machine code
  alt: string; // alternative machine code (or "-")
  s: number; // setup time in hours
  pH: number; // pieces per hour rate
  op: number; // operators required
  skus: string[]; // item SKU codes
  nm: string[]; // item names
  lt: number; // lot economic quantity
  stk: number; // current stock
  wip?: number; // WIP (work in progress)
  status?: 'running' | 'down'; // from ISOP "Estado Ferr." column
}

export interface NikufraOperation {
  id: string; // e.g. "OP01"
  m: string; // machine code
  t: string; // tool code
  sku: string; // item SKU
  nm: string; // item name
  pH: number; // pieces per hour
  atr: number; // atraso (backlog)
  d: (number | null)[]; // raw NP values (engine converts to daily demand)
  s: number; // setup time in hours
  op: number; // operators required
  cl?: string; // customer code (from ISOP col A)
  clNm?: string; // customer name (from ISOP col B)
  pa?: string; // parent SKU / produto acabado (from ISOP col C)
  wip?: number; // WIP (from ISOP col O)
  qe?: number; // qtd exp (from ISOP col M)
  ltDays?: number; // manufacturing lead time in days (from ISOP col "Prz.Fabrico")
  twin?: string; // twin/peca gemea SKU (from ISOP col "Peca Gemea")
}

export interface NikufraMOLoad {
  PG1: number[]; // daily team capacity for PG1
  PG2: number[]; // daily team capacity for PG2
  poolPG1?: number[]; // G4: daily extra pool capacity for PG1
  poolPG2?: number[]; // G4: daily extra pool capacity for PG2
}

export interface NikufraHistoryEvent {
  dt: string; // date "DD/MM"
  type: string; // "machine_down" | "maintenance" | "urgent_order" | "operator"
  mach: string; // machine code
  tool: string; // tool code
  action: string; // action taken
  result: string; // outcome
  roi: string; // ROI indicator
}

export interface NikufraCustomer {
  code: string; // customer code (from ISOP col A)
  name: string; // customer name (from ISOP col B)
}

export interface NikufraData {
  dates: string[]; // ["02/02", "03/02", ...]
  days_label: string[]; // ["Seg", "Ter", ...]
  mo: NikufraMOLoad; // MO load per area
  machines: NikufraMachine[]; // all machines
  tools: NikufraTool[]; // all tools
  operations: NikufraOperation[]; // all operations
  history: NikufraHistoryEvent[]; // recent events
  customers?: NikufraCustomer[]; // deduplicated customer list
  workday_flags?: boolean[]; // per-date workday flag (true = workday, false = weekend/holiday)
}

// ── Master ISOP Types (frozen factory configuration) ──

/**
 * MasterToolRecord — Frozen tool-level data from the Master ISOP.
 * Fields that the daily ISOP lacks (setup, alt machine) live here.
 */
export interface MasterToolRecord {
  id: string; // tool code (e.g. "BFP079")
  m: string; // primary machine
  alt: string; // alternative machine (or "-")
  s: number; // setup time in hours
  pH: number; // pieces per hour rate
  op: number; // operators required
  lt: number; // lot economic quantity
  // ── FUTURO: MP/Rolos optimization (§10 bdmestre obj.5) ──
  // Populated when MP data becomes available in ISOP
  mpCode?: string; // raw material code (código matéria-prima)
  mpConsumption?: number; // MP consumption per piece (kg/peça or m²/peça)
  calco?: string; // calço code for shared-calço grouping (§10 obj.6)
}

/**
 * MasterISOPData — Subset of NikufraData extracted from the Master ISOP.
 * Frozen/static data that persists until explicitly replaced.
 */
export interface MasterISOPData {
  tools: MasterToolRecord[];
  machines: Array<{ id: string; area: string }>;
  mo: NikufraMOLoad;
}

// ── Planning Engine Types (Scheduler + Monte Carlo) ──

export interface PlanningMachine {
  id: string;
  area: 'PG1' | 'PG2';
  man_minutes: number[];
  operator_pool?: number;
}

export interface PlanningTool {
  id: string;
  machine: string;
  alt_machine: string;
  setup_hours: number;
  pcs_per_hour: number;
  operators: number;
  skus: string[];
  names: string[];
  lot_economic_qty: number;
  stock: number;
  calco_code?: string;
  wip?: number;
}

export interface PlanningOperation {
  id: string;
  machine: string;
  tool: string;
  sku: string;
  name: string;
  pcs_per_hour: number;
  atraso: number;
  daily_qty: (number | null)[];
  setup_hours: number;
  operators: number;
  stock: number;
  status: 'PLANNED' | 'RUNNING' | 'LATE' | 'BLOCKED';
  customer_code?: string;
  customer_name?: string;
  parent_sku?: string;
  wip?: number;
  qtd_exp?: number;
  lead_time_days?: number;
  buffer_hours?: number;
  twin?: string;
}

export interface ScheduleSlot {
  operation_id: string;
  machine: string;
  tool: string;
  sku: string;
  day_index: number;
  shift: 'X' | 'Y';
  start_minute: number;
  duration_minutes: number;
  quantity: number;
  is_setup: boolean;
}

export interface MachineLoadEntry {
  machine: string;
  day_index: number;
  total_minutes: number;
  production_minutes: number;
  setup_minutes: number;
  utilization: number;
  ops_count: number;
}

export interface PlanningKPIs {
  otd_rate: number;
  tardiness_total_days: number;
  setup_count: number;
  setup_total_minutes: number;
  balance_score: number;
  total_production_minutes: number;
  machine_utilization: Record<string, number>;
}

export interface PlanState {
  dates: string[];
  days_label: string[];
  machines: PlanningMachine[];
  tools: PlanningTool[];
  operations: PlanningOperation[];
  schedule: ScheduleSlot[];
  machine_loads: MachineLoadEntry[];
  kpis: PlanningKPIs | null;
  parsed_at: string | null;
  data_hash: string | null;
  workday_flags?: boolean[];
  mo?: { PG1: number[]; PG2: number[]; poolPG1?: number[]; poolPG2?: number[] };
  machineStatus?: Record<string, 'running' | 'down'>;
  toolStatus?: Record<string, 'running' | 'down'>;
  thirdShift?: boolean; // G3: exceptional 3rd shift 24:00-07:00
}
