// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Late Delivery Analysis Tests
//
//  Verifies analyzeLateDeliveries() correctly identifies demand checkpoints
//  where cumulative production is insufficient, estimates delays,
//  and produces correct suggested actions.
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { analyzeLateDeliveries } from '../src/analysis/late-delivery-analysis.js';
import type { Block } from '../src/types/blocks.js';
import type { EOp } from '../src/types/engine.js';

// ── Helpers ──

function mkOp(overrides: Partial<EOp> & { id: string; d: number[] }): EOp {
  return {
    t: 'T01',
    m: 'PRM019',
    sku: overrides.id,
    nm: `Op ${overrides.id}`,
    atr: 0,
    ...overrides,
  };
}

function mkBlock(overrides: Partial<Block> & { opId: string; dayIdx: number; qty: number }): Block {
  return {
    machineId: 'PRM019',
    toolId: 'T01',
    startMin: 420,
    endMin: 480,
    shift: 'X',
    type: 'ok',
    moved: false,
    overflow: false,
    ...overrides,
  };
}

const DATES = ['2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14'];

// ── Tests ──

describe('analyzeLateDeliveries', () => {
  it('returns empty analysis when ops have zero demand', () => {
    const ops = [mkOp({ id: 'OP1', d: [0, 0, 0] })];
    const result = analyzeLateDeliveries([], ops, DATES, {});

    expect(result.entries).toHaveLength(0);
    expect(result.unresolvedCount).toBe(0);
    expect(result.resolvedWithCostCount).toBe(0);
    expect(result.totalShortfallPcs).toBe(0);
    expect(result.otdDelivery).toBe(100);
  });

  it('returns empty when all demand is met on time', () => {
    const ops = [mkOp({ id: 'OP1', d: [100, 0, 200] })];
    const blocks = [
      mkBlock({ opId: 'OP1', dayIdx: 0, qty: 100 }),
      mkBlock({ opId: 'OP1', dayIdx: 2, qty: 200 }),
    ];
    const result = analyzeLateDeliveries(blocks, ops, DATES, {});

    expect(result.entries).toHaveLength(0);
    expect(result.unresolvedCount).toBe(0);
    expect(result.otdDelivery).toBe(100);
  });

  it('detects unresolved late delivery with correct shortfall', () => {
    // Demand: 100 on day 0, 200 on day 2. No blocks at all.
    const ops = [mkOp({ id: 'OP1', d: [100, 0, 200] })];
    const result = analyzeLateDeliveries([], ops, DATES, {});

    expect(result.entries).toHaveLength(1);
    expect(result.unresolvedCount).toBe(1);
    expect(result.entries[0].opId).toBe('OP1');
    expect(result.entries[0].isResolved).toBe(false);
    // Worst shortfall: day 2 with cumDemand=300, cumProd=0 → shortfall=300
    expect(result.entries[0].shortfall).toBe(300);
    expect(result.entries[0].deadline).toBe(2);
    expect(result.entries[0].deadlineDate).toBe('2026-03-12');
    expect(result.otdDelivery).toBe(0);
  });

  it('detects resolved late delivery (production catches up later)', () => {
    // Demand: 100 on day 0. No production on day 0, but 150 on day 2.
    const ops = [mkOp({ id: 'OP1', d: [100, 0, 0, 0, 0] })];
    const blocks = [mkBlock({ opId: 'OP1', dayIdx: 2, qty: 150 })];
    const result = analyzeLateDeliveries(blocks, ops, DATES, {});

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].isResolved).toBe(true);
    expect(result.entries[0].delayDays).toBe(2); // day 0 → day 2
    expect(result.entries[0].earliestPossibleDay).toBe(2);
    expect(result.resolvedWithCostCount).toBe(1);
    expect(result.unresolvedCount).toBe(0);
  });

  it('uses client tier from clientTiers map, defaults to 3', () => {
    const ops = [
      mkOp({ id: 'OP1', d: [100], cl: 'FAU', clNm: 'Faurecia' }),
      mkOp({ id: 'OP2', d: [50], cl: 'OTHER' }),
    ];
    const tiers = { FAU: 1 };
    const result = analyzeLateDeliveries([], ops, DATES, tiers);

    expect(result.entries).toHaveLength(2);
    // Sorted by tier ascending (higher priority first)
    expect(result.entries[0].clientTier).toBe(1);
    expect(result.entries[0].cl).toBe('FAU');
    expect(result.entries[1].clientTier).toBe(3); // default
    expect(result.worstTierAffected).toBe(1);
  });

  it('sorts unresolved before resolved, then by tier', () => {
    const ops = [
      mkOp({ id: 'OP1', d: [100, 0, 0], cl: 'C5' }), // tier 5, no blocks → unresolved
      mkOp({ id: 'OP2', d: [50, 0, 0], cl: 'C1' }), // tier 1, resolved by day 2
    ];
    const blocks = [mkBlock({ opId: 'OP2', dayIdx: 2, qty: 50 })];
    const tiers = { C1: 1, C5: 5 };
    const result = analyzeLateDeliveries(blocks, ops, DATES, tiers);

    expect(result.entries).toHaveLength(2);
    // OP1 unresolved comes first despite worse tier
    expect(result.entries[0].opId).toBe('OP1');
    expect(result.entries[0].isResolved).toBe(false);
    expect(result.entries[1].opId).toBe('OP2');
    expect(result.entries[1].isResolved).toBe(true);
  });

  it('suggests correct actions based on delay severity', () => {
    // 1 day delay → OVERTIME, THIRD_SHIFT, FORMAL_ACCEPT
    const ops = [mkOp({ id: 'OP1', d: [100, 0, 0, 0, 0] })];
    const blocks = [mkBlock({ opId: 'OP1', dayIdx: 1, qty: 100 })];
    const result = analyzeLateDeliveries(blocks, ops, DATES, {});

    const entry = result.entries[0];
    expect(entry.delayDays).toBe(1);
    expect(entry.suggestedActions).toContain('OVERTIME');
    expect(entry.suggestedActions).toContain('THIRD_SHIFT');
    expect(entry.suggestedActions).toContain('FORMAL_ACCEPT');
    expect(entry.suggestedActions).not.toContain('NEGOTIATE_DATE');
  });

  it('suggests NEGOTIATE_DATE for delays > 5 days', () => {
    // Demand on day 0, no production at all → unresolved, 5 days of horizon
    const ops = [mkOp({ id: 'OP1', d: [100, 0, 0, 0, 0, 0, 0, 0] })];
    const dates8 = [...DATES, '2026-03-15', '2026-03-16', '2026-03-17'];
    const result = analyzeLateDeliveries([], ops, dates8, {});

    const entry = result.entries[0];
    expect(entry.suggestedActions).toContain('NEGOTIATE_DATE');
    expect(entry.suggestedActions).toContain('FORMAL_ACCEPT');
  });

  it('handles twin-aware production via outputs[]', () => {
    // Twin block produces for both OP1 and OP2
    const ops = [
      mkOp({ id: 'OP1', d: [100, 0] }),
      mkOp({ id: 'OP2', d: [50, 0] }),
    ];
    const twinBlock: Block = {
      opId: 'OP1',
      machineId: 'PRM019',
      toolId: 'T01',
      startMin: 420,
      endMin: 480,
      shift: 'X',
      type: 'ok',
      moved: false,
      overflow: false,
      dayIdx: 0,
      qty: 100,
      isTwinProduction: true,
      outputs: [
        { opId: 'OP1', qty: 100 },
        { opId: 'OP2', qty: 50 },
      ],
    };
    const result = analyzeLateDeliveries([twinBlock], ops, DATES, {});

    // Both ops should be fully met
    expect(result.entries).toHaveLength(0);
    expect(result.otdDelivery).toBe(100);
  });

  it('twin block partial coverage creates late entry for shortfall', () => {
    const ops = [
      mkOp({ id: 'OP1', d: [100, 0] }),
      mkOp({ id: 'OP2', d: [80, 0] }),
    ];
    const twinBlock: Block = {
      opId: 'OP1',
      machineId: 'PRM019',
      toolId: 'T01',
      startMin: 420,
      endMin: 480,
      shift: 'X',
      type: 'ok',
      moved: false,
      overflow: false,
      dayIdx: 0,
      qty: 100,
      isTwinProduction: true,
      outputs: [
        { opId: 'OP1', qty: 100 },
        { opId: 'OP2', qty: 30 }, // only 30 of 80 needed
      ],
    };
    const result = analyzeLateDeliveries([twinBlock], ops, DATES, {});

    // OP1 ok, OP2 has shortfall 50
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].opId).toBe('OP2');
    expect(result.entries[0].shortfall).toBe(50);
  });

  it('ignores blocked blocks', () => {
    const ops = [mkOp({ id: 'OP1', d: [100] })];
    const blocks = [mkBlock({ opId: 'OP1', dayIdx: 0, qty: 100, type: 'blocked' })];
    const result = analyzeLateDeliveries(blocks, ops, DATES, {});

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].isResolved).toBe(false);
    expect(result.entries[0].shortfall).toBe(100);
  });

  it('computes otdDelivery percentage correctly', () => {
    // 2 ops, 3 checkpoints total. 2 met, 1 missed.
    const ops = [
      mkOp({ id: 'OP1', d: [100, 0, 200] }), // 2 checkpoints
      mkOp({ id: 'OP2', d: [50] }), // 1 checkpoint
    ];
    const blocks = [
      mkBlock({ opId: 'OP1', dayIdx: 0, qty: 100 }),
      // OP1 day 2: need cumDemand=300, cumProd=100 → miss
      mkBlock({ opId: 'OP2', dayIdx: 0, qty: 50 }),
    ];
    const result = analyzeLateDeliveries(blocks, ops, DATES, {});

    // 2 on time out of 3 = 66.67%
    expect(result.otdDelivery).toBeCloseTo(66.67, 1);
  });

  it('tracks affected clients correctly', () => {
    const ops = [
      mkOp({ id: 'OP1', d: [100], cl: 'FAU', clNm: 'Faurecia' }),
      mkOp({ id: 'OP2', d: [50], cl: 'FAU', clNm: 'Faurecia' }),
      mkOp({ id: 'OP3', d: [30], cl: 'ABC', clNm: 'ABC Co' }),
    ];
    const result = analyzeLateDeliveries([], ops, DATES, {});

    expect(result.affectedClients).toContain('FAU');
    expect(result.affectedClients).toContain('ABC');
    expect(result.affectedClients).toHaveLength(2);
  });

  it('collapses multiple checkpoints to worst shortfall per op', () => {
    // Op has demand on day 0 (100) and day 2 (200). No production at all.
    // Day 0: shortfall 100. Day 2: shortfall 300 (worst).
    const ops = [mkOp({ id: 'OP1', d: [100, 0, 200] })];
    const result = analyzeLateDeliveries([], ops, DATES, {});

    // Should have ONE entry for OP1 with worst shortfall
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].shortfall).toBe(300);
    expect(result.entries[0].deadline).toBe(2); // worst checkpoint
  });

  it('detects resolvedBy ALT_MACHINE when blocks on different machine', () => {
    const ops = [mkOp({ id: 'OP1', d: [100, 0, 0], m: 'PRM019' })];
    // Production on alt machine resolves it
    const blocks = [mkBlock({ opId: 'OP1', dayIdx: 2, qty: 100, machineId: 'PRM039' })];
    const result = analyzeLateDeliveries(blocks, ops, DATES, {});

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].isResolved).toBe(true);
    expect(result.entries[0].resolvedBy).toBe('ALT_MACHINE');
  });
});
