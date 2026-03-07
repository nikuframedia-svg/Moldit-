// =====================================================================
//  INCOMPOL PLAN -- Demand Grouper Tests
//  Verifies groupDemandIntoBuckets() phase 1 logic
//
//  Factory context: 8-day horizon (Feb 27 - Mar 6, 2026)
//  workdays = [F, F, F, T, T, T, T, T]
//  BUCKET_WINDOW = 5 working days (for tools with lt=0)
//  Machines: PRM019 (PG1), PRM031 (PG2), PRM039 (PG2)
// =====================================================================

import { BUCKET_WINDOW } from '../src/constants.js';
import { groupDemandIntoBuckets } from '../src/scheduler/demand-grouper.js';
import type { MoveAction } from '../src/types/blocks.js';
import type { EOp, ETool } from '../src/types/engine.js';

// ── Shared test data ─────────────────────────────────────────────────

const WORKDAYS: boolean[] = [false, false, false, true, true, true, true, true];
const N_DAYS = 8;

/** No machines or tools are down */
const EMPTY_MST: Record<string, string> = {};
const EMPTY_TST: Record<string, string> = {};
const NO_MOVES: MoveAction[] = [];

/** Build a tool with realistic Nikufra properties */
function makeTool(overrides: Partial<ETool> & { id: string }): ETool {
  return {
    m: 'PRM019',
    alt: '-',
    sH: 0.5,
    pH: 120,
    op: 2,
    lt: 0,
    stk: 0,
    nm: 'Test Tool',
    ...overrides,
  };
}

