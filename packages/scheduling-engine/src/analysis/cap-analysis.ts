// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Capacity Analysis
//  Per-machine per-day load computation
//  Extracted from NikufraEngine.tsx capAnalysis()
// ═══════════════════════════════════════════════════════════

import type { Block, DayLoad } from '../types/blocks.js';
import type { EMachine } from '../types/engine.js';

/**
 * Compute per-machine per-day load from scheduled blocks.
 *
 * Returns: Record<machineId, DayLoad[]> where each DayLoad contains
 * production minutes, setup minutes, ops count, pieces, and blocked count.
 */
export function capAnalysis(
  blocks: Block[],
  machines: EMachine[],
  nDays?: number,
): Record<string, DayLoad[]> {
  const cNDays = nDays ?? (blocks.length > 0 ? Math.max(...blocks.map((b) => b.dayIdx)) + 1 : 0);
  const cap: Record<string, DayLoad[]> = {};

  machines.forEach((m) => {
    cap[m.id] = Array.from({ length: cNDays }, () => ({
      prod: 0,
      setup: 0,
      ops: 0,
      pcs: 0,
      blk: 0,
    }));
  });

  blocks.forEach((b) => {
    if (!cap[b.machineId]) return;
    const dc = cap[b.machineId][b.dayIdx];
    if (b.type === 'blocked') {
      dc.blk++;
      return;
    }
    dc.prod += b.endMin - b.startMin;
    if (b.setupS != null && b.setupE != null) dc.setup += b.setupE - b.setupS;
    dc.ops++;
    // Twin co-production: count total physical pieces from all outputs
    dc.pcs += b.isTwinProduction && b.outputs ? b.outputs.reduce((s, o) => s + o.qty, 0) : b.qty;
  });

  return cap;
}
