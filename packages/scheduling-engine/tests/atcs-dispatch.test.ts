import { describe, expect, it } from 'vitest';
import { DAY_CAP } from '../src/constants.js';
import type { ATCSParams } from '../src/scheduler/atcs-dispatch.js';
import {
  atcsPriority,
  computeATCSAverages,
  DEFAULT_ATCS_PARAMS,
} from '../src/scheduler/atcs-dispatch.js';
import type { ToolGroup } from '../src/scheduler/demand-grouper.js';
import { createGroupComparator } from '../src/scheduler/dispatch-rules.js';

// ── Helpers ─────────────────────────────────────────────────────

function makeGroup(overrides: Partial<ToolGroup> & { toolId: string; edd: number }): ToolGroup {
  return {
    toolId: overrides.toolId,
    machineId: overrides.machineId ?? 'M1',
    edd: overrides.edd,
    setupMin: overrides.setupMin ?? 60,
    totalProdMin: overrides.totalProdMin ?? 500,
    skus: overrides.skus ?? [],
    tool:
      overrides.tool ??
      ({
        id: overrides.toolId,
        m: 'M1',
        alt: '-',
        sH: 1,
        pH: 100,
        op: 1,
        lt: 0,
        stk: 0,
        nm: 'test',
      } as any),
  };
}

// ── atcsPriority ────────────────────────────────────────────────

describe('atcsPriority', () => {
  const params: ATCSParams = { k1: 1.5, k2: 0.5 };
  const avgProd = 500;
  const avgSetup = 60;

  it('returns positive for valid group', () => {
    const g = makeGroup({ toolId: 'T1', edd: 3, totalProdMin: 500, setupMin: 60 });
    const p = atcsPriority(g, null, params, avgProd, avgSetup);
    expect(p).toBeGreaterThan(0);
  });

  it('zero slack (overdue) → term2 = 1 (max urgency)', () => {
    // edd=0 → slack = max(0*DAY_CAP - prodMin, 0) = 0
    const g = makeGroup({ toolId: 'T1', edd: 0, totalProdMin: 500, setupMin: 60 });
    const p = atcsPriority(g, null, params, avgProd, avgSetup);
    // With slack=0, term2=exp(0)=1
    // term1 = 1/500, term3 = exp(-60/(0.5*60)) = exp(-2)
    const expected = (1 / 500) * 1 * Math.exp(-60 / (0.5 * 60));
    expect(p).toBeCloseTo(expected, 10);
  });

  it('large slack → term2 ≈ 0 (low urgency)', () => {
    // edd=100 → slack = 100*1020 - 500 = 101500 (very large)
    const g = makeGroup({ toolId: 'T1', edd: 100, totalProdMin: 500, setupMin: 60 });
    const p = atcsPriority(g, null, params, avgProd, avgSetup);
    // term2 = exp(-101500 / (1.5*500)) ≈ 0
    expect(p).toBeLessThan(1e-10);
  });

  it('zero setup → term3 = 1 (no setup penalty)', () => {
    const g = makeGroup({ toolId: 'T1', edd: 2, totalProdMin: 500, setupMin: 0 });
    const p = atcsPriority(g, null, params, avgProd, avgSetup);
    // setupMin=0 → term3 = exp(0) = 1
    const slack = Math.max(2 * DAY_CAP - 500, 0);
    const expected = (1 / 500) * Math.exp(-slack / (1.5 * 500)) * 1;
    expect(p).toBeCloseTo(expected, 10);
  });

  it('same tool as previous → setupMin = 0, term3 = 1', () => {
    const g = makeGroup({ toolId: 'T1', edd: 2, totalProdMin: 500, setupMin: 60 });
    const withPrev = atcsPriority(g, 'T1', params, avgProd, avgSetup);
    const withoutPrev = atcsPriority(g, null, params, avgProd, avgSetup);
    // Same tool → no setup penalty → higher priority
    expect(withPrev).toBeGreaterThan(withoutPrev);
  });

  it('different tool as previous → uses full setupMin', () => {
    const g = makeGroup({ toolId: 'T1', edd: 2, totalProdMin: 500, setupMin: 60 });
    const diffTool = atcsPriority(g, 'T2', params, avgProd, avgSetup);
    const noTool = atcsPriority(g, null, params, avgProd, avgSetup);
    // Different tool and null previous both use group.setupMin
    expect(diffTool).toBeCloseTo(noTool, 10);
  });

  it('large setup → term3 ≈ 0 (penalized)', () => {
    // setupMin=600 (10 hours), avgSetup=60 → exp(-600/(0.5*60)) = exp(-20)
    const g = makeGroup({ toolId: 'T1', edd: 1, totalProdMin: 500, setupMin: 600 });
    const p = atcsPriority(g, null, params, avgProd, avgSetup);
    expect(p).toBeLessThan(1e-6);
  });

  it('k1 sensitivity: higher k1 → more tolerant of slack', () => {
    const g = makeGroup({ toolId: 'T1', edd: 5, totalProdMin: 500, setupMin: 60 });
    const lowK1 = atcsPriority(g, null, { k1: 0.5, k2: 0.5 }, avgProd, avgSetup);
    const highK1 = atcsPriority(g, null, { k1: 3.0, k2: 0.5 }, avgProd, avgSetup);
    // Higher k1 → exp decay is slower → higher priority for same slack
    expect(highK1).toBeGreaterThan(lowK1);
  });

  it('k2 sensitivity: higher k2 → more tolerant of setup', () => {
    const g = makeGroup({ toolId: 'T1', edd: 2, totalProdMin: 500, setupMin: 120 });
    const lowK2 = atcsPriority(g, null, { k1: 1.5, k2: 0.1 }, avgProd, avgSetup);
    const highK2 = atcsPriority(g, null, { k1: 1.5, k2: 1.0 }, avgProd, avgSetup);
    // Higher k2 → setup penalty decays slower → higher priority
    expect(highK2).toBeGreaterThan(lowK2);
  });

  it('guards against zero totalProdMin', () => {
    const g = makeGroup({ toolId: 'T1', edd: 2, totalProdMin: 0, setupMin: 60 });
    const p = atcsPriority(g, null, params, avgProd, avgSetup);
    // Should not throw, uses max(0, 1) = 1
    expect(p).toBeGreaterThan(0);
    expect(Number.isFinite(p)).toBe(true);
  });
});

