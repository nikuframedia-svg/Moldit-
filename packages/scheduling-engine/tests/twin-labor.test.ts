// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- Twin Blocks & Labor Windows (R10) Tests
//
//  Verifies that twin co-production blocks book operators ONCE
//  (not per-SKU) and interact correctly with the labor window model.
//
//  R10: A twin block is a SINGLE production run producing 2 SKUs.
//       It books operators once, not twice.
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { computeWorkforceDemand } from '../src/analysis/op-demand.js';
import { createOperatorPool } from '../src/constraints/operator-pool.js';
import type { Block } from '../src/types/blocks.js';
import type { WorkforceConfig } from '../src/types/workforce.js';

// ── Shared Config ──────────────────────────────────────────────────

const testConfig: WorkforceConfig = {
  laborGroups: {
    Grandes: [
      { start: 420, end: 930, capacity: 6 },
      { start: 930, end: 960, capacity: 6 },
      { start: 960, end: 1440, capacity: 5 },
    ],
  },
  machineToLaborGroup: {
    PRM019: 'Grandes',
    PRM031: 'Grandes',
    PRM039: 'Grandes',
    PRM043: 'Grandes',
  },
};

// ── Twin Block Factory ─────────────────────────────────────────────

function makeTwinBlock(overrides: Partial<Block>): Block {
  return {
    opId: 'OP1',
    sku: 'SKU-A',
    toolId: 'T1',
    machineId: 'PRM019',
    dayIdx: 0,
    startMin: 420,
    endMin: 875,
    prodMin: 455,
    type: 'ok' as const,
    operators: 3,
    shift: 'X' as const,
    nm: 'SKU-A',
    origM: 'PRM019',
    qty: 200,
    setupMin: 0,
    blocked: false,
    reason: null,
    moved: false,
    hasAlt: false,
    altM: null,
    stk: 0,
    lt: 500,
    atr: 0,
    setupS: null,
    setupE: null,
    overflow: false,
    belowMinBatch: false,
    isTwinProduction: true,
    coProductionGroupId: 'twin-grp-1',
    outputs: [
      { opId: 'OP1', sku: 'SKU-A', qty: 200 },
      { opId: 'OP1-twin', sku: 'SKU-B', qty: 200 },
    ],
    ...overrides,
  };
}

// ── Regular Block Factory ──────────────────────────────────────────

