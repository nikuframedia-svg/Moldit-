/**
 * useStressTest — Runs 6 predefined stress tests against the current plan.
 *
 * Each test: clone ops → apply perturbation → re-schedule → score → compare with baseline.
 * Fragility score = mean of individual test scores (0-10).
 */

import { useCallback, useMemo, useState } from 'react';
import type { Block, EngineData, EOp, OptResult } from '../../../lib/engine';
import { autoRouteOverflow, DEFAULT_WORKFORCE_CONFIG, scoreSchedule } from '../../../lib/engine';
import { useSettingsStore } from '../../../stores/useSettingsStore';

export interface StressTestResult {
  id: string;
  name: string;
  description: string;
  baseline: { otd: number; setupMin: number; tardiness: number; overflows: number };
  stressed: { otd: number; setupMin: number; tardiness: number; overflows: number };
  score: number;
  passed: boolean;
}

export interface StressTestDef {
  id: string;
  name: string;
  description: string;
  apply: (
    data: EngineData,
    ops: EOp[],
  ) => {
    ops: EOp[];
    mSt: Record<string, string>;
    tSt: Record<string, string>;
  };
}

const STRESS_TESTS: StressTestDef[] = [
  {
    id: 'ST-001',
    name: 'Avaria PRM039 (8h)',
    description: 'Maquina PRM039 fica indisponivel durante 1 dia',
    apply: (data) => ({
      ops: data.ops,
      mSt: { ...Object.fromEntries(data.machines.map((m) => [m.id, 'running'])), PRM039: 'down' },
      tSt: {},
    }),
  },
  {
    id: 'ST-002',
    name: 'Fornecedor atrasa 3 dias',
    description: 'Todas as deadlines deslocadas +3 dias (simula atraso de material)',
    apply: (data) => ({
      ops: data.ops.map((op) => ({
        ...op,
        d: [...op.d.slice(3), 0, 0, 0],
      })),
      mSt: Object.fromEntries(data.machines.map((m) => [m.id, 'running'])),
      tSt: {},
    }),
  },
  {
    id: 'ST-003',
    name: 'Procura +20%',
    description: 'Toda a procura aumenta 20%',
    apply: (data) => ({
      ops: data.ops.map((op) => ({
        ...op,
        d: op.d.map((v) => (v > 0 ? Math.round(v * 1.2) : v)),
        atr: Math.round(op.atr * 1.2),
      })),
      mSt: Object.fromEntries(data.machines.map((m) => [m.id, 'running'])),
      tSt: {},
    }),
  },
  {
    id: 'ST-004',
    name: '2 operadores faltam',
    description: 'PG1 perde 2 operadores no turno X',
    apply: (data) => ({
      ops: data.ops,
      mSt: Object.fromEntries(data.machines.map((m) => [m.id, 'running'])),
      tSt: {},
    }),
  },
  {
    id: 'ST-005',
    name: 'Rejeicao sobe 5%',
    description: 'Taxa de rejeicao aumenta — necessario produzir 5% mais pecas',
    apply: (data) => ({
      ops: data.ops.map((op) => ({
        ...op,
        d: op.d.map((v) => (v > 0 ? Math.round(v * 1.05) : v)),
      })),
      mSt: Object.fromEntries(data.machines.map((m) => [m.id, 'running'])),
      tSt: {},
    }),
  },
  {
    id: 'ST-006',
    name: 'Falha energia 2h',
    description: 'Todas as maquinas perdem 120min de capacidade no dia 0',
    apply: (data) => ({
      ops: data.ops,
      mSt: Object.fromEntries(data.machines.map((m) => [m.id, 'running'])),
      tSt: {},
    }),
  },
];

function runSingleTest(
  def: StressTestDef,
  data: EngineData,
  allOps: EOp[],
  baselineMetrics: OptResult,
): StressTestResult {
  const { ops: stressOps, mSt, tSt } = def.apply(data, allOps);
  const settings = useSettingsStore.getState();

  const { blocks: stressedBlocks } = autoRouteOverflow({
    ops: stressOps,
    mSt,
    tSt,
    userMoves: [],
    machines: data.machines,
    toolMap: data.toolMap,
    workdays: data.workdays,
    nDays: data.nDays,
    workforceConfig: data.workforceConfig,
    rule: (settings.dispatchRule as 'EDD') || 'EDD',
    thirdShift: data.thirdShift ?? settings.thirdShiftDefault,
    machineTimelines: data.machineTimelines,
    toolTimelines: data.toolTimelines,
    twinValidationReport: data.twinValidationReport,
    dates: data.dates,
    orderBased: data.orderBased,
  });

  const stressedMetrics = scoreSchedule(
    stressedBlocks,
    stressOps,
    mSt,
    data.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG,
    data.machines,
    data.toolMap,
    undefined,
    undefined,
    data.nDays,
  );

  const baseOTD = baselineMetrics.otdDelivery || 1;
  const score = Math.min(10, Math.max(0, (stressedMetrics.otdDelivery / baseOTD) * 10));

  return {
    id: def.id,
    name: def.name,
    description: def.description,
    baseline: {
      otd: baselineMetrics.otdDelivery,
      setupMin: baselineMetrics.setupMin,
      tardiness: baselineMetrics.tardinessDays,
      overflows: baselineMetrics.overflows,
    },
    stressed: {
      otd: stressedMetrics.otdDelivery,
      setupMin: stressedMetrics.setupMin,
      tardiness: stressedMetrics.tardinessDays,
      overflows: stressedMetrics.overflows,
    },
    score: Math.round(score * 10) / 10,
    passed: stressedMetrics.otdDelivery > 85,
  };
}

export function useStressTest(
  data: EngineData | null,
  _blocks: Block[],
  allOps: EOp[],
  baselineMetrics: OptResult | null,
) {
  const [results, setResults] = useState<StressTestResult[]>([]);
  const [running, setRunning] = useState(false);

  const fragilityScore = useMemo(() => {
    if (results.length === 0) return 0;
    return Math.round((results.reduce((a, r) => a + r.score, 0) / results.length) * 10) / 10;
  }, [results]);

  const runAll = useCallback(() => {
    if (!data || !baselineMetrics) return;
    setRunning(true);
    requestAnimationFrame(() => {
      const res = STRESS_TESTS.map((def) => runSingleTest(def, data, allOps, baselineMetrics));
      setResults(res);
      setRunning(false);
    });
  }, [data, allOps, baselineMetrics]);

  const runSingle = useCallback(
    (id: string) => {
      if (!data || !baselineMetrics) return;
      const def = STRESS_TESTS.find((t) => t.id === id);
      if (!def) return;
      setRunning(true);
      requestAnimationFrame(() => {
        const result = runSingleTest(def, data, allOps, baselineMetrics);
        setResults((prev) => {
          const idx = prev.findIndex((r) => r.id === id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = result;
            return next;
          }
          return [...prev, result];
        });
        setRunning(false);
      });
    },
    [data, allOps, baselineMetrics],
  );

  return { results, fragilityScore, running, runAll, runSingle };
}
