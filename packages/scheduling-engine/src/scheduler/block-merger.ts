// =====================================================================
//  INCOMPOL PLAN -- Block Merger
//  Post-merge logic: combines consecutive blocks for the same operation
//  on the same machine/day/shift into single continuous blocks.
//
//  The slot allocator may produce multiple fragments when constraints
//  limit allocation per iteration. This pass merges them for cleaner
//  Gantt visualization and simpler downstream analysis.
//
//  Pure function -- no React, no side effects.
// =====================================================================

import type { Block } from '../types/blocks.js';

/**
 * Merge consecutive blocks for the same operation on the same
 * machine / day / shift into single continuous blocks.
 *
 * Two blocks are merged when ALL of the following hold:
 * - Same opId, toolId, machineId, dayIdx, shift
 * - Same coProductionGroupId (if present — twin co-production blocks)
 * - Previous block endMin === next block startMin (adjacent in time)
 * - Both blocks have type 'ok'
 *
 * The merged block keeps the first block's setupS/setupE and accumulates
 * prodMin and qty. Data gap info from either block is preserved.
 *
 * @param blocks - Raw blocks from the slot allocator
 * @returns Merged blocks with fewer fragments
 */
export function mergeConsecutiveBlocks(blocks: Block[]): Block[] {
  const merged: Block[] = [];

  for (const b of blocks) {
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;

    if (
      prev &&
      prev.opId === b.opId &&
      prev.toolId === b.toolId &&
      prev.machineId === b.machineId &&
      prev.dayIdx === b.dayIdx &&
      prev.shift === b.shift &&
      prev.endMin === b.startMin &&
      prev.type === 'ok' &&
      b.type === 'ok' &&
      (prev.coProductionGroupId ?? null) === (b.coProductionGroupId ?? null)
    ) {
      // Merge into previous block
      prev.endMin = b.endMin;
      prev.prodMin += b.prodMin;
      prev.qty += b.qty;

      // Merge twin co-production outputs
      if (prev.outputs && b.outputs) {
        for (let i = 0; i < prev.outputs.length; i++) {
          const bOut = b.outputs.find((o) => o.opId === prev.outputs![i].opId);
          if (bOut) prev.outputs[i].qty += bOut.qty;
        }
      }

      // Merge data gap info
      if (b.hasDataGap && !prev.hasDataGap) {
        prev.hasDataGap = true;
        prev.dataGapDetail = b.dataGapDetail;
      }
    } else {
      // Start a new block (shallow copy to avoid mutation of input)
      merged.push({ ...b });
    }
  }

  return merged;
}
