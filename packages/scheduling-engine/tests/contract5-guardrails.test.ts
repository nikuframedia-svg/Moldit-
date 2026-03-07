// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Contract 5: Guard-Rail Tests
//
//  Semantic tests that pin exact twin/workforce behaviour and
//  prevent regressions on existing scheduling logic.
//
//  Sections:
//    A.1  Gémeas: co-production semantics
//    A.2  Laboral: zone/shift capacity warnings
//    A.3  Regressão: non-twin + hard constraints + coverage
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { auditCoverage } from '../src/analysis/coverage-audit.js';
import { computeWorkforceDemand } from '../src/analysis/op-demand.js';
import { validateSchedule } from '../src/analysis/validate-schedule.js';
import { computeWorkforceForecast } from '../src/analysis/workforce-forecast.js';
import { DEFAULT_OEE } from '../src/constants.js';
import { groupDemandIntoBuckets } from '../src/scheduler/demand-grouper.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import { validateTwinReferences } from '../src/transform/twin-validator.js';
import type { Block } from '../src/types/blocks.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../src/types/constraints.js';
import type { EMachine, EOp, ETool } from '../src/types/engine.js';
import type { TwinGroup } from '../src/types/twin.js';
import type { WorkforceConfig } from '../src/types/workforce.js';

// ── Shared helpers ──────────────────────────────────────────

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
    nm: 'Tool1',
    ...overrides,
  } as ETool;
}

function makeOp(overrides: Partial<EOp> & { id: string; sku: string }): EOp {
  return {
    t: 'BFP079',
    m: 'PRM019',
    nm: overrides.sku,
    d: [0, 0, 0, 0],
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
    pH: 40,
    operators: 2,
    lotEconomicDiffers: false,
    leadTimeDiffers: false,
    ...overrides,
  };
}

function makeBlock(overrides: Partial<Block>): Block {
  return {
    opId: 'OP01',
    toolId: 'BFP079',
    sku: 'SKU01',
    nm: 'SKU01',
    machineId: 'PRM019',
    origM: 'PRM019',
    dayIdx: 0,
    qty: 100,
    prodMin: 60,
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
    startMin: 420,
    endMin: 510,
    setupS: null,
    setupE: null,
    type: 'ok',
    shift: 'X',
    ...overrides,
  };
}

