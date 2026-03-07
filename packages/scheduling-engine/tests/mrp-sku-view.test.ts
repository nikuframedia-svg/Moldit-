// ═══════════════════════════════════════════════════════════
//  MRP SKU-View Tests
//  Tests computeMRPSkuView() flatten, back-refs, twins, summary
// ═══════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { computeMRP } from '../src/mrp/mrp-engine.js';
import { computeMRPSkuView } from '../src/mrp/mrp-sku-view.js';
import { transformPlanState } from '../src/transform/transform-plan-state.js';
import type { PlanState } from '../src/types/plan-state.js';
import { buildEngine, createModeratePlanState } from './helpers/replan-fixtures.js';

// ── Shared helpers ─────────────────────────────────────────

function getBaseline() {
  const ps = createModeratePlanState();
  const engine = buildEngine(ps);
  const mrp = computeMRP(engine);
  return { engine, mrp };
}

/** PlanState with 1 tool having 2 SKUs */
function createMultiSkuPlanState(): PlanState {
  return {
    dates: ['02/03', '03/03', '04/03', '05/03', '06/03'],
    days_label: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
    workday_flags: [true, true, true, true, true],
    mo: { PG1: [3, 3, 3, 3, 3], PG2: [3, 3, 3, 3, 3] },
    machines: [{ id: 'PRM031', area: 'PG1', man_minutes: [0, 0, 0, 0, 0] }],
    tools: [
      {
        id: 'BFP079',
        machine: 'PRM031',
        alt_machine: '-',
        setup_hours: 1.0,
        pcs_per_hour: 150,
        operators: 1,
        skus: ['SKU_A', 'SKU_B'],
        names: ['Part A', 'Part B'],
        lot_economic_qty: 0,
        stock: 1000,
      },
    ],
    operations: [
      {
        id: 'OP_A',
        machine: 'PRM031',
        tool: 'BFP079',
        sku: 'SKU_A',
        name: 'Part A',
        pcs_per_hour: 150,
        atraso: 0,
        daily_qty: [200, 200, 200, 0, 0],
        setup_hours: 1.0,
        operators: 1,
        stock: 600,
        status: 'PLANNED' as const,
        customer_code: 'CL01',
        customer_name: 'Customer One',
        twin: 'SKU_B',
      },
      {
        id: 'OP_B',
        machine: 'PRM031',
        tool: 'BFP079',
        sku: 'SKU_B',
        name: 'Part B',
        pcs_per_hour: 150,
        atraso: 100,
        daily_qty: [300, 0, 0, 0, 0],
        setup_hours: 1.0,
        operators: 1,
        stock: 400,
        status: 'PLANNED' as const,
        customer_code: 'CL02',
        customer_name: 'Customer Two',
        twin: 'SKU_A',
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

describe('computeMRPSkuView', () => {
  describe('flatten basico', () => {
    it('retorna 1 SKU record por operacao', () => {
      const { mrp } = getBaseline();
      const view = computeMRPSkuView(mrp);
      // Moderate PlanState has 2 ops (SKU_HEAVY, SKU_LIGHT)
      expect(view.skuRecords.length).toBe(2);
    });

    it('cada record tem toolCode e machine back-refs', () => {
      const { mrp } = getBaseline();
      const view = computeMRPSkuView(mrp);
      for (const rec of view.skuRecords) {
        expect(rec.toolCode).toBeTruthy();
        expect(rec.machine).toBeTruthy();
      }
    });

    it('SKU names propagados correctamente', () => {
      const { mrp } = getBaseline();
      const view = computeMRPSkuView(mrp);
      const heavy = view.skuRecords.find((r) => r.sku === 'SKU_HEAVY');
      expect(heavy).toBeDefined();
      expect(heavy!.name).toBe('Heavy Part');
    });

    it('buckets preservados com mesmo tamanho', () => {
      const { mrp, engine } = getBaseline();
      const view = computeMRPSkuView(mrp);
      for (const rec of view.skuRecords) {
        expect(rec.buckets.length).toBe(engine.nDays);
      }
    });
  });

  describe('multi-SKU por tool', () => {
    it('2 SKUs no mesmo tool → 2 records separados', () => {
      const ps = createMultiSkuPlanState();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);
      const view = computeMRPSkuView(mrp);

      expect(view.skuRecords.length).toBe(2);
      const skus = view.skuRecords.map((r) => r.sku);
      expect(skus).toContain('SKU_A');
      expect(skus).toContain('SKU_B');
    });

    it('ambos apontam para o mesmo toolCode', () => {
      const ps = createMultiSkuPlanState();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);
      const view = computeMRPSkuView(mrp);

      for (const rec of view.skuRecords) {
        expect(rec.toolCode).toBe('BFP079');
        expect(rec.machine).toBe('PRM031');
      }
    });

    it('customer codes propagados', () => {
      const ps = createMultiSkuPlanState();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);
      const view = computeMRPSkuView(mrp);

      const a = view.skuRecords.find((r) => r.sku === 'SKU_A')!;
      const b = view.skuRecords.find((r) => r.sku === 'SKU_B')!;
      expect(a.customer).toBe('CL01');
      expect(a.customerName).toBe('Customer One');
      expect(b.customer).toBe('CL02');
      expect(b.customerName).toBe('Customer Two');
    });
  });

  describe('twins', () => {
    it('twin SKUs marcados com isTwin = true', () => {
      const ps = createMultiSkuPlanState();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);
      const view = computeMRPSkuView(mrp);

      const a = view.skuRecords.find((r) => r.sku === 'SKU_A')!;
      const b = view.skuRecords.find((r) => r.sku === 'SKU_B')!;
      expect(a.isTwin).toBe(true);
      expect(a.twin).toBe('SKU_B');
      expect(b.isTwin).toBe(true);
      expect(b.twin).toBe('SKU_A');
    });

    it('non-twin SKUs marcados com isTwin = false', () => {
      const { mrp } = getBaseline();
      const view = computeMRPSkuView(mrp);
      for (const rec of view.skuRecords) {
        expect(rec.isTwin).toBe(false);
      }
    });
  });

  describe('summary', () => {
    it('totalSkus correcto', () => {
      const { mrp } = getBaseline();
      const view = computeMRPSkuView(mrp);
      expect(view.summary.totalSkus).toBe(view.skuRecords.length);
    });

    it('totalGrossReq soma de todos os SKUs', () => {
      const { mrp } = getBaseline();
      const view = computeMRPSkuView(mrp);
      const manual = view.skuRecords.reduce((s, r) => s + r.grossRequirement, 0);
      expect(view.summary.totalGrossReq).toBe(manual);
    });

    it('skusWithBacklog conta correctamente', () => {
      const ps = createMultiSkuPlanState();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);
      const view = computeMRPSkuView(mrp);
      // OP_B has atraso=100 (backlog)
      expect(view.summary.skusWithBacklog).toBeGreaterThanOrEqual(1);
    });

    it('skusWithStockout conta SKUs com stockoutDay !== null', () => {
      const { mrp } = getBaseline();
      const view = computeMRPSkuView(mrp);
      const manual = view.skuRecords.filter((r) => r.stockoutDay !== null).length;
      expect(view.summary.skusWithStockout).toBe(manual);
    });

    it('totalPlannedQty soma planned order receipts', () => {
      const { mrp } = getBaseline();
      const view = computeMRPSkuView(mrp);
      const manual = view.skuRecords.reduce((s, r) => {
        return s + r.buckets.reduce((bs, b) => bs + b.plannedOrderReceipt, 0);
      }, 0);
      expect(view.summary.totalPlannedQty).toBe(manual);
    });
  });

  describe('campos numericos', () => {
    it('currentStock, wip, backlog sao numeros', () => {
      const { mrp } = getBaseline();
      const view = computeMRPSkuView(mrp);
      for (const rec of view.skuRecords) {
        expect(typeof rec.currentStock).toBe('number');
        expect(typeof rec.wip).toBe('number');
        expect(typeof rec.backlog).toBe('number');
      }
    });

    it('ratePerHour e setupHours preservados do tool', () => {
      const ps = createMultiSkuPlanState();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);
      const view = computeMRPSkuView(mrp);
      for (const rec of view.skuRecords) {
        expect(rec.ratePerHour).toBe(150);
        expect(rec.setupHours).toBe(1.0);
      }
    });
  });
});
