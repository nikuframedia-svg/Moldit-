// compute/machine-network.ts — Feature 7: Machine Alternative Network

import { MACHINE_AREA, MACHINES } from './constants';
import type { HeatmapCell } from './heatmap';
import type { DateContext, NkData } from './types';

export interface NetworkNode {
  id: string;
  area: string;
  toolCount: number;
  totalLoad: number;
  isolated: boolean;
  x: number;
  y: number;
}

export interface NetworkEdge {
  from: string;
  to: string;
  tools: string[];
  weight: number;
  bidirectional: boolean;
}

export function computeMachineNetwork(
  nk: NkData,
  heatmap: HeatmapCell[][],
  ctx: DateContext,
): {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
} {
  // Build edges from tool alternatives
  const edgeMap: Record<string, { tools: Set<string>; reverse: boolean }> = {};

  for (const tool of nk.tools) {
    if (!MACHINES.includes(tool.m as (typeof MACHINES)[number])) continue;
    if (!tool.alt || tool.alt === '-') continue;
    if (!MACHINES.includes(tool.alt as (typeof MACHINES)[number])) continue;

    const key = [tool.m, tool.alt].sort().join('→');
    if (!edgeMap[key]) edgeMap[key] = { tools: new Set(), reverse: false };
    edgeMap[key].tools.add(tool.id);

    const reverseKey = [tool.alt, tool.m].sort().join('→');
    if (reverseKey === key) edgeMap[key].reverse = true;
  }

  const edges: NetworkEdge[] = Object.entries(edgeMap).map(([key, data]) => {
    const [from, to] = key.split('→');
    return {
      from,
      to,
      tools: [...data.tools],
      weight: data.tools.size,
      bidirectional: data.reverse || data.tools.size > 2,
    };
  });

  // Build nodes
  const nodes: NetworkNode[] = MACHINES.map((m, mi) => {
    const toolCount = nk.tools.filter((t) => t.m === m).length;
    const totalLoad = heatmap[mi]?.reduce((s, c) => s + c.pct, 0) || 0;
    const hasEdge = edges.some((e) => e.from === m || e.to === m);
    return {
      id: m,
      area: MACHINE_AREA[m],
      toolCount,
      totalLoad: totalLoad / (ctx.workingDates.length || 1),
      isolated: !hasEdge,
      x: 0,
      y: 0,
    };
  });

  // Simple force-directed layout
  const W = 500,
    H = 400;
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    n.x = W / 2 + Math.cos(angle) * W * 0.3;
    n.y = H / 2 + Math.sin(angle) * H * 0.3;
  });

  for (let iter = 0; iter < 200; iter++) {
    const alpha = 1 - iter / 200;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (3000 * alpha) / (d * d);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        nodes[i].x -= fx;
        nodes[j].x += fx;
        nodes[i].y -= fy;
        nodes[j].y += fy;
      }
    }

    for (const e of edges) {
      const si = nodes.findIndex((n) => n.id === e.from);
      const ti = nodes.findIndex((n) => n.id === e.to);
      if (si < 0 || ti < 0) continue;
      const dx = nodes[ti].x - nodes[si].x;
      const dy = nodes[ti].y - nodes[si].y;
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
      const force = d * 0.015 * alpha * e.weight;
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      nodes[si].x += fx;
      nodes[ti].x -= fx;
      nodes[si].y += fy;
      nodes[ti].y -= fy;
    }

    const cx = nodes.reduce((a, n) => a + n.x, 0) / nodes.length;
    const cy = nodes.reduce((a, n) => a + n.y, 0) / nodes.length;
    for (const n of nodes) {
      n.x += (W / 2 - cx) * 0.1;
      n.y += (H / 2 - cy) * 0.1;
    }
  }

  for (const n of nodes) {
    n.x = Math.max(40, Math.min(W - 40, n.x));
    n.y = Math.max(40, Math.min(H - 40, n.y));
  }

  return { nodes, edges };
}
