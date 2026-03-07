// =====================================================================
//  INCOMPOL PLAN -- Advance Production Tests
//  Verifies the advance-first overflow resolution strategy:
//
//  Phase A (preferred): Advance production on same machine (earlier days)
//  Phase B (fallback): Move to alternative machine
//
//  The advance mechanism works by shifting an operation's EDD earlier,
//  which can trigger tool-group merging (via mergeConsecutiveTools) and
//  save redundant setups, freeing capacity to resolve overflow.
//
//  Factory context: 10-day horizon, DAY_CAP = 1020 min (2 shifts)
// =====================================================================

import { describe, expect, it } from 'vitest';
import type { AutoRouteOverflowInput } from '../src/overflow/auto-route-overflow.js';
import { autoRouteOverflow } from '../src/overflow/auto-route-overflow.js';
import { groupDemandIntoBuckets } from '../src/scheduler/demand-grouper.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import type { AdvanceAction } from '../src/types/blocks.js';
import type { EMachine, EOp, ETool } from '../src/types/engine.js';

// ── Shared test data ─────────────────────────────────────────────────

const N_DAYS = 10;
const WORKDAYS: boolean[] = Array(N_DAYS).fill(true);

const MACHINES: EMachine[] = [
  { id: 'M1', area: 'PG1', focus: true },
  { id: 'M2', area: 'PG1', focus: true },
];

const EMPTY_MST: Record<string, string> = {};
const EMPTY_TST: Record<string, string> = {};

/** Build a tool with defaults */
function makeTool(overrides: Partial<ETool> & { id: string }): ETool {
  return {
    m: 'M1',
    alt: '-',
    sH: 1.0, // 60 min setup
    pH: 120, // 120 pcs/hour
    op: 1,
    lt: 0,
    stk: 0,
    nm: 'Test Tool',
    ...overrides,
  };
}

/** Build an operation */
function makeOp(overrides: Partial<EOp> & { id: string; d: number[] }): EOp {
  return {
    t: 'T1',
    m: 'M1',
    sku: 'SKU-TEST',
    nm: 'Test Part',
    atr: 0,
    ...overrides,
  };
}

/**
 * Creates a "tight capacity" scenario on machine M1:
 *
 * 3 tool groups fill M1 to just over 10200 min (10 days x 1020):
 *   - T1 group A (EDD=2): ~3350 min prod + 60 min setup = 3410
 *   - T2 group C (EDD=5): ~3350 min prod + 60 min setup = 3410
 *   - T1 group B (EDD=9): ~3350 min prod + 60 min setup = 3410
 *   Total = 10230 min (3 setups) -> 30 min overflow on OPB
 *
 * When T1-B is advanced (EDD gap <= MAX_EDD_GAP=5), it merges with T1-A,
 * saving one setup (60 min). Total = 10170 min < 10200. Fits!
 *
 * Demand per op = 4422 pcs -> prodMin ~ 3350 (at pH=120, OEE=0.66)
 */
function createTightCapacityOps(): {
  ops: EOp[];
  toolMap: Record<string, ETool>;
} {
  const toolMap: Record<string, ETool> = {
    T1: makeTool({ id: 'T1', m: 'M1', alt: '-', sH: 1.0, pH: 120, lt: 0 }),
    T2: makeTool({ id: 'T2', m: 'M1', alt: '-', sH: 1.0, pH: 120, lt: 0 }),
  };
  const ops: EOp[] = [
    // T1 group A: demand on days 0-2 -> EDD=2
    makeOp({
      id: 'OPA',
      t: 'T1',
      m: 'M1',
      sku: 'SKU-A',
      d: [1474, 1474, 1474, 0, 0, 0, 0, 0, 0, 0],
    }),
    // T2 group C: demand on days 3-5 -> EDD=5 (interfering tool between T1 groups)
    makeOp({
      id: 'OPC',
      t: 'T2',
      m: 'M1',
      sku: 'SKU-C',
      d: [0, 0, 0, 1474, 1474, 1474, 0, 0, 0, 0],
    }),
    // T1 group B: demand on days 7-9 -> EDD=9 (gap with T1-A = 7 > MAX_EDD_GAP=5)
    makeOp({
      id: 'OPB',
      t: 'T1',
      m: 'M1',
      sku: 'SKU-B',
      d: [0, 0, 0, 0, 0, 0, 0, 1474, 1474, 1474],
    }),
  ];
  return { ops, toolMap };
}

// ── autoRouteOverflow Tests ──────────────────────────────────────────

