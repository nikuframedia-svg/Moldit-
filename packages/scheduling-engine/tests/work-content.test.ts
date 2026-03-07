// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- Work Content & Deficit Evolution Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { DAY_CAP, DEFAULT_OEE } from '../src/constants.js';
import { DecisionRegistry } from '../src/decisions/decision-registry.js';
import { computeDeficitEvolution, computeWorkContent } from '../src/scheduler/work-content.js';
import type { EOp, ETool } from '../src/types/engine.js';

// Helpers
function mkOp(overrides: Partial<EOp> & { id: string; t: string; m: string; d: number[] }): EOp {
  return { sku: 'SKU01', nm: 'Test', atr: 0, ...overrides };
}

function mkTool(overrides: Partial<ETool> & { id: string }): ETool {
  return {
    m: 'M01',
    alt: '-',
    sH: 1,
    pH: 100,
    op: 1,
    lt: 1000,
    stk: 0,
    nm: 'Test',
    ...overrides,
  };
}

function mkToolMap(tools: ETool[]): Record<string, ETool> {
  const map: Record<string, ETool> = {};
  tools.forEach((t) => {
    map[t.id] = t;
  });
  return map;
}

describe('computeWorkContent', () => {
  it('computes basic work content with default OEE', () => {
    const tool = mkTool({ id: 'T01', pH: 1000 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [500, 500, 0], atr: 0 });
    const toolMap = mkToolMap([tool]);

    const result = computeWorkContent([op], toolMap);
    const wc = result.get('OP01')!;

    expect(wc.totalQty).toBe(1000);
    expect(wc.pH).toBe(1000);
    expect(wc.oee).toBe(DEFAULT_OEE);
    expect(wc.oeeSource).toBe('default');
    // workContentHours = 1000 / (1000 * 0.66) ≈ 1.5152
    expect(wc.workContentHours).toBeCloseTo(1000 / (1000 * DEFAULT_OEE), 4);
    expect(wc.workContentMin).toBeCloseTo(wc.workContentHours * 60, 4);
    expect(wc.daysRequired).toBeCloseTo(wc.workContentMin / DAY_CAP, 4);
  });

  it('uses tool-specific OEE when available', () => {
    const tool = mkTool({ id: 'T01', pH: 500, oee: 0.8 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [1000], atr: 0 });
    const toolMap = mkToolMap([tool]);

    const result = computeWorkContent([op], toolMap);
    const wc = result.get('OP01')!;

    expect(wc.oee).toBe(0.8);
    expect(wc.oeeSource).toBe('tool');
    expect(wc.workContentHours).toBeCloseTo(1000 / (500 * 0.8), 4);
  });

  it('includes backlog in total quantity', () => {
    const tool = mkTool({ id: 'T01', pH: 100 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [200, 300], atr: 500 });
    const toolMap = mkToolMap([tool]);

    const result = computeWorkContent([op], toolMap);
    const wc = result.get('OP01')!;

    expect(wc.totalQty).toBe(1000); // 500 backlog + 200 + 300
  });

  it('skips operations with zero total quantity', () => {
    const tool = mkTool({ id: 'T01', pH: 100 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [0, 0, 0], atr: 0 });
    const toolMap = mkToolMap([tool]);

    const result = computeWorkContent([op], toolMap);
    expect(result.size).toBe(0);
  });

  it('skips operations with missing tool', () => {
    const op = mkOp({ id: 'OP01', t: 'T_MISSING', m: 'M01', d: [100] });
    const toolMap = mkToolMap([]);

    const result = computeWorkContent([op], toolMap);
    expect(result.size).toBe(0);
  });

  it('logs CAPACITY_COMPUTATION decisions to registry', () => {
    const tool = mkTool({ id: 'T01', pH: 200 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [1000] });
    const toolMap = mkToolMap([tool]);
    const registry = new DecisionRegistry();

    computeWorkContent([op], toolMap, registry);

    const decisions = registry.getByType('CAPACITY_COMPUTATION');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].opId).toBe('OP01');
    expect(decisions[0].metadata).toMatchObject({
      opId: 'OP01',
      oeeValue: DEFAULT_OEE,
      oeeSource: 'default',
      piecesPerHour: 200,
    });
  });

  it('skips operations with zero OEE (prevents division by zero)', () => {
    const tool = mkTool({ id: 'T01', pH: 100, oee: 0 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [500], atr: 0 });
    const toolMap = mkToolMap([tool]);

    const result = computeWorkContent([op], toolMap);
    expect(result.size).toBe(0); // Skipped because OEE=0
  });

  it('skips operations with negative OEE', () => {
    const tool = mkTool({ id: 'T01', pH: 100, oee: -0.5 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [500], atr: 0 });
    const toolMap = mkToolMap([tool]);

    const result = computeWorkContent([op], toolMap);
    expect(result.size).toBe(0);
  });

  it('handles low OEE (0.66) correctly — increases work content', () => {
    const tool = mkTool({ id: 'T01', pH: 1681, oee: 0.66 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [15600] });
    const toolMap = mkToolMap([tool]);

    const result = computeWorkContent([op], toolMap);
    const wc = result.get('OP01')!;

    // workContentHours = 15600 / (1681 * 0.66) = 15600 / 1109.46 ≈ 14.06
    expect(wc.workContentHours).toBeCloseTo(15600 / (1681 * 0.66), 2);
    expect(wc.daysRequired).toBeGreaterThan(0.5); // Needs at least half a day
  });
});

