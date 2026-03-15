/**
 * banditStore.test.ts — Tests for UCB1 bandit persistence and learning loop.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DISPATCH_BANDIT } from '../../lib/engine';
import { useBanditStore } from '../../stores/useBanditStore';

describe('useBanditStore', () => {
  beforeEach(() => {
    // Reset bandit and store between tests
    DISPATCH_BANDIT.reset();
    useBanditStore.setState({ lastSnapshot: null, banditState: null });
  });

  it('snapshotCurrentPlan stores dispatch rule and metrics', () => {
    const { actions } = useBanditStore.getState();
    actions.snapshotCurrentPlan('EDD', { otd: 95, otdDelivery: 92, tardinessDays: 3 });

    const { lastSnapshot } = useBanditStore.getState();
    expect(lastSnapshot).toEqual({
      dispatchRule: 'EDD',
      otd: 95,
      otdDelivery: 92,
      tardinessDays: 3,
    });
  });

  it('processLearning updates bandit with reward from previous snapshot', () => {
    const { actions } = useBanditStore.getState();

    // Snapshot a plan using EDD
    actions.snapshotCurrentPlan('EDD', { otd: 90, otdDelivery: 85, tardinessDays: 5 });

    // Process learning with new metrics
    actions.processLearning({ otd: 88, otdDelivery: 82, tardinessDays: 7 });

    // EDD should have 1 pull with reward = 82/100 = 0.82
    const stats = DISPATCH_BANDIT.getStats();
    const eddArm = stats.find((s) => s.rule === 'EDD');
    expect(eddArm).toBeDefined();
    expect(eddArm!.pulls).toBe(1);
    expect(eddArm!.avgReward).toBeCloseTo(0.82, 2);
  });

  it('processLearning is no-op without previous snapshot', () => {
    const { actions } = useBanditStore.getState();
    actions.processLearning({ otd: 90, otdDelivery: 85, tardinessDays: 5 });

    // No update should have happened
    const stats = DISPATCH_BANDIT.getStats();
    expect(stats.every((s) => s.pulls === 0)).toBe(true);
  });

  it('processLearning persists bandit state', () => {
    const { actions } = useBanditStore.getState();
    actions.snapshotCurrentPlan('ATCS', { otd: 95, otdDelivery: 90, tardinessDays: 2 });
    actions.processLearning({ otd: 93, otdDelivery: 88, tardinessDays: 3 });

    const { banditState } = useBanditStore.getState();
    expect(banditState).not.toBeNull();
    expect(banditState!.totalPulls).toBe(1);
    const atcsArm = banditState!.arms.find((a) => a.rule === 'ATCS');
    expect(atcsArm!.pulls).toBe(1);
  });

  it('resetBandit clears all statistics and snapshot', () => {
    const { actions } = useBanditStore.getState();
    actions.snapshotCurrentPlan('EDD', { otd: 90, otdDelivery: 85, tardinessDays: 5 });
    actions.processLearning({ otd: 88, otdDelivery: 82, tardinessDays: 7 });

    actions.resetBandit();

    const { lastSnapshot, banditState } = useBanditStore.getState();
    expect(lastSnapshot).toBeNull();
    expect(banditState!.totalPulls).toBe(0);
    expect(DISPATCH_BANDIT.getStats().every((s) => s.pulls === 0)).toBe(true);
  });

  it('multiple learning cycles accumulate rewards', () => {
    const { actions } = useBanditStore.getState();

    // Cycle 1: EDD
    actions.snapshotCurrentPlan('EDD', { otd: 90, otdDelivery: 85, tardinessDays: 5 });
    actions.processLearning({ otd: 88, otdDelivery: 80, tardinessDays: 7 });

    // Cycle 2: ATCS
    actions.snapshotCurrentPlan('ATCS', { otd: 92, otdDelivery: 90, tardinessDays: 3 });
    actions.processLearning({ otd: 91, otdDelivery: 88, tardinessDays: 4 });

    // Cycle 3: EDD again
    actions.snapshotCurrentPlan('EDD', { otd: 95, otdDelivery: 95, tardinessDays: 1 });
    actions.processLearning({ otd: 94, otdDelivery: 92, tardinessDays: 2 });

    const stats = DISPATCH_BANDIT.getStats();
    const edd = stats.find((s) => s.rule === 'EDD')!;
    const atcs = stats.find((s) => s.rule === 'ATCS')!;

    expect(edd.pulls).toBe(2);
    expect(atcs.pulls).toBe(1);
    // EDD avg = (0.80 + 0.92) / 2 = 0.86
    expect(edd.avgReward).toBeCloseTo(0.86, 2);
    // ATCS avg = 0.88
    expect(atcs.avgReward).toBeCloseTo(0.88, 2);
  });
});
