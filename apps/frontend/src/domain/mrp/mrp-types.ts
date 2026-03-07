// MRP Types — Material Requirements Planning (§7.2 PP1.docx)
// Level 0: Finished Goods MRP + RCCP (Rough-Cut Capacity Planning)

/** Bucket MRP para uma Tool num dia */
export interface MRPDayBucket {
  dayIndex: number;
  dateLabel: string;
  grossRequirement: number;
  scheduledReceipts: number;
  projectedAvailable: number;
  netRequirement: number;
  plannedOrderReceipt: number;
  plannedOrderRelease: number;
}

/** Per-SKU MRP breakdown (from MRPRecord.skuRecords) */
export interface MRPSkuRecord {
  sku: string;
  name: string;
  opId: string;
  toolCode: string;
  machine: string;
  altMachine: string | null;
  customer?: string;
  customerName?: string;
  twin?: string;
  ratePerHour: number;
  setupHours: number;
  lotEconomicQty: number;
  currentStock: number;
  wip: number;
  backlog: number;
  grossRequirement: number;
  projectedEnd: number;
  stockoutDay: number | null;
  coverageDays: number;
  buckets: MRPDayBucket[];
}

/** Registo MRP completo por Tool (agrupa SKUs da mesma ferramenta) */
export interface MRPRecord {
  toolCode: string;
  skus: Array<{ sku: string; name: string }>;
  machine: string;
  altMachine: string | null;
  lotEconomicQty: number;
  currentStock: number;
  backlog: number;
  ratePerHour: number;
  setupHours: number;
  operators: number;
  productionLeadDays: number;
  buckets: MRPDayBucket[];
  totalGrossReq: number;
  totalPlannedQty: number;
  endingStock: number;
  stockoutDay: number | null;
  coverageDays: number;
  /** Per-SKU MRP breakdown (always populated) */
  skuRecords: MRPSkuRecord[];
}

/** RCCP: capacidade requerida vs disponível por máquina/dia */
export interface RCCPEntry {
  machine: string;
  area: string;
  dayIndex: number;
  dateLabel: string;
  availableMin: number;
  requiredSetupMin: number;
  requiredProdMin: number;
  requiredTotalMin: number;
  utilization: number;
  overloaded: boolean;
  plannedTools: string[];
}

/** Resultado global MRP */
export interface MRPResult {
  records: MRPRecord[];
  rccp: RCCPEntry[];
  summary: MRPSummary;
}

export interface MRPSummary {
  totalTools: number;
  toolsWithBacklog: number;
  toolsWithStockout: number;
  totalPlannedQty: number;
  totalGrossReq: number;
  avgUtilization: number;
  bottleneckMachine: string | null;
  bottleneckDay: number | null;
}

// ── What-If Simulator (PP1.TWIN.004) ────────────────────────

export type WhatIfMutationType = 'rush_order' | 'machine_down' | 'demand_factor';

export interface WhatIfMutation {
  id: string;
  type: WhatIfMutationType;
  toolCode?: string;
  rushQty?: number;
  rushDay?: number;
  machine?: string;
  downStartDay?: number;
  downEndDay?: number;
  factorToolCode?: string;
  factor?: number;
}

export interface WhatIfDelta {
  toolCode: string;
  baselineStockout: number | null;
  modifiedStockout: number | null;
  baselineCoverage: number;
  modifiedCoverage: number;
  baselinePlannedQty: number;
  modifiedPlannedQty: number;
}

export interface WhatIfResult {
  baseline: MRPResult;
  modified: MRPResult;
  deltas: WhatIfDelta[];
  rccpDeltas: Array<{
    machine: string;
    dayIndex: number;
    baselineUtil: number;
    modifiedUtil: number;
  }>;
  summaryDelta: {
    stockoutsChange: number;
    avgUtilChange: number;
  };
}

// ── CTP Calculator (PP1.PLAN.004) ───────────────────────────

export interface CTPInput {
  toolCode: string;
  quantity: number;
  targetDay: number;
}

export interface CTPResult {
  feasible: boolean;
  toolCode: string;
  machine: string;
  requiredMin: number;
  availableMinOnDay: number;
  capacitySlack: number;
  projectedStockOnDay: number;
  stockAfterOrder: number;
  earliestFeasibleDay: number | null;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  capacityTimeline: Array<{
    dayIndex: number;
    existingLoad: number;
    newOrderLoad: number;
    capacity: number;
  }>;
}

