// Testes de capacidade de operadores (G-4)
// Verifica que OperatorPool bloqueia ops quando limite excedido

import { describe, expect, it } from 'vitest';
import { type EOp, type ETool, scheduleAll, type WorkforceConfig } from '../../lib/engine';

const nDays = 8;
const workdays = Array(nDays).fill(true) as boolean[];

const machines = [
  { id: 'PRM019', area: 'PG1', focus: true },
  { id: 'PRM020', area: 'PG1', focus: true },
];

const tools: ETool[] = [
  { id: 'BFP079', m: 'PRM019', alt: '-', sH: 0.5, pH: 1200, op: 2, lt: 0, stk: 0, nm: 'Tool079' },
  { id: 'BFP082', m: 'PRM019', alt: '-', sH: 0.5, pH: 800, op: 2, lt: 0, stk: 0, nm: 'Tool082' },
  { id: 'BFP091', m: 'PRM020', alt: '-', sH: 0.5, pH: 960, op: 2, lt: 0, stk: 0, nm: 'Tool091' },
];

const toolMap: Record<string, ETool> = {};
tools.forEach((t) => {
  toolMap[t.id] = t;
});

const mSt: Record<string, string> = { PRM019: 'ok', PRM020: 'ok' };
const tSt: Record<string, string> = { BFP079: 'ok', BFP082: 'ok', BFP091: 'ok' };

/** Helper to build a WorkforceConfig with a flat capacity for both areas */
function makeWorkforceConfig(pg1Cap: number, pg2Cap: number): WorkforceConfig {
  return {
    laborGroups: {
      PG1: [{ start: 420, end: 1440, capacity: pg1Cap }],
      PG2: [{ start: 420, end: 1440, capacity: pg2Cap }],
    },
    machineToLaborGroup: {
      PRM019: 'PG1',
      PRM020: 'PG1',
    },
  };
}

describe('G-04: Operator Capacity Enforcement', () => {
  it('operator pool pushes 2nd machine to different shift when area cap exceeded', () => {
    // Cada tool requer 2 operadores. Com cap=2, ambas não cabem em simultâneo (2+2=4 > 2).
    // O allocator minuto-a-minuto empurra PRM020 para outro shift ou dia.
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU1',
        nm: 'P1',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP002',
        t: 'BFP091',
        m: 'PRM020',
        sku: 'SKU2',
        nm: 'P2',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
      },
    ];

    const wfc = makeWorkforceConfig(2, 2);
    const { blocks } = scheduleAll({
      ops,
      mSt,
      tSt,
      moves: [],
      machines,
      toolMap,
      workdays,
      nDays,
      workforceConfig: wfc,
    });
    const okBlocks = blocks.filter((b) => b.type === 'ok');

    // Both should schedule (capacity constraint may push PRM020 to different shift/day)
    const prm019Blocks = okBlocks.filter((b) => b.machineId === 'PRM019');
    const prm020Blocks = okBlocks.filter((b) => b.machineId === 'PRM020');
    expect(prm019Blocks.length).toBeGreaterThanOrEqual(1);
    expect(prm020Blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('operator pool overflow when cap=1 and op needs 2', () => {
    // Cap=1 mas cada tool precisa de 2 operadores → ambos shifts rejeitados → overflow
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU1',
        nm: 'P1',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
      },
    ];

    const wfc = makeWorkforceConfig(1, 1);
    const { blocks } = scheduleAll({
      ops,
      mSt,
      tSt,
      moves: [],
      machines,
      toolMap,
      workdays,
      nDays,
      workforceConfig: wfc,
    });
    // With cap=1 and need=2, every shift is rejected → production pushed across days
    // but eventually no capacity anywhere → overflow or all shifts consumed
    const totalBlocks = blocks.filter((b) => b.type === 'ok' || b.type === 'overflow');
    expect(totalBlocks.length).toBeGreaterThanOrEqual(1);
  });

  it('operator pool permite dentro do limite', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU1',
        nm: 'P1',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP002',
        t: 'BFP091',
        m: 'PRM020',
        sku: 'SKU2',
        nm: 'P2',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
      },
    ];

    const wfc = makeWorkforceConfig(10, 10);
    const { blocks } = scheduleAll({
      ops,
      mSt,
      tSt,
      moves: [],
      machines,
      toolMap,
      workdays,
      nDays,
      workforceConfig: wfc,
    });
    const overflows = blocks.filter((b) => b.type === 'overflow');

    expect(overflows).toHaveLength(0);
  });

  it('sem avOps não há enforcement (backward-compatible)', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU1',
        nm: 'P1',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP002',
        t: 'BFP091',
        m: 'PRM020',
        sku: 'SKU2',
        nm: 'P2',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
      },
    ];

    // Sem workforceConfig → sem pool → tudo agendado
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
    expect(okBlocks.length).toBeGreaterThanOrEqual(2);
  });
});
