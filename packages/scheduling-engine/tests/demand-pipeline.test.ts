// =====================================================================
//  INCOMPOL PLAN -- Demand Pipeline Invariant Tests
//
//  Verifies structural properties of the full NP -> demand -> bucket
//  -> EDD pipeline. These are property-based tests that catch
//  regressions in demand conservation, EDD boundaries, and bucketing.
//
//  Context: Stock-A eliminated (stk forced to 0 everywhere).
//  All demand derived from raw NP values via rawNPtoDailyDemand().
// =====================================================================

import { describe, expect, it } from 'vitest';
import { groupDemandIntoBuckets } from '../src/scheduler/demand-grouper.js';
import { rawNPtoDailyDemand } from '../src/transform/transform-plan-state.js';
import type { MoveAction } from '../src/types/blocks.js';
import type { EOp, ETool } from '../src/types/engine.js';

// ── Shared helpers ──────────────────────────────────────────────────

const WORKDAYS: boolean[] = [false, false, false, true, true, true, true, true];
const N_DAYS = 8;
const NO_MST: Record<string, string> = {};
const NO_TST: Record<string, string> = {};
const NO_MOVES: MoveAction[] = [];

function mkTool(overrides: Partial<ETool> & { id: string }): ETool {
  return {
    m: 'PRM019',
    alt: '-',
    sH: 0.5,
    pH: 120,
    op: 2,
    lt: 0,
    stk: 0,
    nm: 'T',
    ...overrides,
  };
}

function mkOp(overrides: Partial<EOp> & { id: string; d: number[] }): EOp {
  return { t: 'T01', m: 'PRM019', sku: 'SKU01', nm: 'P', atr: 0, ...overrides };
}

/** Sum all bucket totalQty for a given opId across all machines */
function sumBucketQty(
  result: Record<string, ReturnType<typeof groupDemandIntoBuckets>[string]>,
  opId: string,
): number {
  let total = 0;
  for (const groups of Object.values(result)) {
    for (const g of groups) {
      for (const sk of g.skus) {
        if (sk.opId === opId) total += sk.totalQty;
      }
    }
  }
  return total;
}

/** Collect all EDDs from result */
function allEdds(
  result: Record<string, ReturnType<typeof groupDemandIntoBuckets>[string]>,
): number[] {
  const edds: number[] = [];
  for (const groups of Object.values(result)) {
    for (const g of groups) {
      edds.push(g.edd);
      for (const sk of g.skus) edds.push(sk.edd);
    }
  }
  return edds;
}

// ── Demand Conservation ─────────────────────────────────────────────

describe('demand conservation', () => {
  it('SUM(bucket.totalQty) == SUM(op.d) + op.atr (lt=0, single op)', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    const ops = [mkOp({ id: 'OP01', d: [0, 0, 0, 50, 60, 70, 80, 90] })];
    const expectedTotal = 50 + 60 + 70 + 80 + 90;

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    expect(sumBucketQty(result, 'OP01')).toBe(expectedTotal);
  });

  it('conservation with lot economic (lt > 0) — totalQty = demand, not prodQty', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 1000 }) };
    const ops = [mkOp({ id: 'OP01', d: [0, 0, 0, 400, 300, 500, 200, 100] })];
    const expectedTotal = 400 + 300 + 500 + 200 + 100;

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    expect(sumBucketQty(result, 'OP01')).toBe(expectedTotal);
  });

  it('conservation with backlog (atr included in total)', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    const ops = [mkOp({ id: 'OP01', atr: 250, d: [0, 0, 0, 100, 200, 0, 0, 0] })];
    const expectedTotal = 250 + 100 + 200;

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    expect(sumBucketQty(result, 'OP01')).toBe(expectedTotal);
  });

  it('conservation with multiple operations on different tools', () => {
    const toolMap = {
      T01: mkTool({ id: 'T01', lt: 0 }),
      T02: mkTool({ id: 'T02', lt: 500, m: 'PRM031' }),
    };
    const ops = [
      mkOp({ id: 'OP01', t: 'T01', d: [0, 0, 0, 100, 200, 0, 0, 0] }),
      mkOp({ id: 'OP02', t: 'T02', m: 'PRM031', atr: 50, d: [0, 0, 0, 0, 0, 300, 400, 0] }),
    ];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    expect(sumBucketQty(result, 'OP01')).toBe(300);
    expect(sumBucketQty(result, 'OP02')).toBe(50 + 700);
  });

  it('conservation across rawNPtoDailyDemand + groupDemandIntoBuckets', () => {
    const rawNP: (number | null)[] = [500, 500, 420, 340, -60, -60, -160, -160];
    const atr = 0;
    const daily = rawNPtoDailyDemand(rawNP, atr);

    // Verify intermediate demand
    const demandTotal = daily.reduce((s, v) => s + v, 0);
    expect(demandTotal).toBeGreaterThan(0);

    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    const ops = [mkOp({ id: 'OP01', d: daily })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    expect(sumBucketQty(result, 'OP01')).toBe(demandTotal);
  });

  it('conservation with backlog + rawNP pipeline', () => {
    const rawNP: (number | null)[] = [-100, -300, -600, -600, -600, null, null, null];
    const atr = 50;
    const daily = rawNPtoDailyDemand(rawNP, atr);
    const demandTotal = daily.reduce((s, v) => s + v, 0);

    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    const ops = [mkOp({ id: 'OP01', atr, d: daily })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    // Backlog bucket + demand buckets must sum to atr + demandTotal
    expect(sumBucketQty(result, 'OP01')).toBe(atr + demandTotal);
  });
});

