// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- D+1 Workforce Forecast Tests
//
//  Contract 4: D+1 workforce overload prediction and warnings.
//
//  Covers:
//    1. computeWorkforceForecast (core forecast)
//    2. computeD1WorkforceRisk (tiebreaker helper)
//    3. Integration: scheduleAll includes forecast in result
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import {
  computeD1WorkforceRisk,
  computeWorkforceForecast,
} from '../src/analysis/workforce-forecast.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import type { Block } from '../src/types/blocks.js';
import type { ETool } from '../src/types/engine.js';
import type { WorkforceConfig } from '../src/types/workforce.js';

// ── Shared helpers ──

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

const workdays = [true, true, true, true, true, false, false, true];
const dates = ['01/01', '02/01', '03/01', '04/01', '05/01', '06/01', '07/01', '08/01'];

const toolMap: Record<string, ETool> = {
  T001: {
    id: 'T001',
    m: 'PRM019',
    alt: 'PRM031',
    sH: 0.5,
    pH: 40,
    op: 2,
    lt: 100,
    stk: 0,
    nm: 'Tool1',
  },
  T002: { id: 'T002', m: 'PRM031', alt: '-', sH: 0.5, pH: 40, op: 3, lt: 100, stk: 0, nm: 'Tool2' },
  T003: { id: 'T003', m: 'PRM042', alt: '-', sH: 0.5, pH: 40, op: 2, lt: 100, stk: 0, nm: 'Tool3' },
};

