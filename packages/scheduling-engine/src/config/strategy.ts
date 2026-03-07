// =====================================================================
//  INCOMPOL PLAN -- Scheduling Strategy Pattern
//
//  Pluggable scoring strategies for dispatch decisions.
//  Each strategy scores a job-machine pair; higher = better.
//  WeightedCompositeStrategy combines multiple strategies.
//
//  Pure module -- no side effects.
// =====================================================================

import { DAY_CAP } from '../constants.js';
import type { SchedulingConfig } from './scheduling-config.js';

// ── Scoring Context ─────────────────────────────────────

/** Context passed to strategy scorers */
export interface SchedulingContext {
  /** Current scheduling cursor: day index */
  currentDay: number;
  /** Number of scheduling days */
  nDays: number;
  /** Average production time across all jobs on this machine */
  avgProdMin: number;
  /** Average setup time across all jobs on this machine */
  avgSetupMin: number;
  /** Previous tool ID on this machine (for setup detection) */
  previousToolId: string | null;
  /** Machine utilization so far (0-1) */
  machineUtil: number;
}

/** Minimal job representation for scoring */
export interface ScoringJob {
  /** Operation ID */
  opId: string;
  /** Tool ID */
  toolId: string;
  /** Production time in minutes */
  prodMin: number;
  /** Setup time in minutes (if tool change required) */
  setupMin: number;
  /** Deadline as day index (EDD) */
  eddDay: number;
  /** Machine ID */
  machineId: string;
}

// ── Strategy Interface ──────────────────────────────────

export interface SchedulingStrategy {
  readonly name: string;
  /** Score a job on a machine. Higher = higher priority. */
  score(job: ScoringJob, ctx: SchedulingContext): number;
}

// ── Concrete Strategies ─────────────────────────────────

/**
 * MaxOTDStrategy: prioritize jobs closest to their deadline.
 * Score = inverse of slack (time remaining before deadline).
 * Overdue jobs get maximum priority.
 */
export class MaxOTDStrategy implements SchedulingStrategy {
  readonly name = 'MaxOTD';

  score(job: ScoringJob, ctx: SchedulingContext): number {
    const deadlineMin = job.eddDay * DAY_CAP;
    const currentMin = ctx.currentDay * DAY_CAP;
    const slack = deadlineMin - currentMin - job.prodMin;

    if (slack <= 0) return 1000; // overdue → max priority
    return 100 / (1 + slack / DAY_CAP);
  }
}

/**
 * MinSetupsStrategy: prioritize jobs that avoid tool changeovers.
 * Same tool as previous = high score. Different tool = penalized by setup time.
 */
export class MinSetupsStrategy implements SchedulingStrategy {
  readonly name = 'MinSetups';

  score(job: ScoringJob, ctx: SchedulingContext): number {
    if (ctx.previousToolId === null) return 50; // neutral if first job
    if (job.toolId === ctx.previousToolId) return 100; // no changeover
    // Penalize proportionally to setup time
    const penalty = ctx.avgSetupMin > 0 ? job.setupMin / ctx.avgSetupMin : 0;
    return Math.max(0, 100 - 50 * penalty);
  }
}

/**
 * BalancedStrategy: combine urgency and setup cost.
 * Uses simplified ATCS-like formula without k1/k2 tuning.
 */
export class BalancedStrategy implements SchedulingStrategy {
  readonly name = 'Balanced';

  score(job: ScoringJob, ctx: SchedulingContext): number {
    // Urgency term
    const deadlineMin = job.eddDay * DAY_CAP;
    const currentMin = ctx.currentDay * DAY_CAP;
    const slack = Math.max(deadlineMin - currentMin - job.prodMin, 0);
    const avgP = Math.max(ctx.avgProdMin, 1);
    const urgency = Math.exp(-slack / (1.5 * avgP));

    // Setup term
    const sameToolBonus = ctx.previousToolId && job.toolId === ctx.previousToolId ? 1 : 0;
    const avgS = Math.max(ctx.avgSetupMin, 1);
    const setupTerm = sameToolBonus === 1 ? 1 : Math.exp(-job.setupMin / (0.5 * avgS));

    // SPT term (shorter processing time = better)
    const spt = 1 / Math.max(job.prodMin, 1);

    return spt * urgency * setupTerm * 10000;
  }
}

// ── Weighted Composite ──────────────────────────────────

interface WeightedEntry {
  strategy: SchedulingStrategy;
  weight: number;
}

/**
 * Combines N strategies with configurable weights.
 * Final score = sum(weight_i * normalize(score_i)).
 */
export class WeightedCompositeStrategy implements SchedulingStrategy {
  readonly name = 'WeightedComposite';
  private readonly entries: WeightedEntry[];

  constructor(entries: WeightedEntry[]) {
    this.entries = entries;
  }

  score(job: ScoringJob, ctx: SchedulingContext): number {
    let total = 0;
    for (const { strategy, weight } of this.entries) {
      total += weight * strategy.score(job, ctx);
    }
    return total;
  }
}

// ── Strategy Factory ────────────────────────────────────

/**
 * Build a SchedulingStrategy from a SchedulingConfig.
 * Uses the config weights to create a WeightedCompositeStrategy.
 */
export function strategyFromConfig(config: SchedulingConfig): SchedulingStrategy {
  const { otd, setup, utilization: _util } = config.weights;

  // If one weight dominates (>= 0.8), use the focused strategy
  if (otd >= 0.8) return new MaxOTDStrategy();
  if (setup >= 0.8) return new MinSetupsStrategy();

  // Otherwise, compose with weights
  return new WeightedCompositeStrategy([
    { strategy: new MaxOTDStrategy(), weight: otd },
    { strategy: new MinSetupsStrategy(), weight: setup },
    { strategy: new BalancedStrategy(), weight: 1 - otd - setup },
  ]);
}
