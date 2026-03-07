// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Auditoria das 3 Condicionais
//
//  CONDICIONAL 1: NP = ENCOMENDA - STOCK_PROJETADO (sinal e ordem)
//  CONDICIONAL 2: Capacidade real com OEE obrigatório (default 0.66)
//  CONDICIONAL 3: Ignorar "vermelhos" em máquinas/ferramentas
//
//  Estes testes FALHAM se alguém alterar a lógica de qualquer condicional.
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { DAY_CAP, DEFAULT_OEE } from '../src/constants.js';
import { computeToolMRP } from '../src/mrp/mrp-engine.js';
import { groupDemandIntoBuckets } from '../src/scheduler/demand-grouper.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import { computeDeficitEvolution, computeWorkContent } from '../src/scheduler/work-content.js';
import {
  deltaizeCumulativeNP,
  rawNPtoDailyDemand,
  transformPlanState,
} from '../src/transform/transform-plan-state.js';
import type { EngineData, EOp, ETool } from '../src/types/engine.js';
import type { PlanState } from '../src/types/plan-state.js';

// ── Helpers ─────────────────────────────────────────────────────────

function mkTool(overrides: Partial<ETool> & { id: string }): ETool {
  return {
    m: 'PRM039',
    alt: '-',
    sH: 0.5,
    pH: 100,
    op: 1,
    lt: 1000,
    stk: 0,
    nm: 'Test',
    ...overrides,
  };
}

function mkOp(overrides: Partial<EOp> & { id: string; t: string; m: string; d: number[] }): EOp {
  return { sku: 'SKU01', nm: 'Test', atr: 0, ...overrides };
}

function mkToolMap(tools: ETool[]): Record<string, ETool> {
  const map: Record<string, ETool> = {};
  tools.forEach((t) => {
    map[t.id] = t;
  });
  return map;
}

