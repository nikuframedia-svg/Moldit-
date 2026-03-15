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

import { genDecisions } from '../analysis/gen-decisions.js';
import type { ScoreWeights } from '../analysis/score-schedule.js';
import { scoreSchedule } from '../analysis/score-schedule.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { Block } from '../types/blocks.js';
import type { EMachine, EOp, ETool } from '../types/engine.js';
import type { ResourceTimeline } from '../types/failure.js';
import type { DispatchRule, OptResult } from '../types/kpis.js';
import type { TwinValidationReport } from '../types/twin.js';
import type { WorkforceConfig } from '../types/workforce.js';
import { mulberry32 } from '../utils/prng.js';
import { buildScheduleInput, improveIteration } from './neighborhoods.js';

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

// ── Re-export twoOptResequence for public API ────────────

export { twoOptResequence } from './two-opt.js';

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
