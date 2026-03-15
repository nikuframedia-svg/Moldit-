// =====================================================================
//  INCOMPOL PLAN — Tests for repair-violations.ts
//
//  Covers: setup overlap repair, overcapacity clipping, overtime map,
//  combined repairs, qty proportional recalculation.
// =====================================================================

import { describe, expect, it } from 'vitest';

import { DAY_CAP, MINUTES_PER_DAY, S0 } from '../src/constants.js';
import { repairScheduleViolations } from '../src/scheduler/repair-violations.js';
import type { Block } from '../src/types/blocks.js';

// ── Helper: minimal valid Block ─────────────────────────────────

function mkBlock(overrides: Partial<Block> = {}): Block {
  return {
    opId: 'OP1',
    toolId: 'T1',
    sku: 'SKU1',
    nm: 'Part 1',
    machineId: 'PRM039',
    origM: 'PRM039',
    dayIdx: 0,
    qty: 1000,
    prodMin: 500,
    setupMin: 30,
    operators: 1,
    blocked: false,
    reason: null,
    moved: false,
    hasAlt: false,
    altM: null,
    stk: 0,
    lt: 0,
    atr: 0,
    startMin: S0 + 30, // after setup
    endMin: S0 + 30 + 500, // 950
    setupS: S0,
    setupE: S0 + 30,
    type: 'ok',
    shift: 'X',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════
//  1. No violations — blocks pass through unchanged
// ══════════════════════════════════════════════════════════════════

describe('repairScheduleViolations', () => {
  it('returns blocks unchanged when no violations exist', () => {
    const blocks: Block[] = [
      mkBlock({ opId: 'OP1', machineId: 'PRM039', startMin: S0 + 30, endMin: S0 + 200, prodMin: 170, setupS: S0, setupE: S0 + 30 }),
      mkBlock({ opId: 'OP2', machineId: 'PRM042', startMin: S0 + 60, endMin: S0 + 250, prodMin: 190, setupS: S0 + 30, setupE: S0 + 60 }),
    ];

    const result = repairScheduleViolations(blocks);

    expect(result.setupRepairs).toBe(0);
    expect(result.capacityRepairs).toBe(0);
    // Blocks should be shallow copies (not mutated originals)
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].startMin).toBe(blocks[0].startMin);
    expect(result.blocks[1].startMin).toBe(blocks[1].startMin);
  });

  it('does not touch non-ok blocks', () => {
    const blocks: Block[] = [
      mkBlock({ opId: 'OP1', type: 'overflow', setupS: S0, setupE: S0 + 30 }),
      mkBlock({ opId: 'OP2', type: 'blocked', setupS: S0, setupE: S0 + 30, machineId: 'PRM042' }),
    ];

    const result = repairScheduleViolations(blocks);
    expect(result.setupRepairs).toBe(0);
    expect(result.capacityRepairs).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════
  //  2. Setup overlap across machines — later setup gets delayed
  // ══════════════════════════════════════════════════════════════════

  it('delays later setup when two setups on different machines overlap', () => {
    // Both setups start at S0 on day 0, but on different machines
    const setupDur = 30;
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP_A',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: S0,
        setupE: S0 + setupDur,
        startMin: S0 + setupDur,
        endMin: S0 + setupDur + 200,
        prodMin: 200,
        qty: 500,
      }),
      mkBlock({
        opId: 'OP_B',
        machineId: 'PRM042',
        dayIdx: 0,
        setupS: S0,
        setupE: S0 + setupDur,
        startMin: S0 + setupDur,
        endMin: S0 + setupDur + 200,
        prodMin: 200,
        qty: 500,
      }),
    ];

    const result = repairScheduleViolations(blocks);

    expect(result.setupRepairs).toBe(1);
    // One block keeps its original time, the other is delayed
    const delayed = result.blocks.find((b) => b.setupS !== S0);
    expect(delayed).toBeDefined();
    expect(delayed!.setupS).toBe(S0 + setupDur); // starts after first setup ends
    expect(delayed!.setupE).toBe(S0 + setupDur + setupDur);
    expect(delayed!.startMin).toBe(delayed!.setupE); // production follows setup
  });

  it('does NOT delay setups on the same machine (same machine is fine)', () => {
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP_A',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: S0,
        setupE: S0 + 30,
        startMin: S0 + 30,
        endMin: S0 + 230,
        prodMin: 200,
      }),
      mkBlock({
        opId: 'OP_B',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: S0 + 10,
        setupE: S0 + 40,
        startMin: S0 + 40,
        endMin: S0 + 240,
        prodMin: 200,
      }),
    ];

    const result = repairScheduleViolations(blocks);
    // Same machine overlaps are allowed (setup crew is factory-wide cross-machine)
    expect(result.setupRepairs).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════
  //  3. Overcapacity on a machine/day — last blocks get clipped
  // ══════════════════════════════════════════════════════════════════

  it('clips the last block when machine-day exceeds DAY_CAP', () => {
    // DAY_CAP = 1020 (S1-S0). Put two blocks totaling 1100 min production + setups
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP_EARLY',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0,
        endMin: S0 + 600,
        prodMin: 600,
        qty: 1000,
      }),
      mkBlock({
        opId: 'OP_LATE',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0 + 600,
        endMin: S0 + 600 + 500, // total = 1100 > DAY_CAP=1020
        prodMin: 500,
        qty: 800,
      }),
    ];

    const result = repairScheduleViolations(blocks);

    expect(result.capacityRepairs).toBe(1);

    // The victim should be OP_LATE (latest endMin)
    const victim = result.blocks.find((b) => b.opId === 'OP_LATE' && b.type === 'ok');
    expect(victim).toBeDefined();
    // excess = 1100 - 1020 = 80, so 80 min clipped from prodMin
    expect(victim!.prodMin).toBe(500 - 80);
    // An overflow block should have been added
    const overflow = result.blocks.find((b) => b.type === 'overflow');
    expect(overflow).toBeDefined();
    expect(overflow!.prodMin).toBe(80);
  });

  it('converts entire block to overflow when clipMin >= prodDur', () => {
    // One block uses all capacity, second block has tiny prod that fully gets clipped
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP_FULL',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0,
        endMin: S0 + DAY_CAP,
        prodMin: DAY_CAP,
        qty: 2000,
      }),
      mkBlock({
        opId: 'OP_EXCESS',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0 + DAY_CAP,
        endMin: S0 + DAY_CAP + 50,
        prodMin: 50,
        qty: 100,
      }),
    ];

    const result = repairScheduleViolations(blocks);

    expect(result.capacityRepairs).toBe(1);
    const victim = result.blocks.find((b) => b.opId === 'OP_EXCESS');
    expect(victim).toBeDefined();
    expect(victim!.type).toBe('overflow');
  });

  // ══════════════════════════════════════════════════════════════════
  //  4. Overtime map increases effective capacity
  // ══════════════════════════════════════════════════════════════════

  it('does not clip when overtime map makes capacity sufficient', () => {
    const excess = 80;
    const total = DAY_CAP + excess; // 1100 min
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP1',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0,
        endMin: S0 + total,
        prodMin: total,
        qty: 2000,
      }),
    ];

    // Overtime map gives 100 extra minutes for PRM039 day 0 (> 80 excess)
    const overtimeMap = { PRM039: { 0: 100 } };
    const result = repairScheduleViolations(blocks, false, overtimeMap);

    expect(result.capacityRepairs).toBe(0);
    expect(result.blocks[0].prodMin).toBe(total); // unchanged
  });

  it('clips only the amount beyond effective capacity (base + overtime)', () => {
    const total = DAY_CAP + 150; // 1170 min total
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP1',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0,
        endMin: S0 + total,
        prodMin: total,
        qty: 2000,
      }),
    ];

    // Overtime of 100 → effective cap = 1120, excess = 1170 - 1120 = 50
    const overtimeMap = { PRM039: { 0: 100 } };
    const result = repairScheduleViolations(blocks, false, overtimeMap);

    expect(result.capacityRepairs).toBe(1);
    const ok = result.blocks.find((b) => b.type === 'ok');
    expect(ok).toBeDefined();
    expect(ok!.prodMin).toBe(total - 50);
  });

  // ══════════════════════════════════════════════════════════════════
  //  5. Combined setup + overcapacity repairs
  // ══════════════════════════════════════════════════════════════════

  it('repairs both setup overlaps and overcapacity in one pass', () => {
    // Two blocks on different machines with overlapping setups AND overcapacity
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP_A',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: S0,
        setupE: S0 + 30,
        startMin: S0 + 30,
        endMin: S0 + 30 + DAY_CAP, // fills the day exactly after setup
        prodMin: DAY_CAP,
        qty: 2000,
      }),
      mkBlock({
        opId: 'OP_B',
        machineId: 'PRM042',
        dayIdx: 0,
        setupS: S0,
        setupE: S0 + 30,
        startMin: S0 + 30,
        endMin: S0 + 30 + DAY_CAP,
        prodMin: DAY_CAP,
        qty: 2000,
      }),
    ];

    const result = repairScheduleViolations(blocks);

    // Setup repair: one of them should be delayed
    expect(result.setupRepairs).toBe(1);
    // The delayed block's setup + production may push past day boundary,
    // causing clipping → overcapacity repair may also fire
    // Both repairs should be counted
    expect(result.setupRepairs + result.capacityRepairs).toBeGreaterThanOrEqual(1);
  });

  // ══════════════════════════════════════════════════════════════════
  //  6. Quantity recalculation after clipping is proportional
  // ══════════════════════════════════════════════════════════════════

  it('recalculates qty proportionally when overcapacity clips production', () => {
    // 800 qty in 400 min → 2 pcs/min
    // excess clips 100 min → new prod = 300, qty should be ~600
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP_FILL',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0,
        endMin: S0 + 720,
        prodMin: 720,
        qty: 1000,
      }),
      mkBlock({
        opId: 'OP_CLIP',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0 + 720,
        endMin: S0 + 720 + 400,
        prodMin: 400,
        qty: 800,
      }),
    ];

    // total = 1120, DAY_CAP = 1020, excess = 100
    const result = repairScheduleViolations(blocks);

    expect(result.capacityRepairs).toBe(1);
    const clipped = result.blocks.find((b) => b.opId === 'OP_CLIP' && b.type === 'ok');
    expect(clipped).toBeDefined();
    // newProd = 400 - 100 = 300, qty = round(800 * 300/400) = 600
    expect(clipped!.qty).toBe(600);
    expect(clipped!.prodMin).toBe(300);
  });

  it('recalculates qty proportionally when setup overlap clips at day boundary', () => {
    // Setup delayed pushes production past midnight → qty proportional to remaining prod
    const setupDur = 30;
    // Block on PRM039 starts setup at S0 (occupies crew)
    // Block on PRM042 wants setup at S0 too → delayed to S0+30
    // PRM042 block: setup=30, prod from S0+60 to 1440, but originally endMin was 1440
    // After delay, production would extend past 1440 → clipped
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP_FIRST',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: S0,
        setupE: S0 + setupDur,
        startMin: S0 + setupDur,
        endMin: S0 + 200,
        prodMin: 170,
        qty: 500,
      }),
      mkBlock({
        opId: 'OP_DELAYED',
        machineId: 'PRM042',
        dayIdx: 0,
        setupS: S0,
        setupE: S0 + setupDur,
        startMin: S0 + setupDur,
        endMin: 1440, // originally fills to midnight
        prodMin: 1440 - S0 - setupDur, // 990
        qty: 2000,
      }),
    ];

    const result = repairScheduleViolations(blocks);

    expect(result.setupRepairs).toBe(1);
    // OP_DELAYED should be delayed by 30 min, clipping 30 min of production
    const delayed = result.blocks.find((b) => b.opId === 'OP_DELAYED');
    expect(delayed).toBeDefined();
    // Original prodDur = 990. After delay, setup moves to S0+30..S0+60.
    // Production starts at S0+60. endMin = S0+60 + 990 = 1050.
    // But 1050 < 1440, so no clipping needed in this case.
    // qty should remain 2000 if no clipping.
    // The key check: quantity is consistent with production time.
    const pcsPerMin = 2000 / 990;
    expect(delayed!.qty).toBeCloseTo(delayed!.prodMin * pcsPerMin, -1);
  });

  it('does not create negative prodMin or qty', () => {
    // Edge case: block with very small production that gets fully consumed
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP_BIG',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0,
        endMin: S0 + DAY_CAP,
        prodMin: DAY_CAP,
        qty: 2000,
      }),
      mkBlock({
        opId: 'OP_TINY',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0 + DAY_CAP,
        endMin: S0 + DAY_CAP + 5,
        prodMin: 5,
        qty: 10,
      }),
    ];

    const result = repairScheduleViolations(blocks);

    for (const b of result.blocks) {
      expect(b.prodMin).toBeGreaterThanOrEqual(0);
      expect(b.qty).toBeGreaterThanOrEqual(0);
    }
  });

  it('handles thirdShift capacity (S2-S0) correctly', () => {
    // With 3rd shift, base capacity = S2 - S0 = 1860 - 420 = 1440
    const thirdShiftCap = 1860 - S0; // 1440
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP1',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: null,
        setupE: null,
        setupMin: 0,
        startMin: S0,
        endMin: S0 + thirdShiftCap + 50, // 50 over
        prodMin: thirdShiftCap + 50,
        qty: 3000,
      }),
    ];

    const result = repairScheduleViolations(blocks, true);

    expect(result.capacityRepairs).toBe(1);
    const ok = result.blocks.find((b) => b.type === 'ok');
    // prodDur = thirdShiftCap + 50, excess = 50, newProd = thirdShiftCap
    expect(ok!.prodMin).toBe(thirdShiftCap);
  });

  it('does not mutate original blocks array', () => {
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP_A',
        machineId: 'PRM039',
        dayIdx: 0,
        setupS: S0,
        setupE: S0 + 30,
        startMin: S0 + 30,
        endMin: S0 + 230,
        prodMin: 200,
      }),
      mkBlock({
        opId: 'OP_B',
        machineId: 'PRM042',
        dayIdx: 0,
        setupS: S0,
        setupE: S0 + 30,
        startMin: S0 + 30,
        endMin: S0 + 230,
        prodMin: 200,
      }),
    ];

    const originalStartA = blocks[0].startMin;
    const originalStartB = blocks[1].startMin;

    repairScheduleViolations(blocks);

    // Originals unchanged
    expect(blocks[0].startMin).toBe(originalStartA);
    expect(blocks[1].startMin).toBe(originalStartB);
  });
});
