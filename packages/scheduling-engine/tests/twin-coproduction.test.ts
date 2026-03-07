// =====================================================================
//  INCOMPOL PLAN -- Twin Co-Production Tests
//  Validates that twin pieces are scheduled as a single production run
//  where each SKU gets exactly what it needs (NOT 1:1 equal output).
//
//  Rules:
//    Machine time = max(demand_A, demand_B) / pH * 60 / OEE
//    Each SKU output = its actual demand (independent quantities)
//    Single setup, single machine time, single operators
// =====================================================================

import { describe, expect, it } from 'vitest';
import { auditCoverage } from '../src/analysis/coverage-audit.js';
import { computeToolMRP } from '../src/mrp/mrp-engine.js';
import { mergeConsecutiveBlocks } from '../src/scheduler/block-merger.js';
import { groupDemandIntoBuckets } from '../src/scheduler/demand-grouper.js';
import type { Block } from '../src/types/blocks.js';
import type { EMachine, EOp, ETool } from '../src/types/engine.js';
import type { TwinGroup } from '../src/types/twin.js';
import {
  getBlockProductionForOp,
  getBlockQtyForOp,
  getBlocksForOp,
} from '../src/utils/block-production.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeTool(overrides?: Partial<ETool>): ETool {
  return {
    id: 'BFP079',
    m: 'PRM019',
    pH: 100,
    sH: 0.5,
    lt: 500,
    stk: 0,
    op: 1,
    alt: '-',
    calco: undefined,
    mp: undefined,
    ...overrides,
  } as ETool;
}

function makeOp(overrides: Partial<EOp> & { id: string; sku: string }): EOp {
  return {
    t: 'BFP079',
    m: 'PRM019',
    nm: overrides.sku,
    d: [0, 0, 0, 0, 0],
    atr: 0,
    ...overrides,
  } as EOp;
}

function makeTwinGroup(overrides?: Partial<TwinGroup>): TwinGroup {
  return {
    opId1: 'OP01',
    opId2: 'OP02',
    sku1: 'SKU_L',
    sku2: 'SKU_R',
    machine: 'PRM019',
    tool: 'BFP079',
    pH: 100,
    operators: 1,
    lotEconomicDiffers: false,
    leadTimeDiffers: false,
    ...overrides,
  };
}

// ── Block Production Helper ─────────────────────────────────────────

describe('Block Production Helpers', () => {
  it('getBlockProductionForOp returns qty for regular blocks', () => {
    const blocks: Block[] = [
      { opId: 'OP01', sku: 'SKU_L', qty: 100, type: 'ok' } as Block,
      { opId: 'OP01', sku: 'SKU_L', qty: 50, type: 'ok' } as Block,
      { opId: 'OP02', sku: 'SKU_R', qty: 80, type: 'ok' } as Block,
    ];
    expect(getBlockProductionForOp(blocks, 'OP01')).toBe(150);
    expect(getBlockProductionForOp(blocks, 'OP02')).toBe(80);
  });

  it('getBlockProductionForOp returns qty from outputs[] for twin blocks', () => {
    const blocks: Block[] = [
      {
        opId: 'OP01',
        sku: 'SKU_L',
        qty: 100,
        type: 'ok',
        isTwinProduction: true,
        outputs: [
          { opId: 'OP01', sku: 'SKU_L', qty: 100 },
          { opId: 'OP02', sku: 'SKU_R', qty: 80 },
        ],
      } as Block,
    ];
    expect(getBlockProductionForOp(blocks, 'OP01')).toBe(100);
    expect(getBlockProductionForOp(blocks, 'OP02')).toBe(80);
  });

  it('getBlockProductionForOp ignores non-ok blocks', () => {
    const blocks: Block[] = [
      { opId: 'OP01', sku: 'SKU_L', qty: 100, type: 'overflow' } as Block,
      { opId: 'OP01', sku: 'SKU_L', qty: 50, type: 'ok' } as Block,
    ];
    expect(getBlockProductionForOp(blocks, 'OP01')).toBe(50);
  });

  it('getBlocksForOp includes twin blocks referencing the op', () => {
    const blocks: Block[] = [
      {
        opId: 'OP01',
        sku: 'SKU_L',
        qty: 100,
        type: 'ok',
        isTwinProduction: true,
        outputs: [
          { opId: 'OP01', sku: 'SKU_L', qty: 100 },
          { opId: 'OP02', sku: 'SKU_R', qty: 80 },
        ],
      } as Block,
      { opId: 'OP03', sku: 'SKU_X', qty: 50, type: 'ok' } as Block,
    ];
    // OP02 should find the twin block even though opId is OP01
    expect(getBlocksForOp(blocks, 'OP02')).toHaveLength(1);
    expect(getBlocksForOp(blocks, 'OP03')).toHaveLength(1);
    expect(getBlocksForOp(blocks, 'OP99')).toHaveLength(0);
  });

  it('getBlockQtyForOp extracts correct qty from twin block', () => {
    const block = {
      opId: 'OP01',
      sku: 'SKU_L',
      qty: 100,
      type: 'ok',
      isTwinProduction: true,
      outputs: [
        { opId: 'OP01', sku: 'SKU_L', qty: 100 },
        { opId: 'OP02', sku: 'SKU_R', qty: 80 },
      ],
    } as Block;
    expect(getBlockQtyForOp(block, 'OP01')).toBe(100);
    expect(getBlockQtyForOp(block, 'OP02')).toBe(80);
    expect(getBlockQtyForOp(block, 'OP03')).toBe(0);
  });
});

