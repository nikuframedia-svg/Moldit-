// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- Transparency Report Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { buildTransparencyReport } from '../src/analysis/transparency-report.js';
import { DAY_CAP, DEFAULT_OEE } from '../src/constants.js';
import type { Block } from '../src/types/blocks.js';
import type { DecisionEntry } from '../src/types/decisions.js';
import type { EOp, ETool } from '../src/types/engine.js';
import type { InfeasibilityEntry } from '../src/types/infeasibility.js';
import type { DeficitEvolution, WorkContent } from '../src/types/scoring.js';
import type { OperationDeadline } from '../src/types/shipping.js';

// ── Helpers ───────────────────────────────────────────────────

function mkOp(overrides: Partial<EOp> & { id: string; t: string; m: string; d: number[] }): EOp {
  return { sku: 'SKU01', nm: 'Test', atr: 0, ...overrides };
}

function mkTool(overrides: Partial<ETool> & { id: string }): ETool {
  return {
    m: 'M01',
    alt: '-',
    sH: 1,
    pH: 100,
    op: 1,
    lt: 1000,
    stk: 0,
    nm: 'Test',
    ...overrides,
  };
}

function mkBlock(overrides: Partial<Block>): Block {
  return {
    opId: 'OP01',
    toolId: 'T01',
    sku: 'SKU01',
    nm: 'Test',
    machineId: 'M01',
    origM: 'M01',
    dayIdx: 0,
    qty: 100,
    prodMin: 60,
    setupMin: 10,
    operators: 1,
    blocked: false,
    reason: null,
    moved: false,
    hasAlt: false,
    altM: null,
    stk: 0,
    lt: 1000,
    atr: 0,
    startMin: 450,
    endMin: 520,
    setupS: null,
    setupE: null,
    type: 'ok',
    shift: 'X',
    ...overrides,
  };
}

function mkWorkContent(opId: string, overrides?: Partial<WorkContent>): WorkContent {
  const pH = overrides?.pH ?? 100;
  const oee = overrides?.oee ?? DEFAULT_OEE;
  const totalQty = overrides?.totalQty ?? 1000;
  const workContentHours = totalQty / (pH * oee);
  return {
    opId,
    totalQty,
    pH,
    oee,
    oeeSource: 'default',
    workContentHours,
    workContentMin: workContentHours * 60,
    daysRequired: (workContentHours * 60) / DAY_CAP,
    ...overrides,
  };
}

function mkDeficit(opId: string, overrides?: Partial<DeficitEvolution>): DeficitEvolution {
  return {
    opId,
    dailyDeficit: [500, 300, 100, -100],
    firstDeficitDay: 3,
    maxDeficit: 100,
    initialStock: 500,
    ...overrides,
  };
}

function mkDeadline(opId: string, overrides?: Partial<OperationDeadline>): OperationDeadline {
  return {
    opId,
    shippingDayIdx: 5,
    bufferHours: 0,
    latestFinishAbs: 5 * 1440 + 1440, // day 5 end = 24:00 (no buffer)
    latestFinishDay: 6,
    latestFinishMin: 0,
    bufferSource: 'default',
    availableWorkdays: 7,
    shippingDayIsWorkday: true,
    ...overrides,
  };
}

