// Testes de determinismo do scheduling engine (F-14.1)
// Verifica que mesma seed produz mesmos resultados (§2.1 Doc Mestre)

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKFORCE_CONFIG,
  type EOp,
  type ETool,
  mulberry32,
  runOptimization,
  scheduleAll,
} from '../../lib/engine';

// Minimal test data matching real Nikufra structure
const machines = [
  { id: 'PRM019', area: 'PG1', focus: true },
  { id: 'PRM020', area: 'PG1', focus: true },
];

const tools: ETool[] = [
  {
    id: 'BFP079',
    m: 'PRM019',
    alt: 'PRM020',
    sH: 1.0,
    pH: 1200,
    op: 2,
    lt: 5000,
    stk: 0,
    nm: 'Tool079',
  },
  {
    id: 'BFP082',
    m: 'PRM019',
    alt: '-',
    sH: 0.75,
    pH: 800,
    op: 1,
    lt: 3000,
    stk: 0,
    nm: 'Tool082',
  },
  { id: 'BFP091', m: 'PRM020', alt: '-', sH: 0.5, pH: 960, op: 1, lt: 4000, stk: 0, nm: 'Tool091' },
];

const toolMap: Record<string, ETool> = {};
tools.forEach((t) => {
  toolMap[t.id] = t;
});

const nDays = 8;
const workdays = Array(nDays).fill(true) as boolean[];

const ops: EOp[] = [
  {
    id: 'OP001',
    t: 'BFP079',
    m: 'PRM019',
    sku: '1065170X100',
    nm: 'Peça A',
    atr: 0,
    d: [5000, 3000, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'OP002',
    t: 'BFP082',
    m: 'PRM019',
    sku: '1064169X100',
    nm: 'Peça B',
    atr: 0,
    d: [0, 4000, 2000, 0, 0, 0, 0, 0],
  },
  {
    id: 'OP003',
    t: 'BFP091',
    m: 'PRM020',
    sku: '1092262X100',
    nm: 'Peça C',
    atr: 0,
    d: [3000, 3000, 0, 0, 0, 0, 0, 0],
  },
];

const mSt: Record<string, string> = { PRM019: 'ok', PRM020: 'ok' };
const tSt: Record<string, string> = { BFP079: 'ok', BFP082: 'ok', BFP091: 'ok' };

describe('F-01: Determinismo do Monte Carlo', () => {
  it('mulberry32 produz sequência determinística para mesma seed', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    const seq1 = Array.from({ length: 100 }, () => rng1());
    const seq2 = Array.from({ length: 100 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it('mulberry32 produz sequência diferente para seeds diferentes', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(99);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).not.toEqual(seq2);
  });

  it('mulberry32 valores estão no intervalo [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('scheduleAll produz resultado idêntico para mesmos inputs', () => {
    const result1 = scheduleAll({ ops, mSt, tSt, moves: [], machines, toolMap, workdays, nDays });
    const result2 = scheduleAll({ ops, mSt, tSt, moves: [], machines, toolMap, workdays, nDays });

    const blocks1 = result1.blocks;
    const blocks2 = result2.blocks;

    expect(blocks1.length).toBe(blocks2.length);
    blocks1.forEach((b, i) => {
      expect(b.startMin).toBe(blocks2[i].startMin);
      expect(b.endMin).toBe(blocks2[i].endMin);
      expect(b.qty).toBe(blocks2[i].qty);
      expect(b.machineId).toBe(blocks2[i].machineId);
    });
  });

  it('runOptimization com mesma seed produz mesmos top results', () => {
    const r1 = runOptimization({
      ops,
      mSt,
      tSt,
      machines,
      TM: toolMap,
      focusIds: ['PRM019', 'PRM020'],
      tools,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
      seed: 42,
      N: 10,
      K: 3,
      nDays,
      workdays,
    });
    const r2 = runOptimization({
      ops,
      mSt,
      tSt,
      machines,
      TM: toolMap,
      focusIds: ['PRM019', 'PRM020'],
      tools,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
      seed: 42,
      N: 10,
      K: 3,
      nDays,
      workdays,
    });

    expect(r1.top.length).toBe(r2.top.length);
    r1.top.forEach((t, i) => {
      expect(t.score).toBe(r2.top[i].score);
      expect(t.label).toBe(r2.top[i].label);
    });
  });

  it('runOptimization com seed diferente pode produzir resultados diferentes', () => {
    const r1 = runOptimization({
      ops,
      mSt,
      tSt,
      machines,
      TM: toolMap,
      focusIds: ['PRM019', 'PRM020'],
      tools,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
      seed: 42,
      N: 50,
      K: 3,
      nDays,
      workdays,
    });
    const r2 = runOptimization({
      ops,
      mSt,
      tSt,
      machines,
      TM: toolMap,
      focusIds: ['PRM019', 'PRM020'],
      tools,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
      seed: 99,
      N: 50,
      K: 3,
      nDays,
      workdays,
    });

    // At minimum both should have a baseline (identical)
    expect(r1.top[0].score).toBe(r2.top[0].score); // Baseline is the same
    // Monte Carlo iterations may differ (not guaranteed, but likely with 50 iters)
  });
});
