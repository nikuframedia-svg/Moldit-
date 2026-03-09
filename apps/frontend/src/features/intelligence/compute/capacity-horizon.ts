// compute/capacity-horizon.ts — Feature 8: Capacity Horizon

import { MACHINES } from './constants';
import { dayName, fmtDate } from './date-context';
import { buildRoutingIndex, buildSeriesBySkuDate } from './index-builders';
import type { DateContext, NkData, SnapshotFixture } from './types';

export interface CapacityBar {
  date: string;
  fmtDate: string;
  dayName: string;
  isWorking: boolean;
  machines: Record<string, number>;
  total: number;
}

export function computeCapacityHorizon(
  snap: SnapshotFixture,
  _nk: NkData,
  ctx: DateContext,
): CapacityBar[] {
  const ri = buildRoutingIndex(snap);
  const seriesIdx = buildSeriesBySkuDate(snap);

  return ctx.allDates.map((date) => {
    const working = ctx.isWorking[date] ?? false;
    const machines: Record<string, number> = {};
    for (const m of MACHINES) machines[m] = 0;

    if (working) {
      for (const sku of Object.keys(seriesIdx)) {
        const route = ri[sku];
        if (!route || !MACHINES.includes(route.machine as (typeof MACHINES)[number])) continue;
        const val = seriesIdx[sku][date];
        if (val === undefined || val >= 0) continue;

        const minutes = (Math.abs(val) / route.rate) * 60;
        const remainingWorkDays = ctx.workingDates.filter((d) => d >= date).length || 1;
        machines[route.machine] += minutes / remainingWorkDays;
      }
    }

    const total = Object.values(machines).reduce((s, v) => s + v, 0);

    return {
      date,
      fmtDate: fmtDate(date),
      dayName: dayName(date),
      isWorking: working,
      machines,
      total,
    };
  });
}
