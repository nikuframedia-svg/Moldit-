// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- Red Color Immunity Tests
//
//  RULE: ISOP red cells do NOT indicate unavailability.
//  Machines and tools shown in red are FULLY OPERATIONAL.
//
//  These tests prove that:
//  1. transformPlanState ignores PlanState.machineStatus/toolStatus
//  2. The schedule is IDENTICAL with or without machineStatus='down'
//  3. EngineData always produces mSt/tSt with all resources as 'running'
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import { transformPlanState } from '../src/transform/transform-plan-state.js';
import type { PlanState } from '../src/types/plan-state.js';

// ── Helpers ──────────────────────────────────────────────────────────

function createMinimalPlanState(overrides?: Partial<PlanState>): PlanState {
  return {
    dates: ['03/03', '04/03', '05/03', '06/03', '07/03'],
    days_label: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
    workday_flags: [true, true, true, true, true],
    machines: [
      { id: 'PRM039', area: 'PG2', man_minutes: [0, 0, 0, 0, 0] },
      { id: 'PRM031', area: 'PG2', man_minutes: [0, 0, 0, 0, 0] },
    ],
    tools: [
      {
        id: 'BWI003',
        machine: 'PRM039',
        alt_machine: '-',
        setup_hours: 0.5,
        pcs_per_hour: 1000,
        operators: 1,
        skus: ['SKU-A'],
        names: ['Part A'],
        lot_economic_qty: 0,
        stock: 0,
      },
    ],
    operations: [
      {
        id: 'OP01',
        machine: 'PRM039',
        tool: 'BWI003',
        sku: 'SKU-A',
        name: 'Part A',
        pcs_per_hour: 1000,
        atraso: 0,
        daily_qty: [0, 0, 2000, 0, 0],
        setup_hours: 0.5,
        operators: 1,
        stock: 0,
        status: 'PLANNED' as const,
      },
    ],
    schedule: [],
    machine_loads: [],
    kpis: null,
    parsed_at: null,
    data_hash: null,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Red Color Immunity', () => {
  it('transformPlanState sets all machines to running regardless of PlanState.machineStatus', () => {
    // PlanState has machineStatus marking PRM039 as 'down' (simulating red cell inference)
    const ps = createMinimalPlanState({
      machineStatus: { PRM039: 'down', PRM031: 'down' },
      toolStatus: { BWI003: 'down' },
    });

    const engine = transformPlanState(ps);

    // EngineData.mSt must have ALL machines as 'running'
    expect(engine.mSt['PRM039']).toBe('running');
    expect(engine.mSt['PRM031']).toBe('running');

    // EngineData.tSt must have ALL tools as 'running'
    expect(engine.tSt['BWI003']).toBe('running');
  });

  it('transformPlanState mSt/tSt are running even when PlanState has no status at all', () => {
    const ps = createMinimalPlanState();
    // PlanState.machineStatus and toolStatus are undefined

    const engine = transformPlanState(ps);

    expect(engine.mSt['PRM039']).toBe('running');
    expect(engine.mSt['PRM031']).toBe('running');
    expect(engine.tSt['BWI003']).toBe('running');
  });

  it('schedule is IDENTICAL with or without machineStatus=down in PlanState', () => {
    // Run 1: PlanState without any status (clean)
    const psClean = createMinimalPlanState();
    const engineClean = transformPlanState(psClean);
    const resultClean = scheduleAll({
      ops: engineClean.ops,
      mSt: engineClean.mSt,
      tSt: engineClean.tSt,
      moves: [],
      machines: engineClean.machines,
      toolMap: engineClean.toolMap,
      workdays: engineClean.workdays,
      nDays: engineClean.nDays,
    });

    // Run 2: PlanState with ALL machines and tools marked as 'down' (simulating red cells)
    const psRed = createMinimalPlanState({
      machineStatus: { PRM039: 'down', PRM031: 'down' },
      toolStatus: { BWI003: 'down' },
    });
    const engineRed = transformPlanState(psRed);
    const resultRed = scheduleAll({
      ops: engineRed.ops,
      mSt: engineRed.mSt,
      tSt: engineRed.tSt,
      moves: [],
      machines: engineRed.machines,
      toolMap: engineRed.toolMap,
      workdays: engineRed.workdays,
      nDays: engineRed.nDays,
    });

    // Both runs must produce IDENTICAL results
    const cleanBlocks = resultClean.blocks.filter((b) => b.type === 'ok');
    const redBlocks = resultRed.blocks.filter((b) => b.type === 'ok');

    // Same number of production blocks
    expect(redBlocks.length).toBe(cleanBlocks.length);

    // Same total production
    const cleanQty = cleanBlocks.reduce((s, b) => s + b.qty, 0);
    const redQty = redBlocks.reduce((s, b) => s + b.qty, 0);
    expect(redQty).toBe(cleanQty);
    expect(cleanQty).toBe(2000);

    // Same machine assignments
    const cleanMachines = cleanBlocks.map((b) => b.machineId).sort();
    const redMachines = redBlocks.map((b) => b.machineId).sort();
    expect(redMachines).toEqual(cleanMachines);

    // Same day assignments
    const cleanDays = cleanBlocks.map((b) => b.dayIdx).sort();
    const redDays = redBlocks.map((b) => b.dayIdx).sort();
    expect(redDays).toEqual(cleanDays);

    // No blocked blocks in either run
    const cleanBlocked = resultClean.blocks.filter((b) => b.blocked);
    const redBlocked = resultRed.blocks.filter((b) => b.blocked);
    expect(cleanBlocked.length).toBe(0);
    expect(redBlocked.length).toBe(0);
  });

  it('directly passing machineStatus=down to scheduler DOES block (proving transform is the guard)', () => {
    // This test proves that the TRANSFORM is the critical guard.
    // If someone bypasses transformPlanState and passes 'down' directly, it blocks.
    const ps = createMinimalPlanState();
    const engine = transformPlanState(ps);

    // Bypass the transform: manually set machine to 'down'
    const badMSt: Record<string, string> = { ...engine.mSt, PRM039: 'down' };

    const resultBad = scheduleAll({
      ops: engine.ops,
      mSt: badMSt,
      tSt: engine.tSt,
      moves: [],
      machines: engine.machines,
      toolMap: engine.toolMap,
      workdays: engine.workdays,
      nDays: engine.nDays,
    });

    // With machine 'down', no production occurs (operation is blocked)
    const okBlocks = resultBad.blocks.filter((b) => b.opId === 'OP01' && b.type === 'ok');
    const blockedBlocks = resultBad.blocks.filter((b) => b.opId === 'OP01' && b.blocked);
    expect(okBlocks.reduce((s, b) => s + b.qty, 0)).toBe(0);
    expect(blockedBlocks.length).toBeGreaterThan(0);
  });
});
