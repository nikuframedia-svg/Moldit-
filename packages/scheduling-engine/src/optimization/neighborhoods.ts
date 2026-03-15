// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Optimization Neighborhoods
//  Neighborhood search strategies for iterative improvement:
//  - Swap Tardiness (move tardy ops to alt machines)
//  - Setup Reduction (undo non-forced moves)
//  - Load Balance (equalize load across machines)
//  Extracted from run-optimization.ts
// ═══════════════════════════════════════════════════════════

import { capAnalysis } from '../analysis/cap-analysis.js';
import { scoreSchedule } from '../analysis/score-schedule.js';
import { DAY_CAP } from '../constants.js';
import type { ScheduleAllInput } from '../scheduler/scheduler.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { Block, MoveAction } from '../types/blocks.js';
import type { DispatchRule } from '../types/kpis.js';
import { twoOptResequence } from './two-opt.js';
import type { OptimizationInput } from './run-optimization.js';

// ── Helpers ──────────────────────────────────────────────

export function buildScheduleInput(
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

export function scheduleAndScore(
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

// ── Neighborhood A: Swap Tardiness ───────────────────────

export function neighborhoodSwapTardiness(
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

export function neighborhoodSetupReduction(
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

export function neighborhoodLoadBalance(
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

export function improveIteration(
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
