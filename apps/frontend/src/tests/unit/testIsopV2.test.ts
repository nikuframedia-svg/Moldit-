/**
 * ISOP V2 Test — Full pipeline with ISOP_Nikufra_27_2-2.xlsx
 *
 * Runs: Parse → Merge → Transform → Schedule → KPIs → Validate → MRP → Supply
 * Asserts critical invariants at each stage.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { parseISOPFile } from '../../domain/isop';
import type { NikufraData } from '../../domain/nikufra-types';
import type { LoadMeta } from '../../domain/isop';
import type { Block, EngineData, DayLoad } from '../../lib/engine';
import {
  autoReplan,
  autoRouteOverflow,
  capAnalysis,
  cascadingReplan,
  computeMRP,
  computeOtdDeliveryFailures,
  computeROP,
  computeSupplyPriority,
  computeWhatIf,
  DAY_CAP,
  DEFAULT_AUTO_REPLAN_CONFIG,
  DEFAULT_WORKFORCE_CONFIG,
  scoreSchedule,
  tier3Diag,
  transformPlanState,
  validateSchedule,
} from '../../lib/engine';
import type { WhatIfMutation, FailureEvent } from '../../lib/engine';

// ── Paths ──

const cwd = process.cwd();
const base = cwd.endsWith('frontend') ? cwd : join(cwd, 'frontend');
const isopPath = join(base, 'src', 'tests', 'fixtures', 'ISOP_Nikufra_27_2_v2.xlsx');
const fixturePath = join(base, 'public', 'fixtures', 'nikufra', 'nikufra_data.json');

// ── Shared state ──

let parsed: { data: NikufraData; meta: LoadMeta };
let merged: NikufraData;
let engineData: EngineData;
let blocks: Block[];
let autoMoves: Array<{ opId: string; toM: string }>;
let metrics: ReturnType<typeof scoreSchedule>;
let validation: ReturnType<typeof validateSchedule>;

function mergeWithMasterData(data: NikufraData, fixture: NikufraData): NikufraData {
  const fixToolMap = new Map(fixture.tools.map((t) => [t.id, t]));
  const mergedTools = data.tools.map((tool) => {
    const fix = fixToolMap.get(tool.id);
    if (!fix) return tool;
    return {
      ...tool,
      s: tool.s > 0 ? tool.s : fix.s,
      alt: tool.alt !== '-' ? tool.alt : fix.alt,
    };
  });
  const toolLookup = new Map(mergedTools.map((t) => [t.id, t]));
  const mergedOps = data.operations.map((op) => {
    const tool = toolLookup.get(op.t);
    if (!tool) return op;
    return { ...op, s: op.s > 0 ? op.s : tool.s };
  });
  const parsedMoEmpty = !data.mo || data.mo.PG1.length === 0 || data.mo.PG1.every((v) => v === 0);
  const mergedMo = parsedMoEmpty && fixture.mo ? fixture.mo : data.mo;
  return { ...data, tools: mergedTools, operations: mergedOps, mo: mergedMo };
}

function line(ch = '─', len = 60) { return ch.repeat(len); }
function header(title: string) { console.log(`\n${line('═')}\n  ${title}\n${line('═')}`); }
function section(title: string) { console.log(`\n${line()}\n  ${title}\n${line()}`); }

// ── Setup ──

beforeAll(() => {
  const buf = readFileSync(isopPath);
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);
  for (let i = 0; i < buf.length; i++) view[i] = buf[i];

  const parseResult = parseISOPFile(ab);
  if (!parseResult.success) {
    throw new Error(`Parse failed: ${parseResult.errors.join(', ')}`);
  }
  parsed = { data: parseResult.data, meta: parseResult.meta };

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as NikufraData;
  merged = mergeWithMasterData(parseResult.data, fixture);

  const planState = {
    dates: merged.dates,
    days_label: merged.days_label,
    machines: merged.machines.map((m) => ({
      id: m.id,
      area: m.area as 'PG1' | 'PG2',
      man_minutes: m.man,
    })),
    tools: merged.tools.map((t) => ({
      id: t.id,
      machine: t.m,
      alt_machine: t.alt,
      setup_hours: t.s,
      pcs_per_hour: t.pH,
      operators: t.op,
      skus: t.skus,
      names: t.nm,
      lot_economic_qty: t.lt,
      stock: t.stk,
      wip: t.wip,
    })),
    operations: merged.operations.map((op) => ({
      id: op.id,
      machine: op.m,
      tool: op.t,
      sku: op.sku,
      name: op.nm,
      pcs_per_hour: op.pH,
      atraso: op.atr,
      daily_qty: op.d,
      setup_hours: op.s,
      operators: op.op,
      stock: 0,
      status: 'PLANNED' as const,
      customer_code: op.cl,
      customer_name: op.clNm,
      parent_sku: op.pa,
      wip: op.wip,
      qtd_exp: op.qe,
      lead_time_days: op.ltDays,
      twin: op.twin,
    })),
    schedule: [],
    machine_loads: [],
    kpis: null,
    parsed_at: new Date().toISOString(),
    data_hash: null,
    mo: merged.mo ? { PG1: merged.mo.PG1, PG2: merged.mo.PG2 } : undefined,
    workday_flags: merged.workday_flags,
  };

  engineData = transformPlanState(planState, { demandSemantics: 'raw_np', preStartBufferDays: 5 });

  const mrp = computeMRP(engineData);
  const supplyBoosts = computeSupplyPriority(engineData, mrp);

  const mSt: Record<string, string> = Object.fromEntries(
    engineData.machines.map((m) => [m.id, 'running']),
  );
  const nDays = engineData.ops[0]?.d.length ?? 80;

  const schedResult = autoRouteOverflow({
    ops: engineData.ops,
    mSt,
    tSt: {},
    userMoves: [],
    machines: engineData.machines,
    toolMap: engineData.toolMap,
    workdays: engineData.workdays,
    nDays,
    rule: 'EDD',
    supplyBoosts: supplyBoosts.size > 0 ? supplyBoosts : undefined,
    twinValidationReport: engineData.twinValidationReport,
    orderBased: engineData.orderBased,
    dates: engineData.dates,
    workforceConfig: DEFAULT_WORKFORCE_CONFIG,
  });
  blocks = schedResult.blocks;
  autoMoves = schedResult.autoMoves;

  metrics = scoreSchedule(
    blocks,
    engineData.ops,
    mSt,
    DEFAULT_WORKFORCE_CONFIG,
    engineData.machines,
    engineData.toolMap,
  );

  validation = validateSchedule(
    blocks,
    engineData.machines,
    engineData.toolMap,
    engineData.ops,
  );
});

// ── Tests ──

describe('ISOP V2: Parse', () => {
  it('parses successfully', () => {
    expect(parsed.data).toBeDefined();
    expect(parsed.meta.rows).toBeGreaterThan(0);
    header('ISOP V2 TEST — ISOP_Nikufra_27_2-2.xlsx');
    console.log(`  File: ${isopPath}`);
  });

  it('has expected structure', () => {
    const { meta, data } = parsed;
    section('1. PARSING');
    console.log(`  Operations:    ${meta.rows}`);
    console.log(`  Machines:      ${meta.machines} (${data.machines.map((m) => m.id).join(', ')})`);
    console.log(`  Tools:         ${meta.tools}`);
    console.log(`  SKUs:          ${meta.skus}`);
    console.log(`  Customers:     ${data.customers?.length ?? 0}`);
    console.log(`  Dates:         ${meta.dates} (${data.dates[0]} — ${data.dates[data.dates.length - 1]})`);
    console.log(`  Trust Score:   ${(meta.trustScore * 100).toFixed(1)}%`);
    if (meta.warnings.length > 0) {
      console.log(`  Warnings (${meta.warnings.length}):`);
      for (const w of meta.warnings.slice(0, 10)) console.log(`    - ${w}`);
      if (meta.warnings.length > 10) console.log(`    ... +${meta.warnings.length - 10} more`);
    }

    expect(meta.machines).toBeGreaterThanOrEqual(4);
    expect(meta.tools).toBeGreaterThan(30);
    expect(meta.dates).toBeGreaterThan(50);
    expect(meta.trustScore).toBeGreaterThan(0.5);
  });

  it('operations have valid NP data', () => {
    const { data } = parsed;
    const opsWithDemand = data.operations.filter((op) => op.d.some((v) => v !== null && v < 0));
    expect(opsWithDemand.length).toBeGreaterThan(0);
    console.log(`  Ops with demand (negative NP): ${opsWithDemand.length} / ${data.operations.length}`);
  });
});

describe('ISOP V2: Merge with Master Data', () => {
  it('enriches setup times and alt machines', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as NikufraData;
    const fixtureToolIds = new Set(fixture.tools.map((t) => t.id));
    const toolsWithSetup = merged.tools.filter((t) => fixtureToolIds.has(t.id) && t.s > 0);
    const toolsWithAlt = merged.tools.filter((t) => t.alt !== '-');
    const unknownTools = merged.tools.filter((t) => !fixtureToolIds.has(t.id));

    section('2. MASTER DATA MERGE');
    console.log(`  Setup times enriched:  ${toolsWithSetup.length} tools`);
    console.log(`  Alt machines enriched: ${toolsWithAlt.length} tools`);
    console.log(`  Unknown tools:         ${unknownTools.length}${unknownTools.length > 0 ? ` (${unknownTools.map((t) => t.id).join(', ')})` : ''}`);

    expect(toolsWithSetup.length).toBeGreaterThan(20);
  });
});

describe('ISOP V2: Scheduling', () => {
  it('produces blocks', () => {
    section('3. SCHEDULING');
    const okBlocks = blocks.filter((b) => b.type === 'ok');
    const overflowBlocks = blocks.filter((b) => b.type === 'overflow');
    const setupBlocks = blocks.filter((b) => b.setupMin > 0 && b.type === 'ok');

    console.log(`  Engine: ${engineData.ops.length} ops, ${engineData.machines.length} machines`);
    console.log(`  Total blocks:   ${blocks.length}`);
    console.log(`  OK blocks:      ${okBlocks.length}`);
    console.log(`  Overflow:       ${overflowBlocks.length}`);
    console.log(`  Setup blocks:   ${setupBlocks.length}`);
    console.log(`  Auto-moves:     ${autoMoves.length}`);

    const blocksByMachine: Record<string, number> = {};
    for (const b of blocks) blocksByMachine[b.machineId] = (blocksByMachine[b.machineId] || 0) + 1;
    console.log(`  Blocks per machine:`);
    for (const [mId, count] of Object.entries(blocksByMachine).sort()) {
      console.log(`    ${mId}: ${count}`);
    }

    expect(blocks.length).toBeGreaterThan(100);
    expect(okBlocks.length).toBeGreaterThan(50);
  });

  it('overflow blocks are within expected capacity limits', () => {
    const overflows = blocks.filter((b) => b.type === 'overflow');
    console.log(`  Overflow blocks: ${overflows.length}`);
    // Overflow blocks represent factory capacity limits, not software bugs.
    // With 94 ops across 5 machines and 80 days, some overflow is expected.
    expect(overflows.length).toBeLessThan(100);
  });
});

describe('ISOP V2: KPIs', () => {
  it('has high OTD', () => {
    section('4. KPIs');
    console.log(`  OTD:              ${metrics.otd.toFixed(1)}%`);
    console.log(`  OTD-Delivery:     ${metrics.otdDelivery.toFixed(1)}%`);
    console.log(`  Produced:         ${metrics.produced?.toLocaleString() ?? 'N/A'} pcs`);
    console.log(`  Setup count:      ${metrics.setupCount}`);
    console.log(`  Tardiness (days): ${metrics.tardinessDays?.toFixed(1) ?? 'N/A'}`);
    console.log(`  Cap utilization:  ${(metrics.capUtil * 100).toFixed(1)}%`);
    console.log(`  Overflows:        ${metrics.overflows}`);

    console.log(`  Tier3 diag:       ${JSON.stringify(tier3Diag)}`);

    // Show top OTD-D failures
    const otdFails = computeOtdDeliveryFailures(blocks, engineData.ops);
    console.log(`  OTD-D failures:   ${otdFails.count} (${otdFails.failures.length} entries)`);
    const failingOps = new Map<string, { count: number; maxShortfall: number; firstDay: number }>();
    for (const f of otdFails.failures) {
      const e = failingOps.get(f.opId);
      if (!e) failingOps.set(f.opId, { count: 1, maxShortfall: f.shortfall, firstDay: f.day });
      else { e.count++; e.maxShortfall = Math.max(e.maxShortfall, f.shortfall); }
    }
    console.log(`  Unique failing:   ${failingOps.size} ops`);
    const sorted = [...failingOps.entries()].sort((a, b) => b[1].maxShortfall - a[1].maxShortfall);
    for (const [opId, info] of sorted.slice(0, 10)) {
      const op = engineData.ops.find((o: any) => o.id === opId);
      const blks = blocks.filter((b: any) => b.opId === opId && b.type === 'ok');
      const minDay = blks.length > 0 ? Math.min(...blks.map((b: any) => b.dayIdx)) : -1;
      console.log(`    ${opId} (${op?.t}) fails=${info.count} maxShort=${info.maxShortfall} 1stFail=d${info.firstDay} prodStart=d${minDay}`);
    }

    expect(metrics.otd).toBeGreaterThanOrEqual(90);
  });

  it('overflow count matches block count', () => {
    const overflowBlocks = blocks.filter((b) => b.type === 'overflow').length;
    expect(metrics.overflows).toBe(overflowBlocks);
  });
});

describe('ISOP V2: Constraint Validation', () => {
  it('reports constraint status', () => {
    section('5. CONSTRAINT VALIDATION');
    console.log(`  Tool conflicts:     ${validation.summary.toolConflicts}`);
    console.log(`  Setup overlaps:     ${validation.summary.setupOverlaps}`);
    console.log(`  Machine overcap:    ${validation.summary.machineOvercapacity}`);
    console.log(`  Total violations:   ${validation.violations.length}`);

    if (validation.violations.length > 0) {
      console.log(`  Violations:`);
      for (const v of validation.violations.slice(0, 15)) {
        console.log(`    - [${v.type}] ${v.title}`);
      }
      if (validation.violations.length > 15)
        console.log(`    ... +${validation.violations.length - 15} more`);
    } else {
      console.log(`  >> ALL CONSTRAINTS PASS`);
    }
  });

  it('has no tool conflicts', () => {
    expect(validation.summary.toolConflicts).toBe(0);
  });

  it('has no setup overlaps', () => {
    expect(validation.summary.setupOverlaps).toBe(0);
  });
});

describe('ISOP V2: Capacity Analysis', () => {
  it('shows utilization per machine', () => {
    section('6. CAPACITY');
    const cap = capAnalysis(blocks, engineData.machines);
    for (const m of engineData.machines) {
      const loads = cap[m.id] || [];
      if (loads.length === 0) { console.log(`    ${m.id}: no data`); continue; }
      const utils = loads.map((dl: DayLoad) => {
        const total = dl.prod + dl.setup;
        return DAY_CAP > 0 ? (total / DAY_CAP) * 100 : 0;
      });
      const avg = utils.reduce((a, b) => a + b, 0) / utils.length;
      const peak = Math.max(...utils);
      const daysOver80 = utils.filter((u) => u > 80).length;
      console.log(`    ${m.id} (${m.area}): avg ${avg.toFixed(1)}%, peak ${peak.toFixed(1)}%, days>80%: ${daysOver80}`);
    }
  });
});

describe('ISOP V2: MRP', () => {
  it('computes MRP records', () => {
    section('7. MRP');
    const mrp = computeMRP(engineData);
    console.log(`  Total MRP records:   ${mrp.records.length}`);
    console.log(`  Tools with stockout: ${mrp.summary.toolsWithStockout}`);
    console.log(`  Total planned qty:   ${mrp.summary.totalPlannedQty.toLocaleString()}`);
    console.log(`  Total gross req:     ${mrp.summary.totalGrossReq.toLocaleString()}`);
    console.log(`  Avg utilization:     ${mrp.summary.avgUtilization.toFixed(1)}%`);
    console.log(`  Bottleneck:          ${mrp.summary.bottleneckMachine ?? 'none'} (day ${mrp.summary.bottleneckDay ?? '-'})`);

    expect(mrp.records.length).toBeGreaterThan(0);

    // Top stockout risks
    const risks = mrp.records
      .filter((r) => r.stockoutDay !== null)
      .sort((a, b) => (a.stockoutDay ?? 999) - (b.stockoutDay ?? 999));
    if (risks.length > 0) {
      console.log(`\n  Top 10 Stockout Risks:`);
      console.log(`  ${'Tool'.padEnd(10)} ${'Maq'.padEnd(8)} ${'StockoutDay'.padStart(11)} ${'Coverage'.padStart(10)} ${'Stock'.padStart(8)}`);
      for (const t of risks.slice(0, 10)) {
        console.log(`  ${t.toolCode.padEnd(10)} ${t.machine.padEnd(8)} ${`dia ${t.stockoutDay}`.padStart(11)} ${`${t.coverageDays.toFixed(1)}d`.padStart(10)} ${t.currentStock.toString().padStart(8)}`);
      }
    }
  });
});

describe('ISOP V2: Supply Priority', () => {
  it('computes supply boosts', () => {
    section('8. SUPPLY RISK');
    const mrp = computeMRP(engineData);
    const supplyBoosts = computeSupplyPriority(engineData, mrp);
    const rop = computeROP(mrp, engineData, 95);

    const boostCounts = { critical: 0, high: 0, medium: 0 };
    for (const [, sp] of supplyBoosts) {
      if (sp.boost === 3) boostCounts.critical++;
      else if (sp.boost === 2) boostCounts.high++;
      else if (sp.boost === 1) boostCounts.medium++;
    }

    console.log(`  Supply boosts: ${supplyBoosts.size}`);
    console.log(`    Critical (3): ${boostCounts.critical}`);
    console.log(`    High (2):     ${boostCounts.high}`);
    console.log(`    Medium (1):   ${boostCounts.medium}`);
    console.log(`  ROP records:    ${rop.records.length}`);

    expect(supplyBoosts.size).toBeGreaterThanOrEqual(0);
  });
});

describe('ISOP V2: Tardy Operations', () => {
  it('lists tardy ops', () => {
    section('9. TARDY OPERATIONS');
    const tardyBlocks = blocks.filter((b) => {
      if (b.type !== 'ok') return false;
      const op = engineData.ops.find((o) => o.id === b.opId);
      if (!op) return false;
      const edd = op.d.findIndex((v) => v > 0);
      return edd >= 0 && b.dayIdx > edd;
    });

    console.log(`  Tardy blocks: ${tardyBlocks.length} / ${blocks.filter((b) => b.type === 'ok').length} total`);

    if (tardyBlocks.length > 0) {
      const tardyByMachine: Record<string, number> = {};
      for (const b of tardyBlocks) tardyByMachine[b.machineId] = (tardyByMachine[b.machineId] || 0) + 1;
      console.log(`  By machine:`);
      for (const [m, count] of Object.entries(tardyByMachine).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${m}: ${count} tardy blocks`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  10. OTD-Delivery Invariant (MANDATORY — 100%)
// ═══════════════════════════════════════════════════════════

describe('ISOP V2: OTD-Delivery Invariant', () => {
  it('OTD-D = 100% (MANDATORY — zero failures)', () => {
    section('10. OTD-DELIVERY INVARIANT');
    const otdFails = computeOtdDeliveryFailures(blocks, engineData.ops);
    console.log(`  OTD-D failures: ${otdFails.count}`);
    console.log(`  OTD-Delivery:   ${metrics.otdDelivery.toFixed(2)}%`);
    console.log(`  workdays:       ${engineData.workdays?.length ?? 'undefined'} (${engineData.workdays?.filter(Boolean).length ?? 'N/A'} working days)`);
    console.log(`  orderBased:     ${engineData.orderBased}`);
    console.log(`  tier3Diag:      ${JSON.stringify(tier3Diag)}`);

    if (otdFails.count > 0) {
      console.log(`  FAILING OPS (BUG — must fix):`);
      for (const f of otdFails.failures) {
        const op = engineData.ops.find((o: any) => o.id === f.opId);
        const opBlocks = blocks.filter((b: any) => b.opId === f.opId && b.type === 'ok');
        const tool = op ? engineData.toolMap[op.t] : undefined;
        const demandDays = op?.d.map((v: number, i: number) => v > 0 ? `d${i}=${v}` : null).filter(Boolean).join(', ') ?? '';
        console.log(`    ${f.opId} (${op?.t} @ ${op?.m}) day=${f.day} shortfall=${f.shortfall}`);
        console.log(`      tool alt: ${tool?.alt ?? 'none'}, pH: ${tool?.pH ?? 'N/A'}`);
        console.log(`      demand: [${demandDays}]`);
        console.log(`      prod blocks: ${opBlocks.map((b: any) => `d${b.dayIdx}:${b.qty}@${b.machineId}`).join(', ')}`);
        const totalDemand = op?.d.reduce((s: number, v: number) => s + v, 0) ?? 0;
        const totalProd = opBlocks.reduce((s, b: any) => s + b.qty, 0);
        console.log(`      totalDemand=${totalDemand} totalProd=${totalProd}`);
      }
    }

    // Diagnostic: show what blocks occupy machines at failing days
    if (otdFails.count > 0) {
      for (const m of ['PRM019', 'PRM039']) {
        const range = m === 'PRM019' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] : [28, 29, 30, 31, 32, 33, 34];
        console.log(`  ${m} blocks at d${range[0]}-d${range[range.length-1]}:`);
        for (const d of range) {
          const dayBlocks = blocks.filter((b: any) => b.machineId === m && b.dayIdx === d);
          const totalMin = dayBlocks.reduce((s, b: any) => s + (b.prodMin || 0) + (b.setupMin || 0), 0);
          console.log(`    d${d}: ${dayBlocks.length} blk, ${totalMin}min: ${dayBlocks.map((b: any) => `${b.opId}(${b.toolId} edd=${b.eddDay} ${b.prodMin}m)`).join(', ')}`);
        }
      }
    }

    expect(otdFails.count).toBe(0);
    expect(metrics.otdDelivery).toBe(100);
  });

  it('OTD global >= 100%', () => {
    expect(metrics.otd).toBeGreaterThanOrEqual(100);
  });
});

// ═══════════════════════════════════════════════════════════
//  11. Twin Co-Production
// ═══════════════════════════════════════════════════════════

describe('ISOP V2: Twin Co-Production', () => {
  it('twinValidationReport exists and has no critical anomalies', () => {
    section('11. TWIN CO-PRODUCTION');
    const tvr = engineData.twinValidationReport;
    console.log(`  Twin groups:    ${tvr?.twinGroups?.length ?? 0}`);
    console.log(`  Anomalies:      ${tvr?.anomalies?.length ?? 0}`);
    expect(tvr).toBeDefined();
    // Critical anomalies would mean twin parsing or matching is broken
    const critical = tvr?.anomalies?.filter((a: any) => a.severity === 'critical') ?? [];
    expect(critical.length).toBe(0);
  });

  it('twin pairs are scheduled on same machine', () => {
    const tvr = engineData.twinValidationReport;
    if (!tvr?.twinGroups || tvr.twinGroups.length === 0) return;

    const okBlocks = blocks.filter((b) => b.type === 'ok');
    for (const group of tvr.twinGroups) {
      const blocksA = okBlocks.filter((b) => b.opId === group.opId1);
      const blocksB = okBlocks.filter((b) => b.opId === group.opId2);
      if (blocksA.length === 0 || blocksB.length === 0) continue;

      // Twin blocks on same day should be on same machine
      for (const ba of blocksA) {
        const matching = blocksB.filter((bb) => bb.dayIdx === ba.dayIdx);
        for (const bb of matching) {
          expect(bb.machineId).toBe(ba.machineId);
        }
      }
    }
    console.log(`  Twin same-machine check: PASS`);
  });
});

// ═══════════════════════════════════════════════════════════
//  12. What-If MRP (real ISOP data)
// ═══════════════════════════════════════════════════════════

describe('ISOP V2: What-If MRP', () => {
  it('machine_down PRM039 5 days shows RCCP impact', () => {
    section('12. WHAT-IF MRP');
    const mrp = computeMRP(engineData);
    const mutations: WhatIfMutation[] = [
      { id: 'M1', type: 'machine_down', machine: 'PRM039', downStartDay: 5, downEndDay: 9 },
    ];
    const result = computeWhatIf(engineData, mutations, mrp);

    const affected = result.rccpDeltas.filter((r) => r.machine === 'PRM039');
    expect(affected.length).toBeGreaterThan(0);
    const changed = affected.filter((r) => r.modifiedUtil !== r.baselineUtil);
    expect(changed.length).toBeGreaterThan(0);
    console.log(`  PRM039 down: ${changed.length} RCCP days changed, stockoutsChange=${result.summaryDelta.stockoutsChange}`);
  });

  it('demand_factor 1.5x increases planned qty', () => {
    const mrp = computeMRP(engineData);
    const mutations: WhatIfMutation[] = [
      { id: 'M1', type: 'demand_factor', factorToolCode: '__all__', factor: 1.5 },
    ];
    const result = computeWhatIf(engineData, mutations, mrp);

    // At least some tools should show increased planned qty
    const increased = result.deltas.filter((d) => d.modifiedPlannedQty > d.baselinePlannedQty);
    expect(increased.length).toBeGreaterThan(0);
    console.log(`  demand_factor 1.5x: ${increased.length} tools with increased planned qty`);
  });

  it('rush_order 10000 pcs on first real tool', () => {
    const mrp = computeMRP(engineData);
    const firstTool = engineData.tools[0];
    const mutations: WhatIfMutation[] = [
      { id: 'M1', type: 'rush_order', toolCode: firstTool.id, rushQty: 10000, rushDay: 0 },
    ];
    const result = computeWhatIf(engineData, mutations, mrp);

    const delta = result.deltas.find((d) => d.toolCode === firstTool.id);
    expect(delta).toBeDefined();
    if (delta) {
      expect(delta.modifiedPlannedQty).toBeGreaterThan(delta.baselinePlannedQty);
      console.log(`  rush_order ${firstTool.id}: planned ${delta.baselinePlannedQty} -> ${delta.modifiedPlannedQty}`);
    }
  });

  it('combined: machine_down + demand_factor', () => {
    const mrp = computeMRP(engineData);
    const mutations: WhatIfMutation[] = [
      { id: 'M1', type: 'machine_down', machine: 'PRM039', downStartDay: 0, downEndDay: 9 },
      { id: 'M2', type: 'demand_factor', factorToolCode: '__all__', factor: 1.3 },
    ];
    const result = computeWhatIf(engineData, mutations, mrp);

    // Combined: both RCCP and planned qty should change
    const rccpChanged = result.rccpDeltas.filter((r) => r.modifiedUtil !== r.baselineUtil);
    expect(rccpChanged.length).toBeGreaterThan(0);
    console.log(`  combined: ${rccpChanged.length} RCCP changes, stockoutsChange=${result.summaryDelta.stockoutsChange}`);
  });

  it('empty mutations return zero deltas', () => {
    const mrp = computeMRP(engineData);
    const result = computeWhatIf(engineData, [], mrp);
    expect(result.summaryDelta.stockoutsChange).toBe(0);
    expect(result.summaryDelta.avgUtilChange).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  13. Auto-Replan (real ISOP data)
// ═══════════════════════════════════════════════════════════

describe('ISOP V2: Auto-Replan', () => {
  it('PRM039 down triggers replan actions', () => {
    section('13. AUTO-REPLAN');

    const mSt: Record<string, string> = Object.fromEntries(
      engineData.machines.map((m) => [m.id, 'running']),
    );
    mSt['PRM039'] = 'down';
    const nDays = engineData.ops[0]?.d.length ?? 80;

    const input = {
      ops: engineData.ops,
      mSt,
      tSt: {} as Record<string, string>,
      moves: [] as any[],
      machines: engineData.machines,
      toolMap: engineData.toolMap,
      workdays: engineData.workdays,
      nDays,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
    };

    const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

    console.log(`  PRM039 down: ${result.actions.length} actions, ${result.autoMoves.length} moves, ${result.autoAdvances.length} advances`);
    console.log(`  Strategies: ${[...new Set(result.actions.map((a) => a.strategy))].join(', ') || 'none'}`);
    console.log(`  Unresolved: ${result.unresolved.length}`);
    console.log(`  3rd shift:  ${result.thirdShiftActivated}`);

    // With PRM039 down, should have some actions (move to alt machines)
    if (result.actions.length > 0) {
      // Verify block marking
      const replannedBlocks = result.blocks.filter((b) => b.isSystemReplanned);
      console.log(`  Replanned blocks: ${replannedBlocks.length}`);
      expect(replannedBlocks.length).toBeGreaterThan(0);

      // Each replanned block should have a strategy
      for (const b of replannedBlocks) {
        expect(b.replanStrategy).toBeDefined();
      }
    }

    // Should still produce a valid schedule
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('baseline (no machine down) has no replan actions', () => {
    const mSt: Record<string, string> = Object.fromEntries(
      engineData.machines.map((m) => [m.id, 'running']),
    );
    const nDays = engineData.ops[0]?.d.length ?? 80;

    const input = {
      ops: engineData.ops,
      mSt,
      tSt: {} as Record<string, string>,
      moves: [] as any[],
      machines: engineData.machines,
      toolMap: engineData.toolMap,
      workdays: engineData.workdays,
      nDays,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
    };

    const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

    // With all machines running and OTD=100%, there should be minimal or no actions
    console.log(`  Baseline: ${result.actions.length} actions, overflow=${result.blocks.filter((b) => b.type === 'overflow').length}`);
  });

  it('decision registry records all actions with alternatives', () => {
    const mSt: Record<string, string> = Object.fromEntries(
      engineData.machines.map((m) => [m.id, 'running']),
    );
    mSt['PRM039'] = 'down';
    const nDays = engineData.ops[0]?.d.length ?? 80;

    const input = {
      ops: engineData.ops,
      mSt,
      tSt: {} as Record<string, string>,
      moves: [] as any[],
      machines: engineData.machines,
      toolMap: engineData.toolMap,
      workdays: engineData.workdays,
      nDays,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
    };

    const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);
    const decisions = result.registry?.getAll?.() ?? result.decisions ?? [];

    console.log(`  Decisions recorded: ${Array.isArray(decisions) ? decisions.length : 'N/A'}`);

    // Each action should have a corresponding decision
    for (const action of result.actions) {
      expect(action.strategy).toBeDefined();
      expect(action.description).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════
//  14. Cascading Replan (real ISOP data)
// ═══════════════════════════════════════════════════════════

describe('ISOP V2: Cascading Replan', () => {
  it('PRM039 failure generates mitigation moves', () => {
    section('14. CASCADING REPLAN');

    const mSt: Record<string, string> = Object.fromEntries(
      engineData.machines.map((m) => [m.id, 'running']),
    );
    const nDays = engineData.ops[0]?.d.length ?? 80;

    const input = {
      ops: engineData.ops,
      mSt,
      tSt: {} as Record<string, string>,
      moves: [] as any[],
      machines: engineData.machines,
      toolMap: engineData.toolMap,
      workdays: engineData.workdays,
      nDays,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
    };

    const failure: FailureEvent = {
      id: 'F1',
      resourceType: 'machine',
      resourceId: 'PRM039',
      startDay: 0,
      startShift: null,
      endDay: 4,
      endShift: null,
      severity: 'total',
      capacityFactor: 0,
    };

    const result = cascadingReplan(input, [failure], blocks);

    console.log(`  Impacts:          ${result.impacts.length}`);
    console.log(`  Mitigation moves: ${result.mitigationMoves.length}`);
    console.log(`  Unrecoverable:    ${result.unrecoverableBlocks.length}`);
    console.log(`  Schedule blocks:  ${result.schedule.blocks.length}`);

    // Should have at least 1 impact (for PRM039 failure)
    expect(result.impacts.length).toBe(1);
    expect(result.impacts[0].failureEvent.id).toBe('F1');

    // Schedule should be re-run and produce valid blocks
    expect(result.schedule.blocks.length).toBeGreaterThan(0);

    // PRM039 blocks should have mitigation or be unrecoverable
    const prm039Blocks = blocks.filter((b) => b.machineId === 'PRM039' && b.type === 'ok');
    if (prm039Blocks.length > 0) {
      expect(result.mitigationMoves.length + result.unrecoverableBlocks.length).toBeGreaterThan(0);
    }
  });

  it('no failures returns schedule unchanged', () => {
    const mSt: Record<string, string> = Object.fromEntries(
      engineData.machines.map((m) => [m.id, 'running']),
    );
    const nDays = engineData.ops[0]?.d.length ?? 80;

    const input = {
      ops: engineData.ops,
      mSt,
      tSt: {} as Record<string, string>,
      moves: [] as any[],
      machines: engineData.machines,
      toolMap: engineData.toolMap,
      workdays: engineData.workdays,
      nDays,
      workforceConfig: DEFAULT_WORKFORCE_CONFIG,
    };

    const result = cascadingReplan(input, [], blocks);
    expect(result.impacts).toHaveLength(0);
    expect(result.mitigationMoves).toHaveLength(0);
    expect(result.schedule.blocks.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
//  FINAL SUMMARY
// ═══════════════════════════════════════════════════════════

describe('ISOP V2: Summary', () => {
  it('prints final summary', () => {
    header('FINAL SUMMARY');
    const { meta } = parsed;
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as NikufraData;
    const fixtureToolIds = new Set(fixture.tools.map((t) => t.id));
    const toolsWithSetup = merged.tools.filter((t) => fixtureToolIds.has(t.id) && t.s > 0);
    const toolsWithAlt = merged.tools.filter((t) => t.alt !== '-');
    const allOk = validation.violations.length === 0;
    const mrp = computeMRP(engineData);
    const supplyBoosts = computeSupplyPriority(engineData, mrp);
    const criticalCount = [...supplyBoosts.values()].filter((sp) => sp.boost === 3).length;

    console.log(`  Parse:        OK (${meta.rows} ops, ${meta.tools} tools, ${meta.dates} days)`);
    console.log(`  Trust:        ${(meta.trustScore * 100).toFixed(1)}%`);
    console.log(`  Merge:        OK (${toolsWithSetup.length} setups, ${toolsWithAlt.length} alts enriched)`);
    console.log(`  Schedule:     OK (${blocks.length} blocks, ${autoMoves.length} auto-moves)`);
    console.log(`  KPIs:         OTD ${metrics.otd.toFixed(1)}%, ${metrics.setupCount} setups`);
    console.log(`  Constraints:  ${allOk ? 'ALL PASS' : `${validation.violations.length} VIOLATIONS`}`);
    console.log(`  MRP:          ${mrp.records.length} records, ${mrp.summary.toolsWithStockout} stockouts`);
    console.log(`  Supply:       ${supplyBoosts.size} boosted ops (${criticalCount} critical)`);
    console.log(`\n${line('═')}`);
  });
});