function mkCapacityDecision(opId: string): DecisionEntry {
  return {
    id: `dec-${opId}`,
    timestamp: Date.now(),
    type: 'CAPACITY_COMPUTATION',
    opId,
    toolId: 'T01',
    machineId: 'M01',
    detail: `Cap log for ${opId}`,
    metadata: {
      opId,
      toolId: 'T01',
      machineId: 'M01',
      oeeValue: DEFAULT_OEE,
      oeeSource: 'default',
      piecesPerHour: 100,
      availableHoursPerDay: DAY_CAP / 60,
      resultingCapacityPcsPerDay: 100 * DEFAULT_OEE * (DAY_CAP / 60),
      workContentHours: 15.15,
      daysRequired: 0.92,
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('buildTransparencyReport', () => {
  it('generates OrderJustification for a feasible operation', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [500, 500, 0, 0, 0, 0] });
    const tool = mkTool({ id: 'T01', pH: 100 });
    const toolMap = { T01: tool };
    const wc = mkWorkContent('OP01', { totalQty: 1000, pH: 100 });
    const de = mkDeficit('OP01', {
      dailyDeficit: [500, 0, 0, 0, 0, 0],
      firstDeficitDay: -1,
      maxDeficit: 0,
      initialStock: 1000,
    });
    const deadline = mkDeadline('OP01', { shippingDayIdx: 5 });
    const blocks = [
      mkBlock({ opId: 'OP01', dayIdx: 0, qty: 600, prodMin: 360, shift: 'X' }),
      mkBlock({ opId: 'OP01', dayIdx: 1, qty: 400, prodMin: 240, shift: 'X' }),
    ];

    const report = buildTransparencyReport(
      blocks,
      [op],
      toolMap,
      new Map([['OP01', deadline]]),
      new Map([['OP01', wc]]),
      new Map([['OP01', de]]),
      [], // no infeasibilities
      [mkCapacityDecision('OP01')],
    );

    expect(report.orderJustifications).toHaveLength(1);
    const oj = report.orderJustifications[0];
    expect(oj.opId).toBe('OP01');
    expect(oj.feasible).toBe(true);
    expect(oj.totalProduced).toBe(1000);
    expect(oj.totalDemand).toBe(1000);
    expect(oj.initialStock).toBe(1000);
    expect(oj.pH).toBe(100);
    expect(oj.oee).toBe(DEFAULT_OEE);
    expect(oj.capacityPcsPerDay).toBeGreaterThan(0);
    expect(oj.startReason).toBeDefined();
    expect(oj.shiftsUsedPerDay).toHaveLength(6);
    expect(report.failureJustifications).toHaveLength(0);
  });

  it('generates FailureJustification for an infeasible operation', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [5000, 5000] });
    const tool = mkTool({ id: 'T01', pH: 100 });
    const toolMap = { T01: tool };
    const wc = mkWorkContent('OP01', { totalQty: 10000, pH: 100 });
    const de = mkDeficit('OP01', {
      dailyDeficit: [-5000, -10000],
      firstDeficitDay: 0,
      maxDeficit: 10000,
      initialStock: 0,
    });
    const deadline = mkDeadline('OP01', { shippingDayIdx: 1, latestFinishAbs: 1 * 1440 + 1440 });
    const blocks = [
      mkBlock({ opId: 'OP01', dayIdx: 0, qty: 1000, prodMin: 600, type: 'ok' }),
      mkBlock({
        opId: 'OP01',
        dayIdx: 0,
        qty: 0,
        prodMin: 0,
        type: 'infeasible',
        infeasibilityReason: 'SHIPPING_CUTOFF_VIOLATION',
      }),
    ];
    const infeasibilities: InfeasibilityEntry[] = [
      {
        opId: 'OP01',
        toolId: 'T01',
        machineId: 'M01',
        reason: 'SHIPPING_CUTOFF_VIOLATION',
        detail: 'Demand 10000, produced 1000, deficit 9000',
        attemptedAlternatives: ['Slot allocation'],
        suggestion: 'Activar 3.º turno; Overtime em M01',
      },
    ];

    const report = buildTransparencyReport(
      blocks,
      [op],
      toolMap,
      new Map([['OP01', deadline]]),
      new Map([['OP01', wc]]),
      new Map([['OP01', de]]),
      infeasibilities,
      [],
    );

    expect(report.failureJustifications).toHaveLength(1);
    const fj = report.failureJustifications[0];
    expect(fj.opId).toBe('OP01');
    expect(fj.constraintsViolated).toContain('SHIPPING_CUTOFF_VIOLATION');
    expect(fj.missingCapacityPieces).toBe(9000);
    expect(fj.missingCapacityHours).toBeGreaterThan(0);
    expect(fj.suggestions).toHaveLength(2);
    expect(fj.suggestions[0]).toContain('turno');
    expect(report.orderJustifications).toHaveLength(0);
  });

  it('extracts capacity log from CAPACITY_COMPUTATION decisions', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [100] });
    const tool = mkTool({ id: 'T01' });
    const toolMap = { T01: tool };
    const wc = mkWorkContent('OP01', { totalQty: 100 });
    const de = mkDeficit('OP01', { dailyDeficit: [-100], firstDeficitDay: 0 });
    const deadline = mkDeadline('OP01');
    const blocks = [mkBlock({ opId: 'OP01', qty: 100 })];
    const decisions = [mkCapacityDecision('OP01')];

    const report = buildTransparencyReport(
      blocks,
      [op],
      toolMap,
      new Map([['OP01', deadline]]),
      new Map([['OP01', wc]]),
      new Map([['OP01', de]]),
      [],
      decisions,
    );

    expect(report.capacityLog).toHaveLength(1);
    expect(report.capacityLog[0].opId).toBe('OP01');
    expect(report.capacityLog[0].oeeValue).toBe(DEFAULT_OEE);
    expect(report.capacityLog[0].piecesPerHour).toBe(100);
  });

  it('classifies start reason as deficit_elimination when day-0 deficit exists', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [100], atr: 500 });
    const tool = mkTool({ id: 'T01' });
    const toolMap = { T01: tool };
    const wc = mkWorkContent('OP01', { totalQty: 600 });
    const de = mkDeficit('OP01', {
      dailyDeficit: [-200, -300], // Deficit from day 0
      firstDeficitDay: 0,
      maxDeficit: 300,
      initialStock: 300,
    });
    const deadline = mkDeadline('OP01');
    const blocks = [mkBlock({ opId: 'OP01', qty: 600 })];

    const report = buildTransparencyReport(
      blocks,
      [op],
      toolMap,
      new Map([['OP01', deadline]]),
      new Map([['OP01', wc]]),
      new Map([['OP01', de]]),
      [],
      [],
    );

    expect(report.orderJustifications[0].startReason).toBe('deficit_elimination');
    expect(report.orderJustifications[0].initialDeficit).toBe(200);
  });

  it('classifies start reason as urgency_slack_critical when slack < DAY_CAP', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [1000] });
    const tool = mkTool({ id: 'T01', pH: 1000 });
    const toolMap = { T01: tool };
    // workContentMin = 1000 / (1000 * 0.66) * 60 ≈ 90.9 min
    const wc = mkWorkContent('OP01', { totalQty: 1000, pH: 1000 });
    const de = mkDeficit('OP01', {
      dailyDeficit: [0],
      firstDeficitDay: -1,
      maxDeficit: 0,
      initialStock: 1000,
    });
    // deadline very tight: latestFinishAbs just barely above workContentMin
    const deadline = mkDeadline('OP01', {
      shippingDayIdx: 0,
      latestFinishAbs: wc.workContentMin + 100, // slack = 100 < DAY_CAP
    });
    const blocks = [mkBlock({ opId: 'OP01', qty: 1000 })];

    const report = buildTransparencyReport(
      blocks,
      [op],
      toolMap,
      new Map([['OP01', deadline]]),
      new Map([['OP01', wc]]),
      new Map([['OP01', de]]),
      [],
      [],
    );

    expect(report.orderJustifications[0].startReason).toBe('urgency_slack_critical');
  });

  it('classifies start reason as density_heavy_load when density > 0.5', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [500, 500] });
    const tool = mkTool({ id: 'T01', pH: 100 });
    const toolMap = { T01: tool };
    // daysRequired = 1000 / (100*0.66) / (990/60) ≈ 0.92 days
    // Available days = 2 (shippingDayIdx=1 → 2 days)
    // But let's make density > 0.5: need daysRequired > 0.5 * availableDays
    // For 1 day available, daysRequired ~0.92 → density 0.92 > 0.5 ✓
    const wc = mkWorkContent('OP01', { totalQty: 1000, pH: 100 });
    const de = mkDeficit('OP01', {
      dailyDeficit: [500, 0],
      firstDeficitDay: -1,
      maxDeficit: 0,
      initialStock: 1000,
    });
    const deadline = mkDeadline('OP01', {
      shippingDayIdx: 0,
      latestFinishAbs: 5000, // plenty of slack so urgency doesn't trigger
    });
    const blocks = [mkBlock({ opId: 'OP01', qty: 1000 })];

    const report = buildTransparencyReport(
      blocks,
      [op],
      toolMap,
      new Map([['OP01', deadline]]),
      new Map([['OP01', wc]]),
      new Map([['OP01', de]]),
      [],
      [],
    );

    expect(report.orderJustifications[0].startReason).toBe('density_heavy_load');
  });

  it('classifies start reason as future_load_relief for leveled blocks', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [0, 0, 0, 0, 500] });
    const tool = mkTool({ id: 'T01', pH: 100 });
    const toolMap = { T01: tool };
    const wc = mkWorkContent('OP01', { totalQty: 500, pH: 100 });
    const de = mkDeficit('OP01', {
      dailyDeficit: [1000, 1000, 1000, 1000, 500],
      firstDeficitDay: -1,
      maxDeficit: 0,
      initialStock: 1000,
    });
    const deadline = mkDeadline('OP01', {
      shippingDayIdx: 4,
      latestFinishAbs: 20000, // lots of slack
    });
    const blocks = [mkBlock({ opId: 'OP01', qty: 500, dayIdx: 1, isLeveled: true })];

    const report = buildTransparencyReport(
      blocks,
      [op],
      toolMap,
      new Map([['OP01', deadline]]),
      new Map([['OP01', wc]]),
      new Map([['OP01', de]]),
      [],
      [],
    );

    expect(report.orderJustifications[0].startReason).toBe('future_load_relief');
  });

  it('classifies start reason as free_window_available as default', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [0, 0, 0, 0, 100] });
    const tool = mkTool({ id: 'T01', pH: 1000 });
    const toolMap = { T01: tool };
    const wc = mkWorkContent('OP01', { totalQty: 100, pH: 1000 });
    const de = mkDeficit('OP01', {
      dailyDeficit: [1000, 1000, 1000, 1000, 900],
      firstDeficitDay: -1,
      maxDeficit: 0,
      initialStock: 1000,
    });
    const deadline = mkDeadline('OP01', {
      shippingDayIdx: 4,
      latestFinishAbs: 50000, // lots of slack, low density
    });
    const blocks = [mkBlock({ opId: 'OP01', qty: 100, dayIdx: 3 })];

    const report = buildTransparencyReport(
      blocks,
      [op],
      toolMap,
      new Map([['OP01', deadline]]),
      new Map([['OP01', wc]]),
      new Map([['OP01', de]]),
      [],
      [],
    );

    expect(report.orderJustifications[0].startReason).toBe('free_window_available');
  });

  it('skips operations with zero total demand', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [0, 0, 0], atr: 0 });
    const tool = mkTool({ id: 'T01' });
    const toolMap = { T01: tool };

    const report = buildTransparencyReport(
      [],
      [op],
      toolMap,
      new Map(),
      new Map(),
      new Map(),
      [],
      [],
    );

    expect(report.orderJustifications).toHaveLength(0);
    expect(report.failureJustifications).toHaveLength(0);
  });

  it('handles mixed feasible and infeasible operations', () => {
    const ops = [
      mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [500] }),
      mkOp({ id: 'OP02', t: 'T02', m: 'M01', d: [10000] }),
    ];
    const toolMap = {
      T01: mkTool({ id: 'T01', pH: 1000 }),
      T02: mkTool({ id: 'T02', pH: 100 }),
    };
    const workContents = new Map([
      ['OP01', mkWorkContent('OP01', { totalQty: 500, pH: 1000 })],
      ['OP02', mkWorkContent('OP02', { totalQty: 10000, pH: 100 })],
    ]);
    const deficits = new Map([
      ['OP01', mkDeficit('OP01', { dailyDeficit: [500], firstDeficitDay: -1 })],
      [
        'OP02',
        mkDeficit('OP02', { dailyDeficit: [-10000], firstDeficitDay: 0, maxDeficit: 10000 }),
      ],
    ]);
    const deadlines = new Map([
      ['OP01', mkDeadline('OP01')],
      ['OP02', mkDeadline('OP02')],
    ]);
    const blocks = [
      mkBlock({ opId: 'OP01', qty: 500 }),
      mkBlock({
        opId: 'OP02',
        qty: 0,
        type: 'infeasible',
        infeasibilityReason: 'CAPACITY_OVERFLOW',
      }),
    ];
    const infeasibilities: InfeasibilityEntry[] = [
      {
        opId: 'OP02',
        toolId: 'T02',
        machineId: 'M01',
        reason: 'CAPACITY_OVERFLOW',
        detail: 'Capacity overflow',
        attemptedAlternatives: [],
        suggestion: 'Activar 3.º turno',
      },
    ];

    const report = buildTransparencyReport(
      blocks,
      ops,
      toolMap,
      deadlines,
      workContents,
      deficits,
      infeasibilities,
      [],
    );

    expect(report.orderJustifications).toHaveLength(1);
    expect(report.orderJustifications[0].opId).toBe('OP01');
    expect(report.failureJustifications).toHaveLength(1);
    expect(report.failureJustifications[0].opId).toBe('OP02');
  });

  it('computes shifts used per day correctly', () => {
    const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [500, 500, 0] });
    const tool = mkTool({ id: 'T01', pH: 100 });
    const toolMap = { T01: tool };
    const wc = mkWorkContent('OP01', { totalQty: 1000 });
    const de = mkDeficit('OP01', {
      dailyDeficit: [0, -500, -1000],
      firstDeficitDay: 1,
      initialStock: 500,
    });
    const deadline = mkDeadline('OP01', { shippingDayIdx: 2, latestFinishAbs: 10000 });
    const blocks = [
      mkBlock({ opId: 'OP01', dayIdx: 0, qty: 300, shift: 'X' }),
      mkBlock({ opId: 'OP01', dayIdx: 0, qty: 200, shift: 'Y' }),
      mkBlock({ opId: 'OP01', dayIdx: 1, qty: 500, shift: 'X' }),
    ];

    const report = buildTransparencyReport(
      blocks,
      [op],
      toolMap,
      new Map([['OP01', deadline]]),
      new Map([['OP01', wc]]),
      new Map([['OP01', de]]),
      [],
      [],
    );

    const oj = report.orderJustifications[0];
    expect(oj.shiftsUsedPerDay[0]).toEqual(['X', 'Y']);
    expect(oj.shiftsUsedPerDay[1]).toEqual(['X']);
    expect(oj.shiftsUsedPerDay[2]).toEqual([]);
  });
});
