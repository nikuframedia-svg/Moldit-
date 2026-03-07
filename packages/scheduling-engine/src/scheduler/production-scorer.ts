// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Production Scorer
//  Deterministic scoring for operation ordering.
//
//  Lexicographic composite score:
//    P0 (1e9): urgency tier (slack < 0 → overdue, < 1d → critical, etc.)
//    P1 (1e6): -slackTimeMin (smaller slack = higher score)
//    P2 (1e3): setup penalty (different tool from previous → penalty)
//    P3 (1e0): anticipation incentive (high density + free capacity)
//
//  Tie-break: opId lexicographic for total determinism.
// ═══════════════════════════════════════════════════════════

import { DAY_CAP } from '../constants.js';
import type { DecisionRegistry } from '../decisions/decision-registry.js';
import type { DeficitEvolution, OperationScore, WorkContent } from '../types/scoring.js';
import type { OperationDeadline } from '../types/shipping.js';

// ── Urgency tiers ─────────────────────────────────────────

const TIER_OVERDUE = 4; // slack < 0
const TIER_CRITICAL = 3; // slack < 1 day (DAY_CAP minutes)
const TIER_TIGHT = 2; // slack < 2 days
const TIER_COMFORTABLE = 1; // slack >= 2 days
const TIER_NO_DEADLINE = 0; // no deadline computed

// ── Score weights ─────────────────────────────────────────

const W_P0 = 1e9; // Urgency tier
const W_P1 = 1e6; // Slack inversion
const W_P2 = 1e3; // Setup penalty
const W_P3 = 1; // Anticipation incentive

// ── Main export ─────────────────────────────────────────────

/**
 * Score all operations for scheduling order.
 *
 * @param workContents  - Map from opId to WorkContent
 * @param deficits      - Map from opId to DeficitEvolution
 * @param deadlines     - Map from opId to OperationDeadline
 * @param currentDay    - Current scheduling position (day index, typically 0)
 * @param nDays         - Total horizon days
 * @param registry      - Optional decision registry for logging
 * @param workdays      - Optional per-day workday flags (used for accurate density calculation)
 * @returns Map from opId to OperationScore, sorted by compositeScore descending
 */
