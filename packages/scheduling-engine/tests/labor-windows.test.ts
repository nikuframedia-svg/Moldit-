// =====================================================================
//  INCOMPOL PLAN -- Labor Windows (R3, R4, R8, R9) Tests
//
//  Contract 6: Window-based labor model verification.
//
//  Covers:
//    - Window resolution (correct capacity per minute)
//    - Cross-window block evaluation (worst window applies)
//    - Unmapped machine handling (R8)
//    - Peak concurrent model (max per machine, sum across group)
//    - LABOR_GROUP_UNMAPPED decision via scheduleAll
//    - computeWorkforceDemand: peakShortage + overloadPeopleMinutes
// =====================================================================

import { describe, expect, it } from 'vitest';
import { computeWorkforceDemand } from '../src/analysis/op-demand.js';
import { createOperatorPool } from '../src/constraints/operator-pool.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import { transformPlanState } from '../src/transform/transform-plan-state.js';
import type { Block } from '../src/types/blocks.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../src/types/constraints.js';
import type { PlanState } from '../src/types/plan-state.js';
import type { WorkforceConfig } from '../src/types/workforce.js';

// -- Shared workforce config (mirrors DEFAULT_WORKFORCE_CONFIG) --

const cfg: WorkforceConfig = {
  laborGroups: {
    Grandes: [
      { start: 420, end: 930, capacity: 6 }, // 07:00-15:30
      { start: 930, end: 960, capacity: 6 }, // 15:30-16:00
      { start: 960, end: 1440, capacity: 5 }, // 16:00-00:00
    ],
    Medias: [
      { start: 420, end: 930, capacity: 9 }, // 07:00-15:30
      { start: 930, end: 960, capacity: 8 }, // 15:30-16:00
      { start: 960, end: 1440, capacity: 4 }, // 16:00-00:00
    ],
  },
  machineToLaborGroup: {
    PRM019: 'Grandes',
    PRM031: 'Grandes',
    PRM039: 'Grandes',
    PRM043: 'Grandes',
    PRM042: 'Medias',
  },
};

// -- Block factory --

function mkBlock(overrides: Partial<Block> = {}): Block {
  return {
    opId: 'OP1',
    toolId: 'T1',
    sku: 'SKU1',
    nm: 'Part1',
    machineId: 'PRM019',
    origM: 'PRM019',
    dayIdx: 0,
    qty: 100,
    prodMin: 455,
    setupMin: 0,
    operators: 4,
    blocked: false,
    reason: null,
    moved: false,
    hasAlt: false,
    altM: null,
    stk: 0,
    lt: 0,
    atr: 0,
    startMin: 420,
    endMin: 875,
    setupS: null,
    setupE: null,
    type: 'ok',
    shift: 'X',
    overflow: false,
    belowMinBatch: false,
    ...overrides,
  } as Block;
}

// =====================================================================
//  Tests
// =====================================================================

