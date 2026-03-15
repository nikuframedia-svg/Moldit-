// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Move to Alternative Machine Strategy
//  Routes overflow/tardy operations to alternative machines.
//  Uses D+1 workforce risk as tiebreaker between candidates.
//  Pure function — no side effects.
// ═══════════════════════════════════════════════════════════

import { computeD1WorkforceRisk } from '../../analysis/workforce-forecast.js';
import { ALT_UTIL_THRESHOLD } from '../../constants.js';
import type { ScheduleAllInput, ScheduleAllResult } from '../../scheduler/scheduler.js';
import { scheduleAll } from '../../scheduler/scheduler.js';
import type { Block, MoveAction } from '../../types/blocks.js';
import type { AlternativeAction } from '../../types/decisions.js';
import type { EMachine } from '../../types/engine.js';
import type { WorkforceConfig } from '../../types/workforce.js';
import { capAnalysis, computeTardiness, sumOverflow } from '../overflow-helpers.js';

// ── Types ────────────────────────────────────────────────

export interface MoveAttemptResult {
  blocks: Block[];
  schedResult: ScheduleAllResult;
  newMetric: number;
  move: MoveAction;
  ob: Block;
  altUtil: number;
  alternatives: AlternativeAction[];
  metadata: Record<string, unknown>;
}

// ── Overflow move ────────────────────────────────────────

/**
 * Try moving ONE overflow operation to its alt machine.
 * Selects the best candidate using D+1 workforce risk as tiebreaker.
 */
export function tryMoveOverflow(
  buildInput: () => ScheduleAllInput,
  blocks: Block[],
  totalOverflow: number,
  autoMoves: MoveAction[],
  excludeOps: ReadonlySet<string>,
  machines: EMachine[],
  hardCap: number,
  wDayCount: number,
  mSt: Record<string, string>,
  workdays: boolean[],
  workforceConfig?: WorkforceConfig,
): MoveAttemptResult | null {
  const cap = capAnalysis(blocks, machines);

  const candidates = blocks
    .filter(
      (b) =>
        ((b.overflow && b.overflowMin != null && b.overflowMin > 0) ||
          (b.type === 'infeasible' && b.prodMin > 0)) &&
        b.hasAlt &&
        b.altM &&
        !excludeOps.has(b.opId) &&
        mSt[b.altM!] !== 'down',
    )
    .sort((a, b) => {
      const aMin = a.overflow ? a.overflowMin || 0 : a.prodMin;
      const bMin = b.overflow ? b.overflowMin || 0 : b.prodMin;
      return bMin - aMin;
    });

  return findBestMove(
    buildInput,
    candidates,
    autoMoves,
    cap,
    hardCap,
    wDayCount,
    workdays,
    workforceConfig,
    totalOverflow,
    'overflow',
  );
}

// ── Tardy move ───────────────────────────────────────────

/**
 * Try moving ONE tardy operation to its alt machine.
 * Used in Tier 2 (tardiness resolution).
 */
export function tryMoveTardy(
  buildInput: () => ScheduleAllInput,
  blocks: Block[],
  totalTardiness: number,
  autoMoves: MoveAction[],
  excludeOps: ReadonlySet<string>,
  preTier1TardyOps: ReadonlySet<string>,
  machines: EMachine[],
  hardCap: number,
  wDayCount: number,
  mSt: Record<string, string>,
  workdays: boolean[],
  workforceConfig?: WorkforceConfig,
): MoveAttemptResult | null {
  const cap = capAnalysis(blocks, machines);

  const candidates = blocks
    .filter(
      (b) =>
        b.type === 'ok' &&
        b.eddDay != null &&
        b.dayIdx > b.eddDay &&
        preTier1TardyOps.has(b.opId) &&
        !excludeOps.has(b.opId) &&
        b.hasAlt &&
        b.altM &&
        mSt[b.altM!] !== 'down',
    )
    .sort((a, b) => b.prodMin - a.prodMin);

  if (candidates.length === 0) return null;

  return findBestMove(
    buildInput,
    candidates,
    autoMoves,
    cap,
    hardCap,
    wDayCount,
    workdays,
    workforceConfig,
    totalTardiness,
    'tardy',
  );
}

// ── Shared logic ─────────────────────────────────────────

function findBestMove(
  buildInput: () => ScheduleAllInput,
  candidates: Block[],
  autoMoves: MoveAction[],
  cap: Record<string, Array<{ prod: number; setup: number }>>,
  hardCap: number,
  wDayCount: number,
  workdays: boolean[],
  workforceConfig: WorkforceConfig | undefined,
  currentMetric: number,
  mode: 'overflow' | 'tardy',
): MoveAttemptResult | null {
  let bestMove: {
    ob: Block;
    altM: string;
    altUtil: number;
    newMetric: number;
    newResult: ScheduleAllResult;
    d1Risk: number;
  } | null = null;

  const seenOps = new Set<string>();
  for (const ob of candidates) {
    if (seenOps.has(ob.opId)) continue;
    seenOps.add(ob.opId);

    const altM = ob.altM!;
    const altDays = cap[altM];
    if (!altDays) continue;

    const altTotalUsed = altDays.reduce((s, d) => s + d.prod + d.setup, 0);
    const altUtil = altTotalUsed / (wDayCount * hardCap);
    if (altUtil > ALT_UTIL_THRESHOLD) continue;

    autoMoves.push({ opId: ob.opId, toM: altM });
    const newResult = scheduleAll(buildInput());
    const newMetric = mode === 'overflow'
      ? sumOverflow(newResult.blocks)
      : computeTardiness(newResult.blocks);
    autoMoves.pop(); // always undo; apply only best candidate below

    const metricsOk = mode === 'overflow'
      ? newMetric < currentMetric
      : newMetric < currentMetric && sumOverflow(newResult.blocks) === 0;

    if (metricsOk) {
      const d1Risk = workforceConfig
        ? computeD1WorkforceRisk(newResult.blocks, workforceConfig, workdays)
        : 0;

      if (
        !bestMove ||
        newMetric < bestMove.newMetric ||
        (newMetric === bestMove.newMetric && d1Risk < bestMove.d1Risk)
      ) {
        bestMove = { ob, altM, altUtil, newMetric, newResult, d1Risk };
      }
    }
  }

  if (!bestMove) return null;

  const { ob, altM, altUtil, newMetric, newResult } = bestMove;
  const move: MoveAction = { opId: ob.opId, toM: altM };

  const alts: AlternativeAction[] = [
    {
      description: `Antecipar produção na máquina original ${ob.machineId}`,
      actionType: 'ADVANCE_PRODUCTION',
      params: { opId: ob.opId, machineId: ob.machineId },
    },
    {
      description: `Aceitar atraso formalmente`,
      actionType: 'FORMAL_RISK_ACCEPTANCE',
      params: { opId: ob.opId },
    },
  ];

  return {
    blocks: newResult.blocks,
    schedResult: newResult,
    newMetric,
    move,
    ob,
    altUtil,
    alternatives: alts,
    metadata: {
      fromMachine: ob.machineId,
      toMachine: altM,
      sku: ob.sku,
      altUtil: Math.round(altUtil * 100),
    },
  };
}
