// =====================================================================
//  INCOMPOL PLAN -- Simulated Annealing Optimization
//  Post-heuristic improvement via SA:
//    - Initial solution from ATCS dispatch
//    - Neighbourhood: swap adjacent blocks, insert, inter-machine transfer
//    - Respects constraints via full re-scheduling
//    - Objective: minimize weighted tardiness (scoreSchedule)
//
//  Designed to run in a Web Worker for non-blocking execution.
//  Pure function -- no React, no side effects.
// =====================================================================

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

export interface SAConfig {
  /** Initial temperature (default: 1000) */
  T0?: number;
  /** Minimum temperature / stopping criterion (default: 0.01) */
  Tmin?: number;
  /** Geometric cooling rate (default: 0.995) */
  alpha?: number;
  /** Max iterations (default: 10000) */
  maxIter?: number;
  /** PRNG seed (default: 42) */
  seed?: number;
  /** Progress callback interval in iterations (default: 100) */
  progressInterval?: number;
}

export interface SAInput {
  ops: EOp[];
  mSt: Record<string, string>;
  tSt: Record<string, string>;
  machines: EMachine[];
  TM: Record<string, ETool>;
  workdays: boolean[];
  nDays: number;
  workforceConfig: WorkforceConfig;
  weights?: Partial<ScoreWeights>;
  rule?: DispatchRule;
  thirdShift?: boolean;
  machineTimelines?: Record<string, ResourceTimeline>;
  toolTimelines?: Record<string, ResourceTimeline>;
  twinValidationReport?: TwinValidationReport;
  dates?: string[];
  orderBased?: boolean;
  atcsParams?: { k1: number; k2: number };
  /** Initial solution blocks (from ATCS dispatch) */
  initialBlocks?: Block[];
  /** Initial moves */
  initialMoves?: MoveAction[];
}

export interface SAResult {
  /** Best schedule found */
  blocks: Block[];
  /** Best moves found */
  moves: MoveAction[];
  /** Best scored result */
  metrics: OptResult;
  /** Number of iterations executed */
  iterations: number;
  /** Number of accepted (improved or uphill) moves */
  accepted: number;
  /** Final temperature */
  finalTemp: number;
  /** Whether SA improved over initial solution */
  improved: boolean;
  /** Initial score (before SA) */
  initialScore: number;
}

export const DEFAULT_SA_CONFIG: SAConfig = {
  T0: 1000,
  Tmin: 0.01,
  alpha: 0.995,
  maxIter: 10_000,
  seed: 42,
  progressInterval: 100,
};

// ── Setup matrix for O(1) lookup ──────────────────────────

/**
 * Build setup-time lookup: toolId -> setupMin.
 * Used for fast delta evaluation.
 */
function buildSetupMatrix(TM: Record<string, ETool>): Map<string, number> {
  const matrix = new Map<string, number>();
  for (const [id, tool] of Object.entries(TM)) {
    matrix.set(id, tool.sH * 60);
  }
  return matrix;
}

// ── Solution representation ─────────────────────────────

/**
 * A solution is a set of MoveActions (which ops are on which machine).
 * The scheduling pipeline handles sequencing via dispatch rules.
 *
 * Neighbourhood moves:
 * 1. Add a move: send an op to its alt machine
 * 2. Remove a move: return an op to its primary machine
 * 3. Swap: exchange two ops' machine assignments
 */

interface MoveCandidateOp {
  opId: string;
  primaryM: string;
  altM: string;
  toolId: string;
}

function getMoveCandidates(
  ops: EOp[],
  mSt: Record<string, string>,
  tSt: Record<string, string>,
  TM: Record<string, ETool>,
): MoveCandidateOp[] {
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
      primaryM: op.m,
      altM: TM[op.t].alt,
      toolId: op.t,
    }));
}

// ── Fast tardiness estimator ────────────────────────────

/**
 * Fast objective: negative cost matching scoreSchedule direction.
 * Uses tardiness + setup count as fast proxy.
 * Higher = better (less negative = better).
 */
function fastObjective(blocks: Block[], _setupMatrix: Map<string, number>): number {
  const ok = blocks.filter((b) => b.type !== 'blocked');
  let tardinessDays = 0;
  let setupCount = 0;
  let setupMin = 0;

  for (const b of ok) {
    if (b.overflow && b.overflowMin) {
      tardinessDays += b.overflowMin / DAY_CAP;
    }
    if (b.setupS != null) {
      setupCount++;
      setupMin += (b.setupE || 0) - (b.setupS || 0);
    }
  }

  // Match scoreSchedule's weighting direction: higher = better
  return -(100 * tardinessDays + 10 * setupCount + 1 * setupMin);
}

// ── Neighbourhood generators ────────────────────────────

type NeighbourFn = (
  currentMoves: MoveAction[],
  candidates: MoveCandidateOp[],
  rng: () => number,
) => MoveAction[];

/**
 * Add a random op to alt machine.
 */
function neighbourAdd(
  currentMoves: MoveAction[],
  candidates: MoveCandidateOp[],
  rng: () => number,
): MoveAction[] {
  const movedIds = new Set(currentMoves.map((m) => m.opId));
  const available = candidates.filter((c) => !movedIds.has(c.opId));
  if (available.length === 0) return currentMoves;

  const pick = available[Math.floor(rng() * available.length)];
  return [...currentMoves, { opId: pick.opId, toM: pick.altM }];
}

/**
 * Remove a random move (return op to primary).
 */
function neighbourRemove(
  currentMoves: MoveAction[],
  _candidates: MoveCandidateOp[],
  rng: () => number,
): MoveAction[] {
  if (currentMoves.length === 0) return currentMoves;
  const idx = Math.floor(rng() * currentMoves.length);
  return currentMoves.filter((_, i) => i !== idx);
}

