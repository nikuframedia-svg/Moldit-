/**
 * gridDensity — Automatic density scaling for multi-day grids.
 *
 * Returns CSS custom properties that scale cell sizes based on nDays.
 * Used by Dashboard, Fabrica, Risk, MRP, MiniGantt, NikufraEngine.
 */

import type { CSSProperties } from 'react';

export function gridDensityVars(nDays: number): CSSProperties {
  if (nDays <= 14) return {};
  if (nDays <= 30)
    return {
      '--grid-day-min': '36px',
      '--grid-cell-font': '10px',
      '--grid-cell-pad': '3px 2px',
      '--grid-day-gap': '2px',
      '--grid-header-font': '10px',
    } as CSSProperties;
  if (nDays <= 60)
    return {
      '--grid-day-min': '28px',
      '--grid-cell-font': '9px',
      '--grid-cell-pad': '2px 1px',
      '--grid-day-gap': '2px',
      '--grid-header-font': '9px',
    } as CSSProperties;
  return {
    '--grid-day-min': '22px',
    '--grid-cell-font': '8px',
    '--grid-cell-pad': '2px 1px',
    '--grid-day-gap': '1px',
    '--grid-header-font': '8px',
  } as CSSProperties;
}

/** Whether to show detailed cell content (pcs, minutes) or just % */
export function showDetailedCells(nDays: number): boolean {
  return nDays <= 30;
}