// ── Safety Stock & ROP (PP1.SUPPLY.005) ─────────────────────

export type ServiceLevel = 90 | 95 | 99;

export interface ROPResult {
  toolCode: string;
  demandAvg: number;
  demandStdDev: number;
  coefficientOfVariation: number;
  leadTimeDays: number;
  safetyStock: number;
  rop: number;
  serviceLevel: ServiceLevel;
  zScore: number;
  currentStock: number;
  abcClass: 'A' | 'B' | 'C';
  xyzClass: 'X' | 'Y' | 'Z';
  stockProjection: Array<{
    dayIndex: number;
    projected: number;
    ropLine: number;
    ssLine: number;
  }>;
}

export interface ROPSummary {
  records: ROPResult[];
  abcDistribution: { A: number; B: number; C: number };
  xyzDistribution: { X: number; Y: number; Z: number };
  toolsBelowROP: number;
  toolsBelowSS: number;
}

// ── Action Messages (PP1.SUPPLY.006) ────────────────────────

export type ActionType = 'launch_por' | 'transfer_tool' | 'advance_prod' | 'no_alt_risk';
export type ActionSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ActionMessage {
  id: string;
  type: ActionType;
  severity: ActionSeverity;
  severityScore: number;
  toolCode: string;
  machine: string;
  dayIndex: number | null;
  title: string;
  description: string;
  suggestedAction: string;
  sku?: string;
  skuName?: string;
  impact: {
    qtyAffected: number;
    daysAffected: number;
    capacityMinutes: number | null;
  };
}

export interface ActionMessagesSummary {
  messages: ActionMessage[];
  bySeverity: Record<ActionSeverity, number>;
  byType: Record<ActionType, number>;
  criticalCount: number;
}

// ── Coverage Matrix ─────────────────────────────────────────

export interface CoverageCell {
  toolCode: string;
  dayIndex: number;
  daysOfSupply: number;
  colorBand: 'red' | 'amber' | 'green' | 'blue';
}

export interface CoverageMatrixResult {
  tools: Array<{ toolCode: string; machine: string; urgencyScore: number }>;
  days: string[];
  cells: CoverageCell[][];
}

// ── MRP SKU-View Types ──────────────────────────────────────

export interface MRPSkuViewRecord {
  sku: string;
  name: string;
  opId: string;
  toolCode: string;
  machine: string;
  altMachine: string | null;
  customer?: string;
  customerName?: string;
  twin?: string;
  isTwin: boolean;
  currentStock: number;
  wip: number;
  backlog: number;
  grossRequirement: number;
  projectedEnd: number;
  stockoutDay: number | null;
  coverageDays: number;
  buckets: MRPDayBucket[];
  ratePerHour: number;
  setupHours: number;
  lotEconomicQty: number;
}

export interface MRPSkuSummary {
  totalSkus: number;
  skusWithBacklog: number;
  skusWithStockout: number;
  totalGrossReq: number;
  totalPlannedQty: number;
}

export interface MRPSkuViewResult {
  skuRecords: MRPSkuViewRecord[];
  summary: MRPSkuSummary;
}

export interface CTPSkuInput {
  sku: string;
  quantity: number;
  targetDay: number;
}

export interface CoverageSkuCell {
  sku: string;
  toolCode: string;
  dayIndex: number;
  daysOfSupply: number;
  colorBand: 'red' | 'amber' | 'green' | 'blue';
}

export interface CoverageMatrixSkuResult {
  skus: Array<{
    sku: string;
    name: string;
    toolCode: string;
    machine: string;
    urgencyScore: number;
  }>;
  days: string[];
  cells: CoverageSkuCell[][];
}

export interface ROPSkuResult {
  sku: string;
  name: string;
  opId: string;
  toolCode: string;
  machine: string;
  demandAvg: number;
  demandStdDev: number;
  coefficientOfVariation: number;
  leadTimeDays: number;
  safetyStock: number;
  rop: number;
  serviceLevel: ServiceLevel;
  zScore: number;
  currentStock: number;
  abcClass: 'A' | 'B' | 'C';
  xyzClass: 'X' | 'Y' | 'Z';
  stockProjection: Array<{
    dayIndex: number;
    projected: number;
    ropLine: number;
    ssLine: number;
  }>;
}

export interface ROPSkuSummary {
  records: ROPSkuResult[];
  abcDistribution: { A: number; B: number; C: number };
  xyzDistribution: { X: number; Y: number; Z: number };
  skusBelowROP: number;
  skusBelowSS: number;
}
