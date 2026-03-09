// compute/client-risk.ts — Feature 2: Client Delivery Risk

import { workingDaysBetween } from './date-context';
import { buildRoutingIndex, buildSeriesByItemId } from './index-builders';
import type { DateContext, NkData, SnapshotFixture } from './types';

export interface ClientRiskSku {
  sku: string;
  name: string;
  machine: string;
  tool: string;
  firstDeficitDate: string | null;
  daysToDeficit: number;
  maxDeficit: number;
  status: 'ok' | 'tight' | 'late';
}

export interface ClientRisk {
  clientCode: string;
  clientName: string;
  skus: ClientRiskSku[];
  overallStatus: 'ok' | 'tight' | 'late';
  totalSKUs: number;
  atRiskSKUs: number;
}

export function computeClientRisk(
  snap: SnapshotFixture,
  _nk: NkData,
  ctx: DateContext,
): ClientRisk[] {
  const ri = buildRoutingIndex(snap);
  const customerMap = Object.fromEntries(snap.master_data.customers.map((c) => [c.code, c.name]));
  const itemName = Object.fromEntries(snap.master_data.items.map((i) => [i.sku, i.name]));
  const perClient = buildSeriesByItemId(snap);
  const startDate = ctx.allDates[0] || '2026-02-02';

  const byClient: Record<
    string,
    Array<{ sku: string; entries: Array<{ date: string; value: number }> }>
  > = {};
  for (const entry of perClient) {
    if (!byClient[entry.customerCode]) byClient[entry.customerCode] = [];
    byClient[entry.customerCode].push({ sku: entry.sku, entries: entry.entries });
  }

  const results: ClientRisk[] = [];
  for (const [code, items] of Object.entries(byClient)) {
    const skus: ClientRiskSku[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.sku)) continue;
      seen.add(item.sku);

      const route = ri[item.sku];
      let firstDeficitDate: string | null = null;
      let maxDeficit = 0;
      for (const e of item.entries) {
        if (e.value < 0) {
          if (!firstDeficitDate) firstDeficitDate = e.date;
          maxDeficit = Math.min(maxDeficit, e.value);
        }
      }

      const daysToDeficit = firstDeficitDate
        ? workingDaysBetween(startDate, firstDeficitDate, ctx)
        : 999;

      let status: 'ok' | 'tight' | 'late' = 'ok';
      if (firstDeficitDate && daysToDeficit <= 0) status = 'late';
      else if (firstDeficitDate && daysToDeficit <= 5) status = 'tight';

      skus.push({
        sku: item.sku,
        name: itemName[item.sku] || item.sku,
        machine: route?.machine || '-',
        tool: route?.toolCode || '-',
        firstDeficitDate,
        daysToDeficit,
        maxDeficit: Math.abs(maxDeficit),
        status,
      });
    }

    skus.sort((a, b) => a.daysToDeficit - b.daysToDeficit);

    const atRisk = skus.filter((s) => s.status !== 'ok').length;
    const worst = skus[0]?.status || 'ok';

    results.push({
      clientCode: code,
      clientName: customerMap[code] || code,
      skus,
      overallStatus: atRisk > 0 ? worst : 'ok',
      totalSKUs: skus.length,
      atRiskSKUs: atRisk,
    });
  }

  results.sort((a, b) => {
    const ord = { late: 0, tight: 1, ok: 2 };
    return ord[a.overallStatus] - ord[b.overallStatus] || b.atRiskSKUs - a.atRiskSKUs;
  });

  return results;
}