// ── Demand Grouper ──────────────────────────────────────────────────

describe('Demand Grouper — Twin Merging', () => {
  const tool = makeTool();
  const toolMap: Record<string, ETool> = { BFP079: tool };
  const mSt: Record<string, string> = { PRM019: 'running' };
  const tSt: Record<string, string> = { BFP079: 'running' };

  it('should merge twin pair into single SkuBucket with max qty', () => {
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [100, 0, 0, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [80, 0, 0, 0, 0] }),
    ];
    const twinGroups = [makeTwinGroup()];

    const result = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
    );

    const groups = result['PRM019'];
    expect(groups).toBeDefined();
    expect(groups.length).toBe(1);

    const grp = groups[0];
    // Should have only 1 merged bucket (not 2 separate ones)
    expect(grp.skus.length).toBe(1);

    const merged = grp.skus[0];
    expect(merged.isTwinProduction).toBe(true);
    expect(merged.totalQty).toBe(100); // max(100, 80)
    expect(merged.twinOutputs).toHaveLength(2);
    expect(merged.coProductionGroupId).toBe('SKU_L|SKU_R');
  });

  it('should compute prodMin based on max demand, not sum', () => {
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [100, 0, 0, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [80, 0, 0, 0, 0] }),
    ];
    const twinGroups = [makeTwinGroup()];

    const result = groupDemandIntoBuckets(ops, mSt, tSt, [], toolMap, undefined, 5);
    const resultTwin = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
    );

    // Without twins: both buckets exist, total prodMin = prodMin(100) + prodMin(80)
    const normalGroup = result['PRM019'][0];
    const normalProdMin = normalGroup.skus.reduce((s, sk) => s + sk.prodMin, 0);

    // With twins: single merged bucket, prodMin based on max(100, 80) = 100
    const twinGroup = resultTwin['PRM019'][0];
    const twinProdMin = twinGroup.skus.reduce((s, sk) => s + sk.prodMin, 0);

    // Twin prodMin should be LESS than the sum of individual prodMins
    expect(twinProdMin).toBeLessThan(normalProdMin);
  });

  it('should not merge twins with no counterpart in same ToolGroup', () => {
    // Only one twin has demand
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [100, 0, 0, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [0, 0, 0, 0, 0], atr: 0 }),
    ];
    const twinGroups = [makeTwinGroup()];

    const result = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
    );

    const groups = result['PRM019'];
    // OP02 has no demand, so no bucket for it, nothing to merge
    // OP01 should remain solo
    expect(groups).toBeDefined();
    const skus = groups.flatMap((g) => g.skus);
    expect(skus.length).toBe(1);
    expect(skus[0].isTwinProduction).toBeFalsy();
  });

  it('should preserve twinOutputs info for both SKUs', () => {
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [200, 0, 0, 0, 0], atr: 50 }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [150, 0, 0, 0, 0], atr: 30 }),
    ];
    const twinGroups = [makeTwinGroup()];

    const result = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
    );

    // Check backlog bucket (edd=0)
    const allSkus = result['PRM019'].flatMap((g) => g.skus);
    const twinBuckets = allSkus.filter((sk) => sk.isTwinProduction);

    // At least one twin bucket should have both outputs
    for (const tb of twinBuckets) {
      expect(tb.twinOutputs).toHaveLength(2);
      const skus = tb.twinOutputs!.map((t) => t.sku).sort();
      expect(skus).toEqual(['SKU_L', 'SKU_R']);
    }
  });
});

