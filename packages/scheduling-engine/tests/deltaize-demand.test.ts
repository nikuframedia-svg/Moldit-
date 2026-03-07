// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- Deltaize Cumulative NP Tests
//
//  Verifies deltaizeCumulativeNP converts cumulative max(0,-NP) values
//  into correct incremental daily demand, accounting for backlog (atr).
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import {
  deltaizeCumulativeNP,
  extractStockFromRawNP,
  rawNPtoDailyDemand,
  rawNPtoOrderDemand,
} from '../src/transform/transform-plan-state.js';

describe('deltaizeCumulativeNP', () => {
  it('converts OP13 real data (no backlog)', () => {
    const cum = [6609, 10400, 0, 10400, 7800, 10400, 27300, 13000];
    const result = deltaizeCumulativeNP(cum, 0);
    expect(result).toEqual([6609, 3791, 0, 10400, 0, 2600, 16900, 0]);
    expect(result.reduce((s, v) => s + v, 0)).toBe(40300);
  });

  it('subtracts backlog from day 0 to avoid double-counting', () => {
    // cum[0]=1500 includes 1000 backlog + 500 day-0 demand
    // cum[1]=2300 → delta = 800
    const result = deltaizeCumulativeNP([1500, 2300], 1000);
    expect(result).toEqual([500, 800]);
    expect(result.reduce((s, v) => s + v, 0)).toBe(1300);
  });

  it('returns zeros for all-zero input', () => {
    expect(deltaizeCumulativeNP([0, 0, 0, 0], 0)).toEqual([0, 0, 0, 0]);
  });

  it('handles single-day array', () => {
    expect(deltaizeCumulativeNP([5000], 0)).toEqual([5000]);
  });

  it('handles monotonically increasing shortfall (growing demand)', () => {
    // Each day adds more demand
    expect(deltaizeCumulativeNP([100, 200, 500], 0)).toEqual([100, 100, 300]);
  });

  it('handles monotonically decreasing shortfall (receipts covering demand)', () => {
    // Shortfall shrinks → no new demand after day 0
    expect(deltaizeCumulativeNP([500, 200, 100], 0)).toEqual([500, 0, 0]);
  });

  it('returns empty array for empty input', () => {
    expect(deltaizeCumulativeNP([], 0)).toEqual([]);
  });

  it('clamps to zero when atr exceeds cum[0]', () => {
    // backlog=800 but cum[0]=500 → day-0 demand is 0 (backlog already covers it)
    expect(deltaizeCumulativeNP([500], 800)).toEqual([0]);
  });

  it('handles oscillating shortfall (zero interspersed)', () => {
    // cum[1]=0 means NP went positive → no new demand
    // cum[2]=200 > cum[1]=0 → new demand of 200
    expect(deltaizeCumulativeNP([100, 0, 200], 0)).toEqual([100, 0, 200]);
  });

  it('handles OP01 real data (no backlog)', () => {
    const cum = [0, 1490, 0, 3200, 0, 3200, 16960, 0];
    const result = deltaizeCumulativeNP(cum, 0);
    expect(result).toEqual([0, 1490, 0, 3200, 0, 3200, 13760, 0]);
    // Sum should be much less than raw sum of 24850
    const deltaSum = result.reduce((s, v) => s + v, 0);
    expect(deltaSum).toBe(21650);
    expect(deltaSum).toBeLessThan(24850);
  });

  it('handles negative atr gracefully (treated as 0)', () => {
    // Negative atr should not inflate day-0 demand
    expect(deltaizeCumulativeNP([100, 200], -50)).toEqual([100, 100]);
  });

  it('all-same values produce demand only on day 0', () => {
    // Constant shortfall → no new demand after initial
    expect(deltaizeCumulativeNP([5000, 5000, 5000], 0)).toEqual([5000, 0, 0]);
  });
});