describe('Labor Windows (R3, R4, R8, R9)', () => {
  // -----------------------------------------------------------------
  //  1. Window resolution: minute 500 in Grandes -> capacity 6
  // -----------------------------------------------------------------
  it('1. minute 500 in Grandes resolves to first window [420,930) capacity 6', () => {
    const pool = createOperatorPool(cfg);
    // A block fully inside the first window
    const result = pool.checkCapacity(0, 500, 600, 6, 'PRM019');
    expect(result.hasCapacity).toBe(true);
    expect(result.laborGroup).toBe('Grandes');
    // Demand exactly at capacity -> available = 6 - 0 (nothing booked) = 6
    expect(result.available).toBe(6);
  });

  // -----------------------------------------------------------------
  //  2. Window resolution: minute 940 in Grandes -> capacity 6
  // -----------------------------------------------------------------
  it('2. minute 940 in Grandes resolves to second window [930,960) capacity 6', () => {
    const pool = createOperatorPool(cfg);
    const result = pool.checkCapacity(0, 940, 950, 6, 'PRM031');
    expect(result.hasCapacity).toBe(true);
    expect(result.laborGroup).toBe('Grandes');
    expect(result.available).toBe(6);
    // 7 would exceed
    const over = pool.checkCapacity(0, 940, 950, 7, 'PRM031');
    expect(over.hasCapacity).toBe(false);
  });

  // -----------------------------------------------------------------
  //  3. Window resolution: minute 1000 in Grandes -> capacity 5
  // -----------------------------------------------------------------
  it('3. minute 1000 in Grandes resolves to third window [960,1440) capacity 5', () => {
    const pool = createOperatorPool(cfg);
    const result = pool.checkCapacity(0, 1000, 1100, 5, 'PRM039');
    expect(result.hasCapacity).toBe(true);
    expect(result.available).toBe(5);
    // 6 would exceed
    const over = pool.checkCapacity(0, 1000, 1100, 6, 'PRM039');
    expect(over.hasCapacity).toBe(false);
    expect(over.worstWindowShortage).toBe(1); // 6 - 5
  });

  // -----------------------------------------------------------------
  //  4. Window resolution: minute 940 in Medias -> capacity 8
  // -----------------------------------------------------------------
  it('4. minute 940 in Medias resolves to second window [930,960) capacity 8', () => {
    const pool = createOperatorPool(cfg);
    const result = pool.checkCapacity(0, 940, 955, 8, 'PRM042');
    expect(result.hasCapacity).toBe(true);
    expect(result.laborGroup).toBe('Medias');
    expect(result.available).toBe(8);
    // 9 exceeds
    const over = pool.checkCapacity(0, 940, 955, 9, 'PRM042');
    expect(over.hasCapacity).toBe(false);
  });

  // -----------------------------------------------------------------
  //  5. Cross-window block [920,950] checks both windows, WORST wins
  // -----------------------------------------------------------------
  it('5. cross-window block [920,950] evaluates both windows, worst applies', () => {
    const pool = createOperatorPool(cfg);
    // [920,950) spans window 1 [420,930) and window 2 [930,960)
    // Both windows for Grandes have capacity 6
    // Book 5 operators on another Grandes machine in both windows first
    pool.book(0, 420, 960, 5, 'PRM031');

    // Now check PRM019 with 2 operators across the boundary
    // Window 1: groupTotal=5, new peak for PRM019=2, delta=2, newTotal=7 > 6 -> shortage 1
    // Window 2: groupTotal=5, new peak for PRM019=2, delta=2, newTotal=7 > 6 -> shortage 1
    const result = pool.checkCapacity(0, 920, 950, 2, 'PRM019');
    expect(result.hasCapacity).toBe(false);
    expect(result.worstWindowShortage).toBe(1);
  });

  // -----------------------------------------------------------------
  //  6. Cross-window worst: block [920,970] spans all 3 Grandes windows
  // -----------------------------------------------------------------
  it('6. cross-window [920,970] spans 3 windows, reports worst shortage', () => {
    const pool = createOperatorPool(cfg);
    // [920,970) overlaps:
    //   window 1 [420,930) cap=6
    //   window 2 [930,960) cap=6
    //   window 3 [960,1440) cap=5  <-- lowest capacity
    // Book 4 on PRM031 across all windows
    pool.book(0, 420, 1440, 4, 'PRM031');

    // Check PRM019 with 3 operators across [920,970)
    // Window 1: groupTotal=4, delta=3, newTotal=7 > 6 -> shortage 1
    // Window 2: groupTotal=4, delta=3, newTotal=7 > 6 -> shortage 1
    // Window 3: groupTotal=4, delta=3, newTotal=7 > 5 -> shortage 2  <-- worst
    const result = pool.checkCapacity(0, 920, 970, 3, 'PRM019');
    expect(result.hasCapacity).toBe(false);
    expect(result.worstWindowShortage).toBe(2); // from window 3
    // available = min across windows = min(6-4, 6-4, 5-4) = 1
    expect(result.available).toBe(1);
  });

  // -----------------------------------------------------------------
  //  7. Unmapped machine -> hasCapacity=true, unmapped=true
  // -----------------------------------------------------------------
  it('7. unmapped machine returns hasCapacity=true, unmapped=true', () => {
    const pool = createOperatorPool(cfg);
    const result = pool.checkCapacity(0, 500, 800, 100, 'PRM_UNKNOWN');
    expect(result.hasCapacity).toBe(true);
    expect(result.unmapped).toBe(true);
    expect(result.laborGroup).toBeUndefined();
    expect(result.available).toBe(Infinity);
    expect(result.worstWindowShortage).toBe(0);
  });

  // -----------------------------------------------------------------
  //  8. Peak concurrent: same machine, 2 bookings -> max(ops), not sum
  // -----------------------------------------------------------------
  it('8. same machine 2 bookings use max(operators), not sum', () => {
    const pool = createOperatorPool(cfg);
    // Book PRM019 twice in the first window with different operator counts
    pool.book(0, 500, 700, 3, 'PRM019');
    pool.book(0, 500, 700, 5, 'PRM019');

    // Peak for PRM019 = max(3,5) = 5, NOT 3+5=8
    const usage = pool.getCurrentUsage(0, 420, 'Grandes');
    expect(usage).toBe(5);

    // Capacity=6, usage=5 -> 1 slot available
    const check = pool.checkCapacity(0, 500, 700, 1, 'PRM031');
    expect(check.hasCapacity).toBe(true);
    expect(check.available).toBe(1); // 6 - 5 = 1
  });

  // -----------------------------------------------------------------
  //  9. Sum of peaks across machines in the labor group
  // -----------------------------------------------------------------
  it('9. group total = sum of per-machine peaks', () => {
    const pool = createOperatorPool(cfg);
    // Book 3 different Grandes machines in the first window
    pool.book(0, 500, 800, 2, 'PRM019');
    pool.book(0, 500, 800, 3, 'PRM031');
    pool.book(0, 500, 800, 1, 'PRM039');

    // Group total = 2 + 3 + 1 = 6 (sum of peaks)
    const usage = pool.getCurrentUsage(0, 420, 'Grandes');
    expect(usage).toBe(6);

    // Exactly at capacity (6), any new machine demand -> false
    const check = pool.checkCapacity(0, 500, 800, 1, 'PRM043');
    expect(check.hasCapacity).toBe(false);
    expect(check.available).toBe(0); // 6 - 6 = 0
  });

  // -----------------------------------------------------------------
  //  10. LABOR_GROUP_UNMAPPED: scheduleAll with unmapped machine
  // -----------------------------------------------------------------
  it('10. scheduleAll emits LABOR_GROUP_UNMAPPED for unmapped machine', () => {
    // Config that does NOT map PRM020
    const limitedConfig: WorkforceConfig = {
      laborGroups: {
        Grandes: [
          { start: 420, end: 930, capacity: 6 },
          { start: 930, end: 960, capacity: 6 },
          { start: 960, end: 1440, capacity: 5 },
        ],
      },
      machineToLaborGroup: {
        PRM019: 'Grandes',
      },
    };

    const ps: PlanState = {
      dates: ['27/02'],
      days_label: ['Sex'],
      workday_flags: [true],
      machines: [
        { id: 'PRM019', area: 'PG1', man_minutes: [0] },
        { id: 'PRM020', area: 'PG1', man_minutes: [0] },
      ],
      tools: [
        {
          id: 'BWI001',
          machine: 'PRM019',
          alt_machine: '-',
          setup_hours: 0,
          pcs_per_hour: 100,
          operators: 1,
          skus: ['SKU1'],
          names: ['Part1'],
          lot_economic_qty: 0,
          stock: 0,
        },
        {
          id: 'BWI002',
          machine: 'PRM020',
          alt_machine: '-',
          setup_hours: 0,
          pcs_per_hour: 100,
          operators: 2,
          skus: ['SKU2'],
          names: ['Part2'],
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
          name: 'Part1',
          pcs_per_hour: 100,
          atraso: 0,
          daily_qty: [50],
          setup_hours: 0,
          operators: 1,
          stock: 0,
          status: 'PLANNED' as const,
        },
        {
          id: 'OP2',
          machine: 'PRM020',
          tool: 'BWI002',
          sku: 'SKU2',
          name: 'Part2',
          pcs_per_hour: 100,
          atraso: 0,
          daily_qty: [50],
          setup_hours: 0,
          operators: 2,
          stock: 0,
          status: 'PLANNED' as const,
        },
      ],
      workforceConfig: limitedConfig,
    };

    const engine = transformPlanState(ps);
    const mSt: Record<string, string> = {};
    engine.machines.forEach((m) => {
      mSt[m.id] = 'running';
    });
    const tSt: Record<string, string> = {};
    engine.tools.forEach((t) => {
      tSt[t.id] = 'running';
    });

    const result = scheduleAll({
      ops: engine.ops,
      mSt,
      tSt,
      moves: [],
      machines: engine.machines,
      toolMap: engine.toolMap,
      workdays: engine.workdays,
      nDays: engine.nDays,
      workforceConfig: engine.workforceConfig,
      constraintConfig: DEFAULT_CONSTRAINT_CONFIG,
    });

    // PRM020 is unmapped -> should produce LABOR_GROUP_UNMAPPED decision
    const unmappedDecisions = result.decisions.filter((d) => d.type === 'LABOR_GROUP_UNMAPPED');
    expect(unmappedDecisions.length).toBeGreaterThan(0);
    expect(unmappedDecisions.some((d) => d.machineId === 'PRM020')).toBe(true);
  });

  // -----------------------------------------------------------------
  //  11. peakShortage computed correctly via computeWorkforceDemand
  // -----------------------------------------------------------------
  it('11. computeWorkforceDemand reports correct peakShortage', () => {
    // 2 Grandes machines, each with 4 operators in first window
    // Peak = 4 + 4 = 8, capacity = 6, shortage = 2
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP1',
        machineId: 'PRM019',
        dayIdx: 0,
        startMin: 420,
        endMin: 875,
        operators: 4,
        shift: 'X',
      }),
      mkBlock({
        opId: 'OP2',
        machineId: 'PRM031',
        dayIdx: 0,
        startMin: 420,
        endMin: 875,
        operators: 4,
        shift: 'X',
      }),
    ];

    const result = computeWorkforceDemand(blocks, cfg, 1);

    const grandesW1 = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(grandesW1).toBeDefined();
    expect(grandesW1!.peakNeed).toBe(8); // 4 + 4
    expect(grandesW1!.capacity).toBe(6);
    expect(grandesW1!.peakShortage).toBe(2); // 8 - 6
    expect(grandesW1!.overloaded).toBe(true);

    expect(result.maxOverload).toBe(2);
  });

  // -----------------------------------------------------------------
  //  12. overloadPeopleMinutes = excess x window duration
  // -----------------------------------------------------------------
  it('12. computeWorkforceDemand computes overloadPeopleMinutes = excess x window duration', () => {
    // 3 Grandes machines with 3 operators each in the THIRD window [960,1440)
    // Peak = 3 + 3 + 3 = 9, capacity = 5, shortage = 4
    // Window duration = 1440 - 960 = 480 minutes
    // overloadPeopleMinutes = 4 * 480 = 1920
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP1',
        machineId: 'PRM019',
        dayIdx: 0,
        startMin: 960,
        endMin: 1440,
        operators: 3,
        shift: 'Y',
      }),
      mkBlock({
        opId: 'OP2',
        machineId: 'PRM031',
        dayIdx: 0,
        startMin: 960,
        endMin: 1440,
        operators: 3,
        shift: 'Y',
      }),
      mkBlock({
        opId: 'OP3',
        machineId: 'PRM039',
        dayIdx: 0,
        startMin: 960,
        endMin: 1440,
        operators: 3,
        shift: 'Y',
      }),
    ];

    const result = computeWorkforceDemand(blocks, cfg, 1);

    const grandesW3 = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 960 && e.dayIdx === 0,
    );
    expect(grandesW3).toBeDefined();
    expect(grandesW3!.peakNeed).toBe(9); // 3 + 3 + 3
    expect(grandesW3!.capacity).toBe(5);
    expect(grandesW3!.peakShortage).toBe(4); // 9 - 5
    expect(grandesW3!.overloadPeopleMinutes).toBe(1920); // 4 * (1440 - 960)
    expect(grandesW3!.shortageMinutes).toBe(480); // full window duration
  });
});
