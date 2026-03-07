// Testes de lote económico (G-7)
// Verifica que operações abaixo do lote mínimo são flaggadas

import { describe, expect, it } from 'vitest';
import { type EOp, type ETool, scheduleAll } from '../../lib/engine';

const nDays = 8;
const workdays = Array(nDays).fill(true) as boolean[];

const machines = [{ id: 'PRM019', area: 'PG1', focus: true }];

const tools: ETool[] = [
  {
    id: 'BFP079',
    m: 'PRM019',
    alt: '-',
    sH: 0.5,
    pH: 1200,
    op: 1,
    lt: 5000,
    stk: 0,
    nm: 'Tool079',
  },
  { id: 'BFP082', m: 'PRM019', alt: '-', sH: 0.5, pH: 800, op: 1, lt: 0, stk: 0, nm: 'Tool082' },
];

const toolMap: Record<string, ETool> = {};
tools.forEach((t) => {
  toolMap[t.id] = t;
});

const mSt: Record<string, string> = { PRM019: 'ok' };
const tSt: Record<string, string> = { BFP079: 'ok', BFP082: 'ok' };

describe('G-07: Lote Económico', () => {
  it('batch mode rounds demand up to lot_eco', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU1',
        nm: 'P1',
        atr: 0,
        d: [1000, 0, 0, 0, 0, 0, 0, 0],
      },
    ];

    const { blocks } = scheduleAll({
      ops,
      mSt,
      tSt,
      moves: [],
      machines,
      toolMap,
      workdays,
      nDays,
    });
    const okBlocks = blocks.filter((b) => b.type === 'ok');

    expect(okBlocks.length).toBeGreaterThanOrEqual(1);
    // Batch mode: demand 1000 rounded up to lot_eco 5000
    const totalQty = okBlocks.reduce((s, b) => s + b.qty, 0);
    expect(totalQty).toBe(5000);
    expect(okBlocks[0].belowMinBatch).toBeFalsy(); // batch always produces >= lot_eco
  });

  it('demand above lot_eco rounds up to next multiple', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU1',
        nm: 'P1',
        atr: 0,
        d: [5000, 0, 0, 0, 0, 0, 0, 0],
      },
    ];

    const { blocks } = scheduleAll({
      ops,
      mSt,
      tSt,
      moves: [],
      machines,
      toolMap,
      workdays,
      nDays,
    });
    const okBlocks = blocks.filter((b) => b.type === 'ok');

    expect(okBlocks.length).toBeGreaterThanOrEqual(1);
    const totalQty = okBlocks.reduce((s, b) => s + b.qty, 0);
    expect(totalQty).toBe(5000); // exact multiple → no rounding
    expect(okBlocks[0].belowMinBatch).toBeFalsy();
  });

  it('tool sem lote económico (lt=0) produces exact demand', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP082',
        m: 'PRM019',
        sku: 'SKU2',
        nm: 'P2',
        atr: 0,
        d: [100, 0, 0, 0, 0, 0, 0, 0],
      },
    ];

    const { blocks } = scheduleAll({
      ops,
      mSt,
      tSt,
      moves: [],
      machines,
      toolMap,
      workdays,
      nDays,
    });
    const okBlocks = blocks.filter((b) => b.type === 'ok');

    expect(okBlocks.length).toBeGreaterThanOrEqual(1);
    const totalQty = okBlocks.reduce((s, b) => s + b.qty, 0);
    expect(totalQty).toBe(100); // lt=0 → exact demand
    expect(okBlocks[0].belowMinBatch).toBeFalsy();
  });
});