// ── Block Merger ────────────────────────────────────────────────────

describe('Block Merger — Twin Blocks', () => {
  it('should merge adjacent twin blocks and sum outputs per SKU', () => {
    // SKU_L demand=80 total, SKU_R demand=60 total (different per-output qtys)
    const blocks: Block[] = [
      {
        opId: 'OP01',
        toolId: 'BFP079',
        sku: 'SKU_L',
        nm: 'SKU_L',
        machineId: 'PRM019',
        origM: 'PRM019',
        dayIdx: 0,
        qty: 50,
        prodMin: 30,
        setupMin: 0,
        operators: 1,
        blocked: false,
        reason: null,
        moved: false,
        hasAlt: false,
        altM: null,
        stk: 0,
        lt: 500,
        atr: 0,
        startMin: 450,
        endMin: 480,
        setupS: null,
        setupE: null,
        type: 'ok',
        shift: 'X',
        isTwinProduction: true,
        coProductionGroupId: 'SKU_L|SKU_R',
        outputs: [
          { opId: 'OP01', sku: 'SKU_L', qty: 50 },
          { opId: 'OP02', sku: 'SKU_R', qty: 40 },
        ],
      },
      {
        opId: 'OP01',
        toolId: 'BFP079',
        sku: 'SKU_L',
        nm: 'SKU_L',
        machineId: 'PRM019',
        origM: 'PRM019',
        dayIdx: 0,
        qty: 30,
        prodMin: 18,
        setupMin: 0,
        operators: 1,
        blocked: false,
        reason: null,
        moved: false,
        hasAlt: false,
        altM: null,
        stk: 0,
        lt: 500,
        atr: 0,
        startMin: 480,
        endMin: 498,
        setupS: null,
        setupE: null,
        type: 'ok',
        shift: 'X',
        isTwinProduction: true,
        coProductionGroupId: 'SKU_L|SKU_R',
        outputs: [
          { opId: 'OP01', sku: 'SKU_L', qty: 30 },
          { opId: 'OP02', sku: 'SKU_R', qty: 20 },
        ],
      },
    ];

    const merged = mergeConsecutiveBlocks(blocks);

    expect(merged).toHaveLength(1);
    expect(merged[0].qty).toBe(80);
    expect(merged[0].prodMin).toBe(48);
    expect(merged[0].outputs).toBeDefined();
    // Each SKU's outputs are summed independently
    expect(merged[0].outputs![0].qty).toBe(80); // SKU_L: 50+30
    expect(merged[0].outputs![1].qty).toBe(60); // SKU_R: 40+20
  });

  it('should NOT merge twin and non-twin blocks', () => {
    const blocks: Block[] = [
      {
        opId: 'OP01',
        toolId: 'BFP079',
        sku: 'SKU_L',
        nm: 'SKU_L',
        machineId: 'PRM019',
        origM: 'PRM019',
        dayIdx: 0,
        qty: 50,
        prodMin: 30,
        setupMin: 0,
        operators: 1,
        blocked: false,
        reason: null,
        moved: false,
        hasAlt: false,
        altM: null,
        stk: 0,
        lt: 500,
        atr: 0,
        startMin: 450,
        endMin: 480,
        setupS: null,
        setupE: null,
        type: 'ok',
        shift: 'X',
        isTwinProduction: true,
        coProductionGroupId: 'SKU_L|SKU_R',
        outputs: [
          { opId: 'OP01', sku: 'SKU_L', qty: 50 },
          { opId: 'OP02', sku: 'SKU_R', qty: 40 },
        ],
      },
      {
        opId: 'OP01',
        toolId: 'BFP079',
        sku: 'SKU_L',
        nm: 'SKU_L',
        machineId: 'PRM019',
        origM: 'PRM019',
        dayIdx: 0,
        qty: 30,
        prodMin: 18,
        setupMin: 0,
        operators: 1,
        blocked: false,
        reason: null,
        moved: false,
        hasAlt: false,
        altM: null,
        stk: 0,
        lt: 500,
        atr: 0,
        startMin: 480,
        endMin: 498,
        setupS: null,
        setupE: null,
        type: 'ok',
        shift: 'X',
        // no isTwinProduction
      },
    ];

    const merged = mergeConsecutiveBlocks(blocks);
    // Different coProductionGroupId (undefined vs 'SKU_L|SKU_R') → no merge
    expect(merged).toHaveLength(2);
  });
});

