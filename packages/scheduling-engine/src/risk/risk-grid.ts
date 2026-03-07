// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Risk Grid
//  Pure computation module for unified risk map
//  Aggregates 3 risk dimensions: capacity, stock (MRP), constraints
//  Extracted from riskGrid.ts (Incompol)
// ═══════════════════════════════════════════════════════════

import {
  DAY_CAP,
  RISK_CRITICAL_THRESHOLD,
  RISK_HIGH_THRESHOLD,
  RISK_MEDIUM_THRESHOLD,
} from '../constants.js';
import type { ROPConfig } from '../mrp/mrp-rop.js';
import { computeROP } from '../mrp/mrp-rop.js';
import type { DayLoad } from '../types/blocks.js';
import type { EngineData } from '../types/engine.js';
import type { MRPResult } from '../types/mrp.js';

// ── Types ────────────────────────────────────────────────────

export type RiskLevel = 'critical' | 'high' | 'medium' | 'ok';

export interface RiskCell {
  rowId: string;
  dayIdx: number;
  level: RiskLevel;
  tooltip: string;
  entityType: 'machine' | 'tool' | 'constraint';
}

export interface RiskRow {
  id: string;
  label: string;
  entityType: 'machine' | 'tool' | 'constraint';
  cells: RiskCell[];
  worstLevel: RiskLevel;
}

export interface RiskGridData {
  rows: RiskRow[];
  dates: string[];
  dnames: string[];
  summary: { criticalCount: number; highCount: number; mediumCount: number };
}

/**
 * Validation report interface for constraint rows.
 * Simplified from the full ScheduleValidationReport to avoid circular deps.
 */
export interface RiskValidationInput {
  violations: Array<{
    severity: 'critical' | 'high' | 'medium' | 'low';
    affectedOps: Array<{ machineId: string; dayIdx: number }>;
  }>;
}

// ── Helpers ─────────────────────────────────────────────────

const LEVEL_ORDER: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, ok: 3 };

function worstOf(levels: RiskLevel[]): RiskLevel {
  let worst: RiskLevel = 'ok';
  for (const l of levels) {
    if (LEVEL_ORDER[l] < LEVEL_ORDER[worst]) worst = l;
  }
  return worst;
}

// ── Capacity rows (1 per machine) ───────────────────────────

function buildCapacityRows(engine: EngineData, cap: Record<string, DayLoad[]>): RiskRow[] {
  return engine.machines.map((m) => {
    const mc = cap[m.id] || [];
    const cells: RiskCell[] = [];

    for (let di = 0; di < engine.nDays; di++) {
      const d = mc[di];
      if (!d) {
        cells.push({
          rowId: m.id,
          dayIdx: di,
          level: 'ok',
          tooltip: `${m.id} -- sem dados`,
          entityType: 'machine',
        });
        continue;
      }
      const util = (d.prod + d.setup) / DAY_CAP;
      let level: RiskLevel = 'ok';
      if (util > RISK_CRITICAL_THRESHOLD) level = 'critical';
      else if (util > RISK_HIGH_THRESHOLD) level = 'high';
      else if (util > RISK_MEDIUM_THRESHOLD) level = 'medium';

      cells.push({
        rowId: m.id,
        dayIdx: di,
        level,
        tooltip: `${m.id} ${engine.dnames[di]}: ${(util * 100).toFixed(0)}% -- ${d.pcs} pcs, ${d.ops} ops`,
        entityType: 'machine',
      });
    }

    return {
      id: m.id,
      label: m.id,
      entityType: 'machine' as const,
      cells,
      worstLevel: worstOf(cells.map((c) => c.level)),
    };
  });
}

// ── Stock rows (tools with MRP risk) ────────────────────────

