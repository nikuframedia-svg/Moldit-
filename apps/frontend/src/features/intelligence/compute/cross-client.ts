// compute/cross-client.ts — Feature 5: Cross-Client SKU Aggregation

import { buildRoutingIndex, buildSeriesByItemId } from './index-builders';
import type { NkData, SnapshotFixture } from './types';

export interface CrossClientSku {
  sku: string;
  name: string;
  machine: string;
  tool: string;
  rate: number;
  clients: Array<{ code: string; name: string; totalDemand: number }>;
  totalDemand: number;
  requiredHours: number;
}

export function computeCrossClientAggregation(
  snap: SnapshotFixture,
  _nk: NkData,
): CrossClientSku[] {
  const ri = buildRoutingIndex(snap);
  const customerMap = Object.fromEntries(snap.master_data.customers.map((c) => [c.code, c.name]));
  const itemName = Object.fromEntries(snap.master_data.items.map((i) => [i.sku, i.name]));
  const perClient = buildSeriesByItemId(snap);

  const bySku: Record<
    string,
    Array<{ code: string; entries: Array<{ date: string; value: number }> }>
  > = {};
  for (const entry of perClient) {
    if (!bySku[entry.sku]) bySku[entry.sku] = [];
    bySku[entry.sku].push({ code: entry.customerCode, entries: entry.entries });
  }

  const results: CrossClientSku[] = [];
  for (const [sku, clients] of Object.entries(bySku)) {
    const uniqueClients = [...new Set(clients.map((c) => c.code))];
    if (uniqueClients.length < 2) continue;

    const route = ri[sku];
    const clientData = uniqueClients.map((code) => {
      const clientEntries = clients.filter((c) => c.code === code);
      let totalDemand = 0;
      for (const ce of clientEntries) {
        for (const e of ce.entries) {
          if (e.value < 0) totalDemand = Math.max(totalDemand, Math.abs(e.value));
        }
      }
      return { code, name: customerMap[code] || code, totalDemand };
    });

    const totalDemand = clientData.reduce((s, c) => s + c.totalDemand, 0);
    const rate = route?.rate || 1;
    const requiredHours = totalDemand / rate;

    results.push({
      sku,
      name: itemName[sku] || sku,
      machine: route?.machine || '-',
      tool: route?.toolCode || '-',
      rate,
      clients: clientData.sort((a, b) => b.totalDemand - a.totalDemand),
      totalDemand,
      requiredHours,
    });
  }

  return results.sort((a, b) => b.totalDemand - a.totalDemand);
}
