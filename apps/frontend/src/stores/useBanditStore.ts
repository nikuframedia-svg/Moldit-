/**
 * useBanditStore — Persistence layer for UCB1 dispatch rule bandit.
 *
 * Saves bandit arm statistics to localStorage so learning persists across sessions.
 * Snapshots each plan's dispatch rule + KPIs so the next run can compute rewards.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DispatchRule as EngineDispatchRule, UCB1State } from '../lib/engine';
import { DISPATCH_BANDIT } from '../lib/engine';

// ── Types ──

interface PlanSnapshot {
  dispatchRule: EngineDispatchRule;
  otd: number;
  otdDelivery: number;
  tardinessDays: number;
}

interface BanditState {
  /** Last plan's KPIs for comparison on next run */
  lastSnapshot: PlanSnapshot | null;
  /** Serialized UCB1 state for persistence */
  banditState: UCB1State | null;
  actions: BanditActions;
}

interface BanditActions {
  /** Save current plan metrics after pipeline run */
  snapshotCurrentPlan: (
    rule: EngineDispatchRule,
    metrics: { otd: number; otdDelivery: number; tardinessDays: number },
  ) => void;
  /** Compare previous snapshot with current results and update bandit */
  processLearning: (currentMetrics: {
    otd: number;
    otdDelivery: number;
    tardinessDays: number;
  }) => void;
  /** Reset all bandit statistics */
  resetBandit: () => void;
}

// ── Helpers ──

function persistBanditState(set: (s: Partial<BanditState>) => void): void {
  set({ banditState: DISPATCH_BANDIT.exportState() });
}

function restoreBanditState(state: UCB1State | null): void {
  if (state && state.arms?.length > 0) {
    DISPATCH_BANDIT.importState(state);
  }
}

// ── Store ──

export const useBanditStore = create<BanditState>()(
  persist(
    (set, get) => {
      return {
        lastSnapshot: null,
        banditState: null,

        actions: {
          snapshotCurrentPlan: (rule, metrics) => {
            set({
              lastSnapshot: {
                dispatchRule: rule,
                otd: metrics.otd,
                otdDelivery: metrics.otdDelivery,
                tardinessDays: metrics.tardinessDays,
              },
            });
          },

          processLearning: (currentMetrics) => {
            const { lastSnapshot } = get();
            if (!lastSnapshot) return;

            // Reward = OTD delivery score normalized to 0-1
            const reward = currentMetrics.otdDelivery / 100;
            DISPATCH_BANDIT.update(lastSnapshot.dispatchRule, reward);
            persistBanditState(set);
          },

          resetBandit: () => {
            DISPATCH_BANDIT.reset();
            set({ banditState: DISPATCH_BANDIT.exportState(), lastSnapshot: null });
          },
        },
      };
    },
    {
      name: 'pp1-bandit-state',
      partialize: ({ actions: _, ...data }) => data,
    },
  ),
);

// Restore bandit singleton from persisted state on module load
const persisted = useBanditStore.getState().banditState;
restoreBanditState(persisted);
