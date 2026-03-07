// =====================================================================
//  INCOMPOL PLAN -- Twin Validator Tests
//  Validates Peças Gémeas 1:1 pair detection and anomaly classification
//
//  Rules:
//    MUST match: machine, tool, pH, operators
//    CAN differ: lotEconomic, ltDays
//    Invalid → single-SKU + warning (no TwinGroup created)
// =====================================================================

import { describe, expect, it } from 'vitest';
import {
  type TwinValidationInput,
  validateTwinReferences,
} from '../src/transform/twin-validator.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeOp(
  overrides: Partial<TwinValidationInput> & { id: string; sku: string },
): TwinValidationInput {
  return {
    machine: 'PRM019',
    tool: 'BFP079',
    pH: 100,
    operators: 1,
    ltDays: 5,
    lotEconomic: 500,
    ...overrides,
  };
}

// ── Valid Twin Pairs ─────────────────────────────────────────────────

describe('Valid Twin Pairs', () => {
  it('should create TwinGroup for reciprocal valid pair', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: 'SKU_R' }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.totalTwinRefs).toBe(2);
    expect(report.validGroups).toBe(1);
    expect(report.invalidRefs).toBe(0);
    expect(report.anomalies).toHaveLength(0);
    expect(report.twinGroups).toHaveLength(1);

    const g = report.twinGroups[0];
    expect(g.sku1).toBe('SKU_L');
    expect(g.sku2).toBe('SKU_R');
    expect(g.machine).toBe('PRM019');
    expect(g.tool).toBe('BFP079');
    expect(g.pH).toBe(100);
    expect(g.operators).toBe(1);
    expect(g.lotEconomicDiffers).toBe(false);
    expect(g.leadTimeDiffers).toBe(false);
  });

  it('should allow different lot economic qty', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: 'SKU_R', lotEconomic: 500 }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L', lotEconomic: 1000 }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(1);
    expect(report.twinGroups[0].lotEconomicDiffers).toBe(true);
  });

  it('should allow different lead time days', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: 'SKU_R', ltDays: 3 }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L', ltDays: 7 }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(1);
    expect(report.twinGroups[0].leadTimeDiffers).toBe(true);
  });
});

// ── Anomaly Detection ────────────────────────────────────────────────

describe('Anomaly Detection', () => {
  it('should detect self_reference', () => {
    const ops: TwinValidationInput[] = [makeOp({ id: 'OP01', sku: 'SKU_A', twin: 'SKU_A' })];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(0);
    expect(report.invalidRefs).toBe(1);
    expect(report.anomalies[0].code).toBe('self_reference');
    expect(report.anomalies[0].opId).toBe('OP01');
    expect(report.anomalies[0].sku).toBe('SKU_A');
    expect(report.anomalies[0].twinSku).toBe('SKU_A');
    expect(report.byCode).toEqual({ self_reference: 1 });
  });

  it('should detect one_way_link (A→B but B has no twin)', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_A', twin: 'SKU_B' }),
      makeOp({ id: 'OP02', sku: 'SKU_B' }), // no twin reference back
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(0);
    expect(report.invalidRefs).toBe(1);
    expect(report.anomalies[0].code).toBe('one_way_link');
    expect(report.anomalies[0].counterpartMachine).toBe('PRM019');
  });

  it('should detect one_way_link (A→B but B→C)', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_A', twin: 'SKU_B' }),
      makeOp({ id: 'OP02', sku: 'SKU_B', twin: 'SKU_C' }),
      makeOp({ id: 'OP03', sku: 'SKU_C', twin: 'SKU_B' }),
    ];

    const report = validateTwinReferences(ops);

    // A→B fails (one_way), B↔C valid
    expect(report.anomalies.some((a) => a.code === 'one_way_link' && a.sku === 'SKU_A')).toBe(true);
    expect(
      report.twinGroups.some(
        (g) =>
          (g.sku1 === 'SKU_B' && g.sku2 === 'SKU_C') || (g.sku1 === 'SKU_C' && g.sku2 === 'SKU_B'),
      ),
    ).toBe(true);
  });

  it('should detect counterpart_missing', () => {
    const ops: TwinValidationInput[] = [makeOp({ id: 'OP01', sku: 'SKU_A', twin: 'SKU_GHOST' })];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(0);
    expect(report.invalidRefs).toBe(1);
    expect(report.anomalies[0].code).toBe('counterpart_missing');
    expect(report.anomalies[0].twinSku).toBe('SKU_GHOST');
  });

  it('should detect machine_mismatch', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: 'SKU_R', machine: 'PRM019' }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L', machine: 'PRM031' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(0);
    expect(report.invalidRefs).toBe(1);
    expect(report.anomalies[0].code).toBe('machine_mismatch');
    expect(report.anomalies[0].machine).toBe('PRM019');
    expect(report.anomalies[0].counterpartMachine).toBe('PRM031');
  });

  it('should detect tool_mismatch', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: 'SKU_R', tool: 'BFP079' }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L', tool: 'BFP080' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(0);
    expect(report.invalidRefs).toBe(1);
    expect(report.anomalies[0].code).toBe('tool_mismatch');
    expect(report.anomalies[0].counterpartTool).toBe('BFP080');
  });

  it('should detect rate_mismatch', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: 'SKU_R', pH: 100 }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L', pH: 150 }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(0);
    expect(report.invalidRefs).toBe(1);
    expect(report.anomalies[0].code).toBe('rate_mismatch');
  });

  it('should detect people_mismatch', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: 'SKU_R', operators: 1 }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L', operators: 2 }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(0);
    expect(report.invalidRefs).toBe(1);
    expect(report.anomalies[0].code).toBe('people_mismatch');
  });
});

