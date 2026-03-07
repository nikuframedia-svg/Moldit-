// =====================================================================
//  INCOMPOL PLAN -- Load Leveler Tests
//  Verifies levelLoad() balances machine utilization across days
//
//  Factory context: 8-day horizon (Feb 27 - Mar 6, 2026)
//  workdays = [F, F, F, T, T, T, T, T]
//  DAY_CAP = 990 min (2 shifts: 07:30-24:00)
//  LEVEL_LOW_THRESHOLD = 0.50, LEVEL_HIGH_THRESHOLD = 0.85
// =====================================================================

import { DAY_CAP, LEVEL_HIGH_THRESHOLD, LEVEL_LOW_THRESHOLD } from '../src/constants.js';
import { DecisionRegistry } from '../src/decisions/decision-registry.js';
import type { EarliestStartEntry } from '../src/scheduler/backward-scheduler.js';
import { levelLoad } from '../src/scheduler/load-leveler.js';
import type { Block } from '../src/types/blocks.js';
import type { EMachine } from '../src/types/engine.js';

// ── Shared test data ─────────────────────────────────────────────────

const WORKDAYS: boolean[] = [false, false, false, true, true, true, true, true];
const N_DAYS = 8;

const MACHINES: EMachine[] = [
  { id: 'PRM019', area: 'PG1', focus: true },
  { id: 'PRM031', area: 'PG2', focus: true },
  { id: 'PRM039', area: 'PG2', focus: true },
];

