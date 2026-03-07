import { describe, expect, it } from 'vitest';
import { S1, S2 } from '../src/constants.js';
import {
  chooseLayer,
  dispatchReplan,
  LAYER_THRESHOLD_1,
  LAYER_THRESHOLD_2,
} from '../src/replan/replan-dispatcher.js';
import { assignFreezeZones, replanFull } from '../src/replan/replan-full.js';
import { replanMatchUp } from '../src/replan/replan-match-up.js';
import { replanPartial } from '../src/replan/replan-partial.js';

import { replanRightShift } from '../src/replan/replan-right-shift.js';
import type { ScheduleAllInput } from '../src/scheduler/scheduler.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import type { Block } from '../src/types/blocks.js';
import type { EMachine, EOp, ETool } from '../src/types/engine.js';
import { DEFAULT_WORKFORCE_CONFIG } from '../src/types/workforce.js';

// ── Fixtures ─────────────────────────────────────────────

function makeTool(id: string, m: string, alt: string, sH: number, pH: number): ETool {
  return { id, m, alt, sH, pH, op: 1, lt: 0, stk: 0, nm: `Tool ${id}` };
}

function makeOp(id: string, tool: string, machine: string, demand: number[], atr = 0): EOp {
  return {
    id,
    t: tool,
    m: machine,
    sku: `SKU_${id}`,
    nm: `Op ${id}`,
    pH: 500,
    atr,
    d: demand,
    s: 1,
    op: 1,
    cl: 'CL1',
    clNm: 'Client1',
  };
}

function createFixture() {
  const machines: EMachine[] = [
    { id: 'M1', area: 'PG1', man: [0, 0, 0, 0, 0] },
    { id: 'M2', area: 'PG1', man: [0, 0, 0, 0, 0] },
  ];
  const tools: Record<string, ETool> = {
    T1: makeTool('T1', 'M1', 'M2', 1, 500),
    T2: makeTool('T2', 'M1', '-', 0.5, 800),
    T3: makeTool('T3', 'M2', 'M1', 1, 500),
  };
  const ops: EOp[] = [
    makeOp('OP1', 'T1', 'M1', [0, 0, 1000, 0, 0]),
    makeOp('OP2', 'T2', 'M1', [0, 0, 0, 800, 0]),
    makeOp('OP3', 'T3', 'M2', [0, 0, 0, 0, 500]),
  ];
  const mSt: Record<string, string> = { M1: 'running', M2: 'running' };
  const tSt: Record<string, string> = { T1: 'running', T2: 'running', T3: 'running' };
  const workdays = [true, true, true, true, true];

  const scheduleInput: ScheduleAllInput = {
    ops,
    mSt,
    tSt,
    moves: [],
    machines,
    toolMap: tools,
    workdays,
    nDays: 5,
    rule: 'ATCS',
    workforceConfig: DEFAULT_WORKFORCE_CONFIG,
  };

  return { machines, tools, ops, mSt, tSt, workdays, scheduleInput };
}

