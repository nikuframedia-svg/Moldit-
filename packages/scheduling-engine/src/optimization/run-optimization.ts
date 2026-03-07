// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Schedule Optimization
//  Iterative improvement via neighborhood search:
//  - Swap Tardiness (move tardy ops to alt machines)
//  - Setup Reduction (undo non-forced moves to reduce tool changes)
//  - Load Balance (equalize load across machines in same area)
//  - 2-Opt Resequencing (swap adjacent blocks to reduce setups)
//  Migrated from NikufraEngine.tsx runOptimization()
//  Made PURE: no Zustand store access, accepts all params explicitly.
// ═══════════════════════════════════════════════════════════

import { capAnalysis } from '../analysis/cap-analysis.js';
import { genDecisions } from '../analysis/gen-decisions.js';
import type { ScoreWeights } from '../analysis/score-schedule.js';
import { scoreSchedule } from '../analysis/score-schedule.js';
import { DAY_CAP } from '../constants.js';
import type { ScheduleAllInput } from '../scheduler/scheduler.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { Block, MoveAction } from '../types/blocks.js';
import type { EMachine, EOp, ETool } from '../types/engine.js';
import type { ResourceTimeline } from '../types/failure.js';
import type { DispatchRule, OptResult } from '../types/kpis.js';
import type { TwinValidationReport } from '../types/twin.js';
import type { WorkforceConfig } from '../types/workforce.js';
import { mulberry32 } from '../utils/prng.js';

// ── Types ────────────────────────────────────────────────

export interface OptimizationInput {
  ops: EOp[];
  mSt: Record<string, string>;
  tSt: Record<string, string>;
  machines: EMachine[];
  TM: Record<string, ETool>;
  focusIds: string[];
  tools: ETool[];
  workforceConfig: WorkforceConfig;
  weights?: Partial<ScoreWeights>;
  seed?: number;
  workdays?: boolean[];
  nDays: number;
  rule?: DispatchRule;
  baselineBlocks?: Block[];
  /** Number of iterations */
  N?: number;
  /** Top-K results to keep */
  K?: number;
  /** Load balance threshold (default: 0.15) */
  loadBalanceThreshold?: number;
  /** Third shift flag */
  thirdShift?: boolean;
  /** Per-machine failure timelines (per-day-per-shift capacity) */
  machineTimelines?: Record<string, ResourceTimeline>;
  /** Per-tool failure timelines (per-day-per-shift capacity) */
  toolTimelines?: Record<string, ResourceTimeline>;
  /** Twin validation report (from transform pipeline) */
  twinValidationReport?: TwinValidationReport;
  /** Date labels for the planning horizon */
  dates?: string[];
  /** Order-based demand mode: each day with demand = separate order bucket */
  orderBased?: boolean;
  /** ATCS parameters (k1/k2) — only used when rule = 'ATCS' */
  atcsParams?: { k1: number; k2: number };
}

export interface OptimizationSetup {
  moveable: MoveableOp[];
  top: OptResult[];
  N: number;
  run: (onBatch: (results: OptResult[]) => void, onProgress?: (pct: number) => void) => void;
}

export interface MoveableOp {
  opId: string;
  toolId: string;
  primaryM: string;
  altM: string;
  totalPcs: number;
  hrs: number;
}

// ── Helper: Moveable ops ─────────────────────────────────

export function moveableOps(
  ops: EOp[],
  mSt: Record<string, string>,
  tSt: Record<string, string>,
  TM: Record<string, ETool>,
): MoveableOp[] {
  return ops
    .filter((op) => {
      const tool = TM[op.t];
      if (!tool || !tool.alt || tool.alt === '-') return false;
      const primaryDown = mSt[op.m] === 'down' || tSt[op.t] === 'down';
      const altDown = mSt[tool.alt] === 'down';
      return !primaryDown || !altDown;
    })
    .map((op) => ({
      opId: op.id,
      toolId: op.t,
      primaryM: op.m,
      altM: TM[op.t].alt,
      totalPcs: op.d.reduce((a, v) => a + Math.max(v, 0), 0) + Math.max(op.atr, 0),
      hrs: (op.d.reduce((a, v) => a + Math.max(v, 0), 0) + Math.max(op.atr, 0)) / TM[op.t].pH,
    }));
}