// ── Multiple Pairs ───────────────────────────────────────────────────

describe('Multiple Pairs', () => {
  it('should validate multiple independent twin pairs', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_A_L', twin: 'SKU_A_R' }),
      makeOp({ id: 'OP02', sku: 'SKU_A_R', twin: 'SKU_A_L' }),
      makeOp({ id: 'OP03', sku: 'SKU_B_L', twin: 'SKU_B_R', machine: 'PRM042', tool: 'TMK012' }),
      makeOp({ id: 'OP04', sku: 'SKU_B_R', twin: 'SKU_B_L', machine: 'PRM042', tool: 'TMK012' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.totalTwinRefs).toBe(4);
    expect(report.validGroups).toBe(2);
    expect(report.invalidRefs).toBe(0);
  });

  it('should handle mix of valid and invalid refs', () => {
    const ops: TwinValidationInput[] = [
      // Valid pair
      makeOp({ id: 'OP01', sku: 'SKU_A_L', twin: 'SKU_A_R' }),
      makeOp({ id: 'OP02', sku: 'SKU_A_R', twin: 'SKU_A_L' }),
      // Invalid: counterpart missing
      makeOp({ id: 'OP03', sku: 'SKU_B_L', twin: 'SKU_B_R' }),
      // Invalid: self reference
      makeOp({ id: 'OP04', sku: 'SKU_C', twin: 'SKU_C' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(1);
    expect(report.invalidRefs).toBe(2);
    expect(report.anomalies.some((a) => a.code === 'counterpart_missing')).toBe(true);
    expect(report.anomalies.some((a) => a.code === 'self_reference')).toBe(true);
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('should handle empty ops array', () => {
    const report = validateTwinReferences([]);

    expect(report.totalTwinRefs).toBe(0);
    expect(report.validGroups).toBe(0);
    expect(report.invalidRefs).toBe(0);
    expect(report.anomalies).toHaveLength(0);
    expect(report.twinGroups).toHaveLength(0);
  });

  it('should handle ops with no twin references', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_A' }),
      makeOp({ id: 'OP02', sku: 'SKU_B' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.totalTwinRefs).toBe(0);
    expect(report.validGroups).toBe(0);
  });

  it('should ignore whitespace-only twin fields', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_A', twin: '  ' }),
      makeOp({ id: 'OP02', sku: 'SKU_B', twin: '' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.totalTwinRefs).toBe(0);
  });

  it('should not process same pair twice (canonical key)', () => {
    // Both ops reference each other — should produce exactly 1 TwinGroup
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: 'SKU_R' }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.twinGroups).toHaveLength(1);
    expect(report.anomalies).toHaveLength(0);
  });

  it('should handle twin with leading/trailing whitespace', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: ' SKU_R ' }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(1);
  });

  it('validates pair when multiple ops exist for same SKU (multi-client)', () => {
    // BFP079 scenario: OP01 has correct twin, OP87 has self-reference,
    // OP02 has correct twin, OP88 has no twin
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_A', twin: 'SKU_B' }),
      makeOp({ id: 'OP02', sku: 'SKU_B', twin: 'SKU_A' }),
      makeOp({ id: 'OP87', sku: 'SKU_A', twin: 'SKU_A' }), // self-reference
      makeOp({ id: 'OP88', sku: 'SKU_B' }), // no twin
    ];

    const report = validateTwinReferences(ops);

    // The validator should find OP01↔OP02 as valid pair
    expect(report.validGroups).toBe(1);
    expect(report.twinGroups[0].sku1).toBe('SKU_A');
    expect(report.twinGroups[0].sku2).toBe('SKU_B');
    // Self-reference from OP87 should be an anomaly
    expect(report.anomalies.some((a) => a.code === 'self_reference')).toBe(true);
  });

  it('validates pair when correct ops are last in array (overwrite scenario)', () => {
    // Reverse order: bad ops first, correct ops last
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP87', sku: 'SKU_A', twin: 'SKU_A' }), // self-reference
      makeOp({ id: 'OP88', sku: 'SKU_B' }), // no twin
      makeOp({ id: 'OP01', sku: 'SKU_A', twin: 'SKU_B' }),
      makeOp({ id: 'OP02', sku: 'SKU_B', twin: 'SKU_A' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(1);
    expect(report.twinGroups[0].sku1).toBe('SKU_A');
    expect(report.twinGroups[0].sku2).toBe('SKU_B');
  });
});

// ── Multi-Client Twin Pairs ─────────────────────────────────────────

describe('Multi-Client Twin Pairs', () => {
  it('should create 2 TwinGroups for same SKU pair with 2 clients', () => {
    // BFP178 scenario: OP22+OP23 (client 1), OP65+OP66 (client 2)
    // Same SKU pair (SKU_L, SKU_R), different operations
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP22', sku: 'SKU_L', twin: 'SKU_R' }),
      makeOp({ id: 'OP23', sku: 'SKU_R', twin: 'SKU_L' }),
      makeOp({ id: 'OP65', sku: 'SKU_L', twin: 'SKU_R' }),
      makeOp({ id: 'OP66', sku: 'SKU_R', twin: 'SKU_L' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.totalTwinRefs).toBe(4);
    expect(report.validGroups).toBe(2);
    expect(report.invalidRefs).toBe(0);
    expect(report.anomalies).toHaveLength(0);
    expect(report.twinGroups).toHaveLength(2);

    // Each group should pair different operations
    const opIds = report.twinGroups.flatMap((g) => [g.opId1, g.opId2]);
    expect(new Set(opIds).size).toBe(4); // all 4 ops used exactly once
  });

  it('should create 3 TwinGroups for same SKU pair with 3 clients', () => {
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', twin: 'SKU_R' }),
      makeOp({ id: 'OP02', sku: 'SKU_R', twin: 'SKU_L' }),
      makeOp({ id: 'OP03', sku: 'SKU_L', twin: 'SKU_R' }),
      makeOp({ id: 'OP04', sku: 'SKU_R', twin: 'SKU_L' }),
      makeOp({ id: 'OP05', sku: 'SKU_L', twin: 'SKU_R' }),
      makeOp({ id: 'OP06', sku: 'SKU_R', twin: 'SKU_L' }),
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(3);
    expect(report.invalidRefs).toBe(0);
    expect(report.twinGroups).toHaveLength(3);

    // All 6 ops used exactly once
    const opIds = report.twinGroups.flatMap((g) => [g.opId1, g.opId2]);
    expect(new Set(opIds).size).toBe(6);
  });

  it('should handle multi-client mix with anomalies', () => {
    // 2 valid pairs + 1 self-reference + 1 counterpart missing
    const ops: TwinValidationInput[] = [
      makeOp({ id: 'OP22', sku: 'SKU_L', twin: 'SKU_R' }),
      makeOp({ id: 'OP23', sku: 'SKU_R', twin: 'SKU_L' }),
      makeOp({ id: 'OP65', sku: 'SKU_L', twin: 'SKU_R' }),
      makeOp({ id: 'OP66', sku: 'SKU_R', twin: 'SKU_L' }),
      makeOp({ id: 'OP87', sku: 'SKU_L', twin: 'SKU_L' }), // self-reference
      makeOp({ id: 'OP99', sku: 'SKU_X', twin: 'SKU_GHOST' }), // counterpart missing
    ];

    const report = validateTwinReferences(ops);

    expect(report.validGroups).toBe(2);
    expect(report.invalidRefs).toBe(2);
    expect(report.anomalies.some((a) => a.code === 'self_reference')).toBe(true);
    expect(report.anomalies.some((a) => a.code === 'counterpart_missing')).toBe(true);
  });
});