describe('computeDeficitEvolution', () => {
  it('computes deficit from daily demand (stk=0, Stock-A eliminado)', () => {
    const tool = mkTool({ id: 'T01', pH: 100, stk: 0 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [100, 200, 300], stk: 0 });
    const toolMap = mkToolMap([tool]);

    const result = computeDeficitEvolution([op], toolMap, 3);
    const de = result.get('OP01')!;

    expect(de.initialStock).toBe(0);
    // Day 0: 0 - 100 = -100
    // Day 1: 0 - 300 = -300
    // Day 2: 0 - 600 = -600
    expect(de.dailyDeficit).toEqual([-100, -300, -600]);
    expect(de.firstDeficitDay).toBe(0);
    expect(de.maxDeficit).toBe(600);
  });

  it('includes backlog in cumulative demand (stk=0)', () => {
    const tool = mkTool({ id: 'T01', pH: 100, stk: 0 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [100, 100], atr: 300, stk: 0 });
    const toolMap = mkToolMap([tool]);

    const result = computeDeficitEvolution([op], toolMap, 2);
    const de = result.get('OP01')!;

    // Day 0: 0 - (300 + 100) = -400
    // Day 1: 0 - (300 + 100 + 100) = -500
    expect(de.dailyDeficit).toEqual([-400, -500]);
    expect(de.firstDeficitDay).toBe(0);
    expect(de.maxDeficit).toBe(500);
  });

  it('falls back to tool stock when no per-SKU stock (stk=0)', () => {
    const tool = mkTool({ id: 'T01', pH: 100, stk: 0 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [100, 200] });
    // op.stk is undefined → use tool.stk = 0
    const toolMap = mkToolMap([tool]);

    const result = computeDeficitEvolution([op], toolMap, 2);
    const de = result.get('OP01')!;

    expect(de.initialStock).toBe(0);
    // Day 0: 0 - 100 = -100
    // Day 1: 0 - 300 = -300
    expect(de.dailyDeficit).toEqual([-100, -300]);
    expect(de.firstDeficitDay).toBe(0);
    expect(de.maxDeficit).toBe(300);
  });

  it('handles zero stock and zero demand (no deficit)', () => {
    const tool = mkTool({ id: 'T01', pH: 100, stk: 0 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [0, 0, 0] });
    const toolMap = mkToolMap([tool]);

    const result = computeDeficitEvolution([op], toolMap, 3);
    const de = result.get('OP01')!;

    expect(de.dailyDeficit).toEqual([0, 0, 0]);
    expect(de.firstDeficitDay).toBe(-1);
    expect(de.maxDeficit).toBe(0);
  });

  it('computes deficit with WIP included (stk=0, WIP activo)', () => {
    const tool = mkTool({ id: 'T01', pH: 100, stk: 0 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [500], stk: 0, wip: 100 });
    const toolMap = mkToolMap([tool]);

    const result = computeDeficitEvolution([op], toolMap, 1);
    const de = result.get('OP01')!;

    expect(de.initialStock).toBe(100); // 0 stock + 100 WIP
    // Day 0: 100 - 500 = -400
    expect(de.dailyDeficit).toEqual([-400]);
    expect(de.firstDeficitDay).toBe(0);
    expect(de.maxDeficit).toBe(400);
  });

  it('handles large deficit growing over time (stk=0)', () => {
    const tool = mkTool({ id: 'T01', pH: 100, stk: 0 });
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [1000, 2000, 3000], stk: 0 });
    const toolMap = mkToolMap([tool]);

    const result = computeDeficitEvolution([op], toolMap, 3);
    const de = result.get('OP01')!;

    // Day 0: 0 - 1000 = -1000
    // Day 1: 0 - 3000 = -3000
    // Day 2: 0 - 6000 = -6000
    expect(de.dailyDeficit).toEqual([-1000, -3000, -6000]);
    expect(de.firstDeficitDay).toBe(0);
    expect(de.maxDeficit).toBe(6000);
  });
});
