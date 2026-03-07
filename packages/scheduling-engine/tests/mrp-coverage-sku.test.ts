// ═══════════════════════════════════════════════════════════
//  MRP Coverage Matrix Per-SKU Tests
//  Tests computeCoverageMatrixSku() — rows by SKU, urgency sort
// ═══════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { computeCoverageMatrixSku } from '../src/mrp/mrp-coverage-sku.js';
import { computeMRP } from '../src/mrp/mrp-engine.js';
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

/** PlanState with SKUs of varying urgency */
function createVaryingCoveragePlanState(): PlanState {
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
        id: 'T_URGENT',
        machine: 'PRM031',
        alt_machine: '-',
        setup_hours: 0.5,
        pcs_per_hour: 100,
        operators: 1,
        skus: ['SKU_URGENT'],
        names: ['Urgent Part'],
        lot_economic_qty: 0,
        stock: 0,
      },
      {
        id: 'T_SAFE',
        machine: 'PRM039',
        alt_machine: '-',
        setup_hours: 0.5,
        pcs_per_hour: 100,
        operators: 1,
        skus: ['SKU_SAFE'],
        names: ['Safe Part'],
        lot_economic_qty: 0,
        stock: 50000,
      },
    ],
    operations: [
      {
        id: 'OP_URGENT',
        machine: 'PRM031',
        tool: 'T_URGENT',
        sku: 'SKU_URGENT',
        name: 'Urgent Part',
        pcs_per_hour: 100,
        atraso: 500,
        daily_qty: [2000, 2000, 2000, 2000, 2000],
        setup_hours: 0.5,
        operators: 1,
        stock: 0,
        status: 'PLANNED' as const,
      },
      {
        id: 'OP_SAFE',
        machine: 'PRM039',
        tool: 'T_SAFE',
        sku: 'SKU_SAFE',
        name: 'Safe Part',
        pcs_per_hour: 100,
        atraso: 0,
        daily_qty: [10, 10, 10, 10, 10],
        setup_hours: 0.5,
        operators: 1,
        stock: 50000,
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

describe('computeCoverageMatrixSku', () => {
  describe('estrutura', () => {
    it('retorna 1 row por SKU', () => {
      const { engine, mrp } = getBaseline();
      const result = computeCoverageMatrixSku(mrp, engine);
      expect(result.skus.length).toBe(2); // 2 SKUs in moderate plan
      expect(result.cells.length).toBe(2);
    });

    it('cada SKU tem sku, name, toolCode, machine', () => {
      const { engine, mrp } = getBaseline();
      const result = computeCoverageMatrixSku(mrp, engine);
      for (const sku of result.skus) {
        expect(sku.sku).toBeTruthy();
        expect(sku.name).toBeTruthy();
        expect(sku.toolCode).toBeTruthy();
        expect(sku.machine).toBeTruthy();
      }
    });

    it('days correspondem ao engine.dates', () => {
      const { engine, mrp } = getBaseline();
      const result = computeCoverageMatrixSku(mrp, engine);
      expect(result.days).toEqual(engine.dates);
    });

    it('cada row de cells tem entries para todos os dias', () => {
      const { engine, mrp } = getBaseline();
      const result = computeCoverageMatrixSku(mrp, engine);
      for (const row of result.cells) {
        expect(row.length).toBe(engine.nDays);
      }
    });
  });

  describe('color bands', () => {
    it('cells com daysOfSupply < 1 → red', () => {
      const { engine, mrp } = getBaseline();
      const result = computeCoverageMatrixSku(mrp, engine);
      for (const row of result.cells) {
        for (const cell of row) {
          if (cell.daysOfSupply < 1) {
            expect(cell.colorBand).toBe('red');
          }
        }
      }
    });

    it('color bands consistentes com daysOfSupply', () => {
      const { engine, mrp } = getBaseline();
      const result = computeCoverageMatrixSku(mrp, engine);
      for (const row of result.cells) {
        for (const cell of row) {
          const dos = cell.daysOfSupply;
          if (dos < 1) expect(cell.colorBand).toBe('red');
          else if (dos < 3) expect(cell.colorBand).toBe('amber');
          else if (dos < 7) expect(cell.colorBand).toBe('green');
          else expect(cell.colorBand).toBe('blue');
        }
      }
    });
  });

  describe('urgency sorting', () => {
    it('SKUs ordenados por urgencyScore (menor cobertura primeiro)', () => {
      const ps = createVaryingCoveragePlanState();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);
      const result = computeCoverageMatrixSku(mrp, engine);

      // First SKU should have lower urgencyScore than last
      expect(result.skus.length).toBe(2);
      expect(result.skus[0].urgencyScore).toBeLessThanOrEqual(result.skus[1].urgencyScore);
    });

    it('SKU urgente aparece primeiro', () => {
      const ps = createVaryingCoveragePlanState();
      const engine = transformPlanState(ps);
      const mrp = computeMRP(engine);
      const result = computeCoverageMatrixSku(mrp, engine);

      // SKU_URGENT (stock=0, high demand) should be first
      expect(result.skus[0].sku).toBe('SKU_URGENT');
    });
  });

  describe('cell metadata', () => {
    it('cada cell tem sku e toolCode', () => {
      const { engine, mrp } = getBaseline();
      const result = computeCoverageMatrixSku(mrp, engine);
      for (const row of result.cells) {
        for (const cell of row) {
          expect(cell.sku).toBeTruthy();
          expect(cell.toolCode).toBeTruthy();
        }
      }
    });

    it('dayIndex incrementa de 0 a nDays-1', () => {
      const { engine, mrp } = getBaseline();
      const result = computeCoverageMatrixSku(mrp, engine);
      for (const row of result.cells) {
        for (let i = 0; i < row.length; i++) {
          expect(row[i].dayIndex).toBe(i);
        }
      }
    });

    it('daysOfSupply arredondado a 1 decimal', () => {
      const { engine, mrp } = getBaseline();
      const result = computeCoverageMatrixSku(mrp, engine);
      for (const row of result.cells) {
        for (const cell of row) {
          const str = cell.daysOfSupply.toString();
          const parts = str.split('.');
          if (parts.length > 1) {
            expect(parts[1].length).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  });
});
