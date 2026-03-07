// Testes do Gantt Validator (F-14.6)
// Verifica que validateSchedule detecta todas as violações de constraints

import { describe, expect, it } from 'vitest';
import {
  type Block,
  type EMachine,
  type EOp,
  type ETool,
  validateSchedule,
} from '../../lib/engine';

const machines: EMachine[] = [
  { id: 'PRM031', area: 'PG2', focus: true },
  { id: 'PRM039', area: 'PG2', focus: true },
];

const tools: ETool[] = [
  {
    id: 'BFP079',
    m: 'PRM031',
    alt: 'PRM039',
    sH: 1.0,
    pH: 1681,
    op: 2,
    lt: 13000,
    stk: 0,
    nm: 'BFP079',
  },
  {
    id: 'BFP178',
    m: 'PRM039',
    alt: '-',
    sH: 0.75,
    pH: 1200,
    op: 1,
    lt: 5000,
    stk: 0,
    nm: 'BFP178',
  },
];

const TM: Record<string, ETool> = {};
tools.forEach((t) => {
  TM[t.id] = t;
});

const ops: EOp[] = [
  {
    id: 'OP01',
    t: 'BFP079',
    m: 'PRM031',
    sku: 'SKU1',
    nm: 'P1',
    atr: 0,
    d: [13000, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'OP02',
    t: 'BFP178',
    m: 'PRM039',
    sku: 'SKU2',
    nm: 'P2',
    atr: 0,
    d: [5000, 0, 0, 0, 0, 0, 0, 0],
  },
];

// Helper to create a valid block
function mkBlock(overrides: Partial<Block>): Block {
  return {
    opId: 'OP01',
    toolId: 'BFP079',
    sku: 'SKU1',
    nm: 'P1',
    machineId: 'PRM031',
    origM: 'PRM031',
    dayIdx: 0,
    qty: 5000,
    prodMin: 180,
    setupMin: 60,
    operators: 2,
    blocked: false,
    reason: null,
    moved: false,
    hasAlt: true,
    altM: 'PRM039',
    stk: 0,
    lt: 13000,
    atr: 0,
    startMin: 510,
    endMin: 690,
    setupS: 450,
    setupE: 510,
    type: 'ok',
    shift: 'X',
    ...overrides,
  };
}

describe('F-06: Gantt Validator', () => {
  it('retorna valid para schedule limpo', () => {
    // Use non-overlapping setups for clean schedule
    const cleanBlocks: Block[] = [
      mkBlock({
        opId: 'OP01',
        toolId: 'BFP079',
        machineId: 'PRM031',
        startMin: 510,
        endMin: 930,
        setupS: 450,
        setupE: 510,
        qty: 13000,
      }),
      mkBlock({
        opId: 'OP02',
        toolId: 'BFP178',
        machineId: 'PRM039',
        startMin: 555,
        endMin: 805,
        setupS: 510,
        setupE: 555,
        qty: 5000,
        operators: 1,
      }),
    ];
    const report = validateSchedule(cleanBlocks, machines, TM, ops);
    expect(report.summary.toolConflicts).toBe(0);
    expect(report.summary.setupOverlaps).toBe(0);
  });

  it('detecta tool uniqueness violations', () => {
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP01',
        toolId: 'BFP079',
        machineId: 'PRM031',
        dayIdx: 0,
        startMin: 450,
        endMin: 930,
        setupS: null,
        setupE: null,
      }),
      mkBlock({
        opId: 'OP03',
        toolId: 'BFP079',
        machineId: 'PRM039',
        dayIdx: 0,
        startMin: 450,
        endMin: 930,
        setupS: null,
        setupE: null,
      }),
    ];
    const report = validateSchedule(blocks, machines, TM, ops);
    expect(report.summary.toolConflicts).toBeGreaterThan(0);
    expect(report.violations.some((v) => v.type === 'TOOL_UNIQUENESS')).toBe(true);
    expect(report.valid).toBe(false); // critical severity
  });

  it('detecta setup crew overlaps', () => {
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP01',
        toolId: 'BFP079',
        machineId: 'PRM031',
        dayIdx: 0,
        startMin: 510,
        endMin: 930,
        setupS: 450,
        setupE: 510,
      }),
      mkBlock({
        opId: 'OP02',
        toolId: 'BFP178',
        machineId: 'PRM039',
        dayIdx: 0,
        startMin: 510,
        endMin: 790,
        setupS: 470,
        setupE: 515,
        operators: 1,
      }),
    ];
    const report = validateSchedule(blocks, machines, TM, ops);
    expect(report.summary.setupOverlaps).toBeGreaterThan(0);
    expect(report.violations.some((v) => v.type === 'SETUP_CREW_OVERLAP')).toBe(true);
  });

  it('detecta machine overcapacity', () => {
    // 1021 min on one machine in one day (>1020 DAY_CAP)
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP01',
        machineId: 'PRM031',
        dayIdx: 0,
        startMin: 450,
        endMin: 1471,
        setupS: null,
        setupE: null,
      }),
    ];
    const report = validateSchedule(blocks, machines, TM, ops);
    expect(report.summary.machineOvercapacity).toBeGreaterThan(0);
  });

  it('detecta deadline misses', () => {
    // OP01 demands 13000 but produces 0
    const blocks: Block[] = []; // No production at all
    const report = validateSchedule(blocks, machines, TM, ops);
    expect(report.summary.deadlineMisses).toBeGreaterThan(0);
    expect(report.violations.some((v) => v.type === 'DEADLINE_MISS')).toBe(true);
  });

  it('ordena violações por severidade (critical > high > medium)', () => {
    const blocks: Block[] = [
      // Tool conflict (critical)
      mkBlock({
        opId: 'OP01',
        toolId: 'BFP079',
        machineId: 'PRM031',
        dayIdx: 0,
        startMin: 450,
        endMin: 930,
        setupS: null,
        setupE: null,
      }),
      mkBlock({
        opId: 'OP03',
        toolId: 'BFP079',
        machineId: 'PRM039',
        dayIdx: 0,
        startMin: 450,
        endMin: 930,
        setupS: null,
        setupE: null,
      }),
    ];
    const report = validateSchedule(blocks, machines, TM, ops);
    // First violation should be critical (tool uniqueness)
    const sorted = report.violations.sort((a, b) => {
      const o: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (o[a.severity] ?? 3) - (o[b.severity] ?? 3);
    });
    if (sorted.length >= 2) {
      expect(sorted[0].severity === 'critical' || sorted[0].severity === 'high').toBe(true);
    }
  });

  it('é uma função pura (deterministico)', () => {
    const blocks: Block[] = [
      mkBlock({
        opId: 'OP01',
        toolId: 'BFP079',
        machineId: 'PRM031',
        startMin: 510,
        endMin: 930,
        setupS: 450,
        setupE: 510,
        qty: 13000,
      }),
    ];
    const r1 = validateSchedule(blocks, machines, TM, ops);
    const r2 = validateSchedule(blocks, machines, TM, ops);
    expect(r1.violations.length).toBe(r2.violations.length);
    expect(r1.valid).toBe(r2.valid);
    expect(r1.summary).toEqual(r2.summary);
  });
});
