// Tests for UCB1 Multi-Armed Bandit Selector
// Conforme Contrato C5

import { beforeEach, describe, expect, it } from 'vitest';
import type { UCB1State } from '../src/scheduler/ucb1-selector.js';
import { DISPATCH_BANDIT, UCB1Selector } from '../src/scheduler/ucb1-selector.js';
import type { DispatchRule } from '../src/types/kpis.js';

const ALL_RULES: DispatchRule[] = ['ATCS', 'EDD', 'CR', 'SPT', 'WSPT'];

describe('UCB1Selector', () => {
  let selector: UCB1Selector;

  beforeEach(() => {
    selector = new UCB1Selector();
  });

  it('round-robins on fresh state (first 5 calls return each rule once)', () => {
    const selected: DispatchRule[] = [];
    for (let i = 0; i < 5; i++) {
      const rule = selector.select();
      selected.push(rule);
      selector.update(rule, 0.5);
    }
    expect(new Set(selected).size).toBe(5);
    for (const rule of ALL_RULES) {
      expect(selected).toContain(rule);
    }
  });

  it('select() returns best UCB1 arm after updates', () => {
    // Complete round-robin
    for (const rule of ALL_RULES) {
      selector.update(rule, 0.1);
    }
    // Give ATCS a much higher reward
    for (let i = 0; i < 20; i++) {
      selector.update('ATCS', 0.95);
    }
    // With c=0 (pure exploitation), ATCS should be selected
    const greedy = new UCB1Selector(undefined, 0);
    greedy.importState(selector.exportState());
    expect(greedy.select()).toBe('ATCS');
  });

  it('update() increments pull count and total reward', () => {
    selector.update('ATCS', 0.8);
    const stats = selector.getStats();
    const atcs = stats.find((s) => s.rule === 'ATCS')!;
    expect(atcs.pulls).toBe(1);
    expect(atcs.avgReward).toBeCloseTo(0.8);
  });

  it('update() with high reward biases future selection', () => {
    for (const rule of ALL_RULES) {
      selector.update(rule, rule === 'EDD' ? 0.99 : 0.01);
    }
    for (let i = 0; i < 50; i++) {
      selector.update('EDD', 0.99);
    }
    const lowExplore = new UCB1Selector(undefined, 0.01);
    lowExplore.importState(selector.exportState());
    expect(lowExplore.select()).toBe('EDD');
  });

  it('exploration vs exploitation — low-pull arm gets selected with high c', () => {
    for (const rule of ALL_RULES) {
      selector.update(rule, 0.5);
    }
    for (let i = 0; i < 100; i++) {
      selector.update('ATCS', 0.5);
    }
    const highExplore = new UCB1Selector(undefined, 10);
    highExplore.importState(selector.exportState());
    const selected = highExplore.select();
    expect(selected).not.toBe('ATCS');
  });

  it('reset() clears all arm statistics', () => {
    for (const rule of ALL_RULES) {
      selector.update(rule, 0.5);
    }
    selector.reset();
    const stats = selector.getStats();
    for (const stat of stats) {
      expect(stat.pulls).toBe(0);
      expect(stat.avgReward).toBe(0);
    }
  });

  it('exportState() returns serializable state', () => {
    selector.update('ATCS', 0.8);
    selector.update('EDD', 0.6);
    const state = selector.exportState();
    expect(state.totalPulls).toBe(2);
    expect(state.arms).toHaveLength(5);
    const json = JSON.stringify(state);
    const parsed: UCB1State = JSON.parse(json);
    expect(parsed.totalPulls).toBe(2);
    expect(parsed.arms.find((a) => a.rule === 'ATCS')!.totalReward).toBeCloseTo(0.8);
  });

  it('importState() restores previous state', () => {
    selector.update('ATCS', 0.9);
    selector.update('EDD', 0.3);
    const state = selector.exportState();

    const newSelector = new UCB1Selector();
    newSelector.importState(state);
    const stats = newSelector.getStats();
    expect(stats.find((s) => s.rule === 'ATCS')!.pulls).toBe(1);
    expect(stats.find((s) => s.rule === 'ATCS')!.avgReward).toBeCloseTo(0.9);
  });

  it('getStats() returns per-arm diagnostics', () => {
    for (const rule of ALL_RULES) {
      selector.update(rule, 0.5);
    }
    const stats = selector.getStats();
    expect(stats).toHaveLength(5);
    for (const stat of stats) {
      expect(stat).toHaveProperty('rule');
      expect(stat).toHaveProperty('avgReward');
      expect(stat).toHaveProperty('pulls');
      expect(stat).toHaveProperty('ucbScore');
      expect(stat.pulls).toBe(1);
      expect(stat.avgReward).toBeCloseTo(0.5);
    }
  });

  it('c=0 is pure exploitation (greedy)', () => {
    const greedy = new UCB1Selector(undefined, 0);
    for (const rule of ALL_RULES) {
      greedy.update(rule, rule === 'CR' ? 1.0 : 0.0);
    }
    for (let i = 0; i < 10; i++) {
      expect(greedy.select()).toBe('CR');
      greedy.update('CR', 1.0);
    }
  });

  it('custom rules subset works', () => {
    const subset: DispatchRule[] = ['EDD', 'ATCS'];
    const custom = new UCB1Selector(subset);
    const stats = custom.getStats();
    expect(stats).toHaveLength(2);
    expect(stats.map((s) => s.rule).sort()).toEqual(['ATCS', 'EDD']);
  });

  it('DISPATCH_BANDIT singleton exists and works', () => {
    expect(DISPATCH_BANDIT).toBeInstanceOf(UCB1Selector);
    const rule = DISPATCH_BANDIT.select();
    expect(ALL_RULES).toContain(rule);
  });

  it('negative reward handled correctly', () => {
    selector.update('ATCS', -0.5);
    const stats = selector.getStats();
    const atcs = stats.find((s) => s.rule === 'ATCS')!;
    expect(atcs.avgReward).toBeCloseTo(-0.5);
    expect(atcs.pulls).toBe(1);
  });

  it('1000 iterations converges to best arm', () => {
    const convergence = new UCB1Selector(undefined, Math.SQRT2);
    for (const rule of ALL_RULES) {
      convergence.update(rule, 0.5);
    }
    for (let i = 0; i < 1000; i++) {
      const rule = convergence.select();
      const reward = rule === 'WSPT' ? 0.9 : 0.1;
      convergence.update(rule, reward);
    }
    const stats = convergence.getStats();
    const wspt = stats.find((s) => s.rule === 'WSPT')!;
    const maxPulls = Math.max(...stats.map((s) => s.pulls));
    expect(wspt.pulls).toBe(maxPulls);
    expect(wspt.pulls).toBeGreaterThan(500);
  });

  it('update unknown rule throws', () => {
    expect(() => selector.update('UNKNOWN' as DispatchRule, 0.5)).toThrow('unknown rule');
  });
});
