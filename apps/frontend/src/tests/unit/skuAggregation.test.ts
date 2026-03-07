// Testes de agregação SKU cross-client (G-6)
// Verifica que ops com mesmo SKU+tool são agregadas, evitando setups duplicados

import { describe, expect, it } from 'vitest';
import { type EOp, type ETool, scheduleAll } from '../../lib/engine';

const nDays = 8;
const workdays = Array(nDays).fill(true) as boolean[];

const machines = [{ id: 'PRM019', area: 'PG1', focus: true }];

const tools: ETool[] = [
  { id: 'BFP079', m: 'PRM019', alt: '-', sH: 1.0, pH: 1200, op: 1, lt: 0, stk: 0, nm: 'Tool079' },
  { id: 'BFP082', m: 'PRM019', alt: '-', sH: 0.75, pH: 800, op: 1, lt: 0, stk: 0, nm: 'Tool082' },
];

const toolMap: Record<string, ETool> = {};
tools.forEach((t) => {
  toolMap[t.id] = t;
});

const mSt: Record<string, string> = { PRM019: 'ok' };
const tSt: Record<string, string> = { BFP079: 'ok', BFP082: 'ok' };

describe('G-06: SKU Aggregation cross-client', () => {
  it('mesmo SKU+tool de clientes diferentes → apenas 1 setup', () => {
    // Dois clientes encomendaram o mesmo SKU no mesmo dia
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU_A',
        nm: 'Peça A (VW)',
        atr: 0,
        d: [2000, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP002',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU_A',
        nm: 'Peça A (PSA)',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
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
    const okBlocks = blocks.filter((b) => b.type !== 'blocked');

    // Deve haver apenas 1 bloco de produção (agregado) com 1 setup
    const setups = okBlocks.filter((b) => b.setupS != null);
    expect(setups).toHaveLength(1); // Apenas 1 setup, não 2
  });

  it('SKUs diferentes no mesmo tool → mantêm-se separadas', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU_A',
        nm: 'Peça A',
        atr: 0,
        d: [2000, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP002',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU_B',
        nm: 'Peça B',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
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
    const okBlocks = blocks.filter((b) => b.type !== 'blocked');

    // 2 blocos separados (SKUs diferentes, mesmo tool = sem setup extra)
    expect(okBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it('agregação preserva quantidade total', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU_A',
        nm: 'Peça A',
        atr: 0,
        d: [2000, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP002',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU_A',
        nm: 'Peça A',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
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
    const totalQty = blocks.filter((b) => b.type !== 'blocked').reduce((a, b) => a + b.qty, 0);

    expect(totalQty).toBe(5000); // 2000 + 3000
  });
});
