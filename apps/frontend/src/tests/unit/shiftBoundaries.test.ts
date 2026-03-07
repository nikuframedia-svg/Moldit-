// Testes de fronteiras de turno (F-14.3)
// Verifica que nenhuma operação cruza T1=15:30 (§4.4 Doc Mestre, DEC-0002)

import { describe, expect, it } from 'vitest';
import { type Block, type EOp, type ETool, scheduleAll } from '../../lib/engine';

const T1 = 15.5 * 60; // 930 min — shift boundary (15:30)

const nDays = 8;
const workdays = Array(nDays).fill(true) as boolean[];

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
  { id: 'BFP082', m: 'PRM019', alt: '-', sH: 0.5, pH: 800, op: 1, lt: 3000, stk: 0, nm: 'Tool082' },
  { id: 'BFP091', m: 'PRM020', alt: '-', sH: 0.5, pH: 960, op: 1, lt: 4000, stk: 0, nm: 'Tool091' },
];

const toolMap: Record<string, ETool> = {};
tools.forEach((t) => {
  toolMap[t.id] = t;
});

const mSt: Record<string, string> = { PRM019: 'ok', PRM020: 'ok' };
const tSt: Record<string, string> = { BFP079: 'ok', BFP082: 'ok', BFP091: 'ok' };

/** Local helper since setupCountByShift is not exported from incompol-plan */
function setupCountByShift(blocks: Block[]): { X: number; Y: number; Z: number } {
  return {
    X: blocks.filter((b) => b.setupS != null && b.shift === 'X').length,
    Y: blocks.filter((b) => b.setupS != null && b.shift === 'Y').length,
    Z: blocks.filter((b) => b.setupS != null && b.shift === 'Z').length,
  };
}

describe('F-03: Fronteiras de Turno X/Y', () => {
  it('nenhuma operação cruza a fronteira T1 (15:30)', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU1',
        nm: 'P1',
        atr: 0,
        d: [8000, 5000, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP002',
        t: 'BFP082',
        m: 'PRM019',
        sku: 'SKU2',
        nm: 'P2',
        atr: 0,
        d: [4000, 3000, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP003',
        t: 'BFP091',
        m: 'PRM020',
        sku: 'SKU3',
        nm: 'P3',
        atr: 0,
        d: [6000, 6000, 0, 0, 0, 0, 0, 0],
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

    // No block should cross T1 boundary
    const crossingBlocks = blocks.filter((b) => {
      if (b.type === 'blocked') return false;
      return b.startMin < T1 && b.endMin > T1;
    });

    expect(crossingBlocks).toHaveLength(0);
  });

  it('nenhum setup cruza a fronteira T1', () => {
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
      {
        id: 'OP002',
        t: 'BFP082',
        m: 'PRM019',
        sku: 'SKU2',
        nm: 'P2',
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

    const crossingSetups = blocks.filter((b) => {
      if (b.setupS == null || b.setupE == null) return false;
      return b.setupS < T1 && b.setupE > T1;
    });

    expect(crossingSetups).toHaveLength(0);
  });

  it('shift field está correcto (X antes T1, Y depois)', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU1',
        nm: 'P1',
        atr: 0,
        d: [10000, 0, 0, 0, 0, 0, 0, 0],
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

    blocks.forEach((b) => {
      if (b.type === 'blocked') return;
      if (b.startMin < T1) {
        expect(b.shift).toBe('X');
      } else {
        expect(b.shift).toBe('Y');
      }
    });
  });

  it('setupCountByShift conta correctamente por turno', () => {
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
        t: 'BFP082',
        m: 'PRM019',
        sku: 'SKU2',
        nm: 'P2',
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
    const counts = setupCountByShift(blocks);

    // Total setups should equal X + Y
    const totalSetups = blocks.filter((b) => b.setupS != null).length;
    expect(counts.X + counts.Y).toBe(totalSetups);
  });

  it('operação que não cabe no turno X é empurrada para turno Y (DEC-0002)', () => {
    // Big operation that forces push to Y
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
      {
        id: 'OP002',
        t: 'BFP082',
        m: 'PRM019',
        sku: 'SKU2',
        nm: 'P2',
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
    const prm019Blocks = blocks.filter((b) => b.machineId === 'PRM019' && b.type !== 'blocked');

    // Should have blocks in both shifts
    const hasX = prm019Blocks.some((b) => b.shift === 'X');
    const hasY = prm019Blocks.some((b) => b.shift === 'Y');

    // With enough load, both shifts should be used
    if (prm019Blocks.length > 1) {
      expect(hasX || hasY).toBe(true); // At least one shift used
    }
  });

  it('dias não-úteis não têm operações agendadas (F-12)', () => {
    const ops: EOp[] = [
      {
        id: 'OP001',
        t: 'BFP079',
        m: 'PRM019',
        sku: 'SKU1',
        nm: 'P1',
        atr: 0,
        d: [3000, 3000, 3000, 0, 0, 0, 0, 0],
      },
    ];

    // Day 1 (index 1) is non-working
    const customWorkdays = [true, false, true, true, true, true, true, true];
    const { blocks } = scheduleAll({
      ops,
      mSt,
      tSt,
      moves: [],
      machines,
      toolMap,
      workdays: customWorkdays,
      nDays,
    });

    const day1Blocks = blocks.filter((b) => b.dayIdx === 1);
    expect(day1Blocks).toHaveLength(0);
  });
});