describe('rawNPtoDailyDemand', () => {
  it('converts real ISOP row 6 data (BFP079 — stock then shortfall)', () => {
    // Raw ISOP: 2751 (stock), then null, then -15600 (shortfall), then nulls, then -10400
    const raw: (number | null)[] = [
      2751,
      2751,
      2751,
      2751,
      2751,
      null,
      -15600,
      null,
      null,
      null,
      -10400,
    ];
    const result = rawNPtoDailyDemand(raw, 0);
    // Days 0-5: stock positive → no demand
    // Day 6: shortfall = 15600 (new demand)
    // Days 7-9: shortfall stays 15600 (forward-filled) → no new demand
    // Day 10: shortfall = 10400 < 15600 → shortfall decreased → no new demand
    expect(result).toEqual([0, 0, 0, 0, 0, 0, 15600, 0, 0, 0, 0]);
  });

  it('handles all-positive values (stock covers everything)', () => {
    const raw = [500, 400, 300, 200, 100];
    const result = rawNPtoDailyDemand(raw, 0);
    // All positive → max(0, -NP) = 0 for all → no demand
    expect(result).toEqual([0, 0, 0, 0, 0]);
  });

  it('handles all-negative values (growing shortfall)', () => {
    const raw = [-100, -300, -600];
    const result = rawNPtoDailyDemand(raw, 0);
    // max(0,-NP): [100, 300, 600]
    // Delta: [100, 200, 300]
    expect(result).toEqual([100, 200, 300]);
  });

  it('forward-fills null values from previous day', () => {
    const raw: (number | null)[] = [-500, null, null, -1000];
    const result = rawNPtoDailyDemand(raw, 0);
    // Forward-fill: [-500, -500, -500, -1000]
    // max(0,-NP): [500, 500, 500, 1000]
    // Delta: [500, 0, 0, 500]
    expect(result).toEqual([500, 0, 0, 500]);
  });

  it('handles null at start (treated as 0)', () => {
    const raw: (number | null)[] = [null, null, -200];
    const result = rawNPtoDailyDemand(raw, 0);
    // Forward-fill: [0, 0, -200]
    // max(0,-NP): [0, 0, 200]
    // Delta: [0, 0, 200]
    expect(result).toEqual([0, 0, 200]);
  });

  it('subtracts backlog from day 0', () => {
    const raw = [-1500, -2300];
    const result = rawNPtoDailyDemand(raw, 1000);
    // max(0,-NP): [1500, 2300]
    // deltaizeCumulativeNP([1500, 2300], 1000) → [500, 800]
    expect(result).toEqual([500, 800]);
  });

  it('returns empty array for empty input', () => {
    expect(rawNPtoDailyDemand([], 0)).toEqual([]);
  });

  it('handles transition from stock to shortfall and back', () => {
    const raw = [100, -200, -200, 50];
    const result = rawNPtoDailyDemand(raw, 0);
    // max(0,-NP): [0, 200, 200, 0]
    // Delta: [0, 200, 0, 0]
    expect(result).toEqual([0, 200, 0, 0]);
  });

  it('handles undefined values same as null', () => {
    const raw: (number | null | undefined)[] = [-100, undefined, -300];
    const result = rawNPtoDailyDemand(raw, 0);
    // Forward-fill: [-100, -100, -300]
    // max(0,-NP): [100, 100, 300]
    // Delta: [100, 0, 200]
    expect(result).toEqual([100, 0, 200]);
  });
});

describe('extractStockFromRawNP', () => {
  it('returns first positive value as stock', () => {
    expect(extractStockFromRawNP([2751, 2751, -15600])).toBe(2751);
  });

  it('returns 0 for first value negative (shortfall from day 0)', () => {
    expect(extractStockFromRawNP([-500, -1000, -1500])).toBe(0);
  });

  it('skips nulls and returns first non-null positive', () => {
    expect(extractStockFromRawNP([null, null, 1000, -500])).toBe(1000);
  });

  it('skips nulls and returns 0 when first non-null is negative', () => {
    expect(extractStockFromRawNP([null, null, -200])).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(extractStockFromRawNP([])).toBe(0);
  });

  it('returns 0 for all-null array', () => {
    expect(extractStockFromRawNP([null, null, null])).toBe(0);
  });

  it('returns 0 for first value zero', () => {
    expect(extractStockFromRawNP([0, 500, -100])).toBe(0);
  });

  it('handles undefined values same as null', () => {
    expect(extractStockFromRawNP([undefined, undefined, 3000])).toBe(3000);
  });

  it('real BFP079 data: extracts 2751 stock from NP array', () => {
    const raw: (number | null)[] = [
      2751,
      2751,
      2751,
      2751,
      2751,
      null,
      -15600,
      null,
      null,
      null,
      -10400,
    ];
    expect(extractStockFromRawNP(raw)).toBe(2751);
  });
});

// ── rawNPtoOrderDemand (order-based NP interpretation) ───────────────

