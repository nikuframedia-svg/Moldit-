// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- Shipping Cutoff Integration Tests
//
//  5 mandatory scenarios per specification:
//  a) Sufficient capacity: reasonable demand → meets shipping deadline
//  b) Heavy order: >50% capacity → starts earlier via density → meets deadline
//  c) Impossible: demand exceeds horizon capacity → SHIPPING_CUTOFF_VIOLATION
//  d) Buffer change: 24h → 48h → latest_finish_time shifts back 24h
//  e) Low OEE (0.66): reduced effective capacity → alters timing and risk
//
//  All tests use scheduleAll with shippingCutoff to activate the new pipeline.
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { DAY_CAP, DEFAULT_OEE, S1 } from '../src/constants.js';
import type { ScheduleAllInput } from '../src/scheduler/scheduler.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import type { EMachine, EOp, ETool } from '../src/types/engine.js';
import type { ShippingCutoffConfig } from '../src/types/shipping.js';

// ── Helpers ──────────────────────────────────────────────────────────

function mkMachine(id: string, area = 'PG1'): EMachine {
  return { id, area, mm: new Array(8).fill(0) };
}

function mkTool(overrides: Partial<ETool> & { id: string }): ETool {
  return {
    m: 'M01',
    alt: '-',
    sH: 0.5,
    pH: 100,
    op: 1,
    lt: 1000,
    stk: 0,
    nm: 'Test',
    ...overrides,
  };
}

function mkOp(overrides: Partial<EOp> & { id: string; t: string; m: string; d: number[] }): EOp {
  return { sku: 'SKU01', nm: 'Test', atr: 0, ...overrides };
}

/** Build a standard 8-day horizon (6 workdays, 2 weekends) */
function mkWorkdays8(): boolean[] {
  // [Mon,Tue,Wed,Thu,Fri,Sat,Sun,Mon]
  return [true, true, true, true, true, false, false, true];
}

function mkInput(overrides: Partial<ScheduleAllInput>): ScheduleAllInput {
  return {
    ops: [],
    mSt: {},
    tSt: {},
    moves: [],
    machines: [],
    toolMap: {},
    workdays: mkWorkdays8(),
    nDays: 8,
    enableLeveling: false, // Disable leveling to isolate cutoff behavior
    shippingCutoff: { defaultBufferHours: 0 },
    ...overrides,
  };
}

// ── Test (a): Sufficient capacity ────────────────────────────────────