/** Build an operation */
function makeOp(overrides: Partial<EOp> & { id: string; d: number[] }): EOp {
  return {
    t: 'BFP079',
    m: 'PRM019',
    sku: 'SKU-TEST',
    nm: 'Test Part',
    atr: 0,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('groupDemandIntoBuckets', () => {
  describe('bucket window mode (lt=0)', () => {
    it('uses BUCKET_WINDOW for tools with lt=0', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', lt: 0, pH: 120, sH: 0.5 }),
      };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM019',
          d: [0, 0, 0, 50, 60, 70, 80, 90],
          sku: '4927.020.001',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      expect(result['PRM019']).toBeDefined();
      const groups = result['PRM019'];
      expect(groups.length).toBeGreaterThanOrEqual(1);

      // Total quantity across all buckets should match total demand
      const totalQty = groups.reduce(
        (sum, g) => sum + g.skus.reduce((s, sk) => s + sk.totalQty, 0),
        0,
      );
      expect(totalQty).toBe(50 + 60 + 70 + 80 + 90); // 350

      // With 5 working days (3-7) and BUCKET_WINDOW=5, all demand fits in one bucket
      // The EDD should be the last demand day = day 7
      const lastGroup = groups[groups.length - 1];
      expect(lastGroup.edd).toBe(7);
    });
  });

  describe('lot economic mode (lt>0)', () => {
    it('emits bucket when accumulated qty >= lt', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', lt: 1000, pH: 120, sH: 0.5 }),
      };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM019',
          d: [0, 0, 0, 400, 300, 500, 200, 100],
          sku: '4927.020.001',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      const groups = result['PRM019'];
      expect(groups).toBeDefined();
      expect(groups.length).toBeGreaterThanOrEqual(1);

      // First bucket: 400+300+500=1200 >= 1000 -> emits at day 5
      // Second bucket: 200+100=300 (remaining, emitted at end)
      const totalQty = groups.reduce(
        (sum, g) => sum + g.skus.reduce((s, sk) => s + sk.totalQty, 0),
        0,
      );
      expect(totalQty).toBe(1500);

      // With lt=1000, prodQty should be rounded up to lot economic
      for (const g of groups) {
        for (const sk of g.skus) {
          expect(sk.prodQty % 1000).toBe(0);
          expect(sk.prodQty).toBeGreaterThanOrEqual(sk.totalQty);
        }
      }
    });
  });

  describe('backlog handling', () => {
    it('creates EDD=0 urgent batch from backlog (atr > 0)', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', lt: 0, pH: 120, sH: 0.5 }),
      };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM019',
          atr: 250,
          d: [0, 0, 0, 100, 0, 0, 0, 0],
          sku: '4927.020.001',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      const groups = result['PRM019'];
      expect(groups).toBeDefined();

      // Find the backlog batch (EDD=0)
      const backlogGroup = groups.find((g) => g.skus.some((sk) => sk.edd === 0));
      expect(backlogGroup).toBeDefined();

      const backlogSku = backlogGroup!.skus.find((sk) => sk.edd === 0)!;
      expect(backlogSku.totalQty).toBe(250);
      expect(backlogSku.atr).toBe(250);
      expect(backlogSku.edd).toBe(0);
    });
  });

  describe('zero demand', () => {
    it('skips operations with zero total demand', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', lt: 0, pH: 120, sH: 0.5 }),
      };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM019',
          atr: 0,
          d: [0, 0, 0, 0, 0, 0, 0, 0],
          sku: '4927.020.001',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      // No groups should be created for zero-demand operation
      expect(result['PRM019']).toBeUndefined();
    });
  });

  describe('unknown tool', () => {
    it('skips operations with unknown tool (not in toolMap)', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', lt: 0, pH: 120, sH: 0.5 }),
      };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'UNKNOWN_TOOL', // not in toolMap
          m: 'PRM019',
          d: [0, 0, 0, 100, 200, 0, 0, 0],
          sku: 'SKU-UNKNOWN',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      expect(result['PRM019']).toBeUndefined();
    });
  });

  describe('tool and machine down status', () => {
    it('marks buckets as blocked when tool is down', () => {
      const toolMap: Record<string, ETool> = {
        BWI003: makeTool({ id: 'BWI003', m: 'PRM039', lt: 0, pH: 80, sH: 0.75 }),
      };
      const tSt: Record<string, string> = { BWI003: 'down' };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BWI003',
          m: 'PRM039',
          d: [0, 0, 0, 100, 0, 0, 0, 0],
          sku: 'SKU-BWI',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        tSt,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      const groups = result['PRM039'];
      expect(groups).toBeDefined();
      expect(groups[0].skus[0].blocked).toBe(true);
      expect(groups[0].skus[0].reason).toBe('tool_down');
    });

    it('marks buckets as blocked when machine is down', () => {
      const toolMap: Record<string, ETool> = {
        BWI003: makeTool({ id: 'BWI003', m: 'PRM039', lt: 0, pH: 80, sH: 0.75 }),
      };
      const mSt: Record<string, string> = { PRM039: 'down' };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BWI003',
          m: 'PRM039',
          d: [0, 0, 0, 0, 200, 0, 0, 0],
          sku: 'SKU-BWI',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        mSt,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      const groups = result['PRM039'];
      expect(groups).toBeDefined();
      expect(groups[0].skus[0].blocked).toBe(true);
      expect(groups[0].skus[0].reason).toBe('machine_down');
    });
  });

  describe('move actions', () => {
    it('routes operation to alternative machine via move action', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', m: 'PRM019', alt: 'PRM031', lt: 0, pH: 120, sH: 0.5 }),
      };
      const moves: MoveAction[] = [{ opId: 'OP01', toM: 'PRM031' }];
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM019',
          d: [0, 0, 0, 100, 0, 0, 0, 0],
          sku: '4927.020.001',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        moves,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      // Should be grouped under PRM031 (move target), not PRM019
      expect(result['PRM031']).toBeDefined();
      expect(result['PRM019']).toBeUndefined();

      const group = result['PRM031'][0];
      expect(group.skus[0].moved).toBe(true);
      expect(group.skus[0].origM).toBe('PRM019');
    });
  });

  describe('setup time', () => {
    it('includes setup time in tool group (sH * 60 = setupMin)', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', lt: 0, pH: 120, sH: 0.75 }),
      };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM019',
          d: [0, 0, 0, 100, 0, 0, 0, 0],
          sku: '4927.020.001',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      const group = result['PRM019'][0];
      expect(group.setupMin).toBe(0.75 * 60); // 45 minutes
    });
  });

  describe('production quantity rounding', () => {
    it('rounds up to lot economic quantity', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', lt: 500, pH: 120, sH: 0.5 }),
      };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM019',
          d: [0, 0, 0, 0, 0, 0, 0, 350], // 350 < 500
          sku: '4927.020.001',
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      const group = result['PRM019'][0];
      const sku = group.skus[0];
      // totalQty=350, lt=500 => ceil(350/500)*500 = 500
      expect(sku.totalQty).toBe(350);
      expect(sku.prodQty).toBe(500);
    });
  });

  describe('hasAlt flag', () => {
    it('sets hasAlt=true when tool has alternative machine', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', m: 'PRM019', alt: 'PRM031', lt: 0, pH: 120, sH: 0.5 }),
      };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM019',
          d: [0, 0, 0, 100, 0, 0, 0, 0],
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      expect(result['PRM019'][0].skus[0].hasAlt).toBe(true);
      expect(result['PRM019'][0].skus[0].altM).toBe('PRM031');
    });

    it('sets hasAlt=false when tool alt is "-"', () => {
      const toolMap: Record<string, ETool> = {
        BFP079: makeTool({ id: 'BFP079', m: 'PRM019', alt: '-', lt: 0, pH: 120, sH: 0.5 }),
      };
      const ops: EOp[] = [
        makeOp({
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM019',
          d: [0, 0, 0, 100, 0, 0, 0, 0],
        }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      expect(result['PRM019'][0].skus[0].hasAlt).toBe(false);
      expect(result['PRM019'][0].skus[0].altM).toBeNull();
    });
  });

  // ── Cross-cutting invariants ────────────────────────────────────────

  describe('invariants (cross-cutting)', () => {
    /** Sum all bucket totalQty for a given opId */
    function sumQty(
      result: Record<string, ReturnType<typeof groupDemandIntoBuckets>[string]>,
      opId: string,
    ): number {
      let total = 0;
      for (const groups of Object.values(result)) {
        for (const g of groups) {
          for (const sk of g.skus) {
            if (sk.opId === opId) total += sk.totalQty;
          }
        }
      }
      return total;
    }

    it('demand conservation: all demand is bucketed (lt=0)', () => {
      const toolMap = { BFP079: makeTool({ id: 'BFP079', lt: 0, pH: 120 }) };
      const ops = [makeOp({ id: 'OP01', t: 'BFP079', atr: 100, d: [0, 0, 0, 50, 60, 70, 80, 90] })];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      expect(sumQty(result, 'OP01')).toBe(100 + 50 + 60 + 70 + 80 + 90);
    });

    it('demand conservation: all demand is bucketed (lt>0)', () => {
      const toolMap = { BFP079: makeTool({ id: 'BFP079', lt: 500, pH: 120 }) };
      const ops = [makeOp({ id: 'OP01', t: 'BFP079', d: [0, 0, 0, 200, 200, 200, 200, 200] })];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      expect(sumQty(result, 'OP01')).toBe(1000);
    });

    it('EDD boundary: all EDDs within [0, nDays-1]', () => {
      const toolMap = { BFP079: makeTool({ id: 'BFP079', lt: 0, pH: 120 }) };
      const ops = [
        makeOp({ id: 'OP01', t: 'BFP079', atr: 50, d: [0, 0, 0, 100, 200, 300, 400, 500] }),
      ];

      const result = groupDemandIntoBuckets(
        ops,
        EMPTY_MST,
        EMPTY_TST,
        NO_MOVES,
        toolMap,
        WORKDAYS,
        N_DAYS,
      );

      for (const groups of Object.values(result)) {
        for (const g of groups) {
          expect(g.edd).toBeGreaterThanOrEqual(0);
          expect(g.edd).toBeLessThan(N_DAYS);
          for (const sk of g.skus) {
            expect(sk.edd).toBeGreaterThanOrEqual(0);
            expect(sk.edd).toBeLessThan(N_DAYS);
          }
        }
      }
    });
  });
});