function mkMinimalPlanState(overrides?: Partial<PlanState>): PlanState {
  return {
    dates: ['03/03', '04/03', '05/03', '06/03', '07/03'],
    days_label: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
    workday_flags: [true, true, true, true, true],
    machines: [
      { id: 'PRM039', area: 'PG2', man_minutes: [0, 0, 0, 0, 0] },
      { id: 'PRM031', area: 'PG2', man_minutes: [0, 0, 0, 0, 0] },
    ],
    tools: [
      {
        id: 'BWI003',
        machine: 'PRM039',
        alt_machine: '-',
        setup_hours: 0.5,
        pcs_per_hour: 1000,
        operators: 1,
        skus: ['SKU-A'],
        names: ['Part A'],
        lot_economic_qty: 0,
        stock: 0,
      },
    ],
    operations: [
      {
        id: 'OP01',
        machine: 'PRM039',
        tool: 'BWI003',
        sku: 'SKU-A',
        name: 'Part A',
        pcs_per_hour: 1000,
        atraso: 0,
        daily_qty: [0, 0, 2000, 0, 0],
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
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  CONDICIONAL 1 — Interpretação de NP (ordem e sinal)
//
//  Regra: NP = ENCOMENDA_DO_DIA - STOCK_PROJETADO_ATÉ_ESSE_DIA
//  * NP > 0 → falta real → obriga produção
//  * NP ≤ 0 → sem falta → não obriga produção
//
//  Na implementação ISOP:
//    raw_NP = Stock(0) - ΣGrossReq(0..t)
//    shortfall = max(0, -raw_NP) = max(0, ΣGrossReq - Stock)
//    Isto é equivalente a max(0, NP_do_utilizador).
// ═══════════════════════════════════════════════════════════════════════

describe('CONDICIONAL 1 — NP: sinal e fórmula', () => {
  describe('rawNPtoDailyDemand — conversão raw ISOP NP para demanda diária', () => {
    it('stock=1000, encomenda=1200 => NP=200 => falta => produção obrigatória', () => {
      // Raw ISOP NP: Stock - Encomenda = 1000 - 1200 = -200
      // max(0, -(-200)) = max(0, 200) = 200 — há falta de 200 peças
      const rawNP = [-200]; // Stock 1000 - Encomenda 1200
      const result = rawNPtoDailyDemand(rawNP, 0);
      expect(result).toEqual([200]);
      expect(result[0]).toBeGreaterThan(0); // FALTA: obriga produção
    });

    it('stock=1500, encomenda=1200 => NP=-300 => sem falta => não obriga produção', () => {
      // Raw ISOP NP: Stock - Encomenda = 1500 - 1200 = +300
      // max(0, -(+300)) = max(0, -300) = 0 — sem falta
      const rawNP = [300]; // Stock 1500 - Encomenda 1200
      const result = rawNPtoDailyDemand(rawNP, 0);
      expect(result).toEqual([0]);
      expect(result[0]).toBe(0); // SEM FALTA: não obriga produção
    });

    it('sinal invertido (stock > encomenda) nunca produz demanda', () => {
      // Se stock cobre tudo, NP raw é positivo, demanda = 0
      const rawNP = [500, 300, 100]; // stock sempre cobre
      const result = rawNPtoDailyDemand(rawNP, 0);
      expect(result).toEqual([0, 0, 0]);
      expect(result.every((v) => v === 0)).toBe(true);
    });

    it('sinal correto (encomenda > stock) sempre produz demanda > 0', () => {
      // Se encomenda excede stock, NP raw é negativo, demanda > 0
      const rawNP = [-100, -300, -600]; // shortfall crescente
      const result = rawNPtoDailyDemand(rawNP, 0);
      expect(result).toEqual([100, 200, 300]);
      expect(result.every((v) => v >= 0)).toBe(true);
      expect(result.some((v) => v > 0)).toBe(true);
    });
  });

  describe('deltaizeCumulativeNP — conversão cumulativa para incremental', () => {
    it('shortfall crescente gera demanda incremental', () => {
      // cum[0]=200, cum[1]=500 → delta = [200, 300]
      const result = deltaizeCumulativeNP([200, 500], 0);
      expect(result).toEqual([200, 300]);
    });

    it('shortfall decrescente (stock a cobrir) gera zero', () => {
      // cum[0]=500, cum[1]=200 → delta = [500, 0] (receção cobriu)
      const result = deltaizeCumulativeNP([500, 200], 0);
      expect(result).toEqual([500, 0]);
    });
  });

  describe('computeDeficitEvolution — trajetória stock vs demanda', () => {
    it('stk=0, encomenda_dia=1200 → défice negativo imediato (Stock-A eliminado)', () => {
      const tool = mkTool({ id: 'T01', pH: 100, stk: 0 });
      const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [1200], stk: 0 });
      const toolMap = mkToolMap([tool]);

      const result = computeDeficitEvolution([op], toolMap, 1);
      const de = result.get('OP01')!;

      // deficit = 0 - 1200 = -1200 → falta total
      expect(de.dailyDeficit[0]).toBe(-1200);
      expect(de.firstDeficitDay).toBe(0);
      expect(de.maxDeficit).toBe(1200);
    });

    it('stk=0, sem encomenda → sem défice', () => {
      const tool = mkTool({ id: 'T01', pH: 100, stk: 0 });
      const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [0], stk: 0 });
      const toolMap = mkToolMap([tool]);

      const result = computeDeficitEvolution([op], toolMap, 1);
      const de = result.get('OP01')!;

      expect(de.dailyDeficit[0]).toBe(0);
      expect(de.firstDeficitDay).toBe(-1);
      expect(de.maxDeficit).toBe(0);
    });
  });

  describe('MRP netting — projected < 0 gera planned order', () => {
    it('stk=0, demanda_total=1200 → netReq=1200 → gera planned order (Stock-A eliminado)', () => {
      const tool = mkTool({ id: 'T01', pH: 100, stk: 0, lt: 500 });
      const ops = [mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [1200] })];

      const record = computeToolMRP(tool, ops, 1, ['03/03'], ['Seg']);

      // projected = 0 - 1200 = -1200 → netReq = 1200
      expect(record.buckets[0].netRequirement).toBe(1200);
      expect(record.buckets[0].plannedOrderReceipt).toBeGreaterThan(0);
      expect(record.stockoutDay).toBe(0);
    });

    it('stk=0, sem demanda → sem planned order', () => {
      const tool = mkTool({ id: 'T01', pH: 100, stk: 0, lt: 500 });
      const ops = [mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [0] })];

      const record = computeToolMRP(tool, ops, 1, ['03/03'], ['Seg']);

      expect(record.buckets[0].netRequirement).toBe(0);
      expect(record.buckets[0].plannedOrderReceipt).toBe(0);
      expect(record.stockoutDay).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  CONDICIONAL 2 — Capacidade real com OEE obrigatório (default 0.66)
//
//  Regra: capacidade_horária_real = peças_por_hora * OEE
//  * OEE default = 0.66 se não existir override
//  * Proibido usar OEE=1 sem configuração explícita
// ═══════════════════════════════════════════════════════════════════════

describe('CONDICIONAL 2 — OEE obrigatório (default=0.66)', () => {
  it('DEFAULT_OEE é 0.66 (não 1.0)', () => {
    expect(DEFAULT_OEE).toBe(0.66);
    expect(DEFAULT_OEE).not.toBe(1);
    expect(DEFAULT_OEE).not.toBe(1.0);
  });

  describe('computeWorkContent — OEE missing → usa 0.66', () => {
    it('pph=100, OEE missing => capacidade efetiva = 66/h', () => {
      const tool = mkTool({ id: 'T01', pH: 100 }); // sem tool.oee
      expect(tool.oee).toBeUndefined(); // confirma que OEE não está definido

      const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [660] });
      const toolMap = mkToolMap([tool]);

      const result = computeWorkContent([op], toolMap);
      const wc = result.get('OP01')!;

      expect(wc.oee).toBe(0.66);
      expect(wc.oeeSource).toBe('default');
      // capacidade efetiva = 100 * 0.66 = 66 peças/hora
      // work content = 660 / (100 * 0.66) = 10 horas
      expect(wc.workContentHours).toBeCloseTo(10, 4);
      // Se OEE fosse 1.0, seria 6.6 horas — diferente!
      expect(wc.workContentHours).not.toBeCloseTo(6.6, 1);
    });

    it('pph=100, OEE=0.8 => capacidade efetiva = 80/h', () => {
      const tool = mkTool({ id: 'T01', pH: 100, oee: 0.8 });
      const op = mkOp({ id: 'OP01', t: 'T01', m: 'M01', d: [800] });
      const toolMap = mkToolMap([tool]);

      const result = computeWorkContent([op], toolMap);
      const wc = result.get('OP01')!;

      expect(wc.oee).toBe(0.8);
      expect(wc.oeeSource).toBe('tool');
      // capacidade efetiva = 100 * 0.8 = 80 peças/hora
      // work content = 800 / (100 * 0.8) = 10 horas
      expect(wc.workContentHours).toBeCloseTo(10, 4);
    });
  });

  describe('demand-grouper — prodMin inflated by OEE', () => {
    it('OEE missing → prodMin usa DEFAULT_OEE=0.66', () => {
      const tool = mkTool({ id: 'T01', pH: 100, lt: 0, m: 'PRM039' }); // sem oee
      const op = mkOp({ id: 'OP01', t: 'T01', m: 'PRM039', d: [100, 0, 0] });
      const toolMap = mkToolMap([tool]);

      const result = groupDemandIntoBuckets(
        [op],
        { PRM039: 'running' },
        { T01: 'running' },
        [],
        toolMap,
        [true, true, true],
        3,
      );

      const groups = result['PRM039'];
      expect(groups).toBeDefined();
      expect(groups.length).toBeGreaterThan(0);

      const sku = groups[0].skus[0];
      // prodMin = (100 / 100) * 60 / 0.66 ≈ 90.91
      const expectedProdMin = ((100 / 100) * 60) / DEFAULT_OEE;
      expect(sku.prodMin).toBeCloseTo(expectedProdMin, 1);

      // Se OEE fosse 1.0: prodMin = 60 — DIFERENTE
      expect(sku.prodMin).not.toBeCloseTo(60, 1);
    });

    it('OEE=0.8 explícito na tool → usa 0.8', () => {
      const tool = mkTool({ id: 'T01', pH: 100, lt: 0, oee: 0.8, m: 'PRM039' });
      const op = mkOp({ id: 'OP01', t: 'T01', m: 'PRM039', d: [100, 0, 0] });
      const toolMap = mkToolMap([tool]);

      const result = groupDemandIntoBuckets(
        [op],
        { PRM039: 'running' },
        { T01: 'running' },
        [],
        toolMap,
        [true, true, true],
        3,
      );

      const sku = result['PRM039'][0].skus[0];
      // prodMin = (100 / 100) * 60 / 0.8 = 75
      expect(sku.prodMin).toBeCloseTo(75, 1);
    });

    it('OEE nunca é 1.0 por defeito (prova negativa)', () => {
      // Cria tool SEM oee → deve usar 0.66
      const tool = mkTool({ id: 'T01', pH: 100, lt: 0, m: 'PRM039' });
      const op = mkOp({ id: 'OP01', t: 'T01', m: 'PRM039', d: [100, 0, 0] });
      const toolMap = mkToolMap([tool]);

      const result = groupDemandIntoBuckets(
        [op],
        { PRM039: 'running' },
        { T01: 'running' },
        [],
        toolMap,
        [true, true, true],
        3,
      );

      const sku = result['PRM039'][0].skus[0];
      // Com OEE=1.0: prodMin = 60 min
      // Com OEE=0.66: prodMin ≈ 90.91 min
      // A diferença é > 30 min — impossível confundir
      expect(sku.prodMin).toBeGreaterThan(60);
      expect(sku.prodMin).toBeCloseTo(90.91, 0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════
//  CONDICIONAL 3 — Ignorar "vermelhos" em máquinas e ferramentas
//
//  Regra: ISOP red cells são ruído visual, NÃO bloqueiam planeamento.
//  Só FailureEvent[] com campos estruturados podem bloquear.
// ═══════════════════════════════════════════════════════════════════════

describe('CONDICIONAL 3 — Ignorar vermelhos ISOP', () => {
  it('transformPlanState ignora machineStatus/toolStatus (red cells)', () => {
    const ps = mkMinimalPlanState({
      machineStatus: { PRM039: 'down', PRM031: 'down' },
      toolStatus: { BWI003: 'down' },
    });

    const engine = transformPlanState(ps);

    // Todas as máquinas e tools devem ser 'running'
    expect(engine.mSt['PRM039']).toBe('running');
    expect(engine.mSt['PRM031']).toBe('running');
    expect(engine.tSt['BWI003']).toBe('running');
  });

  it('transformPlanState sem status → tudo running', () => {
    const ps = mkMinimalPlanState();
    const engine = transformPlanState(ps);

    expect(engine.mSt['PRM039']).toBe('running');
    expect(engine.mSt['PRM031']).toBe('running');
    expect(engine.tSt['BWI003']).toBe('running');
  });

  it('mesmo ficheiro com "vermelho" vs sem "vermelho" gera MESMO plano', () => {
    // Cenário 1: sem status (limpo)
    const psClean = mkMinimalPlanState();
    const engineClean = transformPlanState(psClean);
    const resultClean = scheduleAll({
      ops: engineClean.ops,
      mSt: engineClean.mSt,
      tSt: engineClean.tSt,
      moves: [],
      machines: engineClean.machines,
      toolMap: engineClean.toolMap,
      workdays: engineClean.workdays,
      nDays: engineClean.nDays,
    });

    // Cenário 2: tudo marcado como 'down' (vermelho)
    const psRed = mkMinimalPlanState({
      machineStatus: { PRM039: 'down', PRM031: 'down' },
      toolStatus: { BWI003: 'down' },
    });
    const engineRed = transformPlanState(psRed);
    const resultRed = scheduleAll({
      ops: engineRed.ops,
      mSt: engineRed.mSt,
      tSt: engineRed.tSt,
      moves: [],
      machines: engineRed.machines,
      toolMap: engineRed.toolMap,
      workdays: engineRed.workdays,
      nDays: engineRed.nDays,
    });

    // Blocos ok devem ser IDÊNTICOS
    const cleanBlocks = resultClean.blocks.filter((b) => b.type === 'ok');
    const redBlocks = resultRed.blocks.filter((b) => b.type === 'ok');

    // Mesma quantidade de blocos
    expect(redBlocks.length).toBe(cleanBlocks.length);

    // Mesma produção total
    const cleanQty = cleanBlocks.reduce((s, b) => s + b.qty, 0);
    const redQty = redBlocks.reduce((s, b) => s + b.qty, 0);
    expect(redQty).toBe(cleanQty);

    // Mesmas máquinas alocadas
    const cleanMachines = cleanBlocks.map((b) => b.machineId).sort();
    const redMachines = redBlocks.map((b) => b.machineId).sort();
    expect(redMachines).toEqual(cleanMachines);

    // Mesmos dias
    const cleanDays = cleanBlocks.map((b) => b.dayIdx).sort();
    const redDays = redBlocks.map((b) => b.dayIdx).sort();
    expect(redDays).toEqual(cleanDays);

    // Nenhum bloco bloqueado em nenhum cenário
    expect(resultClean.blocks.filter((b) => b.blocked).length).toBe(0);
    expect(resultRed.blocks.filter((b) => b.blocked).length).toBe(0);
  });

  it('apenas FailureEvent[] pode bloquear (campo estruturado explícito)', () => {
    // PlanState com FailureEvent real para a máquina
    const ps = mkMinimalPlanState({
      failureEvents: [
        {
          id: 'fail-1',
          resourceType: 'machine',
          resourceId: 'PRM039',
          startDay: 0,
          startShift: null,
          endDay: 4,
          endShift: null,
          severity: 'total',
          capacityFactor: 0,
          description: 'Avaria total — campo estruturado',
        },
      ],
    });
    const engine = transformPlanState(ps);

    // A máquina continua 'running' no mSt (transform ignora)
    // mas o FailureEvent é propagado via pipeline separado
    expect(engine.mSt['PRM039']).toBe('running');

    // O failureEvents é passado ao pipeline de scheduling que o processa
    // via buildResourceTimelines. Aqui verificamos que o transform
    // não bloqueia por si — o bloqueio só vem dos FailureEvents.
  });

  it('bypass do transform com mSt=down BLOQUEIA (prova que guard está no transform)', () => {
    const ps = mkMinimalPlanState();
    const engine = transformPlanState(ps);

    // Bypass: forçar 'down' diretamente
    const badMSt = { ...engine.mSt, PRM039: 'down' };

    const resultBad = scheduleAll({
      ops: engine.ops,
      mSt: badMSt,
      tSt: engine.tSt,
      moves: [],
      machines: engine.machines,
      toolMap: engine.toolMap,
      workdays: engine.workdays,
      nDays: engine.nDays,
    });

    // Com bypass, operação é bloqueada
    const okBlocks = resultBad.blocks.filter((b) => b.opId === 'OP01' && b.type === 'ok');
    expect(okBlocks.reduce((s, b) => s + b.qty, 0)).toBe(0);

    const blockedBlocks = resultBad.blocks.filter((b) => b.opId === 'OP01' && b.blocked);
    expect(blockedBlocks.length).toBeGreaterThan(0);
  });
});
