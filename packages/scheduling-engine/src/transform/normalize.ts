// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Normalize NikufraData
//  Transforms flat fixture/ISOP data to normalized entities
//  + FactoryLookup helpers for relational queries
//  Extracted from nikufraTransform.ts (Incompol)
// ═══════════════════════════════════════════════════════════

import type { NikufraData } from '../types/core.js';

// ── Normalized entity types ──────────────────────────────────

export interface NormalizedMachine {
  id: string;
  area: 'PG1' | 'PG2';
  alternatives: string[]; // derived from tools that reference this machine
}

export interface NormalizedTool {
  id: string;
  primaryMachine: string;
  altMachine: string | null;
  setupHours: number;
  ratePerHour: number;
  operatorsRequired: 1 | 2;
  lotEconomicQty: number;
  currentStock: number;
  calcoCode?: string;
}

export interface ToolSku {
  toolId: string;
  sku: string;
  name: string;
}

export interface DemandLine {
  operationId: string;
  toolId: string;
  sku: string;
  machine: string;
  backlog: number;
  dailyDemand: number[];
}

export interface CalendarDay {
  date: string;
  dayLabel: string;
  isWorkday: boolean;
  shifts: Array<{ id: 'X' | 'Y'; start: number; end: number }>;
}

export interface LaborPool {
  area: 'PG1' | 'PG2';
  dailyCapacity: number[];
}

export interface NormalizedFactory {
  machines: NormalizedMachine[];
  tools: NormalizedTool[];
  toolSkus: ToolSku[];
  demandLines: DemandLine[];
  calendar: CalendarDay[];
  laborPools: LaborPool[];
}

// ── Transform ────────────────────────────────────────────────

/**
 * Transform flat NikufraData to normalized entities.
 *
 * NikufraData is the raw format from ISOP/fixture with short property names.
 * NormalizedFactory uses full property names and relational indices.
 */
export function normalizeNikufraData(raw: NikufraData): NormalizedFactory {
  // Machines
  const machines: NormalizedMachine[] = raw.machines.map((m) => ({
    id: m.id,
    area: m.area as 'PG1' | 'PG2',
    alternatives: [], // populated below
  }));

  // Tools
  const tools: NormalizedTool[] = raw.tools.map((t) => ({
    id: t.id,
    primaryMachine: t.m,
    altMachine: t.alt && t.alt !== '-' ? t.alt : null,
    setupHours: t.s,
    ratePerHour: t.pH,
    operatorsRequired: (t.op === 2 ? 2 : 1) as 1 | 2,
    lotEconomicQty: t.lt,
    currentStock: t.stk,
    calcoCode: undefined, // not in V1 NikufraData
  }));

  // Populate machine alternatives from tools
  const machAlts = new Map<string, Set<string>>();
  tools.forEach((t) => {
    if (t.altMachine) {
      if (!machAlts.has(t.primaryMachine)) machAlts.set(t.primaryMachine, new Set());
      machAlts.get(t.primaryMachine)!.add(t.altMachine);
      if (!machAlts.has(t.altMachine)) machAlts.set(t.altMachine, new Set());
      machAlts.get(t.altMachine)!.add(t.primaryMachine);
    }
  });
  machines.forEach((m) => {
    m.alternatives = Array.from(machAlts.get(m.id) ?? []);
  });

  // Tool-SKU mapping
  const toolSkus: ToolSku[] = raw.tools.flatMap((t) =>
    t.skus.map((sku, i) => ({
      toolId: t.id,
      sku,
      name: t.nm[i] || sku,
    })),
  );

  // Demand lines from operations
  const demandLines: DemandLine[] = raw.operations.map((op) => ({
    operationId: op.id,
    toolId: op.t,
    sku: op.sku,
    machine: op.m,
    backlog: op.atr,
    dailyDemand: [...op.d],
  }));

  // Calendar
  const calendar: CalendarDay[] = raw.dates.map((date, i) => ({
    date,
    dayLabel: raw.days_label[i] || '--',
    isWorkday: true, // default; actual workday flags come from PlanState
    shifts: [
      { id: 'X' as const, start: 420, end: 930 }, // 07:00-15:30
      { id: 'Y' as const, start: 930, end: 1440 }, // 15:30-24:00
    ],
  }));

  // Labor pools
  const laborPools: LaborPool[] = [
    { area: 'PG1', dailyCapacity: [...raw.mo.PG1] },
    { area: 'PG2', dailyCapacity: [...raw.mo.PG2] },
  ];

  return { machines, tools, toolSkus, demandLines, calendar, laborPools };
}

// ── FactoryLookup ────────────────────────────────────────────

/**
 * FactoryLookup: typed helper for relational queries on NormalizedFactory.
 *
 * Builds internal indices on construction for O(1) lookups:
 * - Tools by machine
 * - SKUs by tool
 * - Demand by SKU
 */
export class FactoryLookup {
  private toolsByMachine: Map<string, NormalizedTool[]>;
  private skusByTool: Map<string, ToolSku[]>;
  private demandBySku: Map<string, DemandLine[]>;

  constructor(private data: NormalizedFactory) {
    // Index: tools by machine
    this.toolsByMachine = new Map();
    data.tools.forEach((t) => {
      const primary = this.toolsByMachine.get(t.primaryMachine);
      if (primary) primary.push(t);
      else this.toolsByMachine.set(t.primaryMachine, [t]);
      if (t.altMachine) {
        const alt = this.toolsByMachine.get(t.altMachine);
        if (alt) alt.push(t);
        else this.toolsByMachine.set(t.altMachine, [t]);
      }
    });

    // Index: SKUs by tool
    this.skusByTool = new Map();
    data.toolSkus.forEach((ts) => {
      const arr = this.skusByTool.get(ts.toolId);
      if (arr) arr.push(ts);
      else this.skusByTool.set(ts.toolId, [ts]);
    });

    // Index: demand by SKU
    this.demandBySku = new Map();
    data.demandLines.forEach((dl) => {
      const arr = this.demandBySku.get(dl.sku);
      if (arr) arr.push(dl);
      else this.demandBySku.set(dl.sku, [dl]);
    });
  }

  getToolsForMachine(machineId: string): NormalizedTool[] {
    return this.toolsByMachine.get(machineId) ?? [];
  }

  getSkusForTool(toolId: string): ToolSku[] {
    return this.skusByTool.get(toolId) ?? [];
  }

  getAlternativesForTool(toolId: string): NormalizedMachine[] {
    const tool = this.data.tools.find((t) => t.id === toolId);
    if (!tool || !tool.altMachine) return [];
    return this.data.machines.filter((m) => m.id === tool.altMachine);
  }

  getMachinesInArea(area: 'PG1' | 'PG2'): NormalizedMachine[] {
    return this.data.machines.filter((m) => m.area === area);
  }

  getDemandForSku(sku: string): DemandLine[] {
    return this.demandBySku.get(sku) ?? [];
  }

  // PRM042 has 6 tools without alternatives (bdmestre)
  isCriticalMachine(machineId: string): boolean {
    const tools = this.getToolsForMachine(machineId);
    return tools.some((t) => t.altMachine === null);
  }

  getToolsWith2Operators(): NormalizedTool[] {
    return this.data.tools.filter((t) => t.operatorsRequired === 2);
  }

  getTotalDemand(): number {
    return this.data.demandLines.reduce(
      (sum, dl) => sum + dl.backlog + dl.dailyDemand.reduce((a, v) => a + Math.max(v, 0), 0),
      0,
    );
  }
}