describe('autoRouteOverflow — advance production', () => {
  it('resolves overflow by advancing production to enable tool-merging', () => {
    const { ops, toolMap } = createTightCapacityOps();

    const input: AutoRouteOverflowInput = {
      ops,
      mSt: EMPTY_MST,
      tSt: EMPTY_TST,
      userMoves: [],
      machines: MACHINES,
      toolMap,
      workdays: WORKDAYS,
      nDays: N_DAYS,
    };

    const result = autoRouteOverflow(input);

    // Advance should resolve the overflow (saves setup via tool-merging)
    expect(result.autoAdvances.length).toBeGreaterThanOrEqual(1);
    expect(result.autoMoves).toHaveLength(0);

    // OPB should be the advanced operation
    const adv = result.autoAdvances.find((a) => a.opId === 'OPB');
    expect(adv).toBeDefined();
    expect(adv!.advanceDays).toBeGreaterThanOrEqual(1);

    // Overflow should be fully resolved
    const overflowBlocks = result.blocks.filter(
      (b) =>
        (b.overflow && b.overflowMin && b.overflowMin > 0) ||
        (b.type === 'infeasible' && b.prodMin > 0),
    );
    expect(overflowBlocks).toHaveLength(0);
  });

  it('prefers advancing over moving to alt machine when both could work', () => {
    // Same tight-capacity scenario, but T1 now has alt=M2
    const toolMap: Record<string, ETool> = {
      T1: makeTool({ id: 'T1', m: 'M1', alt: 'M2', sH: 1.0, pH: 120, lt: 0 }),
      T2: makeTool({ id: 'T2', m: 'M1', alt: '-', sH: 1.0, pH: 120, lt: 0 }),
    };
    const ops: EOp[] = [
      makeOp({
        id: 'OPA',
        t: 'T1',
        m: 'M1',
        sku: 'SKU-A',
        d: [1474, 1474, 1474, 0, 0, 0, 0, 0, 0, 0],
      }),
      makeOp({
        id: 'OPC',
        t: 'T2',
        m: 'M1',
        sku: 'SKU-C',
        d: [0, 0, 0, 1474, 1474, 1474, 0, 0, 0, 0],
      }),
      makeOp({
        id: 'OPB',
        t: 'T1',
        m: 'M1',
        sku: 'SKU-B',
        d: [0, 0, 0, 0, 0, 0, 0, 1474, 1474, 1474],
      }),
    ];

    const input: AutoRouteOverflowInput = {
      ops,
      mSt: EMPTY_MST,
      tSt: EMPTY_TST,
      userMoves: [],
      machines: MACHINES,
      toolMap,
      workdays: WORKDAYS,
      nDays: N_DAYS,
    };

    const result = autoRouteOverflow(input);

    // Phase A (advance) should be tried first and succeed
    expect(result.autoAdvances.length).toBeGreaterThanOrEqual(1);
    // Phase B may also fire after Phase A to resolve remaining tardiness
    // (no longer blocked by initialOverflowMin guard)
  });

  it('falls back to alt machine when advancing cannot help', () => {
    // Two DIFFERENT tools on M1 — advance can't merge different tools.
    // Each tool has alt=M2, so moving one to M2 helps.
    // Using different tools avoids calco conflict (shared mold timeline).
    const toolMap: Record<string, ETool> = {
      T1: makeTool({ id: 'T1', m: 'M1', alt: 'M2', sH: 0.5, pH: 120, lt: 0 }),
      T2: makeTool({ id: 'T2', m: 'M1', alt: 'M2', sH: 0.5, pH: 120, lt: 0 }),
    };
    // Each op ~5150 min prod + 30 setup = 5180 min
    // Total on M1: 60 (2 setups) + 10300 (prod) = 10360 > 10200 → overflow ~160 min
    // After move: each machine has one op (5180 min) → both fit easily
    const ops: EOp[] = [
      makeOp({ id: 'OP01', t: 'T1', m: 'M1', sku: 'SKU-A', d: [0, 0, 0, 0, 0, 0, 0, 0, 0, 6800] }),
      makeOp({ id: 'OP02', t: 'T2', m: 'M1', sku: 'SKU-B', d: [0, 0, 0, 0, 0, 0, 0, 0, 0, 6800] }),
    ];

    const input: AutoRouteOverflowInput = {
      ops,
      mSt: EMPTY_MST,
      tSt: EMPTY_TST,
      userMoves: [],
      machines: MACHINES,
      toolMap,
      workdays: WORKDAYS,
      nDays: N_DAYS,
    };

    const result = autoRouteOverflow(input);

    // Advance can't help (different tools, no merging benefit).
    // Should fall back to alt machine move.
    expect(result.autoAdvances).toHaveLength(0);
    expect(result.autoMoves.length).toBeGreaterThanOrEqual(1);
    expect(result.autoMoves[0].toM).toBe('M2');

    // Overflow should be resolved
    const overflowBlocks = result.blocks.filter(
      (b) =>
        (b.overflow && b.overflowMin && b.overflowMin > 0) ||
        (b.type === 'infeasible' && b.prodMin > 0),
    );
    expect(overflowBlocks).toHaveLength(0);
  });

  it('returns no actions when there is no overflow', () => {
    const toolMap: Record<string, ETool> = {
      T1: makeTool({ id: 'T1', m: 'M1', alt: '-', pH: 120, sH: 0.5, lt: 0 }),
    };
    const ops: EOp[] = [
      makeOp({ id: 'OP01', t: 'T1', m: 'M1', sku: 'SKU-A', d: [0, 0, 0, 0, 0, 100, 0, 0, 0, 0] }),
    ];

    const input: AutoRouteOverflowInput = {
      ops,
      mSt: EMPTY_MST,
      tSt: EMPTY_TST,
      userMoves: [],
      machines: MACHINES,
      toolMap,
      workdays: WORKDAYS,
      nDays: N_DAYS,
    };

    const result = autoRouteOverflow(input);

    expect(result.autoAdvances).toHaveLength(0);
    expect(result.autoMoves).toHaveLength(0);
    const overflow = result.blocks.filter((b) => b.overflow || b.type === 'overflow');
    expect(overflow).toHaveLength(0);
  });

  it('tracks ADVANCE_PRODUCTION decisions in the registry', () => {
    const { ops, toolMap } = createTightCapacityOps();

    const input: AutoRouteOverflowInput = {
      ops,
      mSt: EMPTY_MST,
      tSt: EMPTY_TST,
      userMoves: [],
      machines: MACHINES,
      toolMap,
      workdays: WORKDAYS,
      nDays: N_DAYS,
    };

    const result = autoRouteOverflow(input);

    const advDecisions = result.registry.getAdvanceProductions();
    expect(advDecisions.length).toBeGreaterThanOrEqual(1);

    const dec = advDecisions[0];
    expect(dec.type).toBe('ADVANCE_PRODUCTION');
    expect(dec.opId).toBe('OPB');
    expect(dec.machineId).toBe('M1');
    expect(dec.metadata).toBeDefined();
    expect(dec.metadata['advanceDays']).toBeGreaterThanOrEqual(1);
    expect(dec.metadata['sku']).toBe('SKU-B');

    const summary = result.registry.getSummary();
    expect(summary.advanceProductions).toBeGreaterThanOrEqual(1);
  });

  it('marks advanced blocks with isAdvanced and advancedByDays', () => {
    const { ops, toolMap } = createTightCapacityOps();

    const input: AutoRouteOverflowInput = {
      ops,
      mSt: EMPTY_MST,
      tSt: EMPTY_TST,
      userMoves: [],
      machines: MACHINES,
      toolMap,
      workdays: WORKDAYS,
      nDays: N_DAYS,
    };

    const result = autoRouteOverflow(input);
    expect(result.autoAdvances.length).toBeGreaterThanOrEqual(1);

    const advancedOp = result.autoAdvances[0];
    const advancedBlocks = result.blocks.filter(
      (b) => b.opId === advancedOp.opId && b.type === 'ok' && b.isAdvanced,
    );
    expect(advancedBlocks.length).toBeGreaterThanOrEqual(1);
    for (const b of advancedBlocks) {
      expect(b.advancedByDays).toBe(advancedOp.advanceDays);
    }
  });
});