// ── EDD Boundaries ──────────────────────────────────────────────────

describe('EDD boundaries', () => {
  it('all EDDs are within [0, nDays-1]', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    const ops = [mkOp({ id: 'OP01', d: [0, 0, 0, 50, 60, 70, 80, 90] })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    for (const edd of allEdds(result)) {
      expect(edd).toBeGreaterThanOrEqual(0);
      expect(edd).toBeLessThan(N_DAYS);
    }
  });

  it('backlog bucket always has EDD=0', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    const ops = [mkOp({ id: 'OP01', atr: 500, d: [0, 0, 0, 0, 0, 0, 0, 100] })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    const groups = Object.values(result).flat();
    const backlogSku = groups.flatMap((g) => g.skus).find((sk) => sk.atr > 0);
    expect(backlogSku).toBeDefined();
    expect(backlogSku!.edd).toBe(0);
  });

  it('EDD = last day of demand in bucket (not first)', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    // Demand on days 3, 4, 5 — all within one BUCKET_WINDOW
    const ops = [mkOp({ id: 'OP01', d: [0, 0, 0, 100, 200, 300, 0, 0] })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    const groups = Object.values(result).flat();
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // Last demand day is 5
    const lastGroup = groups[groups.length - 1];
    expect(lastGroup.edd).toBe(5);
  });

  it('EDD boundaries hold with lot economic', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 100 }) };
    const ops = [mkOp({ id: 'OP01', d: [0, 0, 0, 50, 50, 50, 50, 50] })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    for (const edd of allEdds(result)) {
      expect(edd).toBeGreaterThanOrEqual(0);
      expect(edd).toBeLessThan(N_DAYS);
    }
  });

  it('demand only on last day produces EDD = nDays-1', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    const ops = [mkOp({ id: 'OP01', d: [0, 0, 0, 0, 0, 0, 0, 500] })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    const groups = Object.values(result).flat();
    expect(groups[0].edd).toBe(7); // N_DAYS - 1
  });
});

// ── Lot Economic Remainder ──────────────────────────────────────────

describe('lot economic remainder', () => {
  it('emits bucket when total demand < lt (remainder not lost)', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 5000 }) };
    // Total demand = 350, much less than lt=5000
    const ops = [mkOp({ id: 'OP01', d: [0, 0, 0, 100, 100, 100, 50, 0] })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    const groups = Object.values(result).flat();
    expect(groups.length).toBe(1); // One bucket with all demand

    const sk = groups[0].skus[0];
    expect(sk.totalQty).toBe(350);
    expect(sk.prodQty).toBe(5000); // Rounded up to lt
  });

  it('emits remainder after partial lot fills', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 1000 }) };
    // Day 3: 400, day 4: 300, day 5: 500 = 1200 >= 1000 -> bucket 1
    // Day 6: 200, day 7: 100 = 300 -> bucket 2 (remainder)
    const ops = [mkOp({ id: 'OP01', d: [0, 0, 0, 400, 300, 500, 200, 100] })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    const groups = Object.values(result).flat();
    expect(groups.length).toBe(2); // Two buckets

    // Conservation: all demand accounted for
    expect(sumBucketQty(result, 'OP01')).toBe(1500);

    // Remainder bucket exists with totalQty < lt
    const remainderBucket = groups.find((g) => g.skus.some((sk) => sk.totalQty < 1000));
    expect(remainderBucket).toBeDefined();
    expect(remainderBucket!.skus[0].totalQty).toBe(300);
    expect(remainderBucket!.skus[0].prodQty).toBe(1000); // Rounded up
  });
});

