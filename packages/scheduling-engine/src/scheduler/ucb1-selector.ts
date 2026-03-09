// =====================================================================
//  INCOMPOL PLAN -- UCB1 Multi-Armed Bandit for Dispatch Rule Selection
//
//  Adaptive selection of dispatch rules (ATCS, EDD, CR, SPT, WSPT)
//  using UCB1 (Upper Confidence Bound) algorithm.
//
//  Formula: Q̂(a) + c · √(ln(t) / n(a))
//  where Q̂(a) = average reward of arm a,
//        t = total pulls across all arms,
//        n(a) = pulls of arm a,
//        c = exploration constant (default √2 ≈ 1.41).
//
//  Pure module -- no side effects, no browser APIs.
// =====================================================================

import type { DispatchRule } from '../types/kpis.js';

// ── Types ─────────────────────────────────────────────────

export interface UCB1Arm {
  rule: DispatchRule;
  totalReward: number;
  pulls: number;
}

export interface UCB1State {
  arms: UCB1Arm[];
  totalPulls: number;
}

export interface UCB1ArmStats {
  rule: DispatchRule;
  avgReward: number;
  pulls: number;
  ucbScore: number;
}

// ── Default arms ──────────────────────────────────────────

const ALL_RULES: DispatchRule[] = ['ATCS', 'EDD', 'CR', 'SPT', 'WSPT'];

function makeArms(rules: DispatchRule[]): UCB1Arm[] {
  return rules.map((rule) => ({ rule, totalReward: 0, pulls: 0 }));
}

// ── UCB1 Selector ─────────────────────────────────────────

export class UCB1Selector {
  private state: UCB1State;
  private readonly c: number;
  private roundRobinIdx: number;

  constructor(rules?: DispatchRule[], c?: number) {
    const arms = makeArms(rules && rules.length > 0 ? rules : ALL_RULES);
    this.state = { arms, totalPulls: 0 };
    this.c = c ?? Math.SQRT2;
    this.roundRobinIdx = 0;
  }

  /** Select best arm via UCB1 formula. Returns dispatch rule. */
  select(): DispatchRule {
    const { arms } = this.state;

    // Round-robin phase: ensure each arm tried at least once
    if (this.roundRobinIdx < arms.length) {
      return arms[this.roundRobinIdx].rule;
    }

    // UCB1 selection
    let bestScore = -Infinity;
    let bestArm = arms[0];

    for (const arm of arms) {
      const score = this.ucbScore(arm);
      if (score > bestScore) {
        bestScore = score;
        bestArm = arm;
      }
    }

    return bestArm.rule;
  }

  /** Update arm reward after observing schedule score. */
  update(rule: DispatchRule, reward: number): void {
    const arm = this.state.arms.find((a) => a.rule === rule);
    if (!arm) {
      throw new Error(`UCB1: unknown rule "${rule}"`);
    }

    arm.totalReward += reward;
    arm.pulls += 1;
    this.state.totalPulls += 1;

    // Advance round-robin if we're in that phase
    if (
      this.roundRobinIdx < this.state.arms.length &&
      arm.rule === this.state.arms[this.roundRobinIdx].rule
    ) {
      this.roundRobinIdx++;
    }
  }

  /** Reset all arm statistics. */
  reset(): void {
    for (const arm of this.state.arms) {
      arm.totalReward = 0;
      arm.pulls = 0;
    }
    this.state.totalPulls = 0;
    this.roundRobinIdx = 0;
  }

  /** Export state for persistence (JSON serializable). */
  exportState(): UCB1State {
    return {
      arms: this.state.arms.map((a) => ({ ...a })),
      totalPulls: this.state.totalPulls,
    };
  }

  /** Import previously saved state. */
  importState(state: UCB1State): void {
    this.state = {
      arms: state.arms.map((a) => ({ ...a })),
      totalPulls: state.totalPulls,
    };
    // Set round-robin past initial phase if all arms have been pulled
    const allPulled = this.state.arms.every((a) => a.pulls > 0);
    this.roundRobinIdx = allPulled ? this.state.arms.length : 0;
  }

  /** Get average reward per arm (for diagnostics). */
  getStats(): UCB1ArmStats[] {
    return this.state.arms.map((arm) => ({
      rule: arm.rule,
      avgReward: arm.pulls > 0 ? arm.totalReward / arm.pulls : 0,
      pulls: arm.pulls,
      ucbScore: this.ucbScore(arm),
    }));
  }

  private ucbScore(arm: UCB1Arm): number {
    if (arm.pulls === 0) return Infinity;
    const avgReward = arm.totalReward / arm.pulls;
    const exploration = this.c * Math.sqrt(Math.log(this.state.totalPulls) / arm.pulls);
    return avgReward + exploration;
  }
}

// ── Singleton ─────────────────────────────────────────────

export const DISPATCH_BANDIT = new UCB1Selector();
