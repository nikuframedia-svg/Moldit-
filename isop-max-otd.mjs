/**
 * ISOP Max OTD — Master data enriched + autoRouteOverflow
 */
import * as XLSX from 'xlsx';
import { readFileSync } from 'fs';
import {
  transformPlanState, scheduleFromEngineData, autoRouteOverflow,
  scoreSchedule, validateSchedule, auditCoverage, analyzeLateDeliveries,
  computeMRP, computeSupplyPriority, DEFAULT_WORKFORCE_CONFIG,
} from './packages/scheduling-engine/dist/index.js';

const FILE = '/Users/martimnicolau/Downloads/ISOP_ Nikufra_27_2-2.xlsx';
const FIXTURE = './packages/scheduling-engine/src/fixtures/nikufra_data.json';
const MACHINE_AREA = { PRM019:'PG1', PRM031:'PG2', PRM039:'PG2', PRM042:'PG2', PRM043:'PG1' };

// ═══ 1. PARSE ISOP ═══
const buf = readFileSync(FILE);
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
const ws = wb.Sheets['Planilha1'];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
let headerIdx = -1;
for (let i = 0; i < 16; i++) {
  const cells = (rows[i]||[]).map(c => String(c??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim());
  if (cells.some(c => c.includes('referencia artigo')) && cells.some(c => c.includes('maquina'))) { headerIdx = i; break; }
}
const headers = rows[headerIdx].map(c => String(c??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim());
const fc = pats => { for (const p of pats) { const i = headers.findIndex(h => h.includes(p)); if (i>=0) return i; } return -1; };
const cm = {
  ref: fc(['referencia artigo']), maq: fc(['maquina']), fer: fc(['ferramenta']),
  pH: fc(['pecas/h','pcs/h']), pes: fc(['pessoas']), cli: fc(['cliente']),
  nom: fc(['nome']), des: fc(['designacao']), lot: fc(['lote eco']),
  wip: fc(['wip']), atr: fc(['atraso']), gem: fc(['gemea']),
};
const lastCol = Math.max(...Object.values(cm).filter(v=>v>=0));
const dates=[], dIdx=[];
for (let ci=lastCol+1; ci<rows[headerIdx].length; ci++) {
  const v = rows[headerIdx][ci];
  if (v instanceof Date && !isNaN(v.getTime())) { dates.push(v); dIdx.push(ci); }
}
const wdFlags = dates.map(d => { const w=d.getDay(); return w>=1&&w<=5; });
const parsed = [];
for (let ri=headerIdx+1; ri<rows.length; ri++) {
  const r=rows[ri]; if (!r) continue;
  const sku=String(r[cm.ref]??'').trim(); if (!sku) continue;
  const m=String(r[cm.maq]??'').trim(); if (!m) continue;
  parsed.push({
    sku, m, t: cm.fer>=0?String(r[cm.fer]??'').trim():'',
    pH: cm.pH>=0?Number(r[cm.pH])||0:0, op: cm.pes>=0?Math.max(1,Math.round(Number(r[cm.pes])||1)):1,
    twin: cm.gem>=0?String(r[cm.gem]??'').trim():'', lt: cm.lot>=0?Number(r[cm.lot])||0:0,
    wip: cm.wip>=0?Number(r[cm.wip])||0:0, atr: cm.atr>=0?Number(r[cm.atr])||0:0,
    cl: cm.cli>=0?String(r[cm.cli]??'').trim():'', nm: cm.des>=0?String(r[cm.des]??'').trim():sku,
    d: dIdx.map(ci => { const v=r[ci]; if (v==null||(typeof v==='string'&&v.trim()==='')) return null; return Number(String(v).replace(',','.'))||null; }),
  });
}
console.log(`1. PARSE: ${parsed.length} ops, ${dates.length} dates, ${wdFlags.filter(Boolean).length} workdays`);

// ═══ 2. BUILD + MASTER MERGE ═══
const mSet = new Set(); parsed.forEach(r => mSet.add(r.m));
const machines = [...mSet].sort().map(id => ({ id, area: MACHINE_AREA[id]||'PG1', man: Array(dates.length).fill(0) }));
const tMap = new Map();
for (const r of parsed) {
  if (!r.t) continue;
  if (!tMap.has(r.t)) tMap.set(r.t, { id:r.t, m:r.m, alt:'-', s:0, pH:r.pH, op:r.op, skus:[r.sku], nm:[r.nm], lt:r.lt, stk:0, wip:r.wip });
  else { const t=tMap.get(r.t); if (!t.skus.includes(r.sku)) { t.skus.push(r.sku); t.nm.push(r.nm); } }
}
const tools = [...tMap.values()];
const ops = parsed.map((r,i) => ({ id:`OP${String(i+1).padStart(2,'0')}`, m:r.m, t:r.t, sku:r.sku, nm:r.nm, pH:r.pH, atr:r.atr, d:r.d, s:0, op:r.op, cl:r.cl||undefined, twin:r.twin||undefined, wip:r.wip||undefined }));

// Master merge
const master = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
const mtm = new Map(master.tools.map(t => [t.id, t]));
let sE=0, aE=0;
const mTools = tools.map(t => {
  const m = mtm.get(t.id); if (!m) return t.s<=0 ? {...t, s:0.75} : t;
  const nS=t.s>0?t.s:m.s>0?m.s:0.75, nA=(t.alt!=='-'&&t.alt!=='')?t.alt:m.alt, nPH=t.pH>0?t.pH:m.pH, nOp=t.op>0?t.op:m.op, nLt=t.lt>0?t.lt:m.lt;
  if (nS!==t.s) sE++; if (nA!==t.alt) aE++;
  return {...t, s:nS, alt:nA, pH:nPH, op:nOp, lt:nLt};
});
const tLkp = new Map(mTools.map(t=>[t.id,t]));
const mOps = ops.map(op => {
  const t=tLkp.get(op.t); if (!t) return op;
  return {...op, s:op.s>0?op.s:t.s>0?t.s:0.75, pH:op.pH>0?op.pH:t.pH, op:op.op>0?op.op:t.op};
});
console.log(`2. MERGE: setups=${sE}, alts=${aE}, tools_with_alt=${mTools.filter(t=>t.alt&&t.alt!=='-').length}/${mTools.length}`);

// ═══ 3. TRANSFORM ═══
const planState = {
  dates: dates.map(d=>`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`),
  days_label: dates.map(d=>['Dom','Seg','Ter','Qua','Qui','Sex','Sab'][d.getDay()]),
  workday_flags: wdFlags,
  machines: machines.map(m=>({ id:m.id, area:m.area, man_minutes:(m.man||[]).map(v=>v*60) })),
  tools: mTools.map(t=>({ id:t.id, machine:t.m, alt_machine:t.alt==='-'?null:t.alt||null, setup_hours:t.s||0, pcs_per_hour:t.pH||0, operators:t.op||1, skus:t.skus||[], names:t.nm||[], lot_economic_qty:t.lt||0, stock:0, wip:t.wip||0 })),
  operations: mOps.map(op=>({ id:op.id, machine:op.m, tool:op.t, sku:op.sku, name:op.nm||op.sku, pcs_hour:op.pH||0, atraso:op.atr||0, daily_qty:op.d||[], setup_hours:op.s||0, operators:op.op||1, customer_code:op.cl, twin:op.twin, wip:op.wip })),
  mo: master.mo ? { PG1:(master.mo.PG1||[]).map(v=>(v||0)*60), PG2:(master.mo.PG2||[]).map(v=>(v||0)*60) } : {PG1:[],PG2:[]},
  history: [],
};
const BUFFER_DAYS = 5;
const engineData = transformPlanState(planState, { moStrategy:'nominal', moNominalPG1:10, moNominalPG2:10, demandSemantics:'raw_np', preStartBufferDays:BUFFER_DAYS });
let totalDemand = 0;
for (const op of engineData.ops) for (const v of op.d) totalDemand += Math.max(0,v);
console.log(`3. TRANSFORM: ${engineData.ops.length} ops, ${engineData.nDays} days, demand=${totalDemand.toLocaleString()} pcs`);

// ═══ 4. SCHEDULE + OVERFLOW ═══
const wfc = DEFAULT_WORKFORCE_CONFIG;
console.log(`4. SCHEDULE (ATCS + autoRouteOverflow with master data)...`);

// scheduleFromEngineData(engine, mSt, tSt, moves, options)
const baseResult = scheduleFromEngineData(engineData, engineData.mSt, engineData.tSt, [], {
  rule:'ATCS', workforceConfig:wfc, supplyBoosts:new Map()
});
const baseScore = scoreSchedule(baseResult.blocks, engineData.ops, engineData.mSt, wfc, engineData.machines, engineData.toolMap);
console.log(`   Base schedule: ${baseResult.blocks.length} blocks, OTD=${baseScore.otdDelivery.toFixed(1)}%`);

// autoRouteOverflow with master-enriched data
const overflowResult = autoRouteOverflow({
  ops: engineData.ops, mSt: engineData.mSt, tSt: engineData.tSt,
  userMoves: baseResult.moves || [], machines: engineData.machines,
  toolMap: engineData.toolMap, workdays: engineData.workdays,
  nDays: engineData.nDays, workforceConfig: wfc, rule: 'ATCS',
  supplyBoosts: new Map(),
  twinValidationReport: engineData.twinValidationReport,
  dates: engineData.dates, orderBased: true,
});
const blocks = overflowResult.blocks;
const score = scoreSchedule(blocks, engineData.ops, engineData.mSt, wfc, engineData.machines, engineData.toolMap);
console.log(`   + autoRouteOverflow: ${blocks.length} blocks, OTD=${score.otdDelivery.toFixed(1)}%`);
console.log(`   Produced: ${score.produced.toLocaleString()} / ${score.totalDemand.toLocaleString()} pcs`);
console.log(`   Lost: ${score.lostPcs.toLocaleString()} pcs`);
console.log(`   Advances: ${overflowResult.autoAdvances?.length ?? 0}`);
console.log(`   Moves: ${overflowResult.autoMoves?.length ?? 0}`);

// ═══ 5. VIOLATIONS ═══
const viol = validateSchedule(blocks, engineData.machines, engineData.toolMap, engineData.ops);
const violCount = Array.isArray(viol) ? viol.length : (viol?.violations?.length ?? 0);
console.log(`5. VIOLATIONS: ${violCount}`);

// ═══ 6. TARDY ANALYSIS ═══
let tardy = 0;
const tardyDetails = [];
for (const b of blocks) {
  if (b.type==='blocked'||b.type==='infeasible') continue;
  if (b.eddDay!=null && b.dayIdx>b.eddDay) {
    tardy++;
    if (tardyDetails.length<30) tardyDetails.push({ op:b.opId, sku:b.sku, m:b.machineId, day:b.dayIdx, edd:b.eddDay, late:b.dayIdx-b.eddDay });
  }
}

// Coverage
let covPct = 'N/A';
try {
  const cov = auditCoverage(blocks, engineData.ops, engineData.toolMap, engineData.twinGroups||[]);
  covPct = typeof cov === 'number' ? cov.toFixed(1) + '%'
    : typeof cov?.global === 'number' ? cov.global.toFixed(1) + '%'
    : typeof cov?.coverage === 'number' ? cov.coverage.toFixed(1) + '%'
    : JSON.stringify(cov).slice(0,80);
} catch(e) { covPct = 'error: ' + e.message; }

console.log(`\n═══════════════════════════════════════`);
console.log(`   RESULTADO FINAL (Master + ${BUFFER_DAYS}d buffer)`);
console.log(`═══════════════════════════════════════`);
console.log(`   OTD:       ${score.otdDelivery.toFixed(1)}%`);
console.log(`   Coverage:  ${covPct}`);
console.log(`   Blocks:    ${blocks.length}`);
console.log(`   Violations: ${violCount}`);
console.log(`   Tardy:     ${tardy} blocks`);
console.log(`   Unresolved: ${overflowResult.unresolved?.length ?? 0}`);

if (tardy > 0) {
  console.log(`\n   ⚠️ TARDY BLOCKS (${tardy}):`);
  // Group by machine
  const byM = {};
  tardyDetails.forEach(d => { byM[d.m] = (byM[d.m]||0)+1; });
  Object.entries(byM).sort((a,b)=>b[1]-a[1]).forEach(([m,c]) => console.log(`     ${m}: ${c} blocks`));
  console.log(`\n   Top 15 tardy:`);
  tardyDetails.slice(0,15).forEach(d => console.log(`     ${d.op} | ${d.sku} | ${d.m} | day ${d.day} vs EDD ${d.edd} → ${d.late}d late`));
} else {
  console.log(`\n   ✅ ZERO TARDY BLOCKS — 100% OTD!`);
}
console.log(`═══════════════════════════════════════`);

console.log(`\nDone.`);