function buildStockRows(
  engine: EngineData,
  mrp: MRPResult,
  ropConfig?: Partial<ROPConfig>,
): RiskRow[] {
  const rop = computeROP(mrp, engine, 95, ropConfig);
  const rows: RiskRow[] = [];

  for (const rec of mrp.records) {
    const ropRec = rop.records.find((r) => r.toolCode === rec.toolCode);
    const ropMissing = !ropRec;
    const ss = ropRec?.safetyStock ?? 0;
    const ropLine = ropRec?.rop ?? 0;
    const cells: RiskCell[] = [];
    let hasRisk = false;

    for (let di = 0; di < engine.nDays; di++) {
      const bucket = rec.buckets[di];
      if (!bucket) {
        cells.push({
          rowId: rec.toolCode,
          dayIdx: di,
          level: 'ok',
          tooltip: `${rec.toolCode} -- sem dados`,
          entityType: 'tool',
        });
        continue;
      }

      const pa = bucket.projectedAvailable;
      let level: RiskLevel = 'ok';
      if (pa < 0) level = 'critical';
      else if (pa < ss) level = 'high';
      else if (pa < ropLine) level = 'medium';

      // Flag tools missing ROP data as medium risk when there's demand
      if (ropMissing && level === 'ok' && bucket.grossRequirement > 0) {
        level = 'medium';
      }

      if (level !== 'ok') hasRisk = true;

      cells.push({
        rowId: rec.toolCode,
        dayIdx: di,
        level,
        tooltip: `${rec.toolCode} ${engine.dnames[di]}: stock proj. ${pa} (SS: ${Math.round(ss)}, ROP: ${Math.round(ropLine)})`,
        entityType: 'tool',
      });
    }

    // Only include tools with at least 1 day of risk
    if (hasRisk) {
      rows.push({
        id: rec.toolCode,
        label: rec.toolCode,
        entityType: 'tool',
        cells,
        worstLevel: worstOf(cells.map((c) => c.level)),
      });
    }
  }

  // Sort by worst level
  rows.sort((a, b) => LEVEL_ORDER[a.worstLevel] - LEVEL_ORDER[b.worstLevel]);

  return rows;
}

// ── Constraint rows (violations grouped by machine) ─────────

function buildConstraintRows(
  engine: EngineData,
  validation: RiskValidationInput | null,
): RiskRow[] {
  if (!validation || validation.violations.length === 0) return [];

  // Group violations by machine
  const machineViolations = new Map<string, Map<number, RiskLevel>>();

  for (const v of validation.violations) {
    for (const aop of v.affectedOps) {
      const key = aop.machineId;
      if (!machineViolations.has(key)) machineViolations.set(key, new Map());
      const dayMap = machineViolations.get(key)!;
      const existing = dayMap.get(aop.dayIdx) ?? 'ok';
      const level: RiskLevel =
        v.severity === 'critical' ? 'critical' : v.severity === 'high' ? 'high' : 'medium';
      if (LEVEL_ORDER[level] < LEVEL_ORDER[existing]) {
        dayMap.set(aop.dayIdx, level);
      }
    }
  }

  const rows: RiskRow[] = [];

  for (const [machineId, dayMap] of machineViolations) {
    const cells: RiskCell[] = [];
    for (let di = 0; di < engine.nDays; di++) {
      const level = dayMap.get(di) ?? 'ok';
      cells.push({
        rowId: `c-${machineId}`,
        dayIdx: di,
        level,
        tooltip:
          level !== 'ok'
            ? `${machineId} ${engine.dnames[di]}: violacao de restricao (${level})`
            : `${machineId} ${engine.dnames[di]}: sem violacoes`,
        entityType: 'constraint',
      });
    }

    rows.push({
      id: `c-${machineId}`,
      label: machineId,
      entityType: 'constraint',
      cells,
      worstLevel: worstOf(cells.map((c) => c.level)),
    });
  }

  rows.sort((a, b) => LEVEL_ORDER[a.worstLevel] - LEVEL_ORDER[b.worstLevel]);

  return rows;
}

// ── Main computation ────────────────────────────────────────

/**
 * Compute unified risk grid combining capacity, stock (MRP), and constraint risks.
 *
 * @param engine - Engine data (machines, dates, horizon)
 * @param cap - Capacity analysis per machine/day
 * @param validation - Schedule validation report (or null)
 * @param mrp - MRP result (or null)
 * @param ropConfig - Optional ROP config overrides for stock risk computation
 */
export function computeRiskGrid(
  engine: EngineData,
  cap: Record<string, DayLoad[]>,
  validation: RiskValidationInput | null,
  mrp: MRPResult | null,
  ropConfig?: Partial<ROPConfig>,
): RiskGridData {
  const capRows = buildCapacityRows(engine, cap);
  const stockRows = mrp ? buildStockRows(engine, mrp, ropConfig) : [];
  const constraintRows = buildConstraintRows(engine, validation);

  const allRows = [...capRows, ...stockRows, ...constraintRows];

  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  for (const row of allRows) {
    for (const cell of row.cells) {
      if (cell.level === 'critical') criticalCount++;
      else if (cell.level === 'high') highCount++;
      else if (cell.level === 'medium') mediumCount++;
    }
  }

  return {
    rows: allRows,
    dates: engine.dates,
    dnames: engine.dnames,
    summary: { criticalCount, highCount, mediumCount },
  };
}
