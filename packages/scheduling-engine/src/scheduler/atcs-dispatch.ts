// =====================================================================
//  INCOMPOL PLAN -- ATCS (Apparent Tardiness Cost with Setups)
//  Dispatch rule that balances deadline urgency with setup-awareness.
//  Grid search over k1/k2 parameters to find optimal tuning.
//
//  Pure functions -- no React, no side effects.
// =====================================================================

import type { ScoreWeights } from '../analysis/score-schedule.js';
import { scoreSchedule } from '../analysis/score-schedule.js';
import { DAY_CAP } from '../constants.js';
import { DEFAULT_WORKFORCE_CONFIG } from '../types/workforce.js';
import type { ToolGroup } from './demand-grouper.js';
import type { ScheduleAllInput } from './scheduler.js';
import { scheduleAll } from './scheduler.js';

// ── Types ──────────────────────────────────────────────────────────

export interface ATCSParams {
  /** Slack sensitivity: higher = more tolerant of slack (0.5-3.0) */
  k1: number;
  /** Setup sensitivity: higher = more tolerant of setup time (0.1-1.0) */
  k2: number;
}

export const DEFAULT_ATCS_PARAMS: ATCSParams = { k1: 1.5, k2: 0.5 };

export interface GridResult {
  k1: number;
  k2: number;
  score: number;
  tardinessDays: number;
}

// ── ATCS Priority ──────────────────────────────────────────────────

/**
 * Compute ATCS priority index for a ToolGroup.
 *
 * Formula:
 *   I(g) = (1/p) × exp(-max(slack, 0) / (k1 × p̄)) × exp(-s / (k2 × s̄))
 *
 * where:
 *   p     = group processing time (totalProdMin)
 *   slack = edd × DAY_CAP - p (time until deadline minus processing)
 *   s     = setup time (setupMin; 0 if same tool as previous)
 *   p̄     = average processing time across all groups
 *   s̄     = average setup time across all groups
 *
 * Higher priority = schedule first.
 */
export function atcsPriority(
  group: ToolGroup,
  previousToolId: string | null,
  params: ATCSParams,
  avgProdMin: number,
  avgSetupMin: number,
): number {
  const p = Math.max(group.totalProdMin, 1); // guard against zero
  const slack = Math.max(group.edd * DAY_CAP - p, 0);
  const setupMin = previousToolId != null && previousToolId === group.toolId ? 0 : group.setupMin;

  // Term 1: weight / processing time (higher throughput = higher priority)
  const term1 = 1 / p;

  // Term 2: urgency — exp(-slack / (k1 × avgP))
  // Zero slack → term2 = 1 (max urgency). Large slack → term2 → 0.
  const denom1 = params.k1 * Math.max(avgProdMin, 1);
  const term2 = Math.exp(-slack / denom1);

  // Term 3: setup cost — exp(-setup / (k2 × avgSetup))
  // Zero setup → term3 = 1 (no penalty). Large setup → term3 → 0.
  const denom2 = params.k2 * Math.max(avgSetupMin, 1);
  const term3 = Math.exp(-setupMin / denom2);

  return term1 * term2 * term3;
}

/**
 * Compute average processing and setup times for a set of groups.
 * Used to normalize ATCS terms.
 */
export function computeATCSAverages(groups: ToolGroup[]): {
  avgProdMin: number;
  avgSetupMin: number;
} {
  if (groups.length === 0) return { avgProdMin: 1, avgSetupMin: 1 };

  const totalProd = groups.reduce((s, g) => s + g.totalProdMin, 0);
  const totalSetup = groups.reduce((s, g) => s + g.setupMin, 0);

  return {
    avgProdMin: Math.max(totalProd / groups.length, 1),
    avgSetupMin: Math.max(totalSetup / groups.length, 1),
  };
}

// ── Grid Search ────────────────────────────────────────────────────

const K1_VALUES = [0.5, 1.0, 1.5, 2.0, 3.0];
const K2_VALUES = [0.1, 0.25, 0.5, 0.75, 1.0];

/**
 * Grid search over k1/k2 parameter space.
 * For each combination, runs full scheduling pipeline and scores result.
 * Returns the combination with lowest weighted tardiness.
 *
 * @param baseInput   - Scheduling input (rule will be overridden to 'ATCS')
 * @param scoreWeights - Score weights for evaluation (default: tardiness-focused)
 * @returns Best params, best score, and all 25 results
 */
export function atcsGridSearch(
  baseInput: ScheduleAllInput,
  scoreWeights?: ScoreWeights,
): { bestParams: ATCSParams; bestScore: number; results: GridResult[] } {
  const results: GridResult[] = [];
  let bestScore = Infinity;
  let bestParams: ATCSParams = DEFAULT_ATCS_PARAMS;

  for (const k1 of K1_VALUES) {
    for (const k2 of K2_VALUES) {
      const input: ScheduleAllInput = {
        ...baseInput,
        rule: 'ATCS',
        atcsParams: { k1, k2 },
      };

      const schedResult = scheduleAll(input);
      const wfc = input.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG;
      const score = scoreSchedule(
        schedResult.blocks,
        input.ops,
        input.mSt,
        wfc,
        input.machines,
        input.toolMap,
        scoreWeights,
        schedResult.blocks, // baseline = self (no churn penalty)
        input.nDays,
      );

      const tardinessDays = score.tardinessDays;
      // Use tardinessDays as primary metric, composite score as tiebreak
      const metric = tardinessDays * 1e6 + score.score;

      results.push({ k1, k2, score: score.score, tardinessDays });

      if (metric < bestScore) {
        bestScore = metric;
        bestParams = { k1, k2 };
      }
    }
  }

  return { bestParams, bestScore: bestScore, results };
}