// ── Multi-Operation Same Tool ───────────────────────────────────────

describe('multi-operation same tool', () => {
  it('different ops on same tool get separate SkuBuckets', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    const ops = [
      mkOp({ id: 'OP01', t: 'T01', sku: 'SKU-A', d: [0, 0, 0, 100, 0, 0, 0, 0] }),
      mkOp({ id: 'OP02', t: 'T01', sku: 'SKU-B', d: [0, 0, 0, 0, 0, 0, 200, 0] }),
    ];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    // Both ops conserve demand independently
    expect(sumBucketQty(result, 'OP01')).toBe(100);
    expect(sumBucketQty(result, 'OP02')).toBe(200);
  });

  it('same-tool ops with same EDD share ToolGroup', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    // Both ops have demand ending on day 5 — same EDD
    const ops = [
      mkOp({ id: 'OP01', t: 'T01', sku: 'SKU-A', d: [0, 0, 0, 100, 200, 300, 0, 0] }),
      mkOp({ id: 'OP02', t: 'T01', sku: 'SKU-B', d: [0, 0, 0, 0, 150, 250, 0, 0] }),
    ];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    const groups = result['PRM019'];
    expect(groups).toBeDefined();

    // Find the ToolGroup with EDD=5
    const eddGroup = groups.find((g) => g.edd === 5);
    expect(eddGroup).toBeDefined();
    // Should have 2 SkuBuckets (one per op)
    expect(eddGroup!.skus.length).toBe(2);
    expect(eddGroup!.skus.map((s) => s.opId).sort()).toEqual(['OP01', 'OP02']);
  });

  it('same-tool ops with different EDDs get separate ToolGroups', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    const ops = [
      mkOp({ id: 'OP01', t: 'T01', sku: 'SKU-A', d: [0, 0, 0, 500, 0, 0, 0, 0] }),
      mkOp({ id: 'OP02', t: 'T01', sku: 'SKU-B', d: [0, 0, 0, 0, 0, 0, 0, 300] }),
    ];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    const groups = result['PRM019'];
    expect(groups).toBeDefined();
    // Should have 2 ToolGroups with different EDDs
    const edds = groups.map((g) => g.edd).sort((a, b) => a - b);
    expect(edds).toEqual([3, 7]);
  });
});

// ── Negative Demand Guard ───────────────────────────────────────────

describe('negative demand clamping', () => {
  it('negative values in op.d are treated as 0 (no negative totalQty)', () => {
    const toolMap = { T01: mkTool({ id: 'T01', lt: 0 }) };
    // Force negative values in demand array (should never happen from NP pipeline,
    // but defence-in-depth)
    const ops = [mkOp({ id: 'OP01', d: [0, 0, 0, 100, -50, 200, -30, 0] })];

    const result = groupDemandIntoBuckets(ops, NO_MST, NO_TST, NO_MOVES, toolMap, WORKDAYS, N_DAYS);

    // Only positive values should be bucketed: 100 + 200 = 300
    expect(sumBucketQty(result, 'OP01')).toBe(300);
  });
});

// ── rawNPtoDailyDemand Non-Negativity ───────────────────────────────

describe('rawNPtoDailyDemand non-negativity property', () => {
  const adversarialCases: { label: string; raw: (number | null | undefined)[] }[] = [
    { label: 'mixed positive/negative/null', raw: [100, -200, null, 50, -1000, null, null, 200] },
    { label: 'all null', raw: [null, null, null] },
    { label: 'all negative', raw: [-1, -1, -1, -1] },
    { label: 'all zero', raw: [0, 0, 0, 0] },
    { label: 'single positive', raw: [500] },
    { label: 'single negative', raw: [-500] },
    { label: 'positive to negative spike', raw: [1000, 500, -5000, -10000] },
    { label: 'negative to positive recovery', raw: [-500, -200, 100, 500] },
    { label: 'alternating sign', raw: [100, -100, 100, -100, 100] },
    { label: 'null then large negative', raw: [null, null, null, -99999] },
  ];

  for (const { label, raw } of adversarialCases) {
    it(`output is always >= 0: ${label}`, () => {
      const result = rawNPtoDailyDemand(raw, 0);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(0);
      }
    });

    it(`output is always >= 0 with backlog: ${label}`, () => {
      const result = rawNPtoDailyDemand(raw, 100);
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(0);
      }
    });
  }
});