function makeBlock(overrides: Partial<Block> & { opId: string; machineId: string }): Block {
  return {
    opId: overrides.opId,
    toolId: 'T1',
    sku: 'SKU1',
    nm: 'Op1',
    machineId: overrides.machineId,
    origM: overrides.machineId,
    dayIdx: 0,
    qty: 100,
    prodMin: 60,
    setupMin: 30,
    operators: 1,
    blocked: false,
    reason: null,
    moved: false,
    hasAlt: false,
    altM: null,
    stk: 0,
    lt: 0,
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

// ── Tests ────────────────────────────────────────────────

describe('chooseLayer', () => {
  it('returns layer 1 for delay < 30min', () => {
    expect(chooseLayer(10)).toBe(1);
    expect(chooseLayer(29)).toBe(1);
  });

  it('returns layer 2 for delay 30-120min', () => {
    expect(chooseLayer(30)).toBe(2);
    expect(chooseLayer(60)).toBe(2);
    expect(chooseLayer(119)).toBe(2);
  });

  it('returns layer 3 for delay >= 120min', () => {
    expect(chooseLayer(120)).toBe(3);
    expect(chooseLayer(300)).toBe(3);
  });

  it('returns layer 4 for catastrophe', () => {
    expect(chooseLayer(5, true)).toBe(4);
    expect(chooseLayer(200, true)).toBe(4);
  });
});

describe('replanRightShift (Layer 1)', () => {
  it('shifts subsequent blocks forward by delay', () => {
    const blocks: Block[] = [
      makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 0, startMin: 420, endMin: 510 }),
      makeBlock({ opId: 'B', machineId: 'M1', dayIdx: 0, startMin: 510, endMin: 600 }),
      makeBlock({ opId: 'C', machineId: 'M1', dayIdx: 0, startMin: 600, endMin: 690 }),
    ];

    const result = replanRightShift(blocks, {
      perturbedOpId: 'A',
      delayMin: 20,
      machineId: 'M1',
    });

    expect(result.affectedOps).toContain('A');
    expect(result.affectedOps).toContain('B');
    expect(result.affectedOps).toContain('C');
    expect(result.totalPropagatedDelay).toBe(20);
    // All blocks shifted by 20min
    expect(result.blocks.find((b) => b.opId === 'A')!.startMin).toBe(440);
    expect(result.blocks.find((b) => b.opId === 'B')!.startMin).toBe(530);
    expect(result.blocks.find((b) => b.opId === 'C')!.startMin).toBe(620);
  });

  it('does not affect other machines', () => {
    const blocks: Block[] = [
      makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 0, startMin: 420, endMin: 510 }),
      makeBlock({ opId: 'X', machineId: 'M2', dayIdx: 0, startMin: 420, endMin: 510 }),
    ];

    const result = replanRightShift(blocks, {
      perturbedOpId: 'A',
      delayMin: 20,
      machineId: 'M1',
    });

    expect(result.blocks.find((b) => b.opId === 'X')!.startMin).toBe(420); // unchanged
  });

  it('returns unchanged if perturbedOpId not found', () => {
    const blocks: Block[] = [
      makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 0, startMin: 420, endMin: 510 }),
    ];

    const result = replanRightShift(blocks, {
      perturbedOpId: 'MISSING',
      delayMin: 20,
      machineId: 'M1',
    });

    expect(result.affectedOps).toHaveLength(0);
    expect(result.totalPropagatedDelay).toBe(0);
  });

  it('detects overflow when block exceeds S1', () => {
    const blocks: Block[] = [
      makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 0, startMin: 1400, endMin: 1430 }),
    ];

    const result = replanRightShift(blocks, {
      perturbedOpId: 'A',
      delayMin: 20,
      machineId: 'M1',
    });

    expect(result.hasOverflow).toBe(true);
    expect(result.blocks.find((b) => b.opId === 'A')!.endMin).toBe(1450);
  });

  it('detects emergency night shift when block exceeds S2', () => {
    const blocks: Block[] = [
      makeBlock({
        opId: 'A',
        machineId: 'M1',
        dayIdx: 0,
        startMin: 1800,
        endMin: 1850,
        shift: 'Y',
      }),
    ];

    const result = replanRightShift(blocks, {
      perturbedOpId: 'A',
      delayMin: 20,
      machineId: 'M1',
    });

    expect(result.emergencyNightShift).toBe(true);
  });

  it('does nothing for zero delay', () => {
    const blocks: Block[] = [
      makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 0, startMin: 420, endMin: 510 }),
    ];

    const result = replanRightShift(blocks, {
      perturbedOpId: 'A',
      delayMin: 0,
      machineId: 'M1',
    });

    expect(result.affectedOps).toHaveLength(0);
    expect(result.totalPropagatedDelay).toBe(0);
  });
});

describe('assignFreezeZones', () => {
  it('assigns frozen for dayIdx < limit', () => {
    const blocks: Block[] = [makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 2 })];
    const result = assignFreezeZones(blocks, 5);
    expect(result[0].freezeStatus).toBe('frozen');
  });

  it('assigns slushy for dayIdx in slushy range', () => {
    const blocks: Block[] = [makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 8 })];
    const result = assignFreezeZones(blocks, 5);
    expect(result[0].freezeStatus).toBe('slushy');
  });

  it('assigns liquid for dayIdx beyond slushy limit', () => {
    const blocks: Block[] = [makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 20 })];
    const result = assignFreezeZones(blocks, 5);
    expect(result[0].freezeStatus).toBe('liquid');
  });

  it('handles boundary: dayIdx exactly at frozen limit → slushy', () => {
    const blocks: Block[] = [makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 5 })];
    const result = assignFreezeZones(blocks, 5);
    expect(result[0].freezeStatus).toBe('slushy');
  });

  it('handles boundary: dayIdx exactly at slushy limit → liquid', () => {
    const blocks: Block[] = [makeBlock({ opId: 'A', machineId: 'M1', dayIdx: 15 })];
    const result = assignFreezeZones(blocks, 5); // slushyLimit = 15
    expect(result[0].freezeStatus).toBe('liquid');
  });
});

describe('replanMatchUp (Layer 2)', () => {
  it('returns blocks and rescheduledOps from ATCS reschedule', () => {
    const fix = createFixture();
    const initialResult = scheduleAll(fix.scheduleInput);
    const blocks = initialResult.blocks;

    const result = replanMatchUp(blocks, {
      perturbedOpId: 'OP1',
      delayMin: 60,
      machineId: 'M1',
      originalBlocks: blocks,
      scheduleInput: fix.scheduleInput,
    });

    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.matchUpDay).toBeGreaterThanOrEqual(0);
    expect(typeof result.emergencyNightShift).toBe('boolean');
  });

  it('returns empty rescheduledOps when no blocks match', () => {
    const fix = createFixture();
    const blocks: Block[] = []; // empty schedule

    const result = replanMatchUp(blocks, {
      perturbedOpId: 'MISSING',
      delayMin: 60,
      machineId: 'M1',
      originalBlocks: blocks,
      scheduleInput: fix.scheduleInput,
    });

    expect(result.rescheduledOps).toHaveLength(0);
  });
});