const testWorkforceConfig: WorkforceConfig = {
  laborGroups: {
    Grandes: [
      { start: 420, end: 930, capacity: 6 },
      { start: 930, end: 960, capacity: 6 },
      { start: 960, end: 1440, capacity: 5 },
    ],
    Medias: [
      { start: 420, end: 930, capacity: 9 },
      { start: 930, end: 960, capacity: 8 },
      { start: 960, end: 1440, capacity: 4 },
    ],
  },
  machineToLaborGroup: {
    PRM019: 'Grandes',
    PRM031: 'Grandes',
    PRM039: 'Grandes',
    PRM043: 'Grandes',
    PRM042: 'Medias',
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  A.1 — Gémeas: Semântica de co-produção
// ═══════════════════════════════════════════════════════════════════════

describe('A.1 — Gémeas: Semântica de co-produção', () => {
  it('1. Par válido 1:1 com procura desigual (A=100, B=60, pH=40)', () => {
    const tool = makeTool({ pH: 40, op: 2, lt: 1 });
    const toolMap: Record<string, ETool> = { BFP079: tool };
    const mSt: Record<string, string> = { PRM019: 'running' };
    const tSt: Record<string, string> = { BFP079: 'running' };

    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [100, 0, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [60, 0, 0, 0] }),
    ];
    const twinGroups = [makeTwinGroup({ pH: 40, operators: 2 })];

    // Demand grouping with twin merging
    const groups = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      4,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
    );

    const allSkus = groups['PRM019'].flatMap((g) => g.skus);
    const merged = allSkus.find((sk) => sk.isTwinProduction);

    // Merged bucket: totalQty = max(100, 60) = 100
    expect(merged).toBeDefined();
    expect(merged!.totalQty).toBe(100);
    expect(merged!.isTwinProduction).toBe(true);
    expect(merged!.twinOutputs).toHaveLength(2);

    // Production time: 100 pcs / 40 pH / OEE ≈ 150min / 0.66 ≈ 227min
    // But prodMin is computed as (prodQty / pH) * 60 / OEE
    const expectedProdMin = ((100 / 40) * 60) / DEFAULT_OEE;
    expect(merged!.prodMin).toBeCloseTo(expectedProdMin, 0);

    // Coverage audit with twin blocks (simulate outputs)
    const twinBlocks: Block[] = [
      makeBlock({
        opId: 'OP01',
        qty: 100,
        prodMin: expectedProdMin,
        operators: 2,
        isTwinProduction: true,
        coProductionGroupId: 'SKU_L|SKU_R',
        outputs: [
          { opId: 'OP01', sku: 'SKU_L', qty: 100 },
          { opId: 'OP02', sku: 'SKU_R', qty: 100 },
        ],
      }),
    ];
    const coverage = auditCoverage(twinBlocks, ops, toolMap, twinGroups);

    // OP01: demand=100, produced=100 → fully covered
    const row1 = coverage.rows.find((r) => r.opId === 'OP01')!;
    expect(row1.produced).toBe(100);
    expect(row1.coveragePct).toBe(100);
    expect(row1.isTwinProduction).toBe(true);
    expect(row1.twinPartnerOpId).toBe('OP02');

    // OP02: demand=60, produced=100 → excess 40 goes to stock
    const row2 = coverage.rows.find((r) => r.opId === 'OP02')!;
    expect(row2.produced).toBe(100);
    expect(row2.coveragePct).toBe(100);
    expect(row2.gap).toBe(0);
    expect(row2.isTwinProduction).toBe(true);
    expect(row2.twinPartnerOpId).toBe('OP01');
    expect(row2.twinExcessToStock).toBe(40); // 100 - 60
  });

  it('2. Par válido 1:1 com procura só de um lado (A=80, B=0) — sem co-produção', () => {
    const tool = makeTool({ pH: 40 });
    const toolMap: Record<string, ETool> = { BFP079: tool };
    const mSt: Record<string, string> = { PRM019: 'running' };
    const tSt: Record<string, string> = { BFP079: 'running' };

    const ops: EOp[] = [
      makeOp({ id: 'OP01', sku: 'SKU_L', d: [80, 0, 0, 0] }),
      makeOp({ id: 'OP02', sku: 'SKU_R', d: [0, 0, 0, 0], atr: 0 }),
    ];
    const twinGroups = [makeTwinGroup()];

    const groups = groupDemandIntoBuckets(
      ops,
      mSt,
      tSt,
      [],
      toolMap,
      undefined,
      4,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      twinGroups,
    );

    // Design decision: B has no demand → no co-production, A runs solo
    const allSkus = groups['PRM019'].flatMap((g) => g.skus);
    expect(allSkus.length).toBe(1); // only OP01 has a bucket
    expect(allSkus[0].isTwinProduction).toBeFalsy();
  });

  it('3. Par inválido — auto-referência → warning + fallback normal', () => {
    const result = validateTwinReferences([
      {
        id: 'OP01',
        sku: 'SKU_L',
        machine: 'PRM019',
        tool: 'BFP079',
        pH: 40,
        operators: 2,
        twin: 'SKU_L',
        lotEconomic: 500,
      },
    ]);

    expect(result.anomalies.length).toBeGreaterThan(0);
    expect(result.anomalies[0].code).toBe('self_reference');
    expect(result.twinGroups).toHaveLength(0); // no valid groups

    // Through scheduleAll: completes normally, no crash
    const tool = makeTool({ pH: 40, op: 2 });
    const toolMap: Record<string, ETool> = { BFP079: tool };
    const ops: EOp[] = [makeOp({ id: 'OP01', sku: 'SKU_L', d: [100, 0, 0, 0], twin: 'SKU_L' })];

    const schedResult = scheduleAll({
      ops,
      mSt: { PRM019: 'running' },
      tSt: { BFP079: 'running' },
      moves: [],
      machines: [{ id: 'PRM019', area: 'PG1', focus: false }] as EMachine[],
      toolMap,
      workdays: [true, true, true, true],
      nDays: 4,
      twinValidationReport: result,
    });

    // Scheduled as normal (not co-production)
    expect(schedResult.blocks.length).toBeGreaterThan(0);
    const okBlocks = schedResult.blocks.filter((b) => b.type === 'ok');
    expect(okBlocks.every((b) => !b.isTwinProduction)).toBe(true);

    // Decision recorded
    const twinDecisions = schedResult.decisions.filter((d) => d.type === 'TWIN_VALIDATION_ANOMALY');
    expect(twinDecisions.length).toBeGreaterThan(0);
  });

  it('4. Par inválido — ausência de recíproco → warning + fallback normal', () => {
    const result = validateTwinReferences([
      {
        id: 'OP01',
        sku: 'SKU_L',
        machine: 'PRM019',
        tool: 'BFP079',
        pH: 40,
        operators: 2,
        twin: 'SKU_R',
        lotEconomic: 500,
      },
      {
        id: 'OP02',
        sku: 'SKU_R',
        machine: 'PRM019',
        tool: 'BFP079',
        pH: 40,
        operators: 2,
        lotEconomic: 500,
      },
      // OP02 does NOT reference OP01 back (no twin field)
    ]);

    expect(result.anomalies.length).toBeGreaterThan(0);
    expect(result.anomalies.some((a) => a.code === 'one_way_link')).toBe(true);
    expect(result.twinGroups).toHaveLength(0);
  });

  it('5. Par inválido — incompatibilidade de ferramenta/máquina → warning', () => {
    const result = validateTwinReferences([
      {
        id: 'OP01',
        sku: 'SKU_L',
        machine: 'PRM019',
        tool: 'BFP079',
        pH: 40,
        operators: 2,
        twin: 'SKU_R',
        lotEconomic: 500,
      },
      {
        id: 'OP02',
        sku: 'SKU_R',
        machine: 'PRM031',
        tool: 'BFP080',
        pH: 40,
        operators: 2,
        twin: 'SKU_L',
        lotEconomic: 500,
      },
    ]);

    expect(result.anomalies.length).toBeGreaterThan(0);
    const codes = result.anomalies.map((a) => a.code);
    expect(codes.some((c) => c === 'machine_mismatch' || c === 'tool_mismatch')).toBe(true);
    expect(result.twinGroups).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  A.2 — Laboral: Capacidade por grupo laboral / janela
// ═══════════════════════════════════════════════════════════════════════

describe('A.2 — Laboral: Capacidade por grupo laboral / janela', () => {
  it('6. Grandes manhã (07:00-15:30) com carga concorrente 7 → warning (excede 6)', () => {
    // Peak model: MAX operators per machine, then SUM across group
    // PRM019 peak=4, PRM031 peak=3 → group total = 7
    const blocks: Block[] = [
      makeBlock({
        machineId: 'PRM019',
        operators: 4,
        shift: 'X',
        dayIdx: 0,
        startMin: 420,
        endMin: 510,
        opId: 'A1',
      }),
      makeBlock({
        machineId: 'PRM031',
        operators: 3,
        shift: 'X',
        dayIdx: 0,
        startMin: 420,
        endMin: 510,
        opId: 'B1',
      }),
    ];

    const result = computeWorkforceDemand(blocks, testWorkforceConfig, 1);

    // Find entry for window [420,930) capacity 6
    const bigX = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(bigX).toBeDefined();
    expect(bigX!.peakNeed).toBe(7); // 4 + 3
    expect(bigX!.capacity).toBe(6);
    expect(bigX!.overloaded).toBe(true);

    // Should appear in warnings
    expect(result.warnings.some((w) => w.laborGroup === 'Grandes' && w.windowStart === 420)).toBe(
      true,
    );
  });

  it('7. Grandes janela 16:00-00:00 com carga concorrente 7 → warning (excede 5)', () => {
    // Peak model: PRM019 peak=4, PRM031 peak=3 → group total = 7
    // Window [960,1440) has capacity 5
    const blocks: Block[] = [
      makeBlock({
        machineId: 'PRM019',
        operators: 4,
        shift: 'Y',
        dayIdx: 0,
        startMin: 960,
        endMin: 1020,
        opId: 'A1',
      }),
      makeBlock({
        machineId: 'PRM031',
        operators: 3,
        shift: 'Y',
        dayIdx: 0,
        startMin: 960,
        endMin: 1020,
        opId: 'B1',
      }),
    ];

    const result = computeWorkforceDemand(blocks, testWorkforceConfig, 1);

    // Find the entry for window [960,1440) — capacity 5
    const bigY = result.entries.find(
      (e) => e.laborGroup === 'Grandes' && e.windowStart === 960 && e.dayIdx === 0,
    );
    expect(bigY).toBeDefined();
    expect(bigY!.peakNeed).toBe(7);
    expect(bigY!.capacity).toBe(5);
    expect(bigY!.overloaded).toBe(true);

    expect(result.warnings.some((w) => w.laborGroup === 'Grandes' && w.windowStart === 960)).toBe(
      true,
    );
  });

  it('8. Medias manhã (07:00-15:30) com carga concorrente 5 → sem warning (cap=9)', () => {
    // Peak model: PRM042 peak=5 → group total = 5 (< capacity 9)
    const blocks: Block[] = [
      makeBlock({
        machineId: 'PRM042',
        operators: 5,
        shift: 'X',
        dayIdx: 0,
        startMin: 420,
        endMin: 510,
        opId: 'C1',
      }),
    ];

    const result = computeWorkforceDemand(blocks, testWorkforceConfig, 1);

    // Find entry for window [420,930) capacity 9
    const medX = result.entries.find(
      (e) => e.laborGroup === 'Medias' && e.windowStart === 420 && e.dayIdx === 0,
    );
    expect(medX).toBeDefined();
    expect(medX!.peakNeed).toBe(5);
    expect(medX!.capacity).toBe(9);
    expect(medX!.overloaded).toBe(false);

    // Should NOT appear in warnings
    expect(result.warnings.some((w) => w.laborGroup === 'Medias' && w.windowStart === 420)).toBe(
      false,
    );
  });

  it('9. D+1 com overload → warning D+1 obrigatório', () => {
    // Peak model: PRM019 peak=4, PRM031 peak=3 → zone total 7 > capacity 6
    const blocks: Block[] = [
      makeBlock({ machineId: 'PRM019', operators: 4, shift: 'X', dayIdx: 1, opId: 'A1' }),
      makeBlock({ machineId: 'PRM031', operators: 3, shift: 'X', dayIdx: 1, opId: 'B1' }),
    ];
    const toolMap: Record<string, ETool> = { BFP079: makeTool() };

    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testWorkforceConfig,
      workdays: [true, true, true, true],
      dates: ['01/01', '02/01', '03/01', '04/01'],
      toolMap,
    });

    expect(forecast.hasWarnings).toBe(true);
    expect(forecast.warnings.length).toBeGreaterThan(0);
    expect(forecast.warnings[0].dayIdx).toBe(1); // D+1
    expect(forecast.warnings[0].causingBlocks.length).toBeGreaterThan(0);
    expect(forecast.warnings[0].suggestions.some((s) => s.type === 'REQUEST_REINFORCEMENT')).toBe(
      true,
    );
  });

  it('10. Fim-de-semana — "amanhã" = próximo dia útil, não calendário', () => {
    // Day 0 = Friday, days 1-2 = weekend (not working), day 3 = Monday
    const workdays = [true, false, false, true, true];
    const dates = ['Sex 03/01', 'Sáb 04/01', 'Dom 05/01', 'Seg 06/01', 'Ter 07/01'];

    // Peak model: PRM019 peak=4, PRM031 peak=3 → zone total 7 > capacity 6
    const blocks: Block[] = [
      makeBlock({ machineId: 'PRM019', operators: 4, shift: 'X', dayIdx: 3, opId: 'A1' }),
      makeBlock({ machineId: 'PRM031', operators: 3, shift: 'X', dayIdx: 3, opId: 'B1' }),
    ];
    const toolMap: Record<string, ETool> = { BFP079: makeTool() };

    const forecast = computeWorkforceForecast({
      blocks,
      workforceConfig: testWorkforceConfig,
      workdays,
      dates,
      toolMap,
    });

    // D+1 = day 3 (Monday), NOT day 1 (Saturday)
    expect(forecast.nextWorkingDayIdx).toBe(3);
    expect(forecast.date).toBe('Seg 06/01');
    expect(forecast.hasWarnings).toBe(true);
    expect(forecast.warnings[0].dayIdx).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  A.3 — Regressão
// ═══════════════════════════════════════════════════════════════════════

describe('A.3 — Regressão', () => {
  // Shared inline data for regression tests
  const machines: EMachine[] = [
    { id: 'PRM019', area: 'PG1', focus: false },
    { id: 'PRM031', area: 'PG1', focus: false },
    { id: 'PRM042', area: 'PG2', focus: false },
  ] as EMachine[];
  const regToolMap: Record<string, ETool> = {
    T001: makeTool({ id: 'T001', m: 'PRM019', alt: 'PRM031', pH: 40, sH: 0.5, op: 2 }),
    T002: makeTool({ id: 'T002', m: 'PRM042', alt: '-', pH: 60, sH: 0.3, op: 3 }),
  };
  const regOps: EOp[] = [
    makeOp({ id: 'OP01', sku: 'SKU_A', t: 'T001', m: 'PRM019', d: [100, 50, 0, 0] }),
    makeOp({ id: 'OP02', sku: 'SKU_B', t: 'T002', m: 'PRM042', d: [80, 40, 0, 0] }),
  ];
  const regMSt: Record<string, string> = {
    PRM019: 'running',
    PRM031: 'running',
    PRM042: 'running',
  };
  const regTSt: Record<string, string> = { T001: 'running', T002: 'running' };

  it('11. Operações normais sem gémeas → comportamento anterior mantido', () => {
    const result = scheduleAll({
      ops: regOps,
      mSt: regMSt,
      tSt: regTSt,
      moves: [],
      machines,
      toolMap: regToolMap,
      workdays: [true, true, true, true],
      nDays: 4,
    });

    // All ops with demand should have blocks
    const okBlocks = result.blocks.filter((b) => b.type === 'ok');
    const opsWithBlocks = new Set(okBlocks.map((b) => b.opId));
    expect(opsWithBlocks.has('OP01')).toBe(true);
    expect(opsWithBlocks.has('OP02')).toBe(true);

    // No twin decisions
    const twinDecisions = result.decisions.filter((d) => d.type === 'TWIN_VALIDATION_ANOMALY');
    expect(twinDecisions).toHaveLength(0);

    // No blocks marked as twin co-production
    expect(okBlocks.every((b) => !b.isTwinProduction)).toBe(true);
  });

  it('12. Hard constraints antigas continuam intactas', () => {
    const result = scheduleAll({
      ops: regOps,
      mSt: regMSt,
      tSt: regTSt,
      moves: [],
      machines,
      toolMap: regToolMap,
      workdays: [true, true, true, true],
      nDays: 4,
      constraintConfig: { ...DEFAULT_CONSTRAINT_CONFIG },
    });

    const report = validateSchedule(result.blocks, machines, regToolMap, regOps);

    // No tool uniqueness violations
    expect(report.summary.toolConflicts).toBe(0);
    // No setup overlap violations
    expect(report.summary.setupOverlaps).toBe(0);
    // No machine overcapacity
    expect(report.summary.machineOvercapacity).toBe(0);

    // Twin summary should be 0 (no twin blocks)
    expect(report.summary.twinBlocks).toBe(0);
    expect(report.summary.twinGroups).toBe(0);
  });

  it('13. Coverage audit fecha para operações não-gémeas', () => {
    const result = scheduleAll({
      ops: regOps,
      mSt: regMSt,
      tSt: regTSt,
      moves: [],
      machines,
      toolMap: regToolMap,
      workdays: [true, true, true, true],
      nDays: 4,
    });

    const coverage = auditCoverage(result.blocks, regOps, regToolMap);

    // All operations should be covered (or at least have production)
    for (const row of coverage.rows) {
      if (row.totalDemand > 0) {
        expect(row.produced).toBeGreaterThan(0);
      }
      // No twin flags on non-twin ops
      expect(row.isTwinProduction).toBeUndefined();
      expect(row.twinPartnerOpId).toBeUndefined();
      expect(row.twinExcessToStock).toBeUndefined();
    }
  });
});
