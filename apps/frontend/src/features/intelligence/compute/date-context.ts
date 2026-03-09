// compute/date-context.ts — Date context builder + helpers

import type { DateContext, NkData } from './types';

/** Convert NkData dates ("DD/MM" + day labels) to ISO DateContext */
export function buildDateContext(nk: NkData): DateContext {
  const WEEKEND = new Set(['Sáb', 'Sab', 'Dom']);
  let year = 2026;
  let prevMonth = -1;

  const allDates: string[] = [];
  const isWorking: Record<string, boolean> = {};

  for (let i = 0; i < nk.dates.length; i++) {
    const [dd, mm] = nk.dates[i].split('/');
    const month = parseInt(mm, 10);
    if (prevMonth > 0 && month < prevMonth) year++;
    prevMonth = month;
    const iso = `${year}-${mm}-${dd}`;
    allDates.push(iso);
    const label = nk.days_label[i] || '';
    isWorking[iso] = !WEEKEND.has(label);
  }

  const workingDates = allDates.filter((d) => isWorking[d]);
  return { allDates, workingDates, isWorking };
}

// Legacy exports for backward compat (used by NikufraIntel render)
export const ALL_DATES: string[] = [];
export const WORKING_DATES: string[] = [];
export const IS_WORKING: Record<string, boolean> = {};

export function fmtDate(d: string): string {
  const parts = d.split('-');
  return `${parts[2]}/${parts[1]}`;
}

export function dayName(d: string): string {
  const dt = new Date(d);
  return ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'][dt.getDay()];
}

export function workingDaysBetween(from: string, to: string, ctx: DateContext): number {
  let count = 0;
  for (const d of ctx.allDates) {
    if (d >= from && d < to && ctx.isWorking[d]) count++;
  }
  return count;
}