describe('rawNPtoOrderDemand', () => {
  it('extracts orders from every explicitly negative NP cell', () => {
    // NP: stock 500, then -60 (order), null (empty cell), -200 (order)
    const raw: (number | null)[] = [500, 420, -60, null, -200];
    const result = rawNPtoOrderDemand(raw, 0);
    // Day 2: -60 → order of 60 pcs
    // Day 3: null → empty ISOP cell, no demand
    // Day 4: -200 → order of 200 pcs
    expect(result).toEqual([0, 0, 60, 0, 200]);
  });

  it('same negative NP repeated = order on each day', () => {
    const raw: (number | null)[] = [-100, -100, -100];
    const result = rawNPtoOrderDemand(raw, 0);
    // Every negative cell = order of |NP| pcs
    expect(result).toEqual([100, 100, 100]);
  });

  it('null cells produce no demand (empty ISOP cells)', () => {
    const raw: (number | null)[] = [-500, null, null, -1000];
    const result = rawNPtoOrderDemand(raw, 0);
    // Day 0: -500 → order of 500
    // Days 1-2: null → empty cell, no demand
    // Day 3: -1000 → order of 1000
    expect(result).toEqual([500, 0, 0, 1000]);
  });

  it('positive NP resets order tracking', () => {
    const raw = [-60, 100, -200];
    const result = rawNPtoOrderDemand(raw, 0);
    // Day 0: -60 → order of 60
    // Day 1: positive → stock OK, reset tracking
    // Day 2: -200 → new order of 200
    expect(result).toEqual([60, 0, 200]);
  });

  it('all positive values = no orders', () => {
    const raw = [500, 400, 300, 200, 100];
    const result = rawNPtoOrderDemand(raw, 0);
    expect(result).toEqual([0, 0, 0, 0, 0]);
  });

  it('returns empty array for empty input', () => {
    expect(rawNPtoOrderDemand([], 0)).toEqual([]);
  });

  it('subtracts atr from first order to avoid double-counting', () => {
    // atr=200, first NP=-800 → first order = 800 - 200 = 600
    // null → empty cell, no demand
    const raw: (number | null)[] = [-800, null, -1500];
    const result = rawNPtoOrderDemand(raw, 200);
    expect(result).toEqual([600, 0, 1500]);
  });

  it('clamps first order to 0 when atr exceeds |NP|', () => {
    const raw: (number | null)[] = [-100, -500];
    const result = rawNPtoOrderDemand(raw, 300);
    // First order: 100 - 300 = -200 → clamped to 0
    // Second order: 500 (atr already subtracted from first)
    expect(result).toEqual([0, 500]);
  });

  it('handles real BFP079 data: stock then shortfalls', () => {
    const raw: (number | null)[] = [
      2751,
      2751,
      2751,
      2751,
      2751,
      null,
      -15600,
      null,
      null,
      null,
      -10400,
    ];
    const result = rawNPtoOrderDemand(raw, 0);
    // Days 0-4: stock positive → no orders
    // Day 5: null → empty cell, no demand
    // Day 6: -15600 → order of 15600
    // Days 7-9: null → empty cells, no demand
    // Day 10: -10400 → order of 10400
    expect(result).toEqual([0, 0, 0, 0, 0, 0, 15600, 0, 0, 0, 10400]);
  });

  it('handles null at start (treated as no NP)', () => {
    const raw: (number | null)[] = [null, null, -200];
    const result = rawNPtoOrderDemand(raw, 0);
    // Nulls at start = no NP info, day 2 = first negative → order of 200
    expect(result).toEqual([0, 0, 200]);
  });

  it('output never contains negative values', () => {
    const cases: (number | null | undefined)[][] = [
      [100, -200, null, 50, -1000, null, null, 200],
      [null, null, null],
      [-1, -1, -1, -1],
      [0, 0, 0, 0],
      [1000, 500, -5000, -10000],
      [-500, -200, 100, 500],
      [100, -100, 100, -100, 100],
    ];
    for (const raw of cases) {
      const result = rawNPtoOrderDemand(raw, 0);
      for (const v of result) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('zero NP resets order tracking (zero = stock OK)', () => {
    const raw = [-100, 0, -100];
    const result = rawNPtoOrderDemand(raw, 0);
    // Day 0: -100 → order of 100
    // Day 1: 0 → stock OK (NP >= 0), reset
    // Day 2: -100 → new order of 100 (even though same value, tracking was reset)
    expect(result).toEqual([100, 0, 100]);
  });
});

// ── Non-negativity property (defence-in-depth) ──────────────────────

describe('rawNPtoDailyDemand non-negativity', () => {
  it('output never contains negative values for adversarial inputs', () => {
    const cases: (number | null | undefined)[][] = [
      [100, -200, null, 50, -1000, null, null, 200],
      [null, null, null],
      [-1, -1, -1, -1],
      [0, 0, 0, 0],
      [1000, 500, -5000, -10000],
      [-500, -200, 100, 500],
      [100, -100, 100, -100, 100],
    ];
    for (const raw of cases) {
      const result = rawNPtoDailyDemand(raw, 0);
      for (const v of result) {
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