function makeBlock(overrides: Partial<Block>): Block {
  return {
    opId: 'OP-X',
    sku: 'SKU-X',
    toolId: 'T-X',
    machineId: 'PRM019',
    dayIdx: 0,
    startMin: 420,
    endMin: 875,
    prodMin: 455,
    type: 'ok' as const,
    operators: 2,
    shift: 'X' as const,
    nm: 'SKU-X',
    origM: 'PRM019',
    qty: 100,
    setupMin: 0,
    blocked: false,
    reason: null,
    moved: false,
    hasAlt: false,
    altM: null,
    stk: 0,
    lt: 500,
    atr: 0,
    setupS: null,
    setupE: null,
    overflow: false,
    belowMinBatch: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════

describe('Twin Blocks & Labor Windows (R10)', () => {
  // ── Test 1 ──────────────────────────────────────────────────────────
  it('Twin block: single operator booking', () => {
    const pool = createOperatorPool(testConfig);
    const twin = makeTwinBlock({ operators: 3 });

    // Book the twin block ONCE — twin produces 2 SKUs but is a single run
    pool.book(twin.dayIdx, twin.startMin, twin.endMin, twin.operators, twin.machineId);

    // Peak usage for Grandes in the first window should be 3 (the block's operators)
    // NOT 6 (which would be double-counted: 3 per SKU)
    const usage = pool.getCurrentUsage(0, 420, 'Grandes');
    expect(usage).toBe(3);

    // Booking the same twin block again (same machine) should NOT increase the peak
    // because the peak model uses max, not sum, for the same machine
    pool.book(twin.dayIdx, twin.startMin, twin.endMin, twin.operators, twin.machineId);
    const usageAfter = pool.getCurrentUsage(0, 420, 'Grandes');
    expect(usageAfter).toBe(3);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────
  it('Twin block at window boundary', () => {
    const pool = createOperatorPool(testConfig);

    // Twin block spans [920, 960] — crosses first→second Grandes window
    // Window 1: [420, 930) capacity=6, overlap [920, 930)
    // Window 2: [930, 960) capacity=6, overlap [930, 960)
    const twin = makeTwinBlock({
      startMin: 920,
      endMin: 960,
      prodMin: 40,
      operators: 4,
    });

    const check = pool.checkCapacity(
      twin.dayIdx,
      twin.startMin,
      twin.endMin,
      twin.operators,
      twin.machineId,
    );

    // Both segments have capacity=6, need=4 → hasCapacity=true
    expect(check.hasCapacity).toBe(true);
    expect(check.laborGroup).toBe('Grandes');
    expect(check.unmapped).toBe(false);

    // Available should be min across overlapping windows = min(6, 6) = 6
    expect(check.available).toBe(6);

    // Now book it and verify both windows get updated
    pool.book(twin.dayIdx, twin.startMin, twin.endMin, twin.operators, twin.machineId);

    const usageW1 = pool.getCurrentUsage(0, 420, 'Grandes'); // first window
    const usageW2 = pool.getCurrentUsage(0, 930, 'Grandes'); // second window
    expect(usageW1).toBe(4);
    expect(usageW2).toBe(4);

    // Checking capacity again: now available = 6-4 = 2 per window
    const check2 = pool.checkCapacity(0, 920, 960, 3, 'PRM031');
    // 3 on PRM031 + 4 on PRM019 = 7 > 6 → no capacity
    expect(check2.hasCapacity).toBe(false);
    expect(check2.worstWindowShortage).toBe(1); // 7 - 6 = 1
  });

  // ── Test 3 ──────────────────────────────────────────────────────────
  it("Twin co-production doesn't duplicate operators per SKU", () => {
    // Twin co-production produces a SINGLE block on a machine (not two blocks).
    // Both SKUs come from one production run with one operator booking.
    // Create one twin block (the correct representation) and verify demand.
    const twin = makeTwinBlock({
      machineId: 'PRM019',
      operators: 3,
      startMin: 420,
      endMin: 875,
      outputs: [
        { opId: 'OP1', sku: 'SKU-A', qty: 200 },
        { opId: 'OP1-twin', sku: 'SKU-B', qty: 200 },
      ],
    });

    const blocks: Block[] = [twin];
    const result = computeWorkforceDemand(blocks, testConfig, 1);

    // First window [420, 930): twin block overlaps → peakNeed = 3
    const grandesW1 = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(grandesW1).toBeDefined();
    expect(grandesW1!.peakNeed).toBe(3); // single block's operators
    expect(grandesW1!.overloaded).toBe(false); // 3 <= 6

    // Verify that the peak is NOT doubled (would be 6 if counted per output)
    expect(grandesW1!.peakNeed).not.toBe(6);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────
  it('Twin with overload -> single warning', () => {
    // Scenario: multiple machines with high operators cause overload.
    // The twin block contributes its operators ONCE.
    //
    // PRM019: twin block, operators=3
    // PRM031: regular block, operators=3
    // PRM039: regular block, operators=2
    // Total peak in Grandes first window = 3 + 3 + 2 = 8 > capacity 6 → overload
    const twin = makeTwinBlock({
      machineId: 'PRM019',
      operators: 3,
      startMin: 420,
      endMin: 875,
    });
    const regular1 = makeBlock({
      opId: 'OP-R1',
      machineId: 'PRM031',
      operators: 3,
      startMin: 420,
      endMin: 875,
    });
    const regular2 = makeBlock({
      opId: 'OP-R2',
      machineId: 'PRM039',
      operators: 2,
      startMin: 420,
      endMin: 875,
    });

    const blocks: Block[] = [twin, regular1, regular2];
    const result = computeWorkforceDemand(blocks, testConfig, 1);

    const grandesW1 = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(grandesW1).toBeDefined();

    // Peak = 3 (PRM019 twin) + 3 (PRM031) + 2 (PRM039) = 8
    // Twin contributes 3 ONCE, not 6 (doubled per output)
    expect(grandesW1!.peakNeed).toBe(8);
    expect(grandesW1!.overloaded).toBe(true);
    expect(grandesW1!.peakShortage).toBe(2); // 8 - 6 = 2

    // Exactly 1 warning for first window (the only overloaded window)
    const firstWindowWarnings = result.warnings.filter(
      (w) => w.windowStart === 420 && w.dayIdx === 0,
    );
    expect(firstWindowWarnings).toHaveLength(1);

    // If twin had been double-counted, peakNeed would be 11 (6+3+2) and shortage 5
    expect(grandesW1!.peakNeed).not.toBe(11);
    expect(grandesW1!.peakShortage).not.toBe(5);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────
  it('Twin + unmapped machine', () => {
    const pool = createOperatorPool(testConfig);

    // PRM020 is NOT in machineToLaborGroup → unmapped
    const twin = makeTwinBlock({
      machineId: 'PRM020',
      operators: 5,
      startMin: 420,
      endMin: 875,
    });

    const check = pool.checkCapacity(
      twin.dayIdx,
      twin.startMin,
      twin.endMin,
      twin.operators,
      twin.machineId,
    );

    // Unmapped machine: constraint bypassed (R8)
    expect(check.unmapped).toBe(true);
    expect(check.hasCapacity).toBe(true);
    expect(check.laborGroup).toBeUndefined();
    expect(check.available).toBe(Infinity);
    expect(check.worstWindowShortage).toBe(0);

    // Booking on unmapped machine should not affect any labor group
    pool.book(twin.dayIdx, twin.startMin, twin.endMin, twin.operators, twin.machineId);
    const grandesUsage = pool.getCurrentUsage(0, 420, 'Grandes');
    expect(grandesUsage).toBe(0);
  });
});
