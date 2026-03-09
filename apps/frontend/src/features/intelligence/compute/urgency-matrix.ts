// compute/urgency-matrix.ts — Feature 9: Urgency Matrix

import { getCustomerForItem } from './constants';
import { workingDaysBetween } from './date-context';
import { buildRoutingIndex, buildSeriesBySkuDate } from './index-builders';
import type { DateContext, NkData, SnapshotFixture } from './types';

export interface UrgencyPoint {
  sku: string;
  name: string;
  machine: string;
  tool: string;
  daysToDeficit: number;
  maxDeficit: number;
  recoveryHours: number;
  clientCode: string;
  clientName: string;
  rate: number;
}

export function computeUrgencyMatrix(
  snap: SnapshotFixture,
  _nk: NkData,
  ctx: DateContext,
): UrgencyPoint[] {
  const ri = buildRoutingIndex(snap);
  const seriesIdx = buildSeriesBySkuDate(snap);
  const customerMap = Object.fromEntries(snap.master_data.customers.map((c) => [c.code, c.name]));
  const itemName = Object.fromEntries(snap.master_data.items.map((i) => [i.sku, i.name]));
  const startDate = ctx.allDates[0] || '2026-02-02';

  const skuCustomer: Record<string, string> = {};
  for (const item of snap.master_data.items) {
    if (!skuCustomer[item.sku]) {
      skuCustomer[item.sku] = getCustomerForItem(item.item_id);
    }
  }

  const points: UrgencyPoint[] = [];
  const seen = new Set<string>();

  for (const sku of Object.keys(seriesIdx)) {
    if (seen.has(sku)) continue;
    seen.add(sku);

    const route = ri[sku];
    if (!route) continue;

    const sortedDates = Object.keys(seriesIdx[sku]).sort();
    let firstDeficit: string | null = null;
    let maxDeficit = 0;

    for (const d of sortedDates) {
      const v = seriesIdx[sku][d];
      if (v < 0) {
        if (!firstDeficit) firstDeficit = d;
        maxDeficit = Math.max(maxDeficit, Math.abs(v));
      }
    }

    if (!firstDeficit) continue;

    const daysToDeficit = workingDaysBetween(startDate, firstDeficit, ctx);
    const code = skuCustomer[sku] || '210020';

    points.push({
      sku,
      name: itemName[sku] || sku,
      machine: route.machine,
      tool: route.toolCode,
      daysToDeficit,
      maxDeficit,
      recoveryHours: maxDeficit / route.rate,
      clientCode: code,
      clientName: customerMap[code] || code,
      rate: route.rate,
    });
  }

  return points.sort((a, b) => a.daysToDeficit - b.daysToDeficit || b.maxDeficit - a.maxDeficit);
}