export function scoreOperations(
  workContents: Map<string, WorkContent>,
  deficits: Map<string, DeficitEvolution>,
  deadlines: Map<string, OperationDeadline>,
  currentDay: number,
  nDays: number,
  registry?: DecisionRegistry,
  workdays?: boolean[],
): Map<string, OperationScore> {
  const result = new Map<string, OperationScore>();

  for (const [opId, wc] of workContents) {
    const deadline = deadlines.get(opId);
    const deficit = deficits.get(opId);

    // Slack: time between when production could finish and deadline
    let slackTimeMin: number;
    let deadlineProximityDays: number;

    if (deadline) {
      // Available time = deadline - currentDay start
      const currentDayStartAbs = currentDay * 1440;
      const availableMin = deadline.latestFinishAbs - currentDayStartAbs;
      slackTimeMin = availableMin - wc.workContentMin;
      deadlineProximityDays = (deadline.latestFinishAbs - currentDayStartAbs) / 1440;
    } else {
      // No deadline — generous slack
      slackTimeMin = nDays * DAY_CAP;
      deadlineProximityDays = nDays;
    }

    // Deficit at deadline
    const deficitAtDeadline = deficit
      ? deadline
        ? Math.max(0, -(deficit.dailyDeficit[deadline.shippingDayIdx] ?? 0))
        : deficit.maxDeficit
      : 0;

    // Density: how much of available capacity before deadline is needed
    // Count working days only (weekends have zero capacity)
    let availableDaysBeforeDeadline: number;
    if (deadline && workdays) {
      let count = 0;
      const end = Math.min(deadline.latestFinishDay, workdays.length - 1);
      for (let d = currentDay; d <= end; d++) {
        if (workdays[d]) count++;
      }
      availableDaysBeforeDeadline = Math.max(1, count);
    } else if (deadline) {
      const calendarDays = Math.max(1, deadline.latestFinishDay - currentDay + 1);
      availableDaysBeforeDeadline = Math.max(1, Math.round((calendarDays * 5) / 7));
    } else {
      availableDaysBeforeDeadline = workdays
        ? Math.max(1, workdays.filter((w) => w).length)
        : nDays;
    }
    const availableCapacityHours = availableDaysBeforeDeadline * (DAY_CAP / 60);
    const density = availableCapacityHours > 0 ? wc.workContentHours / availableCapacityHours : 1;

    // P0: Urgency tier
    let tier: number;
    let tierLabel: string;
    if (!deadline) {
      tier = TIER_NO_DEADLINE;
      tierLabel = 'no_deadline';
    } else if (slackTimeMin < 0) {
      tier = TIER_OVERDUE;
      tierLabel = 'overdue';
    } else if (slackTimeMin < DAY_CAP) {
      tier = TIER_CRITICAL;
      tierLabel = 'critical';
    } else if (slackTimeMin < 2 * DAY_CAP) {
      tier = TIER_TIGHT;
      tierLabel = 'tight';
    } else {
      tier = TIER_COMFORTABLE;
      tierLabel = 'comfortable';
    }

    // P1: Slack inversion — less slack = higher score (cap at reasonable range)
    const maxSlackForP1 = nDays * DAY_CAP;
    const clampedSlack = Math.max(-maxSlackForP1, Math.min(slackTimeMin, maxSlackForP1));
    const p1 = (maxSlackForP1 - clampedSlack) / (2 * maxSlackForP1); // normalized 0-1

    // P2: Setup penalty placeholder (0 for now — applied during per-machine ordering)
    const p2 = 0;

    // P3: Anticipation incentive — high density benefits from earlier start
    const p3 = Math.min(density, 1); // cap at 1

    // Composite score
    const compositeScore = tier * W_P0 + p1 * W_P1 + p2 * W_P2 + p3 * W_P3;

    // Human-readable justification
    const justification = `tier=${tierLabel}, slack=${Math.round(slackTimeMin)}min, density=${(density * 100).toFixed(0)}%, deficit=${deficitAtDeadline}pcs, work=${wc.workContentHours.toFixed(1)}h`;

    const score: OperationScore = {
      opId,
      slackTimeMin,
      deficitAtDeadline,
      deadlineProximityDays,
      workContentHours: wc.workContentHours,
      density,
      compositeScore,
      justification,
    };

    result.set(opId, score);

    if (registry) {
      registry.record({
        type: 'SCORING_DECISION',
        opId,
        detail: `Op ${opId}: score=${compositeScore.toFixed(0)} — ${justification}`,
        metadata: {
          tier: tierLabel,
          slackTimeMin: Math.round(slackTimeMin),
          density: +density.toFixed(4),
          deficitAtDeadline,
          compositeScore: +compositeScore.toFixed(2),
        },
      });
    }
  }

  return result;
}

// ── Sort groups by score ─────────────────────────────────────

/**
 * Sort tool groups using deterministic scoring.
 *
 * Each group's score is the MAX score among its operations.
 * Groups with higher scores are scheduled first.
 * Tie-break: toolId lexicographic for determinism.
 *
 * @param groups - Tool groups to sort
 * @param scores - Operation scores from scoreOperations()
 * @returns New sorted array (original not mutated)
 */
export function sortGroupsByScore(
  groups: { toolId: string; skus: { opId: string }[] }[],
  scores: Map<string, OperationScore>,
): typeof groups {
  return [...groups].sort((a, b) => {
    const scoreA = Math.max(0, ...a.skus.map((s) => scores.get(s.opId)?.compositeScore ?? 0));
    const scoreB = Math.max(0, ...b.skus.map((s) => scores.get(s.opId)?.compositeScore ?? 0));

    if (scoreA !== scoreB) return scoreB - scoreA; // Higher score first
    return a.toolId.localeCompare(b.toolId); // Deterministic tie-break
  });
}
