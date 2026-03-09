// compute/explain-trace.ts — Feature 10: Explain Trace

import { MACHINE_AREA, MACHINES } from './constants';
import type { HeatmapCell } from './heatmap';
import { buildRoutingIndex, buildSeriesBySkuDate, buildToolIndex } from './index-builders';
import type { NkData, SnapshotFixture } from './types';

export interface ExplainStep {
  step: number;
  question: string;
  answer: string;
  evidence: string;
  ok: boolean;
}

export interface ExplainNode {
  sku: string;
  name: string;
  machine: string;
  tool: string;
  steps: ExplainStep[];
}

export function computeExplainTrace(
  snap: SnapshotFixture,
  nk: NkData,
  heatmap: HeatmapCell[][],
): ExplainNode[] {
  const ri = buildRoutingIndex(snap);
  const toolIdx = buildToolIndex(nk);
  const itemName = Object.fromEntries(snap.master_data.items.map((i) => [i.sku, i.name]));
  const seriesIdx = buildSeriesBySkuDate(snap);

  const nodes: ExplainNode[] = [];
  const seen = new Set<string>();

  for (const sku of Object.keys(seriesIdx)) {
    if (seen.has(sku)) continue;
    seen.add(sku);

    const route = ri[sku];
    if (!route) continue;

    const hasDemand = Object.values(seriesIdx[sku]).some((v) => v < 0);
    if (!hasDemand) continue;

    const mi = MACHINES.indexOf(route.machine as (typeof MACHINES)[number]);
    const avgLoad = mi >= 0 ? heatmap[mi].reduce((s, c) => s + c.pct, 0) / heatmap[mi].length : 0;

    const steps: ExplainStep[] = [
      {
        step: 1,
        question: 'Which tool produces this SKU?',
        answer: route.toolCode,
        evidence: `ISOP routing maps ${sku} → ${route.toolCode} (${toolIdx[route.toolCode]?.pH || route.rate} pcs/h)`,
        ok: true,
      },
      {
        step: 2,
        question: 'Primary machine assignment?',
        answer: route.machine,
        evidence: `Tool ${route.toolCode} is assigned to ${route.machine} (${MACHINE_AREA[route.machine]})`,
        ok: true,
      },
      {
        step: 3,
        question: 'Alternative machine available?',
        answer: route.altMachines.length > 0 ? route.altMachines.join(', ') : 'NONE',
        evidence:
          route.altMachines.length > 0
            ? `Can move to ${route.altMachines.join(', ')} if primary overloaded`
            : 'No alternative — critical dependency on ' + route.machine,
        ok: route.altMachines.length > 0,
      },
      {
        step: 4,
        question: 'Setup time required?',
        answer: `${route.setupTime}h (${route.setupTime * 60} min)`,
        evidence: `Tool change to ${route.toolCode} requires ${route.setupTime * 60} min setup (shared crew, cap=1)`,
        ok: route.setupTime <= 1,
      },
      {
        step: 5,
        question: 'Machine capacity sufficient?',
        answer:
          avgLoad < 100
            ? `${avgLoad.toFixed(0)}% avg load — OK`
            : `${avgLoad.toFixed(0)}% avg load — OVERLOADED`,
        evidence: `${route.machine} average utilization across horizon: ${avgLoad.toFixed(1)}%`,
        ok: avgLoad < 100,
      },
      {
        step: 6,
        question: 'Operators available?',
        answer: `${route.operators} operator${route.operators > 1 ? 's' : ''} required`,
        evidence: `${route.operators === 1 ? '81.5%' : '18.5%'} of operations need ${route.operators} operator${route.operators > 1 ? 's' : ''}`,
        ok: true,
      },
    ];

    nodes.push({
      sku,
      name: itemName[sku] || sku,
      machine: route.machine,
      tool: route.toolCode,
      steps,
    });
  }

  return nodes.sort((a, b) => a.sku.localeCompare(b.sku));
}