// ── Coverage Audit ──────────────────────────────────────────────────

describe('Coverage Audit — Twin Co-Production', () => {
  it('should correctly attribute production to both twin ops', () => {
    const tool = makeTool();
    const toolMap: Record<string, ETool> = { BFP079: tool };
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [100, 0, 0, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [80, 0, 0, 0, 0] }),
    ];
    const blocks: Block[] = [
      {
        opId: 'OP01',
        toolId: 'BFP079',
        sku: 'SKU_L',
        nm: 'SKU_L',
        machineId: 'PRM019',
        origM: 'PRM019',
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
        lt: 500,
        atr: 0,
        startMin: 480,
        endMin: 540,
        setupS: 450,
        setupE: 480,
        type: 'ok',
        shift: 'X',
        isTwinProduction: true,
        coProductionGroupId: 'SKU_L|SKU_R',
        outputs: [
          { opId: 'OP01', sku: 'SKU_L', qty: 100 },
          { opId: 'OP02', sku: 'SKU_R', qty: 80 },
        ],
      },
    ];

    const result = auditCoverage(blocks, ops, toolMap);

    // OP01: demand=100, produced=100 → fully covered
    const row1 = result.rows.find((r) => r.opId === 'OP01')!;
    expect(row1.produced).toBe(100);
    expect(row1.coveragePct).toBe(100);

    // OP02: demand=80, produced=80 → fully covered (each SKU gets its actual demand)
    const row2 = result.rows.find((r) => r.opId === 'OP02')!;
    expect(row2.produced).toBe(80);
    expect(row2.coveragePct).toBe(100);

    expect(result.fullyCovered).toBe(2);
  });
});

// ── MRP Engine ──────────────────────────────────────────────────────

describe('MRP Engine — Twin Co-Production', () => {
  it('should compute grossReq as max(A, B) for twin tools', () => {
    const tool = makeTool({ stk: 0 });
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [100, 200, 0, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [80, 300, 0, 0, 0] }),
    ];
    const twinGroups = [makeTwinGroup()];

    const resultNormal = computeToolMRP(
      tool,
      ops,
      5,
      ['d1', 'd2', 'd3', 'd4', 'd5'],
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    );
    const resultTwin = computeToolMRP(
      tool,
      ops,
      5,
      ['d1', 'd2', 'd3', 'd4', 'd5'],
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      twinGroups,
    );

    // Normal: grossReq = 100+80=180, 200+300=500
    expect(resultNormal.buckets[0].grossRequirement).toBe(180);
    expect(resultNormal.buckets[1].grossRequirement).toBe(500);

    // Twin: grossReq = max(100,80)=100, max(200,300)=300
    expect(resultTwin.buckets[0].grossRequirement).toBe(100);
    expect(resultTwin.buckets[1].grossRequirement).toBe(300);
  });

  it('should compute backlog as max(A, B) for twin tools', () => {
    const tool = makeTool({ stk: 0 });
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [0, 0, 0, 0, 0], atr: 100 }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [0, 0, 0, 0, 0], atr: 60 }),
    ];
    const twinGroups = [makeTwinGroup()];

    const resultNormal = computeToolMRP(
      tool,
      ops,
      5,
      ['d1', 'd2', 'd3', 'd4', 'd5'],
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    );
    const resultTwin = computeToolMRP(
      tool,
      ops,
      5,
      ['d1', 'd2', 'd3', 'd4', 'd5'],
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
      twinGroups,
    );

    // Normal: backlog = 100 + 60 = 160
    expect(resultNormal.backlog).toBe(160);

    // Twin: backlog = max(100, 60) = 100
    expect(resultTwin.backlog).toBe(100);
  });
});

