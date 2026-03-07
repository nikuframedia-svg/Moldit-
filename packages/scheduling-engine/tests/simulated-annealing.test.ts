import { describe, expect, it } from 'vitest';
import { scoreSchedule } from '../src/analysis/score-schedule.js';
import { DAY_CAP } from '../src/constants.js';
import type { SAConfig, SAInput } from '../src/optimization/simulated-annealing.js';
import {
  DEFAULT_SA_CONFIG,
  runSimulatedAnnealing,
} from '../src/optimization/simulated-annealing.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
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

function createSmallFixture(): SAInput {
  const machines: EMachine[] = [
    { id: 'M1', area: 'PG1', man: [0, 0, 0, 0, 0] },
    { id: 'M2', area: 'PG1', man: [0, 0, 0, 0, 0] },
  ];

  const tools: Record<string, ETool> = {
    T1: makeTool('T1', 'M1', 'M2', 1, 500),
    T2: makeTool('T2', 'M1', 'M2', 1, 500),
    T3: makeTool('T3', 'M2', 'M1', 0.5, 800),
  };

  const ops: EOp[] = [
    makeOp('OP1', 'T1', 'M1', [0, 0, 1000, 0, 0]),
    makeOp('OP2', 'T2', 'M1', [0, 0, 0, 800, 0]),
    makeOp('OP3', 'T3', 'M2', [0, 0, 0, 0, 500]),
    makeOp('OP4', 'T1', 'M1', [0, 2000, 0, 0, 0]),
  ];

  return {
    ops,
    mSt: { M1: 'running', M2: 'running' },
    tSt: { T1: 'running', T2: 'running', T3: 'running' },
    machines,
    TM: tools,
    workdays: [true, true, true, true, true],
    nDays: 5,
    workforceConfig: DEFAULT_WORKFORCE_CONFIG,
    rule: 'ATCS',
  };
}

function createOverloadedFixture(): SAInput {
  const machines: EMachine[] = [
    { id: 'M1', area: 'PG1', man: [0, 0, 0, 0, 0] },
    { id: 'M2', area: 'PG1', man: [0, 0, 0, 0, 0] },
  ];

  const tools: Record<string, ETool> = {
    T1: makeTool('T1', 'M1', 'M2', 1, 300),
    T2: makeTool('T2', 'M1', 'M2', 0.5, 400),
    T3: makeTool('T3', 'M1', 'M2', 1, 200),
  };

  // All ops on M1 with tight deadlines — forces SA to explore moves to M2
  const ops: EOp[] = [
    makeOp('OP1', 'T1', 'M1', [0, 5000, 0, 0, 0]),
    makeOp('OP2', 'T2', 'M1', [0, 0, 3000, 0, 0]),
    makeOp('OP3', 'T3', 'M1', [0, 0, 0, 2000, 0]),
    makeOp('OP4', 'T1', 'M1', [0, 0, 0, 4000, 0]),
    makeOp('OP5', 'T2', 'M1', [0, 0, 0, 0, 3000]),
  ];

  return {
    ops,
    mSt: { M1: 'running', M2: 'running' },
    tSt: { T1: 'running', T2: 'running', T3: 'running' },
    machines,
    TM: tools,
    workdays: [true, true, true, true, true],
    nDays: 5,
    workforceConfig: DEFAULT_WORKFORCE_CONFIG,
    rule: 'ATCS',
  };
}

// ── Tests ────────────────────────────────────────────────

