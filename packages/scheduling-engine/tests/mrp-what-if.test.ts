// ═══════════════════════════════════════════════════════════
//  What-If MRP Tests
//  Tests computeWhatIf() with all 4 mutation types:
//    rush_order, demand_factor, machine_down, failure_event
//  Verifies deltas, RCCP impacts, and edge cases.
// ═══════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { computeMRP } from '../src/mrp/mrp-engine.js';
import { computeWhatIf } from '../src/mrp/mrp-what-if.js';
import type { FailureEvent } from '../src/types/failure.js';
import type { WhatIfMutation } from '../src/types/mrp.js';
import { buildEngine, createModeratePlanState } from './helpers/replan-fixtures.js';

// ── Shared setup ─────────────────────────────────────────

function getBaseline() {
  const ps = createModeratePlanState();
  const engine = buildEngine(ps);
  const baseline = computeMRP(engine);
  return { engine, baseline };
}

// ═══════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════

describe('What-If MRP', () => {
  // ── Estrutura do resultado ────────────────────────────

  describe('estrutura do resultado', () => {
    it('mutacoes vazias retornam deltas zero', () => {
      const { engine, baseline } = getBaseline();
      const result = computeWhatIf(engine, [], baseline);

      // Every delta should have baseline === modified
      for (const d of result.deltas) {
        expect(d.baselineStockout).toBe(d.modifiedStockout);
        expect(d.baselineCoverage).toBe(d.modifiedCoverage);
        expect(d.baselinePlannedQty).toBe(d.modifiedPlannedQty);
      }
      expect(result.summaryDelta.stockoutsChange).toBe(0);
      expect(result.summaryDelta.avgUtilChange).toBe(0);
      expect(result.deltas.length).toBe(baseline.records.length);
    });
  });

  // ── rush_order ────────────────────────────────────────

  describe('rush_order', () => {
    it('adiciona demanda a tool existente', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'rush_order',
          toolCode: 'BWI003',
          rushQty: 10000,
          rushDay: 0,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);
      const delta = result.deltas.find((d) => d.toolCode === 'BWI003')!;
      expect(delta).toBeDefined();

      // Rush adds 10000 pcs on day 0. Modified planned qty should increase.
      expect(delta.modifiedPlannedQty).toBeGreaterThan(delta.baselinePlannedQty);
    });

    it('tool inexistente no toolMap — ignorado', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'rush_order',
          toolCode: 'INEXISTENTE',
          rushQty: 5000,
          rushDay: 0,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);
      // All deltas should be unchanged
      for (const d of result.deltas) {
        expect(d.baselinePlannedQty).toBe(d.modifiedPlannedQty);
      }
      expect(result.summaryDelta.stockoutsChange).toBe(0);
    });

    it('rushDay fora do horizonte — ignorado', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'rush_order',
          toolCode: 'BWI003',
          rushQty: 5000,
          rushDay: 999,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);
      const delta = result.deltas.find((d) => d.toolCode === 'BWI003')!;
      expect(delta.baselinePlannedQty).toBe(delta.modifiedPlannedQty);
    });

    it('tool existe no toolMap sem ops — cria sintetica', () => {
      const ps = createModeratePlanState();
      // Add a tool with no operations
      ps.tools.push({
        id: 'BWI_ORPHAN',
        machine: 'PRM039',
        alt_machine: '-',
        setup_hours: 0.5,
        pcs_per_hour: 50,
        operators: 1,
        skus: ['SKU_ORPHAN'],
        names: ['Orphan Part'],
        lot_economic_qty: 0,
        stock: 0,
      });
      const engine = buildEngine(ps);
      const baseline = computeMRP(engine);

      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'rush_order',
          toolCode: 'BWI_ORPHAN',
          rushQty: 500,
          rushDay: 0,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);
      // Should have a new delta for BWI_ORPHAN that didn't exist in baseline
      const delta = result.deltas.find((d) => d.toolCode === 'BWI_ORPHAN');
      expect(delta).toBeDefined();
      if (delta) {
        expect(delta.baselineStockout).toBeNull();
        expect(delta.modifiedPlannedQty).toBeGreaterThan(0);
      }
    });
  });

  // ── demand_factor ─────────────────────────────────────

  describe('demand_factor', () => {
    it('factor 2.0 em __all__ duplica demanda', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'demand_factor',
          factorToolCode: '__all__',
          factor: 2.0,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // At least BWI003 should show increased planned qty
      const delta = result.deltas.find((d) => d.toolCode === 'BWI003')!;
      expect(delta.modifiedPlannedQty).toBeGreaterThanOrEqual(delta.baselinePlannedQty);
    });

    it('factor 0.5 reduz demanda', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'demand_factor',
          factorToolCode: '__all__',
          factor: 0.5,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // Planned qty should decrease or stay equal (less demand → less planned)
      for (const d of result.deltas) {
        expect(d.modifiedPlannedQty).toBeLessThanOrEqual(d.baselinePlannedQty);
      }
    });

    it('factor em tool especifica so afecta essa tool', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'demand_factor',
          factorToolCode: 'BWI003',
          factor: 3.0,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      const deltaBWI = result.deltas.find((d) => d.toolCode === 'BWI003')!;
      const deltaBFP = result.deltas.find((d) => d.toolCode === 'BFP080')!;

      // BWI003 should change
      expect(deltaBWI.modifiedPlannedQty).toBeGreaterThan(deltaBWI.baselinePlannedQty);
      // BFP080 should be unchanged
      expect(deltaBFP.baselinePlannedQty).toBe(deltaBFP.modifiedPlannedQty);
    });

    it('factor 0 zera demanda', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'demand_factor',
          factorToolCode: '__all__',
          factor: 0,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      for (const d of result.deltas) {
        expect(d.modifiedPlannedQty).toBe(0);
      }
    });
  });

  // ── machine_down ──────────────────────────────────────

  describe('machine_down', () => {
    it('machine down 3 dias afecta RCCP', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'machine_down',
          machine: 'PRM039',
          downStartDay: 1,
          downEndDay: 3,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // RCCP deltas for PRM039 days 1-3 should show modified util different from baseline
      const affectedRccp = result.rccpDeltas.filter(
        (r) => r.machine === 'PRM039' && r.dayIndex >= 1 && r.dayIndex <= 3,
      );
      expect(affectedRccp.length).toBeGreaterThan(0);
      for (const r of affectedRccp) {
        // Machine is down → modified util should be 0 or different from baseline
        expect(r.modifiedUtil).not.toBe(r.baselineUtil);
      }
    });

    it('machine desconhecida — sem efeito', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'machine_down',
          machine: 'FAKE_MACHINE',
          downStartDay: 0,
          downEndDay: 4,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // RCCP for real machines should be unchanged
      for (const r of result.rccpDeltas) {
        expect(r.baselineUtil).toBe(r.modifiedUtil);
      }
    });

    it('downStartDay > downEndDay — no-op', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'machine_down',
          machine: 'PRM039',
          downStartDay: 3,
          downEndDay: 1,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // Loop L62 won't execute → no capacity override
      for (const d of result.deltas) {
        expect(d.baselinePlannedQty).toBe(d.modifiedPlannedQty);
      }
    });
  });

  // ── failure_event ─────────────────────────────────────

  describe('failure_event', () => {
    it('capacityFactor 0.0 — total failure', () => {
      const { engine, baseline } = getBaseline();
      const fe: FailureEvent = {
        id: 'FE1',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 0,
        startShift: null,
        endDay: 2,
        endShift: null,
        severity: 'total',
        capacityFactor: 0.0,
      };
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'failure_event',
          failureEvent: fe,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // RCCP for PRM039 days 0-2 should show zero or different capacity
      const affected = result.rccpDeltas.filter(
        (r) => r.machine === 'PRM039' && r.dayIndex >= 0 && r.dayIndex <= 2,
      );
      expect(affected.length).toBeGreaterThan(0);
      for (const r of affected) {
        expect(r.modifiedUtil).not.toBe(r.baselineUtil);
      }
    });

    it('capacityFactor 0.5 — parcial', () => {
      const { engine, baseline } = getBaseline();
      const fe: FailureEvent = {
        id: 'FE1',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 0,
        startShift: null,
        endDay: 4,
        endShift: null,
        severity: 'partial',
        capacityFactor: 0.5,
      };
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'failure_event',
          failureEvent: fe,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // RCCP for PRM039 should show different utilization (reduced capacity)
      const affected = result.rccpDeltas.filter((r) => r.machine === 'PRM039');
      expect(affected.length).toBeGreaterThan(0);
      // At least some should differ
      const changed = affected.filter((r) => r.modifiedUtil !== r.baselineUtil);
      expect(changed.length).toBeGreaterThan(0);
    });

    it('resourceType tool — sem efeito no RCCP de maquinas', () => {
      const { engine, baseline } = getBaseline();
      const fe: FailureEvent = {
        id: 'FE1',
        resourceType: 'tool',
        resourceId: 'BWI003',
        startDay: 0,
        startShift: null,
        endDay: 4,
        endShift: null,
        severity: 'total',
        capacityFactor: 0.0,
      };
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'failure_event',
          failureEvent: fe,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // Guard L70 filters resourceType === 'machine' → tool ignored
      // All RCCP deltas should be unchanged
      for (const r of result.rccpDeltas) {
        expect(r.baselineUtil).toBe(r.modifiedUtil);
      }
      // Deltas also unchanged (no capacity override)
      for (const d of result.deltas) {
        expect(d.baselinePlannedQty).toBe(d.modifiedPlannedQty);
      }
    });
  });

  // ── mutacoes combinadas ───────────────────────────────

  describe('mutacoes combinadas', () => {
    it('rush + demand_factor sequenciais', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'rush_order',
          toolCode: 'BWI003',
          rushQty: 5000,
          rushDay: 0,
        },
        {
          id: 'M2',
          type: 'demand_factor',
          factorToolCode: '__all__',
          factor: 1.5,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      const delta = result.deltas.find((d) => d.toolCode === 'BWI003')!;
      // Rush + factor increase → modified should be significantly higher
      expect(delta.modifiedPlannedQty).toBeGreaterThan(delta.baselinePlannedQty);
    });

    it('machine_down + failure_event mesma maquina (last write wins)', () => {
      const { engine, baseline } = getBaseline();
      const fe: FailureEvent = {
        id: 'FE1',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 0,
        startShift: null,
        endDay: 4,
        endShift: null,
        severity: 'partial',
        capacityFactor: 0.7,
      };
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'machine_down',
          machine: 'PRM039',
          downStartDay: 0,
          downEndDay: 4,
        },
        {
          id: 'M2',
          type: 'failure_event',
          failureEvent: fe,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // failure_event runs after machine_down → overwrites capacity
      // PRM039 should have 70% capacity (not zero)
      const affected = result.rccpDeltas.filter((r) => r.machine === 'PRM039');
      expect(affected.length).toBeGreaterThan(0);
      // With 70% capacity, utilization should be different from both baseline and zero
      const changed = affected.filter((r) => r.modifiedUtil !== r.baselineUtil);
      expect(changed.length).toBeGreaterThan(0);
    });
  });

  // ── completude ────────────────────────────────────────

  describe('completude', () => {
    it('deltas cobrem todas as tools do baseline', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'demand_factor',
          factorToolCode: '__all__',
          factor: 1.0,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);
      expect(result.deltas.length).toBeGreaterThanOrEqual(baseline.records.length);

      // Every baseline tool should have a delta
      for (const rec of baseline.records) {
        const delta = result.deltas.find((d) => d.toolCode === rec.toolCode);
        expect(delta).toBeDefined();
      }
    });

    it('summaryDelta.stockoutsChange correcto com factor alto', () => {
      const { engine, baseline } = getBaseline();
      // High factor to guarantee stockouts
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'demand_factor',
          factorToolCode: '__all__',
          factor: 20.0,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      // Verify stockoutsChange = modified - baseline
      const expectedChange =
        result.modified.summary.toolsWithStockout - result.baseline.summary.toolsWithStockout;
      expect(result.summaryDelta.stockoutsChange).toBe(expectedChange);
    });

    it('summaryDelta.avgUtilChange calculado correctamente', () => {
      const { engine, baseline } = getBaseline();
      const mutations: WhatIfMutation[] = [
        {
          id: 'M1',
          type: 'demand_factor',
          factorToolCode: '__all__',
          factor: 2.0,
        },
      ];

      const result = computeWhatIf(engine, mutations, baseline);

      const expectedChange =
        result.modified.summary.avgUtilization - result.baseline.summary.avgUtilization;
      expect(result.summaryDelta.avgUtilChange).toBeCloseTo(expectedChange, 5);
    });
  });
});