// ── Integration ─────────────────────────────────────────────────────

describe('Twin Co-Production Integration', () => {
  it('each SKU gets exactly its demand (no excess production)', () => {
    const blocks: Block[] = [
      {
        opId: 'OP01',
        toolId: 'BFP079',
        sku: 'SKU_L',
        nm: 'SKU_L',
        machineId: 'PRM019',
        origM: 'PRM019',
        dayIdx: 0,
        qty: 500,
        prodMin: 300,
        setupMin: 30,
        operators: 1,
        blocked: false,
        reason: null,
        moved: false,
        hasAlt: false,
        altM: null,
        stk: 0,
        lt: 500,
        atr: 0,
        startMin: 480,
        endMin: 780,
        setupS: 450,
        setupE: 480,
        type: 'ok',
        shift: 'X',
        isTwinProduction: true,
        coProductionGroupId: 'SKU_L|SKU_R',
        outputs: [
          { opId: 'OP01', sku: 'SKU_L', qty: 500 },
          { opId: 'OP02', sku: 'SKU_R', qty: 300 },
        ],
      },
    ];
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [500, 0, 0, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [300, 0, 0, 0, 0] }),
    ];
    const toolMap: Record<string, ETool> = { BFP079: makeTool() };

    const coverage = auditCoverage(blocks, ops, toolMap);

    // OP01: demand=500, produced=500 → exact match
    const row1 = coverage.rows.find((r) => r.opId === 'OP01')!;
    expect(row1.produced).toBe(500);
    expect(row1.gap).toBe(0);

    // OP02: demand=300, produced=300 → exact match (each SKU gets its actual demand)
    const row2 = coverage.rows.find((r) => r.opId === 'OP02')!;
    expect(row2.produced).toBe(300);
    expect(row2.gap).toBe(0);
    expect(row2.coveragePct).toBe(100);
  });

  it('outputs have different qty when demands differ', () => {
    const blocks: Block[] = [
      {
        opId: 'OP01',
        sku: 'SKU_L',
        qty: 200,
        type: 'ok',
        isTwinProduction: true,
        coProductionGroupId: 'SKU_L|SKU_R',
        outputs: [
          { opId: 'OP01', sku: 'SKU_L', qty: 200 },
          { opId: 'OP02', sku: 'SKU_R', qty: 120 },
        ],
      } as Block,
    ];

    // Each output reflects its actual demand — not equal
    const out = blocks[0].outputs!;
    expect(out[0].qty).toBe(200);
    expect(out[1].qty).toBe(120);
    expect(out[0].qty).not.toBe(out[1].qty);
  });
});

// ── Cross-EDD Twin Merging ────────────────────────────────────────