// ── Helper: Count setups ─────────────────────────────────

function countSetups(blocks: Block[]): number {
  let count = 0;
  let lastTool: string | null = null;
  blocks.forEach((b) => {
    if (b.toolId !== lastTool) {
      count++;
      lastTool = b.toolId;
    }
  });
  return Math.max(0, count - 1);
}

// ── 2-Opt Resequencing ───────────────────────────────────

/**
 * Post-processing pass: swap consecutive block pairs within same machine/day
 * to reduce setup count. Respects shift boundaries by recalculating times.
 */
export function twoOptResequence(blocks: Block[], TM: Record<string, ETool>): Block[] {
  const groups = new Map<string, Block[]>();
  blocks.forEach((b) => {
    if (b.type === 'blocked') return;
    const key = `${b.machineId}_${b.dayIdx}`;
    const arr = groups.get(key);
    if (arr) arr.push(b);
    else groups.set(key, [b]);
  });

  const improved: Block[] = [...blocks];
  groups.forEach((dayBlocks) => {
    if (dayBlocks.length < 2) return;

    let best = dayBlocks.slice();
    let bestSetups = countSetups(best);
    let didImprove = true;
    while (didImprove) {
      didImprove = false;
      for (let i = 0; i < best.length - 1; i++) {
        const swapped = best.slice();
        const tmp = swapped[i];
        swapped[i] = swapped[i + 1];
        swapped[i + 1] = tmp;
        const newSetups = countSetups(swapped);
        if (newSetups < bestSetups) {
          best = swapped;
          bestSetups = newSetups;
          didImprove = true;
        }
      }
    }

    if (bestSetups < countSetups(dayBlocks)) {
      let cursor = dayBlocks[0].startMin;
      if (dayBlocks[0].setupS !== null) cursor = dayBlocks[0].setupS!;
      let lastTool: string | null = null;

      best.forEach((b) => {
        const needSetup = b.toolId !== lastTool && TM[b.toolId] && TM[b.toolId].sH > 0;
        const setupDur = needSetup ? TM[b.toolId].sH * 60 : 0;
        const setupS = needSetup ? cursor : null;
        const setupE = needSetup ? cursor + setupDur : null;
        cursor += setupDur;
        const pStart = cursor;
        const pEnd = pStart + b.prodMin;

        const idx = improved.findIndex(
          (ib) => ib.opId === b.opId && ib.dayIdx === b.dayIdx && ib.machineId === b.machineId,
        );
        if (idx !== -1) {
          improved[idx] = {
            ...b,
            startMin: pStart,
            endMin: pEnd,
            setupS,
            setupE,
            setupMin: setupDur,
          };
        }
        cursor = pEnd;
        lastTool = b.toolId;
      });
    }
  });
  return improved;
}

// ── Neighborhood A: Swap Tardiness ───────────────────────

function buildScheduleInput(
  input: OptimizationInput,
  moves: MoveAction[],
  rule?: DispatchRule,
): ScheduleAllInput {
  return {
    ops: input.ops,
    mSt: input.mSt,
    tSt: input.tSt,
    moves,
    machines: input.machines,
    toolMap: input.TM,
    workdays: input.workdays ?? [],
    nDays: input.nDays,
    rule: rule ?? input.rule,
    thirdShift: input.thirdShift,
    workforceConfig: input.workforceConfig,
    machineTimelines: input.machineTimelines,
    toolTimelines: input.toolTimelines,
    twinValidationReport: input.twinValidationReport,
    dates: input.dates,
    orderBased: input.orderBased,
    atcsParams: input.atcsParams,
  };
}

