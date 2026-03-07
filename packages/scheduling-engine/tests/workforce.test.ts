// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- Workforce Labor Group Model Tests
//
//  Contract 3: Labor-Group-Based workforce model (Grandes / Medias)
//  replacing the old PG1/PG2 area-based model.
//
//  Covers:
//    1. Operator Pool (labor-group-based)
//    2. Workforce Demand computation
//    3. Score Schedule integration
//    4. Integration: scheduleAll with workforceConfig
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { computeWorkforceDemand } from '../src/analysis/op-demand.js';
import { scoreSchedule } from '../src/analysis/score-schedule.js';
import { createOperatorPool } from '../src/constraints/operator-pool.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import { transformPlanState } from '../src/transform/transform-plan-state.js';
import type { Block } from '../src/types/blocks.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../src/types/constraints.js';
import type { PlanState } from '../src/types/plan-state.js';
import type { WorkforceConfig } from '../src/types/workforce.js';
import { DEFAULT_WORKFORCE_CONFIG } from '../src/types/workforce.js';

// ── Shared config ──

const testConfig: WorkforceConfig = {
  laborGroups: {
    Grandes: [
      { start: 420, end: 930, capacity: 6 },
      { start: 930, end: 960, capacity: 6 },
      { start: 960, end: 1440, capacity: 5 },
    ],
    Medias: [
      { start: 420, end: 930, capacity: 9 },
      { start: 930, end: 960, capacity: 8 },
      { start: 960, end: 1440, capacity: 4 },
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

// ═══════════════════════════════════════════════════════════════════════
//  1. Operator Pool (labor-group-based)
// ═══════════════════════════════════════════════════════════════════════

describe('Operator Pool (labor-group-based)', () => {
  it('1. hasCapacity returns true when demand <= capacity for laborGroup/window', () => {
    const pool = createOperatorPool(testConfig);
    // First window (420-930): Grandes cap=6, Medias cap=9
    expect(pool.hasCapacity(0, 420, 930, 6, 'PRM019')).toBe(true);
    // Third window (960-1440): Grandes cap=5
    expect(pool.hasCapacity(0, 960, 1440, 5, 'PRM031')).toBe(true);
    // First window: Medias cap=9
    expect(pool.hasCapacity(0, 420, 930, 9, 'PRM042')).toBe(true);
  });

  it('2. hasCapacity returns false when demand > capacity', () => {
    const pool = createOperatorPool(testConfig);
    // First window (420-930): Grandes cap=6
    expect(pool.hasCapacity(0, 420, 930, 7, 'PRM019')).toBe(false);
    // Third window (960-1440): Grandes cap=5
    expect(pool.hasCapacity(0, 960, 1440, 6, 'PRM031')).toBe(false);
    // First window: Medias cap=9
    expect(pool.hasCapacity(0, 420, 930, 10, 'PRM042')).toBe(false);
  });

  it('3. Unmapped machine -> always hasCapacity=true (constraint bypassed)', () => {
    const pool = createOperatorPool(testConfig);
    expect(pool.hasCapacity(0, 420, 930, 1000, 'PRM_UNMAPPED')).toBe(true);

    const check = pool.checkCapacity(0, 420, 930, 1000, 'PRM_UNMAPPED');
    expect(check.hasCapacity).toBe(true);
    expect(check.available).toBe(Infinity);
    expect(check.laborGroup).toBeUndefined();
  });

  it('4. Peak model: same machine, 2 bookings -> uses max, not sum', () => {
    const pool = createOperatorPool(testConfig);

    pool.book(0, 420, 930, 2, 'PRM019');
    pool.book(0, 420, 930, 4, 'PRM019');

    // Peak for PRM019 = 4 (max of 2, 4), not 6 (2+4)
    const usage = pool.getCurrentUsage(0, 420, 'Grandes');
    expect(usage).toBe(4);
  });

  it('5. Peak model: 2 machines same laborGroup -> sum of peaks', () => {
    const pool = createOperatorPool(testConfig);

    pool.book(0, 420, 930, 3, 'PRM019');
    pool.book(0, 420, 930, 2, 'PRM031');

    // Total = 3 (PRM019 peak) + 2 (PRM031 peak) = 5
    const usage = pool.getCurrentUsage(0, 420, 'Grandes');
    expect(usage).toBe(5);
  });

  it('6. Z shift times: no configured windows -> hasCapacity=true (unchecked)', () => {
    const pool = createOperatorPool(testConfig);

    // Z shift would be post-midnight (1440-1860), no windows cover this range
    // No overlapping windows -> hasCapacity=true for mapped machines (no constraint)
    expect(pool.hasCapacity(0, 1440, 1860, 1, 'PRM019')).toBe(true);
    expect(pool.hasCapacity(0, 1440, 1860, 1, 'PRM042')).toBe(true);

    // Unmapped machine also bypasses
    expect(pool.hasCapacity(0, 1440, 1860, 1, 'PRM_UNMAPPED')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  2. Workforce Demand
// ═══════════════════════════════════════════════════════════════════════

describe('Workforce Demand', () => {
  const makeBlock = (overrides: Partial<Block>): Block => ({
    opId: 'OP1',
    toolId: 'BWI001',
    sku: 'SKU1',
    machineId: 'PRM019',
    dayIdx: 0,
    shift: 'X',
    startMin: 420,
    endMin: 510,
    prodMin: 60,
    setupMin: 0,
    qty: 100,
    operators: 2,
    type: 'ok',
    overflow: false,
    blocked: false,
    moved: false,
    hasAlt: false,
    belowMinBatch: false,
    ...overrides,
  });

  it('7. computeWorkforceDemand returns entries per laborGroup x window x day', () => {
    const blocks: Block[] = [
      makeBlock({ machineId: 'PRM019', dayIdx: 0, shift: 'X', operators: 2 }),
      makeBlock({ machineId: 'PRM042', dayIdx: 0, shift: 'X', operators: 3 }),
    ];
    const result = computeWorkforceDemand(blocks, testConfig, 1);

    // 2 laborGroups x 3 windows x 1 day = 6 entries
    expect(result.entries).toHaveLength(6);

    // Check Grandes first window (420-930) day 0
    const grandesW1 = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(grandesW1).toBeDefined();
    expect(grandesW1!.peakNeed).toBe(2);
    expect(grandesW1!.capacity).toBe(6);
    expect(grandesW1!.overloaded).toBe(false);

    // Check Medias first window (420-930) day 0
    const mediasW1 = result.entries.find(
      (e) => e.laborGroup === 'Medias' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(mediasW1).toBeDefined();
    expect(mediasW1!.peakNeed).toBe(3);
    expect(mediasW1!.capacity).toBe(9);
    expect(mediasW1!.overloaded).toBe(false);
  });

  it('8. Peak concurrent: 2 blocks same window/machine -> max, not sum', () => {
    const blocks: Block[] = [
      makeBlock({ opId: 'OP1', machineId: 'PRM019', dayIdx: 0, shift: 'X', operators: 2 }),
      makeBlock({ opId: 'OP2', machineId: 'PRM019', dayIdx: 0, shift: 'X', operators: 3 }),
    ];
    const result = computeWorkforceDemand(blocks, testConfig, 1);

    const grandesW1 = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(grandesW1!.peakNeed).toBe(3); // max(2, 3) not 2+3=5
  });

  it('9. Overload detection: peakNeed > capacity -> overloaded=true', () => {
    const blocks: Block[] = [
      makeBlock({ machineId: 'PRM019', dayIdx: 0, shift: 'X', operators: 4 }),
      makeBlock({ machineId: 'PRM031', dayIdx: 0, shift: 'X', operators: 3 }),
    ];
    // Grandes first window cap=6, peak=4+3=7 -> overloaded
    const result = computeWorkforceDemand(blocks, testConfig, 1);

    const grandesW1 = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(grandesW1!.peakNeed).toBe(7);
    expect(grandesW1!.overloaded).toBe(true);

    expect(result.warnings).toHaveLength(1);
    expect(result.maxOverload).toBe(1); // 7 - 6 = 1
  });

  it('10. Empty laborGroup (no blocks) -> peakNeed=0', () => {
    const blocks: Block[] = [
      makeBlock({ machineId: 'PRM019', dayIdx: 0, shift: 'X', operators: 2 }),
    ];
    const result = computeWorkforceDemand(blocks, testConfig, 1);

    // Medias has no blocks
    const mediasW1 = result.entries.find(
      (e) => e.laborGroup === 'Medias' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(mediasW1!.peakNeed).toBe(0);
    expect(mediasW1!.overloaded).toBe(false);
  });

  it('Z shift blocks are excluded from demand computation', () => {
    const blocks: Block[] = [
      makeBlock({
        machineId: 'PRM019',
        dayIdx: 0,
        shift: 'Z' as 'X',
        startMin: 1440,
        endMin: 1860,
        operators: 5,
      }),
    ];
    const result = computeWorkforceDemand(blocks, testConfig, 1);

    // Z shift block (1440-1860) does not overlap any window [420-1440]
    // so no window entry includes it — Z entries don't exist
    const zEntries = result.entries.filter((e) => e.shift === 'Z');
    expect(zEntries).toHaveLength(0);
  });

  it('blocked blocks are excluded from demand', () => {
    const blocks: Block[] = [
      makeBlock({ machineId: 'PRM019', dayIdx: 0, shift: 'X', operators: 5, type: 'blocked' }),
    ];
    const result = computeWorkforceDemand(blocks, testConfig, 1);

    const grandesW1 = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(grandesW1!.peakNeed).toBe(0); // blocked blocks excluded
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  3. Score Schedule
// ═══════════════════════════════════════════════════════════════════════

describe('Score Schedule (labor-group-based)', () => {
  it('11. overOps correct with labor-group-based capacities', () => {
    // Create a simple PlanState with demand that can be scheduled
    const ps: PlanState = {
      dates: ['27/02', '28/02'],
      days_label: ['Sex', 'Sab'],
      workday_flags: [true, false],
      machines: [{ id: 'PRM019', area: 'PG1', man_minutes: [0, 0] }],
      tools: [
        {
          id: 'BWI001',
          machine: 'PRM019',
          alt_machine: '-',
          setup_hours: 0.5,
          pcs_per_hour: 100,
          operators: 1,
          skus: ['SKU1'],
          names: ['Part1'],
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
          daily_qty: [50, 0],
          setup_hours: 0.5,
          operators: 1,
          stock: 0,
          status: 'PLANNED' as const,
        },
      ],
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

    const scored = scoreSchedule(
      result.blocks,
      engine.ops,
      mSt,
      engine.workforceConfig!,
      engine.machines,
      engine.toolMap,
      undefined,
      undefined,
      engine.nDays,
    );

    expect(scored.overOps).toBe(0); // 1 operator on PRM019 << Grandes first window cap=6
    expect(scored.peakOps).toBeGreaterThanOrEqual(0);
  });

  it('12. peakOps correct with labor-group-based demand', () => {
    const scored_demand = computeWorkforceDemand([], DEFAULT_WORKFORCE_CONFIG, 0);
    expect(scored_demand.peakTotal).toBe(0);
    expect(scored_demand.maxOverload).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  4. Integration
// ═══════════════════════════════════════════════════════════════════════

describe('Integration (labor-group-based workforce)', () => {
  it('13. scheduleAll with workforceConfig -> operatorWarning when overloaded', () => {
    // Set up a scenario where Grandes first window capacity (6) is exceeded
    // 4 machines x 2 operators each = 8 > 6
    const ps: PlanState = {
      dates: ['27/02', '28/02'],
      days_label: ['Sex', 'Sab'],
      workday_flags: [true, false],
      machines: [
        { id: 'PRM019', area: 'PG1', man_minutes: [0, 0] },
        { id: 'PRM031', area: 'PG1', man_minutes: [0, 0] },
        { id: 'PRM039', area: 'PG2', man_minutes: [0, 0] },
        { id: 'PRM043', area: 'PG2', man_minutes: [0, 0] },
      ],
      tools: [
        {
          id: 'BWI001',
          machine: 'PRM019',
          alt_machine: '-',
          setup_hours: 0,
          pcs_per_hour: 100,
          operators: 4,
          skus: ['SKU1'],
          names: ['Part1'],
          lot_economic_qty: 0,
          stock: 0,
        },
        {
          id: 'BWI002',
          machine: 'PRM031',
          alt_machine: '-',
          setup_hours: 0,
          pcs_per_hour: 100,
          operators: 4,
          skus: ['SKU2'],
          names: ['Part2'],
          lot_economic_qty: 0,
          stock: 0,
        },
        {
          id: 'BWI003',
          machine: 'PRM039',
          alt_machine: '-',
          setup_hours: 0,
          pcs_per_hour: 100,
          operators: 4,
          skus: ['SKU3'],
          names: ['Part3'],
          lot_economic_qty: 0,
          stock: 0,
        },
        {
          id: 'BWI004',
          machine: 'PRM043',
          alt_machine: '-',
          setup_hours: 0,
          pcs_per_hour: 100,
          operators: 4,
          skus: ['SKU4'],
          names: ['Part4'],
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
          daily_qty: [500, 0],
          setup_hours: 0,
          operators: 4,
          stock: 0,
          status: 'PLANNED' as const,
        },
        {
          id: 'OP2',
          machine: 'PRM031',
          tool: 'BWI002',
          sku: 'SKU2',
          name: 'Part2',
          pcs_per_hour: 100,
          atraso: 0,
          daily_qty: [500, 0],
          setup_hours: 0,
          operators: 4,
          stock: 0,
          status: 'PLANNED' as const,
        },
        {
          id: 'OP3',
          machine: 'PRM039',
          tool: 'BWI003',
          sku: 'SKU3',
          name: 'Part3',
          pcs_per_hour: 100,
          atraso: 0,
          daily_qty: [500, 0],
          setup_hours: 0,
          operators: 4,
          stock: 0,
          status: 'PLANNED' as const,
        },
        {
          id: 'OP4',
          machine: 'PRM043',
          tool: 'BWI004',
          sku: 'SKU4',
          name: 'Part4',
          pcs_per_hour: 100,
          atraso: 0,
          daily_qty: [500, 0],
          setup_hours: 0,
          operators: 4,
          stock: 0,
          status: 'PLANNED' as const,
        },
      ],
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

    // 4 machines x 4 operators = 16 peak > Grandes first window cap=6 -> R6 tiebreaker can't fully resolve
    const warningBlocks = result.blocks.filter((b) => b.operatorWarning);
    expect(warningBlocks.length).toBeGreaterThan(0);

    // Should have OPERATOR_CAPACITY_WARNING decisions
    const opWarnings = result.decisions.filter((d) => d.type === 'OPERATOR_CAPACITY_WARNING');
    expect(opWarnings.length).toBeGreaterThan(0);
  });

  it('14. Machine outside laborGroup map -> no warnings (constraint bypassed)', () => {
    // Use a config with only Grandes mapped, PRM042 NOT mapped
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
        { id: 'PRM042', area: 'PG2', man_minutes: [0] },
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
          machine: 'PRM042',
          alt_machine: '-',
          setup_hours: 0,
          pcs_per_hour: 100,
          operators: 10,
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
          daily_qty: [50, 0],
          setup_hours: 0,
          operators: 1,
          stock: 0,
          status: 'PLANNED' as const,
        },
        {
          id: 'OP2',
          machine: 'PRM042',
          tool: 'BWI002',
          sku: 'SKU2',
          name: 'Part2',
          pcs_per_hour: 100,
          atraso: 0,
          daily_qty: [50, 0],
          setup_hours: 0,
          operators: 10,
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

    // PRM042 has 10 operators but is NOT mapped -> no warning
    const prm042Warnings = result.blocks.filter(
      (b) => b.machineId === 'PRM042' && b.operatorWarning,
    );
    expect(prm042Warnings).toHaveLength(0);
  });

  it('15. Grandes: 4 machines x 2 ops each = 8 ops -> warning if > 6 (first window)', () => {
    const pool = createOperatorPool(testConfig);

    // Book 2 operators on each of 4 Grandes machines in first window (420-930)
    pool.book(0, 420, 930, 2, 'PRM019');
    pool.book(0, 420, 930, 2, 'PRM031');
    pool.book(0, 420, 930, 2, 'PRM039');
    pool.book(0, 420, 930, 2, 'PRM043');

    // Total = 2+2+2+2 = 8, capacity = 6
    const usage = pool.getCurrentUsage(0, 420, 'Grandes');
    expect(usage).toBe(8);

    // Any additional booking on another machine should show no capacity
    const check = pool.checkCapacity(0, 420, 930, 1, 'PRM019');
    expect(check.hasCapacity).toBe(false);
    expect(check.available).toBe(0); // max(0, 6-8) = 0
  });

  it('DEFAULT_WORKFORCE_CONFIG has correct structure', () => {
    expect(DEFAULT_WORKFORCE_CONFIG.laborGroups).toBeDefined();
    expect(DEFAULT_WORKFORCE_CONFIG.laborGroups['Grandes']).toEqual([
      { start: 420, end: 930, capacity: 6 },
      { start: 930, end: 960, capacity: 6 },
      { start: 960, end: 1440, capacity: 5 },
    ]);
    expect(DEFAULT_WORKFORCE_CONFIG.laborGroups['Medias']).toEqual([
      { start: 420, end: 930, capacity: 9 },
      { start: 930, end: 960, capacity: 8 },
      { start: 960, end: 1440, capacity: 4 },
    ]);
    expect(DEFAULT_WORKFORCE_CONFIG.machineToLaborGroup['PRM019']).toBe('Grandes');
    expect(DEFAULT_WORKFORCE_CONFIG.machineToLaborGroup['PRM039']).toBe('Grandes');
    expect(DEFAULT_WORKFORCE_CONFIG.machineToLaborGroup['PRM043']).toBe('Grandes');
    expect(DEFAULT_WORKFORCE_CONFIG.machineToLaborGroup['PRM042']).toBe('Medias');
  });

  it('transformPlanState populates workforceConfig from default', () => {
    const ps: PlanState = {
      dates: ['27/02'],
      days_label: ['Sex'],
      workday_flags: [true],
      machines: [{ id: 'PRM019', area: 'PG1', man_minutes: [0] }],
      tools: [
        {
          id: 'BWI001',
          machine: 'PRM019',
          alt_machine: '-',
          setup_hours: 0.5,
          pcs_per_hour: 100,
          operators: 1,
          skus: ['SKU1'],
          names: ['Part1'],
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
          setup_hours: 0.5,
          operators: 1,
          stock: 0,
          status: 'PLANNED' as const,
        },
      ],
    };

    const engine = transformPlanState(ps);
    expect(engine.workforceConfig).toBeDefined();
    expect(engine.workforceConfig!.laborGroups['Grandes']).toEqual([
      { start: 420, end: 930, capacity: 6 },
      { start: 930, end: 960, capacity: 6 },
      { start: 960, end: 1440, capacity: 5 },
    ]);
  });

  it('transformPlanState uses custom workforceConfig from PlanState', () => {
    const customConfig: WorkforceConfig = {
      laborGroups: {
        CUSTOM_GROUP: [
          { start: 420, end: 930, capacity: 10 },
          { start: 930, end: 1440, capacity: 8 },
        ],
      },
      machineToLaborGroup: { PRM019: 'CUSTOM_GROUP' },
    };

    const ps: PlanState = {
      dates: ['27/02'],
      days_label: ['Sex'],
      workday_flags: [true],
      machines: [{ id: 'PRM019', area: 'PG1', man_minutes: [0] }],
      tools: [
        {
          id: 'BWI001',
          machine: 'PRM019',
          alt_machine: '-',
          setup_hours: 0.5,
          pcs_per_hour: 100,
          operators: 1,
          skus: ['SKU1'],
          names: ['Part1'],
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
          setup_hours: 0.5,
          operators: 1,
          stock: 0,
          status: 'PLANNED' as const,
        },
      ],
      workforceConfig: customConfig,
    };

    const engine = transformPlanState(ps);
    expect(engine.workforceConfig).toEqual(customConfig);
    expect(engine.workforceConfig!.laborGroups['CUSTOM_GROUP']).toEqual([
      { start: 420, end: 930, capacity: 10 },
      { start: 930, end: 1440, capacity: 8 },
    ]);
  });
});
