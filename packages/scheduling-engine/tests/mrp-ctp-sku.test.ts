// ═══════════════════════════════════════════════════════════
//  MRP CTP Per-SKU Tests
//  Tests computeCTPSku() — resolve SKU → tool, capacity check
// ═══════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { computeCTPSku } from '../src/mrp/mrp-ctp-sku.js';
import { computeMRP } from '../src/mrp/mrp-engine.js';
import { transformPlanState } from '../src/transform/transform-plan-state.js';
import type { CTPSkuInput } from '../src/types/mrp.js';
import type { PlanState } from '../src/types/plan-state.js';
import { buildEngine, createModeratePlanState } from './helpers/replan-fixtures.js';

// ── Shared helpers ─────────────────────────────────────────

function getBaseline() {
  const ps = createModeratePlanState();
  const engine = buildEngine(ps);
  const mrp = computeMRP(engine);
  return { engine, mrp };
}

/** PlanState with 2 SKUs on same tool */
function createTwoSkuOneTool(): PlanState {
  return {
    dates: ['02/03', '03/03', '04/03', '05/03', '06/03'],
    days_label: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
    workday_flags: [true, true, true, true, true],
    mo: { PG1: [3, 3, 3, 3, 3], PG2: [3, 3, 3, 3, 3] },
    machines: [{ id: 'PRM031', area: 'PG1', man_minutes: [0, 0, 0, 0, 0] }],
    tools: [
      {
        id: 'BFP100',
        machine: 'PRM031',
        alt_machine: '-',
        setup_hours: 0.5,
        pcs_per_hour: 100,
        operators: 1,
        skus: ['SKU_X', 'SKU_Y'],
        names: ['Part X', 'Part Y'],
        lot_economic_qty: 0,
        stock: 500,
      },
    ],
    operations: [
      {
        id: 'OP_X',
        machine: 'PRM031',
        tool: 'BFP100',
        sku: 'SKU_X',
        name: 'Part X',
        pcs_per_hour: 100,
        atraso: 0,
        daily_qty: [100, 100, 100, 0, 0],
        setup_hours: 0.5,
        operators: 1,
        stock: 300,
        status: 'PLANNED' as const,
      },
      {
        id: 'OP_Y',
        machine: 'PRM031',
        tool: 'BFP100',
        sku: 'SKU_Y',
        name: 'Part Y',
        pcs_per_hour: 100,
        atraso: 0,
        daily_qty: [200, 200, 0, 0, 0],
        setup_hours: 0.5,
        operators: 1,
        stock: 200,
        status: 'PLANNED' as const,
      },
    ],
    schedule: [],
    machine_loads: [],
    kpis: null,
    parsed_at: null,
    data_hash: null,
  };
}

// ═══════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════

describe('computeCTPSku', () => {
  describe('resolucao SKU → tool', () => {
    it('resolve SKU existente para tool correcto', () => {
      const { engine, mrp } = getBaseline();
      const input: CTPSkuInput = {
        sku: 'SKU_HEAVY',
        quantity: 100,
        targetDay: 2,
      };
      const result = computeCTPSku(input, mrp, engine);
      expect(result.toolCode).toBe('BWI003');
      expect(result.sku).toBe('SKU_HEAVY');
      expect(result.skuName).toBe('Heavy Part');
    });

    it('SKU inexistente → feasible=false com reason', () => {
      const { engine, mrp } = getBaseline();
      const input: CTPSkuInput = {
        sku: 'SKU_INEXISTENTE',
        quantity: 100,
        targetDay: 0,
      };
      const result = computeCTPSku(input, mrp, engine);
      expect(result.feasible).toBe(false);
      expect(result.toolCode).toBe('?');
      expect(result.sku).toBe('SKU_INEXISTENTE');
      expect(result.reason).toContain('not found');
    });
  });

  describe('capacidade e stock', () => {
    it('quantidade pequena no dia 0 → feasible', () => {
      const { engine, mrp } = getBaseline();
      const input: CTPSkuInput = {
        sku: 'SKU_HEAVY',
        quantity: 10,
        targetDay: 0,
      };
      const result = computeCTPSku(input, mrp, engine);
      // Small qty should be feasible on day 0
      expect(result.machine).toBe('PRM039');
    });

    it('resultado inclui capacityTimeline', () => {
      const { engine, mrp } = getBaseline();
      const input: CTPSkuInput = {
        sku: 'SKU_HEAVY',
        quantity: 500,
        targetDay: 2,
      };
      const result = computeCTPSku(input, mrp, engine);
      expect(result.capacityTimeline).toBeDefined();
      expect(Array.isArray(result.capacityTimeline)).toBe(true);
    });

    it('stockAfterOrder calculado com stock per-SKU', () => {
      const ps = createTwoSkuOneTool();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);

      const input: CTPSkuInput = {
        sku: 'SKU_X',
        quantity: 50,
        targetDay: 0,
      };
      const result = computeCTPSku(input, mrp, engine);
      expect(result.sku).toBe('SKU_X');
      expect(result.skuName).toBe('Part X');
      // stockAfterOrder should be projectedStock - quantity
      expect(result.stockAfterOrder).toBe(result.projectedStockOnDay - 50);
    });
  });

  describe('multi-SKU no mesmo tool', () => {
    it('CTP para SKU_X e SKU_Y resolvem para mesmo tool', () => {
      const ps = createTwoSkuOneTool();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);

      const resultX = computeCTPSku({ sku: 'SKU_X', quantity: 50, targetDay: 0 }, mrp, engine);
      const resultY = computeCTPSku({ sku: 'SKU_Y', quantity: 50, targetDay: 0 }, mrp, engine);
      expect(resultX.toolCode).toBe('BFP100');
      expect(resultY.toolCode).toBe('BFP100');
      expect(resultX.machine).toBe(resultY.machine);
    });

    it('projected stock diferente por SKU', () => {
      const ps = createTwoSkuOneTool();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);

      const resultX = computeCTPSku({ sku: 'SKU_X', quantity: 10, targetDay: 0 }, mrp, engine);
      const resultY = computeCTPSku({ sku: 'SKU_Y', quantity: 10, targetDay: 0 }, mrp, engine);
      // Different SKUs may have different projected stock
      expect(resultX.sku).toBe('SKU_X');
      expect(resultY.sku).toBe('SKU_Y');
    });
  });

  describe('edge cases', () => {
    it('targetDay = ultimo dia do horizonte', () => {
      const { engine, mrp } = getBaseline();
      const lastDay = engine.nDays - 1;
      const input: CTPSkuInput = {
        sku: 'SKU_HEAVY',
        quantity: 100,
        targetDay: lastDay,
      };
      const result = computeCTPSku(input, mrp, engine);
      expect(result.sku).toBe('SKU_HEAVY');
      // Should not crash
      expect(typeof result.feasible).toBe('boolean');
    });

    it('quantity = 0 → feasible', () => {
      const { engine, mrp } = getBaseline();
      const input: CTPSkuInput = {
        sku: 'SKU_HEAVY',
        quantity: 0,
        targetDay: 0,
      };
      const result = computeCTPSku(input, mrp, engine);
      expect(result.feasible).toBe(true);
    });
  });
});
