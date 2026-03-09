/**
 * generatePresetsFromISOP — Analyzes parsed ISOP data to produce
 * recommended scheduling presets (top client, bottleneck, policy).
 * Pure function, no React dependencies.
 */

import type { NikufraData } from '@/domain/nikufra-types';
import type { ConfigWeights } from '@/features/settings/useConfigPreview';
import type { LoadMeta } from '@/stores/useDataStore';

export type PolicyId =
  | 'incompol_standard'
  | 'max_otd'
  | 'min_setups'
  | 'balanced'
  | 'urgent'
  | 'friday'
  | 'custom';

export interface CustomerTier {
  tier: number;
  multiplier: number;
}

export interface IsopPresets {
  topClient: { id: string; name: string; orderCount: number };
  bottleneckMachine: { id: string; orderCount: number };
  recommendedPolicy: PolicyId;
  recommendedWeights: ConfigWeights;
  customerTiers: Record<string, CustomerTier>;
  stats: { machines: number; skus: number; clients: number; days: number };
}

function defaultTier(name: string): CustomerTier {
  const n = name.toLowerCase();
  if (n.includes('faurecia') || n.includes('forvia')) return { tier: 1, multiplier: 10 };
  if (n.includes('continental') || n.includes('bosch')) return { tier: 2, multiplier: 7 };
  if (!name || name === 'Sem cliente') return { tier: 5, multiplier: 1 };
  return { tier: 3, multiplier: 3 };
}

function countBy<T>(items: T[], key: (item: T) => string | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item) ?? '__unknown__';
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

function maxKey(counts: Record<string, number>): string | undefined {
  let best: string | undefined;
  let bestCount = -1;
  for (const [k, v] of Object.entries(counts)) {
    if (v > bestCount) {
      best = k;
      bestCount = v;
    }
  }
  return best;
}

export function generatePresetsFromISOP(meta: LoadMeta, data: NikufraData): IsopPresets {
  const ops = data.operations;

  // Count orders per client
  const clientCounts = countBy(ops, (o) => o.cl);
  const topClientId = maxKey(clientCounts) ?? '';
  const topClientOp = ops.find((o) => o.cl === topClientId);
  const topClientName = topClientOp?.clNm ?? topClientId;
  const topClientOrders = clientCounts[topClientId] ?? 0;

  // Count orders per machine → bottleneck
  const machineCounts = countBy(ops, (o) => o.m);
  const bottleneckId = maxKey(machineCounts) ?? '';
  const bottleneckOrders = machineCounts[bottleneckId] ?? 0;

  // Determine policy based on client concentration
  const totalOps = ops.length;
  const dominance = totalOps > 0 ? topClientOrders / totalOps : 0;
  const recommendedPolicy: PolicyId = dominance > 0.5 ? 'max_otd' : 'incompol_standard';
  const recommendedWeights: ConfigWeights =
    recommendedPolicy === 'max_otd'
      ? { otd: 90, setup: 5, utilization: 5 }
      : { otd: 70, setup: 20, utilization: 10 };

  // Customer tiers using name-based heuristics
  const customerTiers: Record<string, CustomerTier> = {};
  const uniqueClients = new Map<string, string>();
  for (const op of ops) {
    if (op.cl && !uniqueClients.has(op.cl)) {
      uniqueClients.set(op.cl, op.clNm ?? op.cl);
    }
  }
  for (const [id, name] of uniqueClients) {
    customerTiers[id] = defaultTier(name);
  }
  // Top client always gets Tier 1
  if (topClientId && customerTiers[topClientId]) {
    customerTiers[topClientId] = { tier: 1, multiplier: 10 };
  }

  return {
    topClient: { id: topClientId, name: topClientName, orderCount: topClientOrders },
    bottleneckMachine: { id: bottleneckId, orderCount: bottleneckOrders },
    recommendedPolicy,
    recommendedWeights,
    customerTiers,
    stats: {
      machines: meta.machines,
      skus: meta.skus,
      clients: uniqueClients.size,
      days: meta.dates,
    },
  };
}