function scheduleAndScore(
  input: OptimizationInput,
  moves: MoveAction[],
  rule?: DispatchRule,
): { blocks: Block[]; score: number } {
  const sInput = buildScheduleInput(input, moves, rule);
  const result = scheduleAll(sInput);
  const metrics = scoreSchedule(
    result.blocks,
    input.ops,
    input.mSt,
    input.workforceConfig,
    input.machines,
    input.TM,
    input.weights,
    input.baselineBlocks,
    input.nDays,
  );
  return { blocks: result.blocks, score: metrics.score };
}

function neighborhoodSwapTardiness(
  currentMoves: MoveAction[],
  input: OptimizationInput,
): { moves: MoveAction[]; blocks: Block[]; score: number } | null {
  const { blocks: blks, score: currentScore } = scheduleAndScore(input, currentMoves);

  const tardByMachine: Record<string, number> = {};
  blks.forEach((b) => {
    if (b.overflow && b.overflowMin) {
      tardByMachine[b.machineId] = (tardByMachine[b.machineId] || 0) + b.overflowMin;
    }
  });
  const entries = Object.entries(tardByMachine).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;

  const [worstM] = entries[0];
  const tardyOps = blks
    .filter((b) => b.machineId === worstM && b.overflow && b.overflowMin && b.hasAlt && b.altM)
    .sort((a, b) => (b.overflowMin || 0) - (a.overflowMin || 0))
    .slice(0, 3);

  if (tardyOps.length === 0) return null;

  let bestResult: { moves: MoveAction[]; blocks: Block[]; score: number } | null = null;

  for (const tOp of tardyOps) {
    if (!tOp.altM || input.mSt[tOp.altM] === 'down') continue;
    if (currentMoves.find((m) => m.opId === tOp.opId)) continue;
    const newMoves = [...currentMoves, { opId: tOp.opId, toM: tOp.altM }];
    const { blocks: newBlks, score: newScore } = scheduleAndScore(input, newMoves);
    if (newScore > currentScore && (!bestResult || newScore > bestResult.score)) {
      bestResult = { moves: newMoves, blocks: newBlks, score: newScore };
    }
  }
  return bestResult;
}

// ── Neighborhood B: Setup Reduction ──────────────────────

function neighborhoodSetupReduction(
  currentMoves: MoveAction[],
  input: OptimizationInput,
  rng: () => number,
): { moves: MoveAction[]; blocks: Block[]; score: number } | null {
  if (currentMoves.length === 0) return null;

  const nonForced = currentMoves.filter((mv) => {
    const op = input.ops.find((o) => o.id === mv.opId);
    if (!op) return false;
    return input.mSt[op.m] !== 'down' && input.tSt[op.t] !== 'down';
  });
  if (nonForced.length === 0) return null;

  const idx = Math.floor(rng() * nonForced.length);
  const toUndo = nonForced[idx];
  const newMoves = currentMoves.filter((m) => m.opId !== toUndo.opId);
  const { score: currentScore } = scheduleAndScore(input, currentMoves);
  const { blocks: newBlks, score: newScore } = scheduleAndScore(input, newMoves);
  if (newScore > currentScore) {
    return { moves: newMoves, blocks: newBlks, score: newScore };
  }
  return null;
}

// ── Neighborhood C: Load Balance ─────────────────────────

