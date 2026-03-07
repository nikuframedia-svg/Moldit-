// Testes de SetupCrew constraint (F-14.2)
// Verifica que setups nunca se sobrepõem entre máquinas (§6.2.3 Doc Mestre)

import { describe, expect, it } from 'vitest';
import { createSetupCrew, type EOp, type ETool, scheduleAll } from '../../lib/engine';

const nDays = 8;
const workdays = Array(nDays).fill(true) as boolean[];

// 2 machines with tools that require setup
const machines = [
  { id: 'PRM019', area: 'PG1', focus: true },
  { id: 'PRM020', area: 'PG1', focus: true },
];

const tools: ETool[] = [
  {
    id: 'BFP079',
    m: 'PRM019',
    alt: '-',
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
  { id: 'BFP091', m: 'PRM020', alt: '-', sH: 1.0, pH: 960, op: 1, lt: 4000, stk: 0, nm: 'Tool091' },
  {
    id: 'BFP105',
    m: 'PRM020',
    alt: '-',
    sH: 0.5,
    pH: 1100,
    op: 1,
    lt: 3500,
    stk: 0,
    nm: 'Tool105',
  },
];

const toolMap: Record<string, ETool> = {};
tools.forEach((t) => {
  toolMap[t.id] = t;
});

const mSt: Record<string, string> = { PRM019: 'ok', PRM020: 'ok' };
const tSt: Record<string, string> = { BFP079: 'ok', BFP082: 'ok', BFP091: 'ok', BFP105: 'ok' };

describe('F-02: SetupCrew Constraint', () => {
  it('createSetupCrew funciona correctamente', () => {
    const crew = createSetupCrew();

    // Book a slot
    crew.book(450, 510, 'PRM019');

    // Finding next available — overlapping should be pushed
    const next = crew.findNextAvailable(460, 60, 1440);
    expect(next).toBe(510); // After the existing slot

    // Non-overlapping should work
    const next2 = crew.findNextAvailable(510, 60, 1440);
    expect(next2).toBe(510); // Exactly after
  });

  it('createSetupCrew retorna -1 quando não cabe', () => {
    const crew = createSetupCrew();
    crew.book(1320, 1440, 'PRM019'); // Fill end of day

    const next = crew.findNextAvailable(1320, 180, 1440); // 3h setup won't fit
    expect(next).toBe(-1);
  });

  it('setup_overlap_violations == 0 para cenário multi-máquina', () => {
    // Operations que forçam setup em ambas as máquinas no mesmo dia
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
        d: [2000, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP003',
        t: 'BFP091',
        m: 'PRM020',
        sku: 'SKU3',
        nm: 'P3',
        atr: 0,
        d: [3000, 0, 0, 0, 0, 0, 0, 0],
      },
      {
        id: 'OP004',
        t: 'BFP105',
        m: 'PRM020',
        sku: 'SKU4',
        nm: 'P4',
        atr: 0,
        d: [2000, 0, 0, 0, 0, 0, 0, 0],
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

    // Extract all setup intervals (absolute timeline)
    const setupSlots = blocks
      .filter((b) => b.setupS != null && b.setupE != null)
      .map((b) => ({
        start: b.dayIdx * 1440 + b.setupS!,
        end: b.dayIdx * 1440 + b.setupE!,
        machine: b.machineId,
      }));

    // Check no overlaps between different machines
    let overlaps = 0;
    for (let i = 0; i < setupSlots.length; i++) {
      for (let j = i + 1; j < setupSlots.length; j++) {
        if (setupSlots[i].machine === setupSlots[j].machine) continue; // Same machine is ok
        if (setupSlots[i].start < setupSlots[j].end && setupSlots[j].start < setupSlots[i].end) {
          overlaps++;
        }
      }
    }

    expect(overlaps).toBe(0);
  });

  it('setups são sequenciais quando múltiplas máquinas precisam setup no mesmo turno', () => {
    // Force both machines to need setup at the start of day
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
        t: 'BFP091',
        m: 'PRM020',
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
    const setups = blocks.filter((b) => b.setupS != null).sort((a, b) => a.setupS! - b.setupS!);

    if (setups.length >= 2) {
      // Second setup should start at or after first setup ends
      expect(setups[1].setupS!).toBeGreaterThanOrEqual(setups[0].setupE!);
    }
  });
});