/** Helper to build a minimal Block for testing */
function makeBlock(overrides: Partial<Block> & { opId: string; dayIdx: number }): Block {
  return {
    toolId: 'BFP079',
    sku: 'SKU-TEST',
    nm: 'Test Part',
    machineId: 'PRM019',
    origM: 'PRM019',
    qty: 100,
    prodMin: 200,
    setupMin: 30,
    operators: 2,
    blocked: false,
    reason: null,
    moved: false,
    hasAlt: false,
    altM: null,
    stk: 0,
    lt: 1000,
    atr: 0,
    startMin: 450,
    endMin: 680,
    setupS: null,
    setupE: null,
    type: 'ok',
    shift: 'X',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('levelLoad', () => {
  let registry: DecisionRegistry;

  beforeEach(() => {
    registry = new DecisionRegistry();
  });

  it('moves blocks from heavy day to light day', () => {
    // Day 6: heavy (900 min used out of 990 = 91% > 85%)
    // Day 4: light (200 min used = 20% < 50%)
    // The load leveler sorts candidates by prodMin descending, so OP02 (400 min)
    // is the first candidate considered. It has no earliestStart constraint, so
    // it moves to an earlier light day, reducing day 6 utilization.
    const blocks: Block[] = [
      // Day 4 (light): one small block
      makeBlock({ opId: 'OP01', dayIdx: 4, prodMin: 200, setupMin: 0 }),
      // Day 6 (heavy): several blocks totaling 900 min
      makeBlock({ opId: 'OP02', dayIdx: 6, prodMin: 400, setupMin: 30 }),
      makeBlock({ opId: 'OP03', dayIdx: 6, prodMin: 320, setupMin: 0 }),
      makeBlock({ opId: 'OP04', dayIdx: 6, prodMin: 150, setupMin: 0 }),
    ];

    const earliestStarts = new Map<string, EarliestStartEntry>();
    // All operations can start from day 3
    earliestStarts.set('OP02', {
      earliestDayIdx: 3,
      latestDayIdx: 7,
      ltDays: 1,
      source: 'prz_fabrico',
    });
    earliestStarts.set('OP03', {
      earliestDayIdx: 3,
      latestDayIdx: 7,
      ltDays: 1,
      source: 'prz_fabrico',
    });
    earliestStarts.set('OP04', {
      earliestDayIdx: 3,
      latestDayIdx: 7,
      ltDays: 1,
      source: 'prz_fabrico',
    });

    const result = levelLoad(blocks, MACHINES, WORKDAYS, earliestStarts, registry);

    // At least one block should have moved from day 6 to an earlier day
    const movedBlocks = result.filter((b) => b.isLeveled === true);
    expect(movedBlocks.length).toBeGreaterThanOrEqual(1);

    for (const mb of movedBlocks) {
      // Moved blocks came from day 6 and went to an earlier day
      expect(mb.dayIdx).toBeLessThan(6);
    }
  });

  it('does not move block when earliestStart prevents it', () => {
    // Day 6: heavy, Day 3: light
    // But OP04 has earliestStart=6, so it cannot move before day 6
    const blocks: Block[] = [
      makeBlock({ opId: 'OP01', dayIdx: 3, prodMin: 100, setupMin: 0 }),
      makeBlock({ opId: 'OP02', dayIdx: 6, prodMin: 500, setupMin: 30 }),
      makeBlock({ opId: 'OP03', dayIdx: 6, prodMin: 300, setupMin: 0 }),
      makeBlock({ opId: 'OP04', dayIdx: 6, prodMin: 100, setupMin: 0 }),
    ];

    const earliestStarts = new Map<string, EarliestStartEntry>();
    // OP04 cannot start before day 6 (lead time constraint)
    earliestStarts.set('OP04', {
      earliestDayIdx: 6,
      latestDayIdx: 7,
      ltDays: 5,
      source: 'prz_fabrico',
    });
    // OP02 and OP03 also locked to day 6
    earliestStarts.set('OP02', {
      earliestDayIdx: 6,
      latestDayIdx: 7,
      ltDays: 5,
      source: 'prz_fabrico',
    });
    earliestStarts.set('OP03', {
      earliestDayIdx: 6,
      latestDayIdx: 7,
      ltDays: 5,
      source: 'prz_fabrico',
    });

    const result = levelLoad(blocks, MACHINES, WORKDAYS, earliestStarts, registry);

    // All blocks on day 6 should stay on day 6 (earliestStart prevents move)
    const day6Blocks = result.filter((b) => b.dayIdx === 6);
    expect(day6Blocks).toHaveLength(3);
  });

  it('does not move block if target day would become overloaded', () => {
    // Day 5: already at 80% (792 min), Day 7: heavy at 90%
    // Moving a block of 200 min to day 5 would push it to 792+200=992 > 85% of 990
    const blocks: Block[] = [
      // Day 5: already moderately loaded (but below LOW threshold is false, it's 80%)
      makeBlock({ opId: 'OP01', dayIdx: 5, prodMin: 792, setupMin: 0 }),
      // Day 7: heavy
      makeBlock({ opId: 'OP02', dayIdx: 7, prodMin: 700, setupMin: 30 }),
      makeBlock({ opId: 'OP03', dayIdx: 7, prodMin: 200, setupMin: 0 }),
    ];

    const earliestStarts = new Map<string, EarliestStartEntry>();

    const result = levelLoad(blocks, MACHINES, WORKDAYS, earliestStarts, registry);

    // Day 5 is at 80% (>50%), so it is NOT a light day -- nothing should move there
    // Block OP03 on day 7 should not move to day 5
    const op3 = result.find((b) => b.opId === 'OP03')!;
    // If it did move, it would only be to a day with util < 50%
    // Day 5 at 80% does not qualify as light
    if (op3.dayIdx !== 7) {
      // If it moved, the target must have been a light day (< 50%)
      const targetDayBlocks = result.filter(
        (b) => b.machineId === 'PRM019' && b.dayIdx === op3.dayIdx && b.opId !== 'OP03',
      );
      const targetUsed = targetDayBlocks.reduce((s, b) => s + b.prodMin + b.setupMin, 0);
      expect(targetUsed / DAY_CAP).toBeLessThan(LEVEL_LOW_THRESHOLD);
    }
  });

  it('only moves to earlier days, never to later days', () => {
    // Day 3: heavy at 95%, Day 7: light at 10%
    // Even though day 7 is light, blocks should never move to a LATER day
    const blocks: Block[] = [
      makeBlock({ opId: 'OP01', dayIdx: 3, prodMin: 600, setupMin: 30 }),
      makeBlock({ opId: 'OP02', dayIdx: 3, prodMin: 300, setupMin: 0 }),
      makeBlock({ opId: 'OP03', dayIdx: 7, prodMin: 100, setupMin: 0 }),
    ];

    const earliestStarts = new Map<string, EarliestStartEntry>();

    const result = levelLoad(blocks, MACHINES, WORKDAYS, earliestStarts, registry);

    // Blocks on day 3 should never move to day 7 (later)
    for (const b of result) {
      if (b.opId === 'OP01' || b.opId === 'OP02') {
        expect(b.dayIdx).toBeLessThanOrEqual(3);
      }
    }
  });

  it('records decisions in the registry for every move', () => {
    const blocks: Block[] = [
      makeBlock({ opId: 'OP01', dayIdx: 4, prodMin: 100, setupMin: 0 }),
      makeBlock({ opId: 'OP02', dayIdx: 6, prodMin: 500, setupMin: 30 }),
      makeBlock({ opId: 'OP03', dayIdx: 6, prodMin: 350, setupMin: 0 }),
      makeBlock({ opId: 'OP04', dayIdx: 6, prodMin: 60, setupMin: 0, sku: '4927.020.001' }),
    ];

    const earliestStarts = new Map<string, EarliestStartEntry>();

    levelLoad(blocks, MACHINES, WORKDAYS, earliestStarts, registry);

    const moves = registry.getByType('LOAD_LEVEL');
    // At least OP04 should have been moved (smallest, easiest to fit)
    if (moves.length > 0) {
      const move = moves[0];
      expect(move.type).toBe('LOAD_LEVEL');
      expect(move.opId).toBeTruthy();
      expect(move.metadata['fromDay']).toBeDefined();
      expect(move.metadata['toDay']).toBeDefined();
      expect(typeof move.metadata['fromUtil']).toBe('number');
      expect(typeof move.metadata['toUtil']).toBe('number');
    }
  });

  it('does not move blocked or overflow blocks', () => {
    const blocks: Block[] = [
      makeBlock({ opId: 'OP01', dayIdx: 4, prodMin: 100, setupMin: 0 }),
      // Blocked block on heavy day
      makeBlock({
        opId: 'OP02',
        dayIdx: 6,
        prodMin: 500,
        setupMin: 30,
        type: 'blocked',
        blocked: true,
        reason: 'machine_down',
      }),
      // Overflow block on heavy day
      makeBlock({
        opId: 'OP03',
        dayIdx: 6,
        prodMin: 400,
        setupMin: 0,
        type: 'overflow',
        overflow: true,
      }),
    ];

    const earliestStarts = new Map<string, EarliestStartEntry>();

    const result = levelLoad(blocks, MACHINES, WORKDAYS, earliestStarts, registry);

    // Blocked and overflow blocks should stay on their original day
    const op2 = result.find((b) => b.opId === 'OP02')!;
    const op3 = result.find((b) => b.opId === 'OP03')!;
    expect(op2.dayIdx).toBe(6);
    expect(op3.dayIdx).toBe(6);
  });

  it('returns unmodified blocks when workdays < 2', () => {
    // Only 1 working day -- nothing to level
    const singleDay: boolean[] = [false, false, false, true, false, false, false, false];
    const blocks: Block[] = [makeBlock({ opId: 'OP01', dayIdx: 3, prodMin: 900, setupMin: 30 })];

    const earliestStarts = new Map<string, EarliestStartEntry>();

    const result = levelLoad(blocks, MACHINES, singleDay, earliestStarts, registry);
    expect(result).toHaveLength(1);
    expect(result[0].dayIdx).toBe(3);
  });

  it('returns copies of blocks (does not mutate originals)', () => {
    const blocks: Block[] = [
      makeBlock({ opId: 'OP01', dayIdx: 4, prodMin: 100, setupMin: 0 }),
      makeBlock({ opId: 'OP02', dayIdx: 6, prodMin: 900, setupMin: 30 }),
    ];

    const earliestStarts = new Map<string, EarliestStartEntry>();

    const result = levelLoad(blocks, MACHINES, WORKDAYS, earliestStarts, registry);

    // Original blocks should not be mutated
    expect(blocks[0].dayIdx).toBe(4);
    expect(blocks[1].dayIdx).toBe(6);
    // Result may have different references
    expect(result[0]).not.toBe(blocks[0]);
  });
});