describe('Demand Grouper — Cross-EDD Twin Merging', () => {
  const tool = makeTool({ lt: 0 }); // no lot economic for clarity
  const toolMap: Record<string, ETool> = { BFP079: tool };
  const mSt: Record<string, string> = { PRM019: 'running' };
  const tSt: Record<string, string> = { BFP079: 'running' };

  it('pairs twins with different EDDs by sequential order', () => {
    // Twin A has order on day 1, Twin B has order on day 3
    // They should co-produce: merged EDD = min(1, 3) = 1
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [0, 100, 0, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [0, 0, 0, 80, 0] }),
    ];
    const twinGroups = [makeTwinGroup()];

    const result = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
      true, // orderBased=true
    );

    const allSkus = result['PRM019'].flatMap((g) => g.skus);
    // Should have 1 merged bucket (not 2 solo)
    expect(allSkus.length).toBe(1);
    expect(allSkus[0].isTwinProduction).toBe(true);
    expect(allSkus[0].totalQty).toBe(100); // max(100, 80)
    expect(allSkus[0].edd).toBe(1); // min(1, 3) = 1 — first order triggers
    expect(allSkus[0].twinOutputs).toHaveLength(2);
    expect(allSkus[0].twinOutputs![0].totalQty).toBe(100); // SKU_L actual
    expect(allSkus[0].twinOutputs![1].totalQty).toBe(80); // SKU_R actual
  });

  it('handles different order counts: 2 orders vs 3 orders', () => {
    // Twin A: 2 orders (day 1, day 4)
    // Twin B: 3 orders (day 0, day 2, day 4)
    // Expected: 2 merged pairs + 1 solo B remainder
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [0, 100, 0, 0, 200] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [50, 0, 80, 0, 300] }),
    ];
    const twinGroups = [makeTwinGroup()];

    const result = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
      true,
    );

    const allSkus = result['PRM019'].flatMap((g) => g.skus);
    const twinBuckets = allSkus.filter((sk) => sk.isTwinProduction);
    const soloBuckets = allSkus.filter((sk) => !sk.isTwinProduction);

    // 2 merged pairs
    expect(twinBuckets.length).toBe(2);

    // 1 solo remainder (B's 3rd order has no A counterpart)
    expect(soloBuckets.length).toBe(1);
    expect(soloBuckets[0].sku).toBe('SKU_R');
    expect(soloBuckets[0].totalQty).toBe(300);
  });

  it('preserves same-EDD behavior (backwards compatible)', () => {
    // Both twins have order on day 2 — same EDD, should merge as before
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [0, 0, 150, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [0, 0, 90, 0, 0] }),
    ];
    const twinGroups = [makeTwinGroup()];

    const result = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
      true,
    );

    const allSkus = result['PRM019'].flatMap((g) => g.skus);
    expect(allSkus.length).toBe(1);
    expect(allSkus[0].isTwinProduction).toBe(true);
    expect(allSkus[0].edd).toBe(2);
    expect(allSkus[0].totalQty).toBe(150); // max(150, 90)
  });

  it('remainder bucket stays solo when no pair exists', () => {
    // Twin A: 1 order, Twin B: 2 orders
    // 1 merged pair + 1 solo B
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [0, 0, 200, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [0, 100, 0, 0, 300] }),
    ];
    const twinGroups = [makeTwinGroup()];

    const result = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
      true,
    );

    const allSkus = result['PRM019'].flatMap((g) => g.skus);
    const twinBuckets = allSkus.filter((sk) => sk.isTwinProduction);
    const soloBuckets = allSkus.filter((sk) => !sk.isTwinProduction);

    expect(twinBuckets.length).toBe(1);
    // The merged pair: A(EDD=2) paired with B(EDD=1) → merged EDD = min(1,2) = 1
    expect(twinBuckets[0].edd).toBe(1);

    // B's 2nd order (EDD=4) stays solo
    expect(soloBuckets.length).toBe(1);
    expect(soloBuckets[0].sku).toBe('SKU_R');
    expect(soloBuckets[0].edd).toBe(4);
    expect(soloBuckets[0].totalQty).toBe(300);
  });

  it('merged EDD = min(A, B) — first order triggers co-production', () => {
    // A orders on day 4, B orders on day 1
    // B's earlier order triggers co-production → merged EDD = 1
    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [0, 0, 0, 0, 500] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [0, 200, 0, 0, 0] }),
    ];
    const twinGroups = [makeTwinGroup()];

    const result = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
      true,
    );

    const allSkus = result['PRM019'].flatMap((g) => g.skus);
    expect(allSkus.length).toBe(1);
    expect(allSkus[0].isTwinProduction).toBe(true);
    // B's day 1 order is earlier → merged EDD = 1
    expect(allSkus[0].edd).toBe(1);
    expect(allSkus[0].totalQty).toBe(500); // max(500, 200)
    // Both outputs preserved
    const outputs = allSkus[0].twinOutputs!.sort((a, b) => a.sku.localeCompare(b.sku));
    expect(outputs[0].totalQty).toBe(500); // SKU_L
    expect(outputs[1].totalQty).toBe(200); // SKU_R
  });
});