// ── computeATCSAverages ─────────────────────────────────────────

describe('computeATCSAverages', () => {
  it('returns 1 for empty groups', () => {
    const avg = computeATCSAverages([]);
    expect(avg.avgProdMin).toBe(1);
    expect(avg.avgSetupMin).toBe(1);
  });

  it('computes correct averages', () => {
    const groups = [
      makeGroup({ toolId: 'T1', edd: 1, totalProdMin: 300, setupMin: 60 }),
      makeGroup({ toolId: 'T2', edd: 2, totalProdMin: 500, setupMin: 120 }),
      makeGroup({ toolId: 'T3', edd: 3, totalProdMin: 700, setupMin: 30 }),
    ];
    const avg = computeATCSAverages(groups);
    expect(avg.avgProdMin).toBe(500);
    expect(avg.avgSetupMin).toBe(70);
  });

  it('guards against zero average setup', () => {
    const groups = [
      makeGroup({ toolId: 'T1', edd: 1, totalProdMin: 300, setupMin: 0 }),
      makeGroup({ toolId: 'T2', edd: 2, totalProdMin: 500, setupMin: 0 }),
    ];
    const avg = computeATCSAverages(groups);
    expect(avg.avgSetupMin).toBe(1); // min guard
  });
});

// ── createGroupComparator with ATCS ─────────────────────────────

describe('createGroupComparator ATCS', () => {
  it('sorts urgent group before comfortable group', () => {
    const urgent = makeGroup({ toolId: 'T1', edd: 0, totalProdMin: 500, setupMin: 60 });
    const comfortable = makeGroup({ toolId: 'T2', edd: 10, totalProdMin: 500, setupMin: 60 });

    const ctx = {
      avgProdMin: 500,
      avgSetupMin: 60,
      params: DEFAULT_ATCS_PARAMS,
    };
    const cmp = createGroupComparator('ATCS', undefined, ctx);
    // Negative means urgent before comfortable
    expect(cmp(urgent, comfortable)).toBeLessThan(0);
  });

  it('low setup group gets priority over high setup group (same deadline)', () => {
    const lowSetup = makeGroup({ toolId: 'T1', edd: 3, totalProdMin: 500, setupMin: 10 });
    const highSetup = makeGroup({ toolId: 'T2', edd: 3, totalProdMin: 500, setupMin: 300 });

    const ctx = {
      avgProdMin: 500,
      avgSetupMin: 60,
      params: { k1: 1.5, k2: 0.3 }, // sensitive to setup
    };
    const cmp = createGroupComparator('ATCS', undefined, ctx);
    // lowSetup should come first (negative)
    expect(cmp(lowSetup, highSetup)).toBeLessThan(0);
  });

  it('supply boost overrides ATCS priority', () => {
    const boosted = makeGroup({ toolId: 'T1', edd: 10, totalProdMin: 500, setupMin: 60 });
    const urgent = makeGroup({ toolId: 'T2', edd: 0, totalProdMin: 500, setupMin: 60 });

    // Give boosted group a supply boost
    boosted.skus = [{ opId: 'OP_BOOSTED' } as any];
    urgent.skus = [{ opId: 'OP_URGENT' } as any];

    const boosts = new Map([['OP_BOOSTED', { boost: 3 }]]);
    const ctx = { avgProdMin: 500, avgSetupMin: 60, params: DEFAULT_ATCS_PARAMS };
    const cmp = createGroupComparator('ATCS', boosts, ctx);

    // Despite urgent having edd=0, boosted has supply boost=3 → wins
    expect(cmp(boosted, urgent)).toBeLessThan(0);
  });
});
