// =====================================================================
//  INCOMPOL PLAN -- Twin Co-Production Merger
//  Merges twin SkuBucket pairs into single co-production buckets.
//  Extracted from demand-grouper.ts
// =====================================================================

import type { TwinGroup } from '../types/twin.js';
import type { SkuBucket, ToolGroup } from './demand-grouper.js';

/**
 * Merge twin SkuBucket pairs into single co-production buckets.
 * After merging:
 *   - totalQty = max(A, B) — drives MACHINE TIME only
 *   - prodMin = totalQty / pH * 60 / OEE (single run for both)
 *   - isTwinProduction = true
 *   - twinOutputs = [{A info}, {B info}] — each preserves its ACTUAL demand
 *
 * Each SKU gets exactly what it needs (NOT 1:1 equal output).
 * Machine time is driven by the max demand; each side produces independently.
 *
 * Merges ACROSS ToolGroups (different EDDs): collects all buckets for each
 * twin SKU on the same machine, sorts by EDD, and pairs sequentially
 * (1st with 1st, 2nd with 2nd). The first order from either twin triggers
 * co-production for both. EDD of the merged pair = min(A.edd, B.edd).
 * Unpaired remainder buckets stay solo in their original ToolGroups.
 */
export function mergeTwinBuckets(
  mGroups: Record<string, ToolGroup[]>,
  twinGroups: TwinGroup[],
  oee: number,
  skipLotEconomic: boolean = false,
): void {
  for (const tg of twinGroups) {
    const canonicalId = [tg.sku1, tg.sku2].sort().join('|');

    // Scan all machines (twins share the same machine, but could be moved)
    for (const machineId of Object.keys(mGroups)) {
      const groups = mGroups[machineId];

      // 1. Collect ALL buckets for each twin SKU across ALL ToolGroups
      const bucketsA: { bucket: SkuBucket; grp: ToolGroup }[] = [];
      const bucketsB: { bucket: SkuBucket; grp: ToolGroup }[] = [];

      for (const grp of groups) {
        if (grp.toolId !== tg.tool) continue;
        for (const sk of grp.skus) {
          // Match by BOTH sku AND opId to isolate multi-client twin pairs.
          // Without opId filtering, TwinGroup 1 would consume OP65/OP66's
          // buckets (same SKU pair, different client) leaving TwinGroup 2 empty.
          if (sk.sku === tg.sku1 && sk.opId === tg.opId1) bucketsA.push({ bucket: sk, grp });
          else if (sk.sku === tg.sku2 && sk.opId === tg.opId2) bucketsB.push({ bucket: sk, grp });
        }
      }

      // Need at least one bucket from each twin to merge
      if (bucketsA.length === 0 || bucketsB.length === 0) continue;

      // 2. Sort by EDD (ascending — earliest order first)
      bucketsA.sort((x, y) => x.bucket.edd - y.bucket.edd);
      bucketsB.sort((x, y) => x.bucket.edd - y.bucket.edd);

      // 3. Pair sequentially: 1st-1st, 2nd-2nd, etc.
      const pairCount = Math.min(bucketsA.length, bucketsB.length);

      for (let i = 0; i < pairCount; i++) {
        const { bucket: a, grp: grpA } = bucketsA[i];
        const { bucket: b, grp: grpB } = bucketsB[i];

        // Remove originals from their ToolGroups
        grpA.skus = grpA.skus.filter((sk) => sk !== a);
        grpB.skus = grpB.skus.filter((sk) => sk !== b);

        // Compute co-production quantities
        const runQty = Math.max(a.totalQty, b.totalQty);
        const lt = grpA.tool.lt;
        const prodQty = skipLotEconomic ? runQty : lt > 0 ? Math.ceil(runQty / lt) * lt : runQty;
        const effectiveOee = grpA.tool.oee ?? oee;
        const prodMin = ((prodQty / grpA.tool.pH) * 60) / effectiveOee;

        // Create merged bucket (primary = first twin alphabetically)
        const primary = a.sku < b.sku ? a : b;
        const mergedEdd = Math.min(a.edd, b.edd);

        const merged: SkuBucket = {
          ...primary,
          totalQty: runQty,
          prodQty,
          prodMin,
          isTwinProduction: true,
          coProductionGroupId: canonicalId,
          twinOutputs: [
            { opId: a.opId, sku: a.sku, nm: a.nm, totalQty: a.totalQty, atr: a.atr },
            { opId: b.opId, sku: b.sku, nm: b.nm, totalQty: b.totalQty, atr: b.atr },
          ],
          // Use the earlier EDD (more urgent) — first order triggers co-production
          edd: mergedEdd,
          // Merge backlog: max (co-production covers both)
          atr: Math.max(a.atr, b.atr),
        };

        // Add merged bucket to the correct ToolGroup (by merged EDD)
        let targetGrp = groups.find((g) => g.toolId === tg.tool && g.edd === mergedEdd);
        if (!targetGrp) {
          targetGrp = {
            toolId: tg.tool,
            machineId,
            edd: mergedEdd,
            setupMin: grpA.tool.sH * 60,
            totalProdMin: 0,
            skus: [],
            tool: grpA.tool,
          };
          groups.push(targetGrp);
        }
        targetGrp.skus.push(merged);
      }

      // 4. Clean up: remove empty ToolGroups, recalculate totalProdMin
      mGroups[machineId] = groups.filter((g) => g.skus.length > 0);
      for (const g of mGroups[machineId]) {
        g.totalProdMin = g.skus.reduce((s, sk) => s + sk.prodMin, 0);
      }
    }
  }
}