function neighborhoodLoadBalance(
  currentMoves: MoveAction[],
  input: OptimizationInput,
  rng: () => number,
): { moves: MoveAction[]; blocks: Block[]; score: number } | null {
  const { blocks: blks, score: currentScore } = scheduleAndScore(input, currentMoves);
  const cap = capAnalysis(blks, input.machines);
  const threshold = input.loadBalanceThreshold ?? 0.15;

  const machUtil: Array<{ id: string; area: string; avgUtil: number }> = input.machines
    .filter((m) => input.mSt[m.id] !== 'down')
    .map((m) => {
      const days = cap[m.id] || [];
      const utils = days.map((d) => (d.prod + d.setup) / DAY_CAP).filter((u) => u > 0);
      return {
        id: m.id,
        area: m.area,
        avgUtil: utils.length > 0 ? utils.reduce((a, v) => a + v, 0) / utils.length : 0,
      };
    });

  for (const area of ['PG1', 'PG2']) {
    const inArea = machUtil.filter((m) => m.area === area).sort((a, b) => b.avgUtil - a.avgUtil);
    if (inArea.length < 2) continue;
    const over = inArea[0];
    const under = inArea[inArea.length - 1];
    if (over.avgUtil - under.avgUtil < threshold) continue;

    const candidateOps = input.ops.filter((op) => {
      const tool = input.TM[op.t];
      if (!tool) return false;
      const effM = currentMoves.find((m) => m.opId === op.id)?.toM || op.m;
      if (effM !== over.id) return false;
      if (tool.alt === under.id || tool.m === under.id) return true;
      return false;
    });

    if (candidateOps.length === 0) continue;

    const pick = candidateOps[Math.floor(rng() * candidateOps.length)];
    const existingMove = currentMoves.find((m) => m.opId === pick.id);
    let newMoves: MoveAction[];
    if (existingMove) {
      newMoves = currentMoves.map((m) =>
        m.opId === pick.id ? { opId: pick.id, toM: under.id } : m,
      );
    } else {
      newMoves = [...currentMoves, { opId: pick.id, toM: under.id }];
    }

    const { blocks: newBlks, score: newScore } = scheduleAndScore(input, newMoves);
    if (newScore > currentScore) {
      return { moves: newMoves, blocks: newBlks, score: newScore };
    }
  }
  return null;
}

// ── Iterative improvement ────────────────────────────────

function improveIteration(
  currentMoves: MoveAction[],
  input: OptimizationInput,
  rng: () => number,
  iterCount: number,
): { moves: MoveAction[]; blocks: Block[]; score: number } {
  const neighborhoods = [
    (mv: MoveAction[]) => neighborhoodSwapTardiness(mv, input),
    (mv: MoveAction[]) => neighborhoodSetupReduction(mv, input, rng),
    (mv: MoveAction[]) => neighborhoodLoadBalance(mv, input, rng),
  ];

  const nh = neighborhoods[iterCount % 3];
  const result = nh(currentMoves);

  if (result) {
    const resequenced = twoOptResequence(result.blocks, input.TM);
    const reScore = scoreSchedule(
      resequenced,
      input.ops,
      input.mSt,
      input.workforceConfig,
      input.machines,
      input.TM,
      input.weights,
      input.baselineBlocks,
      input.nDays,
    );
    if (reScore.score > result.score) {
      return { moves: result.moves, blocks: resequenced, score: reScore.score };
    }
    return result;
  }

  const { blocks: blks, score } = scheduleAndScore(input, currentMoves);
  return { moves: [...currentMoves], blocks: blks, score };
}

// ── Main entry point ─────────────────────────────────────

/**
 * Run iterative schedule optimization.
 *
 * Pure function — no Zustand store access.
 * All parameters passed explicitly including baseline blocks.
 *
 * Returns an OptimizationSetup object with:
 * - moveable: list of operations that can be moved
 * - top: initial candidate solutions (baseline + alt heuristics + auto-replan)
 * - N: iteration count
 * - run(): starts the iterative improvement loop
 */
