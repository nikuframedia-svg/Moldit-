// =====================================================================
//  INCOMPOL PLAN -- Backward Scheduler Tests
//  Verifies computeEarliestStarts() lead-time backward counting
//
//  Factory context: 8-day horizon (Feb 27 - Mar 6, 2026)
//  workdays = [F, F, F, T, T, T, T, T]
//    day 0-2 = weekend (Fri Feb 27, Sat Feb 28, Sun Mar 1)
//    day 3-7 = working days (Mon-Fri)
// =====================================================================

import { DecisionRegistry } from '../src/decisions/decision-registry.js';
import { computeEarliestStarts } from '../src/scheduler/backward-scheduler.js';
import type { EOp } from '../src/types/engine.js';

// ── Shared test data ─────────────────────────────────────────────────

/** 8-day horizon: first 3 days are weekend, then 5 working days */
const WORKDAYS: boolean[] = [false, false, false, true, true, true, true, true];
const N_DAYS = 8;

/** Helper to build a minimal EOp for testing */
function makeOp(overrides: Partial<EOp> & { id: string; d: number[] }): EOp {
  return {
    t: 'BFP079',
    m: 'PRM019',
    sku: 'SKU-TEST',
    nm: 'Test Part',
    atr: 0,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('computeEarliestStarts', () => {
  it('skips operation with ltDays=0 (no lead time)', () => {
    const ops: EOp[] = [makeOp({ id: 'OP01', d: [0, 0, 0, 0, 0, 100, 0, 0], ltDays: 0 })];

    const result = computeEarliestStarts(ops, WORKDAYS, N_DAYS);
    expect(result.size).toBe(0);
  });

  it('computes correct earliestStart for ltDays=3, demand on day 7', () => {
    // demand on day 7 (last working day)
    // workday indices: [3, 4, 5, 6, 7]
    // day 7 is at workday position 4
    // count back 3 working days: position 4 - 3 = position 1 = day index 4
    const ops: EOp[] = [makeOp({ id: 'OP01', d: [0, 0, 0, 0, 0, 0, 0, 200], ltDays: 3 })];

    const result = computeEarliestStarts(ops, WORKDAYS, N_DAYS);
    expect(result.has('OP01')).toBe(true);

    const entry = result.get('OP01')!;
    expect(entry.latestDayIdx).toBe(7);
    expect(entry.ltDays).toBe(3);
    // workday position of day 7 is 4, minus 3 = position 1 = day index 4
    expect(entry.earliestDayIdx).toBe(4);
    expect(entry.source).toBe('prz_fabrico');
  });

  it('skips operation with no demand at all', () => {
    const ops: EOp[] = [makeOp({ id: 'OP01', d: [0, 0, 0, 0, 0, 0, 0, 0], ltDays: 2 })];

    const result = computeEarliestStarts(ops, WORKDAYS, N_DAYS);
    expect(result.size).toBe(0);
  });

  it('treats operation with ltDays undefined as no lead time (skipped)', () => {
    const ops: EOp[] = [
      makeOp({ id: 'OP01', d: [0, 0, 0, 0, 100, 0, 0, 0] }),
      // ltDays not set => undefined
    ];

    const result = computeEarliestStarts(ops, WORKDAYS, N_DAYS);
    expect(result.size).toBe(0);
  });

  it('clamps to day 0 when ltDays exceeds available working days', () => {
    // demand on day 4 (workday position 1)
    // ltDays = 10, but only 2 working days before day 4 (positions 0 and 1)
    // targetPos = 1 - 10 = -9 => clamp to day 0
    const ops: EOp[] = [makeOp({ id: 'OP01', d: [0, 0, 0, 0, 500, 0, 0, 0], ltDays: 10 })];

    const result = computeEarliestStarts(ops, WORKDAYS, N_DAYS);
    expect(result.has('OP01')).toBe(true);

    const entry = result.get('OP01')!;
    expect(entry.earliestDayIdx).toBe(0);
    expect(entry.latestDayIdx).toBe(4);
    expect(entry.ltDays).toBe(10);
  });

  it('handles multiple operations correctly', () => {
    const ops: EOp[] = [
      // ltDays=2, demand on day 6
      // workday position of day 6 is 3, minus 2 = position 1 = day 4
      makeOp({ id: 'OP01', d: [0, 0, 0, 0, 0, 0, 300, 0], ltDays: 2 }),
      // ltDays=1, demand on day 5
      // workday position of day 5 is 2, minus 1 = position 1 = day 4
      makeOp({ id: 'OP02', d: [0, 0, 0, 0, 0, 150, 0, 0], ltDays: 1 }),
      // no ltDays => skipped
      makeOp({ id: 'OP03', d: [0, 0, 0, 100, 0, 0, 0, 0] }),
    ];

    const result = computeEarliestStarts(ops, WORKDAYS, N_DAYS);
    expect(result.size).toBe(2);
    expect(result.get('OP01')!.earliestDayIdx).toBe(4);
    expect(result.get('OP02')!.earliestDayIdx).toBe(4);
    expect(result.has('OP03')).toBe(false);
  });

  it('uses LAST day with demand as delivery date (not first)', () => {
    // Demand on days 4, 5, and 7 => last demand day = 7
    // workday position of day 7 is 4, minus 1 = position 3 = day 6
    const ops: EOp[] = [makeOp({ id: 'OP01', d: [0, 0, 0, 0, 50, 50, 0, 100], ltDays: 1 })];

    const result = computeEarliestStarts(ops, WORKDAYS, N_DAYS);
    const entry = result.get('OP01')!;
    expect(entry.latestDayIdx).toBe(7);
    expect(entry.earliestDayIdx).toBe(6);
  });

  it('records decisions in the registry when provided', () => {
    const registry = new DecisionRegistry();
    const ops: EOp[] = [
      makeOp({ id: 'OP01', d: [0, 0, 0, 0, 0, 0, 0, 200], ltDays: 3, sku: '4927.020.001' }),
    ];

    computeEarliestStarts(ops, WORKDAYS, N_DAYS, registry);

    const decisions = registry.getByType('BACKWARD_SCHEDULE');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].opId).toBe('OP01');
    expect(decisions[0].metadata['ltDays']).toBe(3);
    expect(decisions[0].metadata['deliveryDay']).toBe(7);
    expect(decisions[0].metadata['earliestDay']).toBe(4);
    expect(decisions[0].metadata['sku']).toBe('4927.020.001');
  });

  it('does not record decisions when registry is not provided', () => {
    const ops: EOp[] = [makeOp({ id: 'OP01', d: [0, 0, 0, 0, 0, 0, 0, 200], ltDays: 3 })];

    // No registry passed -- should not throw
    const result = computeEarliestStarts(ops, WORKDAYS, N_DAYS);
    expect(result.size).toBe(1);
  });

  it('handles all-working-days horizon', () => {
    const allWork = [true, true, true, true, true, true, true, true];
    // demand on day 5, ltDays=4
    // workday positions: 0,1,2,3,4,5,6,7
    // position 5 - 4 = position 1 = day 1
    const ops: EOp[] = [makeOp({ id: 'OP01', d: [0, 0, 0, 0, 0, 100, 0, 0], ltDays: 4 })];

    const result = computeEarliestStarts(ops, allWork, 8);
    expect(result.get('OP01')!.earliestDayIdx).toBe(1);
  });
});