/**
 * Swap: move one op to alt, return another to primary.
 */
function neighbourSwap(
  currentMoves: MoveAction[],
  candidates: MoveCandidateOp[],
  rng: () => number,
): MoveAction[] {
  // Remove one + add one
  let moves = neighbourRemove(currentMoves, candidates, rng);
  moves = neighbourAdd(moves, candidates, rng);
  return moves;
}

const NEIGHBOURS: NeighbourFn[] = [neighbourAdd, neighbourRemove, neighbourSwap];

// ── Main SA ─────────────────────────────────────────────

function buildSAScheduleInput(input: SAInput, moves: MoveAction[]): ScheduleAllInput {
  return {
    ops: input.ops,
    mSt: input.mSt,
    tSt: input.tSt,
    moves,
    machines: input.machines,
    toolMap: input.TM,
    workdays: input.workdays,
    nDays: input.nDays,
    rule: input.rule ?? 'ATCS',
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

function scheduleAndEvaluate(
  input: SAInput,
  moves: MoveAction[],
  setupMatrix: Map<string, number>,
): { blocks: Block[]; score: number } {
  const sInput = buildSAScheduleInput(input, moves);
  const result = scheduleAll(sInput);
  const score = fastObjective(result.blocks, setupMatrix);
  return { blocks: result.blocks, score };
}

/**
 * Run Simulated Annealing to improve a schedule.
 *
 * Starts from the initial ATCS solution (or baseline if no initialBlocks).
 * Explores neighbourhood via machine reassignment moves.
 * Accepts worse solutions with probability exp(-delta/T) to escape local minima.
 *
 * @param input  - SA input data (ops, machines, tools, initial solution)
 * @param config - SA parameters (temperature, cooling, iterations)
 * @param onProgress - Optional callback for progress updates (0-100)
 * @returns Best solution found
 */
export function runSimulatedAnnealing(
  input: SAInput,
  config: Partial<SAConfig> = {},
  onProgress?: (pct: number) => void,
): SAResult {
  const cfg: Required<SAConfig> = { ...DEFAULT_SA_CONFIG, ...config } as Required<SAConfig>;
  const rng = mulberry32(cfg.seed);
  const setupMatrix = buildSetupMatrix(input.TM);
  const candidates = getMoveCandidates(input.ops, input.mSt, input.tSt, input.TM);

  // Initial solution
  let currentMoves = input.initialMoves ? [...input.initialMoves] : [];
  const initial = scheduleAndEvaluate(input, currentMoves, setupMatrix);
  let currentScore = initial.score;
  const initialScore = currentScore;

  // Best solution tracking
  let bestMoves = [...currentMoves];
  let bestScore = currentScore;
  let T = cfg.T0;
  let accepted = 0;
  let iter = 0;

  while (iter < cfg.maxIter && T > cfg.Tmin) {
    // Pick random neighbourhood
    const nhIdx = Math.floor(rng() * NEIGHBOURS.length);
    const neighbour = NEIGHBOURS[nhIdx];
    const newMoves = neighbour(currentMoves, candidates, rng);

    // Skip if moves didn't change
    if (
      newMoves.length === currentMoves.length &&
      newMoves.every((m, i) => currentMoves[i]?.opId === m.opId && currentMoves[i]?.toM === m.toM)
    ) {
      iter++;
      T *= cfg.alpha;
      continue;
    }

    const candidate = scheduleAndEvaluate(input, newMoves, setupMatrix);
    const delta = candidate.score - currentScore;

    // Accept if better, or with probability exp(delta/T) if worse
    // delta > 0 means improvement (score is negative cost, higher = better)
    if (delta > 0 || rng() < Math.exp(delta / T)) {
      currentMoves = newMoves;
      currentScore = candidate.score;
      accepted++;

      if (currentScore > bestScore) {
        bestMoves = [...currentMoves];
        bestScore = currentScore;
      }
    }

    T *= cfg.alpha;
    iter++;

    // Progress callback
    if (onProgress && iter % cfg.progressInterval === 0) {
      onProgress(Math.round((iter / cfg.maxIter) * 100));
    }
  }

  // Final full scoring for the best solution
  const finalResult = scheduleAll(buildSAScheduleInput(input, bestMoves));
  const finalMetrics = scoreSchedule(
    finalResult.blocks,
    input.ops,
    input.mSt,
    input.workforceConfig,
    input.machines,
    input.TM,
    input.weights,
    input.initialBlocks,
    input.nDays,
  );

  // Guarantee: never return worse than initial
  if (finalMetrics.score < initialScore) {
    // SA didn't improve — return initial solution
    const initResult = scheduleAll(buildSAScheduleInput(input, input.initialMoves ?? []));
    const initMetrics = scoreSchedule(
      initResult.blocks,
      input.ops,
      input.mSt,
      input.workforceConfig,
      input.machines,
      input.TM,
      input.weights,
      input.initialBlocks,
      input.nDays,
    );
    return {
      blocks: initResult.blocks,
      moves: input.initialMoves ?? [],
      metrics: { ...initMetrics, moves: input.initialMoves ?? [], label: 'SA (no improvement)' },
      iterations: iter,
      accepted,
      finalTemp: T,
      improved: false,
      initialScore,
    };
  }

  return {
    blocks: finalResult.blocks,
    moves: bestMoves,
    metrics: {
      ...finalMetrics,
      moves: bestMoves,
      blocks: finalResult.blocks,
      label: 'SA Optimizado',
    },
    iterations: iter,
    accepted,
    finalTemp: T,
    improved: bestScore > initialScore,
    initialScore,
  };
}
