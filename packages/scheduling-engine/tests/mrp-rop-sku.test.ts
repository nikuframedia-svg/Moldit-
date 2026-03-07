// ═══════════════════════════════════════════════════════════
//  MRP ROP/SS Per-SKU Tests
//  Tests computeROPSku() — ABC/XYZ, safety stock, per-SKU
// ═══════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { computeMRP } from '../src/mrp/mrp-engine.js';
import { computeROPSku } from '../src/mrp/mrp-rop-sku.js';
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

/** PlanState with 3 SKUs for ABC classification */
function createThreeSkuPlanState(): PlanState {
  return {
    dates: ['02/03', '03/03', '04/03', '05/03', '06/03'],
    days_label: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
    workday_flags: [true, true, true, true, true],
    mo: { PG1: [3, 3, 3, 3, 3], PG2: [3, 3, 3, 3, 3] },
    machines: [
      { id: 'PRM031', area: 'PG1', man_minutes: [0, 0, 0, 0, 0] },
      { id: 'PRM039', area: 'PG2', man_minutes: [0, 0, 0, 0, 0] },
    ],
    tools: [
      {
        id: 'T_HIGH',
        machine: 'PRM031',
        alt_machine: '-',
        setup_hours: 1.0,
        pcs_per_hour: 200,
        operators: 1,
        skus: ['SKU_HIGH'],
        names: ['High Volume'],
        lot_economic_qty: 0,
        stock: 0,
      },
      {
        id: 'T_MED',
        machine: 'PRM031',
        alt_machine: '-',
        setup_hours: 0.5,
        pcs_per_hour: 100,
        operators: 1,
        skus: ['SKU_MED'],
        names: ['Medium Volume'],
        lot_economic_qty: 0,
        stock: 0,
      },
      {
        id: 'T_LOW',
        machine: 'PRM039',
        alt_machine: '-',
        setup_hours: 0.5,
        pcs_per_hour: 50,
        operators: 1,
        skus: ['SKU_LOW'],
        names: ['Low Volume'],
        lot_economic_qty: 0,
        stock: 0,
      },
    ],
    operations: [
      {
        id: 'OP_HIGH',
        machine: 'PRM031',
        tool: 'T_HIGH',
        sku: 'SKU_HIGH',
        name: 'High Volume',
        pcs_per_hour: 200,
        atraso: 0,
        daily_qty: [5000, 5000, 5000, 5000, 5000],
        setup_hours: 1.0,
        operators: 1,
        stock: 0,
        status: 'PLANNED' as const,
      },
      {
        id: 'OP_MED',
        machine: 'PRM031',
        tool: 'T_MED',
        sku: 'SKU_MED',
        name: 'Medium Volume',
        pcs_per_hour: 100,
        atraso: 0,
        daily_qty: [1000, 1000, 1000, 1000, 1000],
        setup_hours: 0.5,
        operators: 1,
        stock: 0,
        status: 'PLANNED' as const,
      },
      {
        id: 'OP_LOW',
        machine: 'PRM039',
        tool: 'T_LOW',
        sku: 'SKU_LOW',
        name: 'Low Volume',
        pcs_per_hour: 50,
        atraso: 0,
        daily_qty: [50, 50, 50, 50, 50],
        setup_hours: 0.5,
        operators: 1,
        stock: 0,
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

describe('computeROPSku', () => {
  describe('estrutura basica', () => {
    it('retorna 1 record por SKU', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      // Moderate plan has 2 ops → 2 SKUs
      expect(result.records.length).toBe(2);
    });

    it('cada record tem sku, name, opId, toolCode, machine', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      for (const r of result.records) {
        expect(r.sku).toBeTruthy();
        expect(r.name).toBeTruthy();
        expect(r.opId).toBeTruthy();
        expect(r.toolCode).toBeTruthy();
        expect(r.machine).toBeTruthy();
      }
    });

    it('serviceLevel propagado', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      for (const r of result.records) {
        expect(r.serviceLevel).toBe(95);
      }
    });

    it('zScore correcto para SL 95%', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      for (const r of result.records) {
        expect(r.zScore).toBe(1.645);
      }
    });

    it('zScore correcto para SL 99%', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 99);
      for (const r of result.records) {
        expect(r.zScore).toBe(2.33);
      }
    });
  });

  describe('safety stock e ROP', () => {
    it('safetyStock >= 0', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      for (const r of result.records) {
        expect(r.safetyStock).toBeGreaterThanOrEqual(0);
      }
    });

    it('rop >= safetyStock', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      for (const r of result.records) {
        expect(r.rop).toBeGreaterThanOrEqual(r.safetyStock);
      }
    });

    it('SL 99% > SL 90% para safetyStock', () => {
      const { engine, mrp } = getBaseline();
      const r90 = computeROPSku(mrp, engine, 90);
      const r99 = computeROPSku(mrp, engine, 99);

      // Higher service level → higher safety stock (if demand has variance)
      const ss90 = r90.records.reduce((s, r) => s + r.safetyStock, 0);
      const ss99 = r99.records.reduce((s, r) => s + r.safetyStock, 0);
      expect(ss99).toBeGreaterThanOrEqual(ss90);
    });

    it('stockProjection tem entries para todos os dias', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      for (const r of result.records) {
        expect(r.stockProjection.length).toBe(engine.nDays);
        for (const sp of r.stockProjection) {
          expect(sp.ropLine).toBeGreaterThanOrEqual(0);
          expect(sp.ssLine).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe('ABC classification', () => {
    it('3 SKUs com volumes diferentes → classificacao ABC coerente', () => {
      const ps = createThreeSkuPlanState();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);
      const result = computeROPSku(mrp, engine, 95);

      expect(result.records.length).toBe(3);

      const high = result.records.find((r) => r.sku === 'SKU_HIGH')!;
      const med = result.records.find((r) => r.sku === 'SKU_MED')!;
      const low = result.records.find((r) => r.sku === 'SKU_LOW')!;

      // Higher volume SKU has demandAvg >= lower volume SKU
      expect(high.demandAvg).toBeGreaterThan(med.demandAvg);
      expect(med.demandAvg).toBeGreaterThan(low.demandAvg);

      // ABC class ordering: A ≤ B ≤ C (by volume cumulative)
      const classOrder = { A: 0, B: 1, C: 2 };
      expect(classOrder[high.abcClass]).toBeLessThanOrEqual(classOrder[med.abcClass]);
      expect(classOrder[med.abcClass]).toBeLessThanOrEqual(classOrder[low.abcClass]);

      // Low volume should be B or C (never A)
      expect(['B', 'C']).toContain(low.abcClass);
    });

    it('abcDistribution soma == total records', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      const total = result.abcDistribution.A + result.abcDistribution.B + result.abcDistribution.C;
      expect(total).toBe(result.records.length);
    });
  });

  describe('XYZ classification', () => {
    it('demand constante → X (baixo CV)', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      // SKU_HEAVY has constant demand (500, 500, 500, 500, 500) → CV = 0 → X
      const heavy = result.records.find((r) => r.sku === 'SKU_HEAVY')!;
      expect(heavy.xyzClass).toBe('X');
      expect(heavy.coefficientOfVariation).toBeLessThan(0.5);
    });

    it('xyzDistribution soma == total records', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      const total = result.xyzDistribution.X + result.xyzDistribution.Y + result.xyzDistribution.Z;
      expect(total).toBe(result.records.length);
    });
  });

  describe('summary counters', () => {
    it('skusBelowROP conta SKUs com stock < rop', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      const manual = result.records.filter((r) => r.currentStock < r.rop).length;
      expect(result.skusBelowROP).toBe(manual);
    });

    it('skusBelowSS conta SKUs com stock < safetyStock', () => {
      const { engine, mrp } = getBaseline();
      const result = computeROPSku(mrp, engine, 95);
      const manual = result.records.filter((r) => r.currentStock < r.safetyStock).length;
      expect(result.skusBelowSS).toBe(manual);
    });
  });
});
