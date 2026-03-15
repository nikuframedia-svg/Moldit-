// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Advance Production Strategy
//  Moves overflow/tardy operations to earlier days on the same machine.
//  Uses D+1 workforce risk as tiebreaker between candidates.
//  Pure function — no side effects.
// ═══════════════════════════════════════════════════════════

import { computeD1WorkforceRisk } from '../../analysis/workforce-forecast.js';
import type { ScheduleAllInput, ScheduleAllResult } from '../../scheduler/scheduler.js';
import { scheduleAll } from '../../scheduler/scheduler.js';
import type { AdvanceAction, Block } from '../../types/blocks.js';
import type { AlternativeAction } from '../../types/decisions.js';
import type { WorkforceConfig } from '../../types/workforce.js';
import { computeAdvancedEdd, computeTardiness, sumOverflow } from '../overflow-helpers.js';

// ── Types ────────────────────────────────────────────────

export interface AdvanceAttemptResult {
  blocks: Block[];
  schedResult: ScheduleAllResult;
  newMetric: number;
  advance: AdvanceAction;
  ob: Block;
  targetDay: number;
  alternatives: AlternativeAction[];
  metadata: Record<string, unknown>;
}

// ── Overflow advance ─────────────────────────────────────

/**
 * Try advancing ONE overflow operation to reduce total overflow.
 * Selects the best candidate using D+1 workforce risk as tiebreaker.
 *
 * @returns The best advance result, or null if no improvement possible.
 */
export function tryAdvanceOverflow(
  buildInput: () => ScheduleAllInput,
  blocks: Block[],
  totalOverflow: number,
  autoAdvances: readonly AdvanceAction[],
  excludeOps: ReadonlySet<string>,
  workdays: boolean[],
  workforceConfig?: WorkforceConfig,
  toolMap?: Record<string, { alt?: string }>,
): AdvanceAttemptResult | null {
  const candidates = blocks
    .filter(
      (b) =>
        ((b.overflow && b.overflowMin != null && b.overflowMin > 0) ||
          (b.type === 'infeasible' && b.prodMin > 0)) &&
        !excludeOps.has(b.opId),
    )
    .sort((a, b) => {
      const aMin = a.overflow ? a.overflowMin || 0 : a.prodMin;
      const bMin = b.overflow ? b.overflowMin || 0 : b.prodMin;
      return bMin - aMin;
    });

  return findBestAdvance(
    buildInput,
    candidates,
    autoAdvances,
    workdays,
    workforceConfig,
    toolMap,
    totalOverflow,
    'overflow',
  );
}

// ── Tardy advance ────────────────────────────────────────

/**
 * Try advancing ONE tardy operation to reduce total tardiness.
 * Used in Tier 2 (tardiness resolution).
 */
export function tryAdvanceTardy(
  buildInput: () => ScheduleAllInput,
  blocks: Block[],
  totalTardiness: number,
  autoAdvances: readonly AdvanceAction[],
  excludeOps: ReadonlySet<string>,
  preTier1TardyOps: ReadonlySet<string>,
  workdays: boolean[],
  workforceConfig?: WorkforceConfig,
  toolMap?: Record<string, { alt?: string }>,
): AdvanceAttemptResult | null {
  const candidates = blocks
    .filter(
      (b) =>
        b.type === 'ok' &&
        b.eddDay != null &&
        b.dayIdx > b.eddDay &&
        preTier1TardyOps.has(b.opId) &&
        !excludeOps.has(b.opId),
    )
    .sort((a, b) => b.prodMin - a.prodMin);

  if (candidates.length === 0) return null;

  return findBestAdvance(
    buildInput,
    candidates,
    autoAdvances,
    workdays,
    workforceConfig,
    toolMap,
    totalTardiness,
    'tardy',
  );
}

// ── Shared logic ─────────────────────────────────────────

function findBestAdvance(
  buildInput: () => ScheduleAllInput,
  candidates: Block[],
  autoAdvances: readonly AdvanceAction[],
  workdays: boolean[],
  workforceConfig: WorkforceConfig | undefined,
  toolMap: Record<string, { alt?: string }> | undefined,
  currentMetric: number,
  mode: 'overflow' | 'tardy',
): AdvanceAttemptResult | null {
  let bestAdv: {
    ob: Block;
    advDays: number;
    targetDay: number;
    newMetric: number;
    newResult: ScheduleAllResult;
    d1Risk: number;
  } | null = null;

  const seenOps = new Set<string>();
  for (const ob of candidates) {
    if (seenOps.has(ob.opId)) continue;
    seenOps.add(ob.opId);

    const baseEdd = mode === 'tardy' ? (ob.eddDay ?? ob.dayIdx) : ob.dayIdx;
    for (let advDays = 1; advDays <= 30; advDays++) {
      const targetDay = computeAdvancedEdd(baseEdd, advDays, workdays);
      if (targetDay < 0) break;

      const trial: AdvanceAction[] = [
        ...autoAdvances,
        { opId: ob.opId, advanceDays: advDays, originalEdd: baseEdd },
      ];
      const newResult = scheduleAll({ ...buildInput(), advanceOverrides: trial });

      const newMetric = mode === 'overflow'
        ? sumOverflow(newResult.blocks)
        : computeTardiness(newResult.blocks);

      const metricsOk = mode === 'overflow'
        ? newMetric < currentMetric
        : newMetric < currentMetric && sumOverflow(newResult.blocks) === 0;

      if (metricsOk) {
        const d1Risk = workforceConfig
          ? computeD1WorkforceRisk(newResult.blocks, workforceConfig, workdays)
          : 0;

        if (
          !bestAdv ||
          newMetric < bestAdv.newMetric ||
          (newMetric === bestAdv.newMetric && d1Risk < bestAdv.d1Risk)
        ) {
          bestAdv = { ob, advDays, targetDay, newMetric, newResult, d1Risk };
        }
        break;
      }
    }
  }

  if (!bestAdv) return null;

  const { ob, advDays, targetDay, newMetric, newResult } = bestAdv;
  const baseEdd = mode === 'tardy' ? (ob.eddDay ?? ob.dayIdx) : ob.dayIdx;
  const advance: AdvanceAction = { opId: ob.opId, advanceDays: advDays, originalEdd: baseEdd };

  const tool = toolMap?.[ob.toolId];
  const alts: AlternativeAction[] = [];
  if (tool?.alt && tool.alt !== '-') {
    alts.push({
      description: `Mover para máquina alternativa ${tool.alt}`,
      actionType: 'MOVE_ALT_MACHINE',
      params: { opId: ob.opId, toM: tool.alt },
    });
  }
  alts.push({
    description: `Aceitar atraso formalmente`,
    actionType: 'FORMAL_RISK_ACCEPTANCE',
    params: { opId: ob.opId },
  });

  return {
    blocks: newResult.blocks,
    schedResult: newResult,
    newMetric,
    advance,
    ob,
    targetDay,
    alternatives: alts,
    metadata: {
      originalEdd: baseEdd,
      newEdd: targetDay,
      advanceDays: advDays,
      sku: ob.sku,
    },
  };
}