/** Create a mock block */
function mockBlock(overrides: Partial<Block>): Block {
  return {
    opId: 'OP1',
    toolId: 'T001',
    sku: 'SKU1',
    nm: 'SKU1',
    machineId: 'PRM019',
    origM: 'PRM019',
    dayIdx: 1,
    qty: 100,
    prodMin: 60,
    setupMin: 30,
    operators: 2,
    blocked: false,
    reason: null,
    moved: false,
    hasAlt: true,
    altM: 'PRM031',
    stk: 0,
    lt: 100,
    atr: 0,
    startMin: 420,
    endMin: 510,
    setupS: 420,
    setupE: 450,
    type: 'ok',
    shift: 'X',
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  1. computeWorkforceForecast
// ═══════════════════════════════════════════════════════════════════════

describe('computeWorkforceForecast', () => {
  it('1. No D+1 blocks → empty forecast (hasWarnings: false)', () => {
    // All blocks are on day 0, D+1 is day 1 with no blocks
    const blocks: Block[] = [
      mockBlock({ dayIdx: 0, machineId: 'PRM019', operators: 2, shift: 'X' }),
    ];
    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
    });
    expect(forecast.nextWorkingDayIdx).toBe(1);
    expect(forecast.hasWarnings).toBe(false);
    expect(forecast.warnings).toHaveLength(0);
  });

  it('2. D+1 with Grandes overload window [420,930) → warning with causingBlocks', () => {
    // Grandes window [420,930) capacity = 6. Put 4 machines × 2 ops = 8 peak → excess 2
    const blocks: Block[] = [
      mockBlock({
        opId: 'OP1',
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 2,
        shift: 'X',
        toolId: 'T001',
        sku: 'SKU_A',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP2',
        dayIdx: 1,
        machineId: 'PRM031',
        operators: 2,
        shift: 'X',
        toolId: 'T002',
        sku: 'SKU_B',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP3',
        dayIdx: 1,
        machineId: 'PRM039',
        operators: 2,
        shift: 'X',
        toolId: 'T001',
        sku: 'SKU_C',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP4',
        dayIdx: 1,
        machineId: 'PRM043',
        operators: 2,
        shift: 'X',
        toolId: 'T001',
        sku: 'SKU_D',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
    });
    expect(forecast.hasWarnings).toBe(true);
    expect(forecast.warnings).toHaveLength(1);

    const w = forecast.warnings[0];
    expect(w.laborGroup).toBe('Grandes');
    expect(w.shift).toBe('X');
    expect(w.capacity).toBe(6);
    expect(w.projectedPeak).toBe(8);
    expect(w.excess).toBe(2);
    expect(w.causingBlocks.length).toBe(4);
    expect(w.machines).toContain('PRM019');
    expect(w.machines).toContain('PRM043');
    expect(w.overloadWindow).toBe('07:00-15:30');
    expect(w.date).toBe('02/01');
    // New warning fields
    expect(w.windowStart).toBe(420);
    expect(w.windowEnd).toBe(930);
    expect(w.peakShortage).toBe(2);
    expect(w.overloadPeopleMinutes).toBe(2 * (930 - 420));
    expect(w.shortageMinutes).toBe(930 - 420);
  });

  it('3. D+1 with 2 laborGroups overloaded → 2 warnings', () => {
    const blocks: Block[] = [
      // Grandes window [420,930): 4 machines × 2 = 8 > 6 → excess 2
      mockBlock({
        opId: 'OP1',
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP2',
        dayIdx: 1,
        machineId: 'PRM031',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP3',
        dayIdx: 1,
        machineId: 'PRM039',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP4',
        dayIdx: 1,
        machineId: 'PRM043',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      // Medias window [420,930): 1 machine × 10 = 10 > 9 → excess 1
      mockBlock({
        opId: 'OP5',
        dayIdx: 1,
        machineId: 'PRM042',
        operators: 10,
        shift: 'X',
        toolId: 'T003',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
    });
    expect(forecast.warnings).toHaveLength(2);
    expect(forecast.warnings.map((w) => w.laborGroup).sort()).toEqual(['Grandes', 'Medias']);
  });

  it('4. D+1 without overload → 0 warnings', () => {
    const blocks: Block[] = [
      // Grandes window [420,930): 2 machines × 2 = 4 ≤ 6
      mockBlock({
        opId: 'OP1',
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP2',
        dayIdx: 1,
        machineId: 'PRM031',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
    });
    expect(forecast.hasWarnings).toBe(false);
    expect(forecast.warnings).toHaveLength(0);
  });

  it('5. ADVANCE_BLOCK suggestion present when block can be advanced', () => {
    const blocks: Block[] = [
      // 4 machines on D+1 (day 1), day 0 is a workday → can advance
      mockBlock({
        opId: 'OP1',
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP2',
        dayIdx: 1,
        machineId: 'PRM031',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP3',
        dayIdx: 1,
        machineId: 'PRM039',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP4',
        dayIdx: 1,
        machineId: 'PRM043',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
    });
    const sug = forecast.warnings[0].suggestions;
    expect(sug.some((s) => s.type === 'ADVANCE_BLOCK')).toBe(true);
  });

  it('6. MOVE_ALT_MACHINE suggestion present when tool has alt', () => {
    // T001 has alt=PRM031
    const blocks: Block[] = [
      mockBlock({
        opId: 'OP1',
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 2,
        shift: 'X',
        toolId: 'T001',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP2',
        dayIdx: 1,
        machineId: 'PRM031',
        operators: 2,
        shift: 'X',
        toolId: 'T002',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP3',
        dayIdx: 1,
        machineId: 'PRM039',
        operators: 2,
        shift: 'X',
        toolId: 'T001',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP4',
        dayIdx: 1,
        machineId: 'PRM043',
        operators: 2,
        shift: 'X',
        toolId: 'T001',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
    });
    const sug = forecast.warnings[0].suggestions;
    const moveSugs = sug.filter((s) => s.type === 'MOVE_ALT_MACHINE');
    expect(moveSugs.length).toBeGreaterThan(0);
    // T001 has alt PRM031
    expect(moveSugs.some((s) => s.machineId === 'PRM031')).toBe(true);
  });

  it('7. REQUEST_REINFORCEMENT suggestion always present', () => {
    const blocks: Block[] = [
      mockBlock({
        opId: 'OP1',
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP2',
        dayIdx: 1,
        machineId: 'PRM031',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP3',
        dayIdx: 1,
        machineId: 'PRM039',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP4',
        dayIdx: 1,
        machineId: 'PRM043',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
    });
    const sug = forecast.warnings[0].suggestions;
    expect(sug.some((s) => s.type === 'REQUEST_REINFORCEMENT')).toBe(true);
    const reinforce = sug.find((s) => s.type === 'REQUEST_REINFORCEMENT')!;
    expect(reinforce.expectedReduction).toBe(2);
  });

  it('8. Coverage missing: 3rd shift active + no Z windows → WORKFORCE_COVERAGE_MISSING', () => {
    const forecast = computeWorkforceForecast({
      blocks: [],
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
      thirdShift: true,
    });
    expect(forecast.hasCritical).toBe(true);
    expect(forecast.coverageMissing.length).toBeGreaterThan(0);
    const cm = forecast.coverageMissing.filter((c) => c.type === 'THIRD_SHIFT');
    expect(cm.length).toBe(2); // Grandes and Medias both have no Z windows
    expect(cm.every((c) => c.shift === 'Z')).toBe(true);
  });

  it('9. Coverage missing: overtime active + machine not mapped → WORKFORCE_COVERAGE_MISSING', () => {
    const forecast = computeWorkforceForecast({
      blocks: [],
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
      overtimeMap: { PRM_UNKNOWN: { 1: 60 } }, // unmapped machine
    });
    expect(forecast.hasCritical).toBe(true);
    const cm = forecast.coverageMissing.filter((c) => c.type === 'OVERTIME');
    expect(cm).toHaveLength(1);
    expect(cm[0].machineId).toBe('PRM_UNKNOWN');
  });

  it('10. No working days after day 0 → forecast with nextWorkingDayIdx = -1', () => {
    const noWorkdays = [true, false, false, false];
    const forecast = computeWorkforceForecast({
      blocks: [],
      workforceConfig: testConfig,
      workdays: noWorkdays,
      dates,
      toolMap,
    });
    expect(forecast.nextWorkingDayIdx).toBe(-1);
    expect(forecast.hasWarnings).toBe(false);
  });

  it('11. Peak concurrent model: 2 blocks same machine → max, not sum', () => {
    // PRM019 has 2 blocks: operators 3 and 2 → peak = 3, not 5
    // PRM031 has 1 block: operators 3
    // Total Grandes in window [420,930) = 3 + 3 = 6 = capacity → NO overload
    const blocks: Block[] = [
      mockBlock({
        opId: 'OP1',
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 3,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP2',
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP3',
        dayIdx: 1,
        machineId: 'PRM031',
        operators: 3,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testConfig,
      workdays,
      dates,
      toolMap,
    });
    expect(forecast.hasWarnings).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  2. computeD1WorkforceRisk
// ═══════════════════════════════════════════════════════════════════════

describe('computeD1WorkforceRisk', () => {
  it('12. No overload D+1 → risk = 0', () => {
    const blocks: Block[] = [
      mockBlock({
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const risk = computeD1WorkforceRisk(blocks, testConfig, workdays);
    expect(risk).toBe(0);
  });

  it('13. With overload → risk = sum of excesses across windows', () => {
    // Grandes window [420,930): 4 machines × 2 = 8 > 6 → excess 2
    // Blocks startMin=420, endMin=510 overlap only window [420,930), not [930,960) or [960,1440)
    // So total risk = 2
    const blocks: Block[] = [
      mockBlock({
        opId: 'OP1',
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP2',
        dayIdx: 1,
        machineId: 'PRM031',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP3',
        dayIdx: 1,
        machineId: 'PRM039',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
      mockBlock({
        opId: 'OP4',
        dayIdx: 1,
        machineId: 'PRM043',
        operators: 2,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const risk = computeD1WorkforceRisk(blocks, testConfig, workdays);
    expect(risk).toBe(2);
  });

  it('14. No future workdays → risk = 0', () => {
    const blocks: Block[] = [
      mockBlock({
        dayIdx: 1,
        machineId: 'PRM019',
        operators: 10,
        shift: 'X',
        startMin: 420,
        endMin: 510,
      }),
    ];
    const risk = computeD1WorkforceRisk(blocks, testConfig, [true, false, false]);
    expect(risk).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  3. Integration: scheduleAll includes forecast
// ═══════════════════════════════════════════════════════════════════════

describe('Workforce Forecast Integration', () => {
  // Minimal inline data for integration tests (no fixture dependency)
  const machines = [
    { id: 'PRM019', area: 'PG1', focus: false },
    { id: 'PRM031', area: 'PG1', focus: false },
    { id: 'PRM042', area: 'PG2', focus: false },
  ];
  const intToolMap: Record<string, ETool> = {
    T001: {
      id: 'T001',
      m: 'PRM019',
      alt: 'PRM031',
      sH: 0.5,
      pH: 40,
      op: 2,
      lt: 100,
      stk: 0,
      nm: 'Tool1',
    },
    T002: {
      id: 'T002',
      m: 'PRM042',
      alt: '-',
      sH: 0.5,
      pH: 40,
      op: 3,
      lt: 100,
      stk: 0,
      nm: 'Tool2',
    },
  };
  const ops = [
    { id: 'OP1', t: 'T001', m: 'PRM019', sku: 'SKU1', nm: 'SKU1', atr: 0, d: [100, 100, 0, 0] },
    { id: 'OP2', t: 'T002', m: 'PRM042', sku: 'SKU2', nm: 'SKU2', atr: 0, d: [50, 50, 0, 0] },
  ];
  const mSt: Record<string, string> = { PRM019: 'running', PRM031: 'running', PRM042: 'running' };
  const tSt: Record<string, string> = { T001: 'running', T002: 'running' };
  const intWorkdays = [true, true, true, true];
  const intDates = ['01/01', '02/01', '03/01', '04/01'];

  it('15. scheduleAll with workforceConfig returns workforceForecast', () => {
    const result = scheduleAll({
      ops: ops as any,
      mSt,
      tSt,
      moves: [],
      machines: machines as any,
      toolMap: intToolMap,
      workdays: intWorkdays,
      nDays: 4,
      workforceConfig: testConfig,
      dates: intDates,
    });

    expect(result.workforceForecast).toBeDefined();
    expect(result.workforceForecast!.nextWorkingDayIdx).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.workforceForecast!.warnings)).toBe(true);
    expect(Array.isArray(result.workforceForecast!.coverageMissing)).toBe(true);
    expect(typeof result.workforceForecast!.hasWarnings).toBe('boolean');
    expect(typeof result.workforceForecast!.hasCritical).toBe('boolean');
  });

  it('16. Decisions include WORKFORCE_FORECAST_D1 when there are warnings', () => {
    const result = scheduleAll({
      ops: ops as any,
      mSt,
      tSt,
      moves: [],
      machines: machines as any,
      toolMap: intToolMap,
      workdays: intWorkdays,
      nDays: 4,
      workforceConfig: testConfig,
      dates: intDates,
    });

    const forecast = result.workforceForecast!;
    if (forecast.hasWarnings) {
      const forecastDecisions = result.decisions.filter((d) => d.type === 'WORKFORCE_FORECAST_D1');
      expect(forecastDecisions.length).toBe(forecast.warnings.length);
    }
    if (!forecast.hasWarnings) {
      const forecastDecisions = result.decisions.filter((d) => d.type === 'WORKFORCE_FORECAST_D1');
      expect(forecastDecisions).toHaveLength(0);
    }
  });

  it('17. DecisionSummary includes workforceForecastD1 counter', () => {
    const result = scheduleAll({
      ops: ops as any,
      mSt,
      tSt,
      moves: [],
      machines: machines as any,
      toolMap: intToolMap,
      workdays: intWorkdays,
      nDays: 4,
      workforceConfig: testConfig,
      dates: intDates,
    });

    const summary = result.registry.getSummary();
    expect(typeof summary.workforceForecastD1).toBe('number');
    expect(typeof summary.workforceCoverageMissing).toBe('number');
  });

  it('18. No workforceConfig → no forecast (undefined)', () => {
    const result = scheduleAll({
      ops: ops as any,
      mSt,
      tSt,
      moves: [],
      machines: machines as any,
      toolMap: intToolMap,
      workdays: intWorkdays,
      nDays: 4,
      // No workforceConfig!
    });

    expect(result.workforceForecast).toBeUndefined();
  });
});