describe('replanPartial (Layer 3)', () => {
  it('identifies transitively affected ops via machine dependency', () => {
    const fix = createFixture();
    const initialResult = scheduleAll(fix.scheduleInput);

    const result = replanPartial(initialResult.blocks, {
      eventType: 'breakdown',
      machineId: 'M1',
      affectedOpIds: ['OP1'],
      scheduleInput: fix.scheduleInput,
      TM: fix.tools,
    });

    // OP1 and OP2 are both on M1, so both should be rescheduled
    expect(result.rescheduledOps).toContain('OP1');
    expect(result.rescheduledOps).toContain('OP2');
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('freezes non-affected ops', () => {
    const fix = createFixture();
    const initialResult = scheduleAll(fix.scheduleInput);

    const result = replanPartial(initialResult.blocks, {
      eventType: 'breakdown',
      machineId: 'M1',
      affectedOpIds: ['OP1'],
      scheduleInput: fix.scheduleInput,
      TM: fix.tools,
    });

    const frozenBlocks = result.blocks.filter((b) => b.freezeStatus === 'frozen');
    const liquidBlocks = result.blocks.filter((b) => b.freezeStatus === 'liquid');
    expect(frozenBlocks.length + liquidBlocks.length).toBe(result.blocks.length);
  });
});

describe('dispatchReplan (Dispatcher)', () => {
  it('dispatches to layer 1 for small delay', () => {
    const fix = createFixture();
    const initialResult = scheduleAll(fix.scheduleInput);

    const result = dispatchReplan({
      blocks: initialResult.blocks,
      previousBlocks: initialResult.blocks,
      perturbedOpId: 'OP1',
      delayMin: 15,
      machineId: 'M1',
      scheduleInput: fix.scheduleInput,
      TM: fix.tools,
    });

    expect(result.layer).toBe(1);
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('dispatches to layer 2 for moderate delay', () => {
    const fix = createFixture();
    const initialResult = scheduleAll(fix.scheduleInput);

    const result = dispatchReplan({
      blocks: initialResult.blocks,
      previousBlocks: initialResult.blocks,
      perturbedOpId: 'OP1',
      delayMin: 60,
      machineId: 'M1',
      scheduleInput: fix.scheduleInput,
      TM: fix.tools,
    });

    expect(result.layer).toBe(2);
  });

  it('dispatches to layer 3 for large delay', () => {
    const fix = createFixture();
    const initialResult = scheduleAll(fix.scheduleInput);

    const result = dispatchReplan({
      blocks: initialResult.blocks,
      previousBlocks: initialResult.blocks,
      perturbedOpId: 'OP1',
      delayMin: 180,
      machineId: 'M1',
      scheduleInput: fix.scheduleInput,
      TM: fix.tools,
    });

    expect(result.layer).toBe(3);
  });

  it('dispatches to layer 4 for catastrophe', () => {
    const fix = createFixture();
    const initialResult = scheduleAll(fix.scheduleInput);

    const result = dispatchReplan({
      blocks: initialResult.blocks,
      previousBlocks: initialResult.blocks,
      perturbedOpId: 'OP1',
      delayMin: 30,
      machineId: 'M1',
      scheduleInput: fix.scheduleInput,
      TM: fix.tools,
      isCatastrophe: true,
    });

    expect(result.layer).toBe(4);
  });

  it('respects forceLayer override', () => {
    const fix = createFixture();
    const initialResult = scheduleAll(fix.scheduleInput);

    const result = dispatchReplan({
      blocks: initialResult.blocks,
      previousBlocks: initialResult.blocks,
      perturbedOpId: 'OP1',
      delayMin: 5, // would be layer 1
      machineId: 'M1',
      scheduleInput: fix.scheduleInput,
      TM: fix.tools,
      forceLayer: 3,
    });

    expect(result.layer).toBe(3);
  });

  it('always returns emergencyNightShift boolean', () => {
    const fix = createFixture();
    const initialResult = scheduleAll(fix.scheduleInput);

    for (const delay of [10, 60, 180]) {
      const result = dispatchReplan({
        blocks: initialResult.blocks,
        previousBlocks: initialResult.blocks,
        perturbedOpId: 'OP1',
        delayMin: delay,
        machineId: 'M1',
        scheduleInput: fix.scheduleInput,
        TM: fix.tools,
      });
      expect(typeof result.emergencyNightShift).toBe('boolean');
    }
  });
});

describe('Threshold constants', () => {
  it('LAYER_THRESHOLD_1 = 30', () => {
    expect(LAYER_THRESHOLD_1).toBe(30);
  });

  it('LAYER_THRESHOLD_2 = 120', () => {
    expect(LAYER_THRESHOLD_2).toBe(120);
  });
});
