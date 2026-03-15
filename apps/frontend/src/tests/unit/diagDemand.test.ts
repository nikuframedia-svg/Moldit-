/**
 * Diagnostic: Compare raw ISOP demand vs engine transformed demand.
 * Find where the 5.2M produced vs 3.2M raw demand discrepancy comes from.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

import { parseISOPFile } from '../../domain/isop';
import type { NikufraData } from '../../domain/nikufra-types';
import {
  autoRouteOverflow,
  DEFAULT_WORKFORCE_CONFIG,
  scoreSchedule,
  transformPlanState,
} from '../../lib/engine';

const cwd = process.cwd();
const base = cwd.endsWith('frontend') ? cwd : join(cwd, 'frontend');
const isopPath = join(base, 'src', 'tests', 'fixtures', 'ISOP_Nikufra_27_2_v2.xlsx');
const fixturePath = join(base, 'public', 'fixtures', 'nikufra', 'nikufra_data.json');

describe('Demand Diagnostic', () => {
  it('compares raw ISOP demand vs engine demand vs production', () => {
    // Parse
    const buf = readFileSync(isopPath);
    const ab = new ArrayBuffer(buf.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < buf.length; i++) view[i] = buf[i];
    const parseResult = parseISOPFile(ab);
    if (!parseResult.success) throw new Error('Parse failed');
    const data = parseResult.data;

    // Merge
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as NikufraData;
    const fixToolMap = new Map(fixture.tools.map((t) => [t.id, t]));
    const mergedTools = data.tools.map((tool) => {
      const fix = fixToolMap.get(tool.id);
      if (!fix) return tool;
      return { ...tool, s: tool.s > 0 ? tool.s : fix.s, alt: tool.alt !== '-' ? tool.alt : fix.alt };
    });
    const toolLookup = new Map(mergedTools.map((t) => [t.id, t]));
    const mergedOps = data.operations.map((op) => {
      const tool = toolLookup.get(op.t);
      if (!tool) return op;
      return { ...op, s: op.s > 0 ? op.s : tool.s };
    });
    const parsedMoEmpty = !data.mo || data.mo.PG1.length === 0 || data.mo.PG1.every((v) => v === 0);
    const mergedMo = parsedMoEmpty && fixture.mo ? fixture.mo : data.mo;
    const merged = { ...data, tools: mergedTools, operations: mergedOps, mo: mergedMo };

    // Transform
    const planState = {
      dates: merged.dates, days_label: merged.days_label,
      machines: merged.machines.map((m) => ({ id: m.id, area: m.area as 'PG1' | 'PG2', man_minutes: m.man })),
      tools: merged.tools.map((t) => ({
        id: t.id, machine: t.m, alt_machine: t.alt, setup_hours: t.s,
        pcs_per_hour: t.pH, operators: t.op, skus: t.skus, names: t.nm,
        lot_economic_qty: t.lt, stock: t.stk, wip: t.wip,
      })),
      operations: merged.operations.map((op) => ({
        id: op.id, machine: op.m, tool: op.t, sku: op.sku, name: op.nm,
        pcs_per_hour: op.pH, atraso: op.atr, daily_qty: op.d,
        setup_hours: op.s, operators: op.op, stock: 0, status: 'PLANNED' as const,
        customer_code: op.cl, customer_name: op.clNm, parent_sku: op.pa,
        wip: op.wip, qtd_exp: op.qe, lead_time_days: op.ltDays, twin: op.twin,
      })),
      schedule: [], machine_loads: [], kpis: null,
      parsed_at: new Date().toISOString(), data_hash: null,
      mo: merged.mo ? { PG1: merged.mo.PG1, PG2: merged.mo.PG2 } : undefined,
      workday_flags: merged.workday_flags,
    };

    const engineData = transformPlanState(planState, { demandSemantics: 'raw_np' });

    // STEP 1: Compare raw vs engine demand per operation
    console.log('=== RAW ISOP vs ENGINE DEMAND (per op) ===\n');

    let totalIsopDemand = 0;
    let totalEngineDemand = 0;
    const diffs: Array<{ id: string; raw: number; eng: number; diff: number }> = [];

    for (const eOp of engineData.ops) {
      const rawOp = merged.operations.find((o) => o.id === eOp.id);
      if (!rawOp) continue;
      const rawDemand = rawOp.d.reduce((s: number, v: number | null) => s + (v !== null && v < 0 ? Math.abs(v) : 0), 0);
      const engineDemand = eOp.d.reduce((s, v) => s + Math.max(v || 0, 0), 0);
      totalIsopDemand += rawDemand;
      totalEngineDemand += engineDemand;
      if (Math.abs(rawDemand - engineDemand) > 10) {
        diffs.push({ id: eOp.id, raw: rawDemand, eng: engineDemand, diff: engineDemand - rawDemand });
      }
    }

    console.log('Total ISOP demand (|NP neg|):  ', totalIsopDemand.toLocaleString());
    console.log('Total engine demand (d > 0):   ', totalEngineDemand.toLocaleString());
    console.log('Inflation:                     ', ((totalEngineDemand / totalIsopDemand - 1) * 100).toFixed(1) + '%');
    console.log('');

    if (diffs.length > 0) {
      console.log('Operations with demand mismatch:');
      diffs.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      for (const d of diffs.slice(0, 20)) {
        console.log(`  ${d.id.padEnd(30)} ISOP: ${d.raw.toLocaleString().padStart(10)}  Engine: ${d.eng.toLocaleString().padStart(10)}  Diff: ${d.diff > 0 ? '+' : ''}${d.diff.toLocaleString().padStart(10)}`);
      }
    } else {
      console.log('NO mismatches found!');
    }

    // STEP 2: Show engine d[] for first few ops to understand transformation
    console.log('\n=== ENGINE d[] SAMPLE (first 5 ops with demand) ===\n');
    let shown = 0;
    for (const eOp of engineData.ops) {
      const totalD = eOp.d.reduce((s, v) => s + Math.max(v || 0, 0), 0);
      if (totalD === 0) continue;
      const rawOp = merged.operations.find((o) => o.id === eOp.id);
      const rawFirst10 = rawOp ? rawOp.d.slice(0, 20).map((v: number | null) => v === null ? '_' : v) : [];
      const engFirst10 = eOp.d.slice(0, 20);
      console.log(`Op: ${eOp.id} (${eOp.t} / ${eOp.m})`);
      console.log(`  Raw NP:  [${rawFirst10.join(', ')}]`);
      console.log(`  Engine:  [${engFirst10.join(', ')}]`);
      console.log(`  Raw demand: ${rawOp?.d.reduce((s: number, v: number | null) => s + (v !== null && v < 0 ? Math.abs(v) : 0), 0).toLocaleString()}`);
      console.log(`  Eng demand: ${totalD.toLocaleString()}`);
      console.log('');
      if (++shown >= 5) break;
    }

    // STEP 3: Run schedule and compare produced vs demand
    const mSt: Record<string, string> = Object.fromEntries(
      engineData.machines.map((m) => [m.id, 'running']),
    );
    const nDays = engineData.ops[0]?.d.length ?? 80;
    const schedResult = autoRouteOverflow({
      ops: engineData.ops, mSt, tSt: {}, userMoves: [],
      machines: engineData.machines, toolMap: engineData.toolMap,
      workdays: engineData.workdays, nDays, rule: 'EDD',
    });

    const metrics = scoreSchedule(
      schedResult.blocks, engineData.ops, mSt,
      DEFAULT_WORKFORCE_CONFIG, engineData.machines, engineData.toolMap,
    );

    console.log('=== PRODUCTION vs DEMAND ===\n');
    console.log('ISOP demand:        ', totalIsopDemand.toLocaleString(), 'pcs');
    console.log('Engine demand:      ', totalEngineDemand.toLocaleString(), 'pcs');
    console.log('Produced:           ', metrics.produced?.toLocaleString(), 'pcs');
    console.log('Over-production:    ', ((metrics.produced ?? 0) - totalEngineDemand).toLocaleString(), 'pcs');
    console.log('');

    // Per-machine production
    const prodByMachine: Record<string, number> = {};
    for (const b of schedResult.blocks) {
      if (b.type === 'ok') {
        prodByMachine[b.machineId] = (prodByMachine[b.machineId] || 0) + b.qty;
      }
    }
    console.log('Production by machine:');
    for (const [m, qty] of Object.entries(prodByMachine).sort()) {
      console.log(`  ${m}: ${qty.toLocaleString()} pcs`);
    }

    // STEP 4: Check lot economic in tools
    console.log('\n=== LOT ECONOMIC CHECK ===\n');
    const toolsWithLotEco = merged.tools.filter((t) => t.lt > 0);
    console.log('Tools with lot economic > 0:', toolsWithLotEco.length);
    for (const t of toolsWithLotEco.slice(0, 10)) {
      console.log(`  ${t.id} (${t.m}): lot_eco=${t.lt.toLocaleString()}, pH=${t.pH}`);
    }
  });
});