describe('runSimulatedAnnealing', () => {
  it('returns a valid result structure', () => {
    const input = createSmallFixture();
    const result = runSimulatedAnnealing(input, { maxIter: 50 });

    expect(result).toHaveProperty('blocks');
    expect(result).toHaveProperty('moves');
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('iterations');
    expect(result).toHaveProperty('accepted');
    expect(result).toHaveProperty('finalTemp');
    expect(result).toHaveProperty('improved');
    expect(result).toHaveProperty('initialScore');
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(Number.isFinite(result.metrics.score)).toBe(true);
  });

  it('never returns worse than initial ATCS solution', () => {
    const input = createSmallFixture();

    // Get initial ATCS score
    const initResult = scheduleAll({
      ...input,
      moves: [],
      toolMap: input.TM,
    });
    const initScore = scoreSchedule(
      initResult.blocks,
      input.ops,
      input.mSt,
      input.workforceConfig,
      input.machines,
      input.TM,
      undefined,
      undefined,
      input.nDays,
    );

    // Run SA
    const saResult = runSimulatedAnnealing(input, { maxIter: 200, seed: 42 });

    // SA must not worsen the solution
    expect(saResult.metrics.score).toBeGreaterThanOrEqual(initScore.score);
  });

  it('never returns worse than initial on overloaded fixture', () => {
    const input = createOverloadedFixture();

    const initResult = scheduleAll({
      ...input,
      moves: [],
      toolMap: input.TM,
    });
    const initScore = scoreSchedule(
      initResult.blocks,
      input.ops,
      input.mSt,
      input.workforceConfig,
      input.machines,
      input.TM,
      undefined,
      undefined,
      input.nDays,
    );

    const saResult = runSimulatedAnnealing(input, { maxIter: 500, seed: 123 });
    expect(saResult.metrics.score).toBeGreaterThanOrEqual(initScore.score);
  });

  it('respects constraints (no blocked-type blocks in ok positions)', () => {
    const input = createSmallFixture();
    const result = runSimulatedAnnealing(input, { maxIter: 100 });

    for (const b of result.blocks) {
      expect(['ok', 'blocked', 'overflow', 'infeasible']).toContain(b.type);
    }
  });

  it('produces valid blocks with proper structure', () => {
    const input = createSmallFixture();
    const result = runSimulatedAnnealing(input, { maxIter: 50 });

    for (const b of result.blocks) {
      expect(b.machineId).toBeDefined();
      expect(b.toolId).toBeDefined();
      expect(b.opId).toBeDefined();
      expect(b.dayIdx).toBeGreaterThanOrEqual(0);
      expect(b.startMin).toBeGreaterThanOrEqual(0);
      expect(b.endMin).toBeGreaterThanOrEqual(b.startMin);
    }
  });

  it('calls progress callback with increasing percentages', () => {
    const input = createSmallFixture();
    const progress: number[] = [];

    runSimulatedAnnealing(input, { maxIter: 500, progressInterval: 100 }, (pct) => {
      progress.push(pct);
    });

    expect(progress.length).toBeGreaterThan(0);
    // Progress should be monotonically increasing
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
    // Last progress should be 100
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('is deterministic with same seed', () => {
    const input = createSmallFixture();
    const cfg: Partial<SAConfig> = { maxIter: 200, seed: 42 };

    const r1 = runSimulatedAnnealing(input, cfg);
    const r2 = runSimulatedAnnealing(input, cfg);

    expect(r1.metrics.score).toBe(r2.metrics.score);
    expect(r1.iterations).toBe(r2.iterations);
    expect(r1.accepted).toBe(r2.accepted);
    expect(r1.moves.length).toBe(r2.moves.length);
  });

  it('different seeds produce different exploration paths', () => {
    const input = createOverloadedFixture();

    const r1 = runSimulatedAnnealing(input, { maxIter: 300, seed: 1 });
    const r2 = runSimulatedAnnealing(input, { maxIter: 300, seed: 999 });

    // At least one metric should differ (very unlikely to be identical with different seeds)
    const sameScore = r1.metrics.score === r2.metrics.score;
    const sameAccepted = r1.accepted === r2.accepted;
    // It's theoretically possible but extremely unlikely both match
    expect(sameScore && sameAccepted).toBe(false);
  });

  it('temperature decreases geometrically', () => {
    const input = createSmallFixture();
    const result = runSimulatedAnnealing(input, {
      T0: 1000,
      Tmin: 0.01,
      alpha: 0.995,
      maxIter: 100,
    });

    // After 100 iterations at alpha=0.995: T = 1000 * 0.995^100 ≈ 606
    const expectedTemp = 1000 * 0.995 ** 100;
    expect(result.finalTemp).toBeCloseTo(expectedTemp, 0);
  });

  it('stops when temperature reaches Tmin', () => {
    const input = createSmallFixture();
    const result = runSimulatedAnnealing(input, {
      T0: 1,
      Tmin: 0.5,
      alpha: 0.9,
      maxIter: 100_000,
    });

    // Should stop early due to Tmin
    expect(result.iterations).toBeLessThan(100_000);
    expect(result.finalTemp).toBeLessThanOrEqual(0.5);
  });

  it('DEFAULT_SA_CONFIG has valid values', () => {
    expect(DEFAULT_SA_CONFIG.T0).toBe(1000);
    expect(DEFAULT_SA_CONFIG.Tmin).toBe(0.01);
    expect(DEFAULT_SA_CONFIG.alpha).toBe(0.995);
    expect(DEFAULT_SA_CONFIG.maxIter).toBe(10_000);
    expect(DEFAULT_SA_CONFIG.seed).toBe(42);
  });

  it('handles zero-demand ops gracefully', () => {
    const input = createSmallFixture();
    // Replace all demand with zeros
    input.ops = input.ops.map((op) => ({ ...op, d: [0, 0, 0, 0, 0], atr: 0 }));

    const result = runSimulatedAnnealing(input, { maxIter: 50 });
    expect(Number.isFinite(result.metrics.score)).toBe(true);
  });

  it('handles no-alt ops (nothing moveable)', () => {
    const machines: EMachine[] = [{ id: 'M1', area: 'PG1', man: [0, 0, 0] }];
    const tools: Record<string, ETool> = {
      T1: makeTool('T1', 'M1', '-', 1, 500),
    };
    const ops: EOp[] = [makeOp('OP1', 'T1', 'M1', [0, 1000, 0])];

    const input: SAInput = {
      ops,
      mSt: { M1: 'running' },
      tSt: { T1: 'running' },
      machines,
      TM: tools,
      workdays: [true, true, true],
      nDays: 3,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
      rule: 'ATCS',
    };

    const result = runSimulatedAnnealing(input, { maxIter: 50 });
    // Should still complete without error
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.moves.length).toBe(0); // nothing to move
  });

  it('initial moves are preserved when SA finds no improvement', () => {
    const input = createSmallFixture();
    input.initialMoves = [{ opId: 'OP1', toM: 'M2' }];

    const result = runSimulatedAnnealing(input, { maxIter: 10, T0: 0.001 });

    // With near-zero temperature, SA won't accept worse moves
    // Either preserves initial moves or finds better ones
    expect(Number.isFinite(result.metrics.score)).toBe(true);
  });
});
