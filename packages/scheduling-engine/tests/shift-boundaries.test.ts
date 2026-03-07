// =====================================================================
//  INCOMPOL PLAN -- Shift Boundaries (R1) Tests
//
//  Verifies that R1 constants are correct after Contract 6 changes:
//    S0 = 420 (07:00, was 450/07:30)
//    T1 = 930 (15:30, unchanged)
//    S1 = 1440 (24:00, unchanged)
//    S2 = 1860 (S1 + S0, was 1890)
//    TG_END = 960 (16:00, NEW)
//    DAY_CAP = 1020 (S1 - S0, was 990)
//
//  Tests 1-4: constant value assertions
//  Tests 6-7: integration with slot-allocator / scheduleAll
//  Test 8: derived identity DAY_CAP === S1 - S0
// =====================================================================

import { describe, expect, it } from 'vitest';
import { DAY_CAP, S0, S1, S2, T1, TG_END } from '../src/constants.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import { transformPlanState } from '../src/transform/transform-plan-state.js';
import type { PlanState } from '../src/types/plan-state.js';

// ── Helper: build a minimal PlanState for integration tests ──

function makePlanState(overrides?: {
  pcsPerHour?: number;
  dailyQty?: number;
  setupHours?: number;
  operators?: number;
  nDays?: number;
}): PlanState {
  const {
    pcsPerHour = 60,
    dailyQty = 100,
    setupHours = 0,
    operators = 1,
    nDays = 3,
  } = overrides ?? {};

  const dates = Array.from({ length: nDays }, (_, i) => `0${i + 1}/03`);
  const daysLabel = Array.from({ length: nDays }, () => 'Seg');
  const workdays = Array.from({ length: nDays }, () => true);
  const manMinutes = Array.from({ length: nDays }, () => 0);
  const daily = Array.from({ length: nDays }, (_, i) => (i === 0 ? dailyQty : 0));

  return {
    dates,
    days_label: daysLabel,
    workday_flags: workdays,
    machines: [{ id: 'PRM019', area: 'PG1', man_minutes: manMinutes }],
    tools: [
      {
        id: 'BWI001',
        machine: 'PRM019',
        alt_machine: '-',
        setup_hours: setupHours,
        pcs_per_hour: pcsPerHour,
        operators,
        skus: ['SKU1'],
        names: ['Peça Teste'],
        lot_economic_qty: 0,
        stock: 0,
      },
    ],
    operations: [
      {
        id: 'OP1',
        machine: 'PRM019',
        tool: 'BWI001',
        sku: 'SKU1',
        name: 'Peça Teste',
        pcs_per_hour: pcsPerHour,
        atraso: 0,
        daily_qty: daily,
        setup_hours: setupHours,
        operators,
        stock: 0,
        status: 'PLANNED' as const,
      },
    ],
  };
}

/** Run scheduleAll from a PlanState and return blocks */
function runSchedule(ps: PlanState) {
  const engine = transformPlanState(ps);
  const mSt: Record<string, string> = {};
  engine.machines.forEach((m) => {
    mSt[m.id] = 'running';
  });
  const tSt: Record<string, string> = {};
  engine.tools.forEach((t) => {
    tSt[t.id] = 'running';
  });

  return scheduleAll({
    ops: engine.ops,
    mSt,
    tSt,
    moves: [],
    machines: engine.machines,
    toolMap: engine.toolMap,
    workdays: engine.workdays,
    nDays: engine.nDays,
  });
}

// ══════════════════════════════════════════════════════════════════════
//  Shift Boundaries (R1)
// ══════════════════════════════════════════════════════════════════════

describe('Shift Boundaries (R1)', () => {
  // ── 1. S0 === 420 (07:00) ──

  it('S0 === 420 (07:00)', () => {
    expect(S0).toBe(420);
  });

  // ── 2. DAY_CAP === 1020 ──

  it('DAY_CAP === 1020', () => {
    expect(DAY_CAP).toBe(1020);
  });

  // ── 3. S2 === 1860 ──

  it('S2 === 1860', () => {
    expect(S2).toBe(1860);
  });

  // ── 4. TG_END === 960 (16:00) ──

  it('TG_END === 960 (16:00)', () => {
    expect(TG_END).toBe(960);
  });

  // ── 6. Slot-allocator starts at minute 420 ──

  it('slot-allocator starts at minute 420', () => {
    // Single small op: 100 pcs at 60 pcs/h = 100 min production
    // No setup. Should start at S0 = 420.
    const ps = makePlanState({ pcsPerHour: 60, dailyQty: 100, setupHours: 0 });
    const result = runSchedule(ps);

    const okBlocks = result.blocks.filter((b) => b.type === 'ok' && b.machineId === 'PRM019');
    expect(okBlocks.length).toBeGreaterThan(0);

    const firstBlock = okBlocks.reduce(
      (min, b) => (b.startMin < min.startMin ? b : min),
      okBlocks[0],
    );
    expect(firstBlock.startMin).toBeGreaterThanOrEqual(420);
    // Also verify it starts exactly at S0 (no earlier padding)
    expect(firstBlock.startMin).toBe(S0);
  });

  // ── 7. Block at shift boundary 15:30 has correct shifts ──

  it('block spanning T1 (15:30) produces blocks in both X and Y shifts', () => {
    // Need production that spans across T1 = 930 (15:30).
    // 900 pcs at 60 pcs/h = 900 min production time.
    // Starts at 420, runs 900 min -> ends at 1320.
    // This crosses T1=930, so we expect blocks in both X and Y shifts.
    const ps = makePlanState({ pcsPerHour: 60, dailyQty: 900, setupHours: 0 });
    const result = runSchedule(ps);

    const day0Blocks = result.blocks.filter(
      (b) => b.machineId === 'PRM019' && b.dayIdx === 0 && b.type === 'ok',
    );

    const shifts = new Set(day0Blocks.map((b) => b.shift));
    expect(shifts.has('X')).toBe(true);
    expect(shifts.has('Y')).toBe(true);

    // Verify X shift blocks are within [420, 930] range
    const xBlocks = day0Blocks.filter((b) => b.shift === 'X');
    for (const b of xBlocks) {
      expect(b.startMin).toBeGreaterThanOrEqual(S0);
      expect(b.endMin).toBeLessThanOrEqual(T1);
    }

    // Verify Y shift blocks start at or after T1
    const yBlocks = day0Blocks.filter((b) => b.shift === 'Y');
    for (const b of yBlocks) {
      expect(b.startMin).toBeGreaterThanOrEqual(T1);
      expect(b.endMin).toBeLessThanOrEqual(S1);
    }
  });

  // ── 8. DAY_CAP derived identity ──

  it('DAY_CAP === S1 - S0', () => {
    expect(DAY_CAP).toBe(S1 - S0);
  });
});