export function runOptimization(input: OptimizationInput): OptimizationSetup {
  const N = input.N ?? 100;
  const K = input.K ?? 5;
  const rng = mulberry32(input.seed ?? 42);
  const mvbl = moveableOps(input.ops, input.mSt, input.tSt, input.TM);
  const top: OptResult[] = [];
  const rule = input.rule ?? 'EDD';

  // 1. Baseline — zero moves with selected dispatch rule
  const baseResult = scheduleAll(buildScheduleInput(input, [], rule));
  const baseM = scoreSchedule(
    baseResult.blocks,
    input.ops,
    input.mSt,
    input.workforceConfig,
    input.machines,
    input.TM,
    input.weights,
    input.baselineBlocks,
    input.nDays,
  );
  top.push({ ...baseM, moves: [], blocks: baseResult.blocks, label: `Baseline (${rule})` });

  // 2. Test alternative heuristics as additional seed candidates
  const altRules: DispatchRule[] = (['EDD', 'CR', 'WSPT', 'SPT'] as const).filter(
    (r) => r !== rule,
  );
  for (const alt of altRules) {
    const altResult = scheduleAll(buildScheduleInput(input, [], alt));
    const altM = scoreSchedule(
      altResult.blocks,
      input.ops,
      input.mSt,
      input.workforceConfig,
      input.machines,
      input.TM,
      input.weights,
      input.baselineBlocks,
      input.nDays,
    );
    if (altM.score > baseM.score) {
      top.push({ ...altM, moves: [], blocks: altResult.blocks, label: `Baseline (${alt})` });
    }
  }

  // 3. Auto-Replan — apply all replan decisions
  const decs = genDecisions(
    input.ops,
    input.mSt,
    input.tSt,
    [],
    baseResult.blocks,
    input.machines,
    input.TM,
    input.focusIds,
    input.tools,
  );
  const autoMvs = decs.filter((d) => d.type === 'replan' && d.action).map((d) => d.action!);
  if (autoMvs.length > 0) {
    const autoResult = scheduleAll(buildScheduleInput(input, autoMvs, rule));
    const autoM = scoreSchedule(
      autoResult.blocks,
      input.ops,
      input.mSt,
      input.workforceConfig,
      input.machines,
      input.TM,
      input.weights,
      input.baselineBlocks,
      input.nDays,
    );
    top.push({ ...autoM, moves: [...autoMvs], blocks: autoResult.blocks, label: 'Auto-Replan' });
  }

  // 4. Iterative improvement
  return {
    moveable: mvbl,
    top,
    N,
    run: (onBatch: (results: OptResult[]) => void, onProgress?: (pct: number) => void) => {
      const initial = [...top].sort((a, b) => b.score - a.score)[0];
      let bestMoves = [...initial.moves];
      let bestBlocks = initial.blocks;
      let bestScore = initial.score;

      // Synchronous iteration (no setTimeout — caller manages scheduling)
      for (let i = 0; i < N; i++) {
        const candidate = improveIteration(bestMoves, input, rng, i);
        if (candidate.score > bestScore) {
          bestMoves = candidate.moves;
          bestBlocks = candidate.blocks;
          bestScore = candidate.score;
        }
        if (onProgress && (i + 1) % 25 === 0) {
          onProgress(Math.round(((i + 1) / N) * 100));
        }
      }

      // Build final top-K
      const results: OptResult[] = [...top];
      if (bestScore > initial.score) {
        const improved = scoreSchedule(
          bestBlocks,
          input.ops,
          input.mSt,
          input.workforceConfig,
          input.machines,
          input.TM,
          input.weights,
          input.baselineBlocks,
          input.nDays,
        );
        results.push({ ...improved, moves: bestMoves, blocks: bestBlocks, label: 'Otimizado' });
      }
      results.sort((a, b) => b.score - a.score);
      const seen = new Set<string>();
      const unique: OptResult[] = [];
      results.forEach((r) => {
        const sig = r.moves
          .map((m) => `${m.opId}→${m.toM}`)
          .sort()
          .join('|');
        if (!seen.has(sig)) {
          seen.add(sig);
          unique.push(r);
        }
      });
      onBatch(unique.slice(0, K));
    },
  };
}