// ── Demand Grouper advanceOverrides Tests ────────────────────────────

describe('groupDemandIntoBuckets — advanceOverrides', () => {
  it('shifts EDD earlier when advanceOverrides is provided', () => {
    const toolMap: Record<string, ETool> = {
      T1: makeTool({ id: 'T1', m: 'M1', alt: '-', pH: 120, sH: 0.5, lt: 0 }),
    };
    const ops: EOp[] = [
      makeOp({ id: 'OP01', t: 'T1', m: 'M1', sku: 'SKU-A', d: [0, 0, 0, 0, 0, 0, 0, 200, 0, 0] }),
    ];
    const advances: AdvanceAction[] = [{ opId: 'OP01', advanceDays: 3, originalEdd: 7 }];

    const result = groupDemandIntoBuckets(
      ops,
      EMPTY_MST,
      EMPTY_TST,
      [],
      toolMap,
      WORKDAYS,
      N_DAYS,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      advances,
    );

    const groups = result['M1'];
    expect(groups).toBeDefined();
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // EDD should be shifted from 7 to 7-3=4
    expect(groups[0].edd).toBe(4);
  });

  it('does not shift EDD when no matching advanceOverride exists', () => {
    const toolMap: Record<string, ETool> = {
      T1: makeTool({ id: 'T1', m: 'M1', alt: '-', pH: 120, sH: 0.5, lt: 0 }),
    };
    const ops: EOp[] = [
      makeOp({ id: 'OP01', t: 'T1', m: 'M1', sku: 'SKU-A', d: [0, 0, 0, 0, 0, 0, 0, 200, 0, 0] }),
    ];
    const advances: AdvanceAction[] = [{ opId: 'OP99', advanceDays: 3, originalEdd: 7 }];

    const result = groupDemandIntoBuckets(
      ops,
      EMPTY_MST,
      EMPTY_TST,
      [],
      toolMap,
      WORKDAYS,
      N_DAYS,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      advances,
    );

    const groups = result['M1'];
    expect(groups).toBeDefined();
    expect(groups[0].edd).toBe(7);
  });

  it('respects workdays when counting advance days backward', () => {
    // Workdays: [T, F, T, T, F, T, T, T, T, T]
    // Demand on day 8, advance by 2 working days
    // Counting backward from 8: day 7 (work, -1), day 6 (work, -2) -> target = 6
    const workdays = [true, false, true, true, false, true, true, true, true, true];
    const toolMap: Record<string, ETool> = {
      T1: makeTool({ id: 'T1', m: 'M1', alt: '-', pH: 120, sH: 0.5, lt: 0 }),
    };
    const ops: EOp[] = [
      makeOp({ id: 'OP01', t: 'T1', m: 'M1', sku: 'SKU-A', d: [0, 0, 0, 0, 0, 0, 0, 0, 200, 0] }),
    ];
    const advances: AdvanceAction[] = [{ opId: 'OP01', advanceDays: 2, originalEdd: 8 }];

    const result = groupDemandIntoBuckets(
      ops,
      EMPTY_MST,
      EMPTY_TST,
      [],
      toolMap,
      workdays,
      N_DAYS,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      advances,
    );

    const groups = result['M1'];
    expect(groups).toBeDefined();
    expect(groups[0].edd).toBe(6);
  });

  it('advances as far as possible when not enough working days available', () => {
    const toolMap: Record<string, ETool> = {
      T1: makeTool({ id: 'T1', m: 'M1', alt: '-', pH: 120, sH: 0.5, lt: 0 }),
    };
    // Demand on day 2, advance by 5 days — only 2 working days before it
    // applyAdvanceOverride goes back: day 1 (work, -1), day 0 (work, -2), stop.
    // daysBack=2 < advanceDays=5 but newEdd=0 (the implementation returns max(0, newEdd))
    const ops: EOp[] = [
      makeOp({ id: 'OP01', t: 'T1', m: 'M1', sku: 'SKU-A', d: [0, 0, 200, 0, 0, 0, 0, 0, 0, 0] }),
    ];
    const advances: AdvanceAction[] = [{ opId: 'OP01', advanceDays: 5, originalEdd: 2 }];

    const result = groupDemandIntoBuckets(
      ops,
      EMPTY_MST,
      EMPTY_TST,
      [],
      toolMap,
      WORKDAYS,
      N_DAYS,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      advances,
    );

    const groups = result['M1'];
    expect(groups).toBeDefined();
    // The implementation advances as far as it can (to day 0)
    expect(groups[0].edd).toBe(0);
  });

  it('passes advanceOverrides through the full scheduleAll pipeline', () => {
    const toolMap: Record<string, ETool> = {
      T1: makeTool({ id: 'T1', m: 'M1', alt: '-', pH: 120, sH: 0.5, lt: 0 }),
    };
    const ops: EOp[] = [
      makeOp({ id: 'OP01', t: 'T1', m: 'M1', sku: 'SKU-A', d: [0, 0, 0, 0, 0, 0, 0, 200, 0, 0] }),
    ];
    const advances: AdvanceAction[] = [{ opId: 'OP01', advanceDays: 3, originalEdd: 7 }];

    const result = scheduleAll({
      ops,
      mSt: EMPTY_MST,
      tSt: EMPTY_TST,
      moves: [],
      machines: MACHINES,
      toolMap,
      workdays: WORKDAYS,
      nDays: N_DAYS,
      advanceOverrides: advances,
    });

    const op01Blocks = result.blocks.filter((b) => b.opId === 'OP01' && b.type === 'ok');
    expect(op01Blocks.length).toBeGreaterThanOrEqual(1);
  });
});
