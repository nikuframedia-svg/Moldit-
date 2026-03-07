// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Coverage Audit
//  Per-operation demand vs. production verification
//  Extracted from NikufraEngine.tsx auditCoverage()
// ═══════════════════════════════════════════════════════════

import type { Block } from '../types/blocks.js';
import type { EOp, ETool } from '../types/engine.js';
import type { TwinGroup } from '../types/twin.js';
import { getBlockProductionForOp } from '../utils/block-production.js';

// ── Types ────────────────────────────────────────────────────

export interface CoverageAuditRow {
  opId: string;
  sku: string;
  nm: string;
  machineId: string;
  toolId: string;
  totalDemand: number;
  produced: number;
  coveragePct: number;
  gap: number;
  reason: 'ok' | 'overflow' | 'blocked' | 'partial' | 'rate_zero' | 'no_demand';
  hasAlt: boolean;
  altM: string | null;
  /** Whether production comes from twin co-production */
  isTwinProduction?: boolean;
  /** Twin partner op ID (if co-produced) */
  twinPartnerOpId?: string;
  /** Excess production from co-production going to stock */
  twinExcessToStock?: number;
}

export interface CoverageAuditResult {
  rows: CoverageAuditRow[];
  totalDemand: number;
  totalProduced: number;
  globalCoveragePct: number;
  fullyCovered: number;
  partiallyCovered: number;
  zeroCovered: number;
  isComplete: boolean;
}

// ── Main Computation ────────────────────────────────────────

/**
 * Audit demand coverage for each operation.
 *
 * For each operation, computes total demand (daily + backlog),
 * produced quantity from 'ok' blocks, and categorizes the result.
 */
export function auditCoverage(
  blocks: Block[],
  ops: EOp[],
  TM: Record<string, ETool>,
  twinGroups?: TwinGroup[],
): CoverageAuditResult {
  const rows: CoverageAuditRow[] = [];
  let totalDemand = 0;
  let totalProduced = 0;
  let fullyCovered = 0;
  let partiallyCovered = 0;
  let zeroCovered = 0;

  for (const op of ops) {
    const demand = op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0);
    const tool = TM[op.t];

    if (demand <= 0) {
      rows.push({
        opId: op.id,
        sku: op.sku,
        nm: op.nm,
        machineId: op.m,
        toolId: op.t,
        totalDemand: 0,
        produced: 0,
        coveragePct: 100,
        gap: 0,
        reason: 'no_demand',
        hasAlt: !!(tool?.alt && tool.alt !== '-'),
        altM: tool?.alt && tool.alt !== '-' ? tool.alt : null,
      });
      fullyCovered++;
      continue;
    }

    totalDemand += demand;

    // Check if rate=0 (scheduler skips these)
    if (!tool || tool.pH <= 0) {
      rows.push({
        opId: op.id,
        sku: op.sku,
        nm: op.nm,
        machineId: op.m,
        toolId: op.t,
        totalDemand: demand,
        produced: 0,
        coveragePct: 0,
        gap: demand,
        reason: 'rate_zero',
        hasAlt: !!(tool?.alt && tool.alt !== '-'),
        altM: tool?.alt && tool.alt !== '-' ? tool.alt : null,
      });
      zeroCovered++;
      continue;
    }

    const opBlocks = blocks.filter((b) => b.opId === op.id);
    // Twin-aware production: uses outputs[] for co-production blocks
    const produced = getBlockProductionForOp(blocks, op.id);
    const hasBlocked = opBlocks.some((b) => b.type === 'blocked');
    const hasOverflow = opBlocks.some((b) => b.type === 'overflow');

    // Twin co-production metadata
    const twinBlks = blocks.filter(
      (b) => b.type === 'ok' && b.isTwinProduction && b.outputs?.some((o) => o.opId === op.id),
    );
    const isTwin = twinBlks.length > 0;
    let twinPartnerOpId: string | undefined;
    let twinExcessToStock: number | undefined;
    if (isTwin && twinGroups) {
      const grp = twinGroups.find((g) => g.opId1 === op.id || g.opId2 === op.id);
      twinPartnerOpId = grp ? (grp.opId1 === op.id ? grp.opId2 : grp.opId1) : undefined;
      if (produced > demand) twinExcessToStock = produced - demand;
    }

    totalProduced += produced;
    const pct = Math.min(100, demand > 0 ? (produced / demand) * 100 : 100);
    const gap = Math.max(0, demand - produced);

    let reason: CoverageAuditRow['reason'] = 'ok';
    if (pct < 100) {
      reason = hasBlocked ? 'blocked' : hasOverflow ? 'overflow' : 'partial';
    }

    rows.push({
      opId: op.id,
      sku: op.sku,
      nm: op.nm,
      machineId: op.m,
      toolId: op.t,
      totalDemand: demand,
      produced,
      coveragePct: Math.round(pct),
      gap,
      reason,
      hasAlt: !!(tool?.alt && tool.alt !== '-'),
      altM: tool?.alt && tool.alt !== '-' ? tool.alt : null,
      ...(isTwin ? { isTwinProduction: true, twinPartnerOpId, twinExcessToStock } : {}),
    });

    if (produced >= demand) fullyCovered++;
    else if (produced > 0) partiallyCovered++;
    else zeroCovered++;
  }

  const globalPct = totalDemand > 0 ? Math.min(100, (totalProduced / totalDemand) * 100) : 100;

  return {
    rows,
    totalDemand,
    totalProduced,
    globalCoveragePct: Math.round(globalPct * 10) / 10,
    fullyCovered,
    partiallyCovered,
    zeroCovered,
    isComplete: totalProduced >= totalDemand,
  };
}