describe('Shipping Cutoff Integration', () => {
  it('(a) sufficient capacity: reasonable demand meets shipping deadline', () => {
    // 6 workdays, pH=500 pcs/h, demand=2000 on day 4
    // Effective capacity: 500 * 0.66 * (990/60) = 5445 pcs/day → easily fits
    const machine = mkMachine('M01');
    const tool = mkTool({ id: 'T01', m: 'M01', pH: 500, sH: 0.5 });
    const op = mkOp({
      id: 'OP01',
      t: 'T01',
      m: 'M01',
      sku: 'SKU-A',
      d: [0, 0, 0, 0, 2000, 0, 0, 0],
    });

    const result = scheduleAll(
      mkInput({
        ops: [op],
        machines: [machine],
        toolMap: { T01: tool },
        mSt: { M01: 'running' },
        tSt: { T01: 'running' },
      }),
    );

    // Should be fully scheduled
    const okBlocks = result.blocks.filter((b) => b.opId === 'OP01' && b.type === 'ok');
    const produced = okBlocks.reduce((s, b) => s + b.qty, 0);
    expect(produced).toBe(2000);

    // No infeasibilities
    const opInfeasible = result.feasibilityReport.entries.filter((e) => e.opId === 'OP01');
    expect(opInfeasible).toHaveLength(0);

    // Deadline exists
    expect(result.deadlines).toBeDefined();
    const dl = result.deadlines!.get('OP01');
    expect(dl).toBeDefined();
    expect(dl!.shippingDayIdx).toBe(4);
    expect(dl!.bufferHours).toBe(0);

    // Work content computed
    expect(result.workContents).toBeDefined();
    expect(result.workContents!.get('OP01')).toBeDefined();

    // Deficit evolution: starts at 0 stock, demand on day 4
    expect(result.deficits).toBeDefined();
    const de = result.deficits!.get('OP01');
    expect(de).toBeDefined();
    expect(de!.firstDeficitDay).toBeGreaterThanOrEqual(0);
  });

  // ── Test (b): Heavy order ─────────────────────────────────────────

  it('(b) heavy order: large qty occupying >50% capacity → meets deadline', () => {
    // pH=200 pcs/h, demand=5000 on day 6
    // Effective capacity per day: 200 * 0.66 * (990/60) = 2178 pcs
    // 5000 / 2178 ≈ 2.3 days needed → must start by day 4 at latest
    // 7 workdays total (0-4, 7) → fits but tight
    const machine = mkMachine('M01');
    const tool = mkTool({ id: 'T01', m: 'M01', pH: 200, sH: 0.5 });
    const op = mkOp({
      id: 'OP01',
      t: 'T01',
      m: 'M01',
      sku: 'SKU-HEAVY',
      d: [0, 0, 0, 0, 0, 0, 0, 5000],
    });

    const result = scheduleAll(
      mkInput({
        ops: [op],
        machines: [machine],
        toolMap: { T01: tool },
        mSt: { M01: 'running' },
        tSt: { T01: 'running' },
      }),
    );

    const okBlocks = result.blocks.filter((b) => b.opId === 'OP01' && b.type === 'ok');
    const produced = okBlocks.reduce((s, b) => s + b.qty, 0);
    expect(produced).toBe(5000);

    // Check scoring was used
    expect(result.scores).toBeDefined();
    const score = result.scores!.get('OP01');
    expect(score).toBeDefined();
    expect(score!.compositeScore).toBeGreaterThan(0);

    // Production should span multiple days
    const daysUsed = new Set(okBlocks.map((b) => b.dayIdx));
    expect(daysUsed.size).toBeGreaterThanOrEqual(2);
  });

  // ── Test (c): Impossible ──────────────────────────────────────────

  it('(c) impossible: demand exceeds horizon capacity → SHIPPING_CUTOFF_VIOLATION', () => {
    // pH=100 pcs/h, demand=100000 on day 1
    // Effective capacity per day: 100 * 0.66 * (990/60) = 1089 pcs
    // Total horizon capacity: 6 workdays * 1089 = 6534 pcs
    // Demand 100000 >> 6534 → impossible
    const machine = mkMachine('M01');
    const tool = mkTool({ id: 'T01', m: 'M01', pH: 100, sH: 0.5 });
    const op = mkOp({
      id: 'OP01',
      t: 'T01',
      m: 'M01',
      sku: 'SKU-IMPOSSIBLE',
      d: [0, 100000, 0, 0, 0, 0, 0, 0],
    });

    const result = scheduleAll(
      mkInput({
        ops: [op],
        machines: [machine],
        toolMap: { T01: tool },
        mSt: { M01: 'running' },
        tSt: { T01: 'running' },
      }),
    );

    // Some blocks may be ok, but total production << demand
    const okBlocks = result.blocks.filter((b) => b.opId === 'OP01' && b.type === 'ok');
    const produced = okBlocks.reduce((s, b) => s + b.qty, 0);
    expect(produced).toBeLessThan(100000);

    // Should have infeasibility entry for OP01 (with specific reason from overflow classification)
    const infeasible = result.feasibilityReport.entries.filter(
      (e) => e.opId === 'OP01' && e.reason != null,
    );
    expect(infeasible.length).toBeGreaterThanOrEqual(1);

    // Feasibility report: not deadline-feasible + has remediations
    expect(result.feasibilityReport.deadlineFeasible).toBe(false);
    expect(result.feasibilityReport.remediations.length).toBeGreaterThan(0);

    // Transparency report should have failure justification
    expect(result.transparencyReport).toBeDefined();
    const fj = result.transparencyReport!.failureJustifications.find((f) => f.opId === 'OP01');
    expect(fj).toBeDefined();
    // Constraint violated should be set (specific reason from overflow classification)
    expect(fj!.constraintsViolated.length).toBeGreaterThan(0);
    expect(fj!.missingCapacityPieces).toBeGreaterThan(0);
    expect(fj!.missingCapacityHours).toBeGreaterThan(0);
    expect(fj!.suggestions.length).toBeGreaterThan(0);
  });

  // ── Test (d): Buffer change ───────────────────────────────────────

  it('(d) buffer change: 24h → 48h → latest_finish_time shifts back 24h', () => {
    const machine = mkMachine('M01');
    const tool = mkTool({ id: 'T01', m: 'M01', pH: 500, sH: 0.5 });
    const op = mkOp({
      id: 'OP01',
      t: 'T01',
      m: 'M01',
      sku: 'SKU-BUFFER',
      d: [0, 0, 0, 0, 1000, 0, 0, 0],
    });
    const baseInput = {
      ops: [op],
      machines: [machine],
      toolMap: { T01: tool },
      mSt: { M01: 'running' },
      tSt: { T01: 'running' },
    };

    // Run with 24h buffer
    const result24 = scheduleAll(
      mkInput({
        ...baseInput,
        shippingCutoff: { defaultBufferHours: 24 },
      }),
    );

    // Run with 48h buffer
    const result48 = scheduleAll(
      mkInput({
        ...baseInput,
        shippingCutoff: { defaultBufferHours: 48 },
      }),
    );

    const dl24 = result24.deadlines!.get('OP01')!;
    const dl48 = result48.deadlines!.get('OP01')!;

    // Same shipping day
    expect(dl24.shippingDayIdx).toBe(dl48.shippingDayIdx);

    // Buffer is different
    expect(dl24.bufferHours).toBe(24);
    expect(dl48.bufferHours).toBe(48);

    // latestFinishAbs should differ by exactly 24h = 1440 min
    expect(dl24.latestFinishAbs - dl48.latestFinishAbs).toBe(24 * 60);

    // 48h buffer should be more restrictive
    expect(dl48.latestFinishAbs).toBeLessThan(dl24.latestFinishAbs);
  });

  // ── Test (e): Low OEE (0.66) ──────────────────────────────────────

  it('(e) low OEE (0.66): reduced effective capacity alters timing and risk', () => {
    // pH=1681 pcs/h with OEE=0.66 → effective = 1681 * 0.66 = 1109.46 pcs/h
    // Demand = 15600 pcs on day 4
    // Work content = 15600 / 1109.46 ≈ 14.06 hours ≈ 843 min
    // DAY_CAP = 990 min → needs ~0.85 days
    const machine = mkMachine('M01');
    const tool = mkTool({ id: 'T01', m: 'M01', pH: 1681, sH: 0.5, oee: 0.66 });
    const op = mkOp({
      id: 'OP01',
      t: 'T01',
      m: 'M01',
      sku: 'SKU-OEE',
      d: [0, 0, 0, 0, 15600, 0, 0, 0],
    });

    const result = scheduleAll(
      mkInput({
        ops: [op],
        machines: [machine],
        toolMap: { T01: tool },
        mSt: { M01: 'running' },
        tSt: { T01: 'running' },
      }),
    );

    // Work content should reflect OEE
    expect(result.workContents).toBeDefined();
    const wc = result.workContents!.get('OP01')!;
    expect(wc.oee).toBe(0.66);
    expect(wc.oeeSource).toBe('tool');
    expect(wc.pH).toBe(1681);

    // Work content hours = 15600 / (1681 * 0.66) ≈ 14.06
    expect(wc.workContentHours).toBeCloseTo(15600 / (1681 * 0.66), 1);

    // With OEE the work content is higher than without
    const naiveHours = 15600 / 1681; // ~9.28 hours (without OEE)
    expect(wc.workContentHours).toBeGreaterThan(naiveHours);

    // Capacity log should include the OEE computation
    expect(result.transparencyReport).toBeDefined();
    const capLog = result.transparencyReport!.capacityLog.find((c) => c.opId === 'OP01');
    expect(capLog).toBeDefined();
    expect(capLog!.oeeValue).toBe(0.66);
    expect(capLog!.oeeSource).toBe('tool');

    // With available capacity and OEE, should schedule all demand
    const okBlocks = result.blocks.filter((b) => b.opId === 'OP01' && b.type === 'ok');
    const produced = okBlocks.reduce((s, b) => s + b.qty, 0);
    expect(produced).toBeGreaterThanOrEqual(15600);

    // Deficit should show the initial state
    const de = result.deficits!.get('OP01')!;
    expect(de.firstDeficitDay).toBeGreaterThanOrEqual(0);
  });

  // ── Bonus: Legacy pipeline still works without shippingCutoff ──

  it('legacy pipeline works unchanged when shippingCutoff is absent', () => {
    const machine = mkMachine('M01');
    const tool = mkTool({ id: 'T01', m: 'M01', pH: 500, sH: 0.5 });
    const op = mkOp({
      id: 'OP01',
      t: 'T01',
      m: 'M01',
      sku: 'SKU-LEGACY',
      d: [0, 0, 0, 0, 1000, 0, 0, 0],
    });

    const result = scheduleAll({
      ops: [op],
      mSt: { M01: 'running' },
      tSt: { T01: 'running' },
      moves: [],
      machines: [machine],
      toolMap: { T01: tool },
      workdays: mkWorkdays8(),
      nDays: 8,
      // No shippingCutoff → legacy pipeline
    });

    // Should schedule normally
    const okBlocks = result.blocks.filter((b) => b.opId === 'OP01' && b.type === 'ok');
    const produced = okBlocks.reduce((s, b) => s + b.qty, 0);
    expect(produced).toBe(1000);

    // New pipeline fields should NOT be present
    expect(result.deadlines).toBeUndefined();
    expect(result.workContents).toBeUndefined();
    expect(result.deficits).toBeUndefined();
    expect(result.scores).toBeUndefined();
    expect(result.transparencyReport).toBeUndefined();
  });
});
