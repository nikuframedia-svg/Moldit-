// compute/index-builders.ts — Data indexing helpers

import { getCustomerForItem } from './constants';
import type { NkData, NkTool, SnapshotFixture } from './types';

export interface RoutingIndex {
  machine: string;
  altMachines: string[];
  toolCode: string;
  setupTime: number;
  rate: number;
  operators: number;
}

export function buildRoutingIndex(snap: SnapshotFixture): Record<string, RoutingIndex> {
  const idx: Record<string, RoutingIndex> = {};
  for (const r of snap.routing) {
    const op = r.operations[0];
    if (!op) continue;
    idx[r.item_sku] = {
      machine: op.resource_code,
      altMachines: op.alt_resources || [],
      toolCode: op.tool_code,
      setupTime: op.setup_time,
      rate: op.rate_pieces_per_hour,
      operators: op.operators_required,
    };
  }
  return idx;
}

export function buildToolIndex(nk: NkData): Record<string, NkTool> {
  const idx: Record<string, NkTool> = {};
  for (const t of nk.tools) idx[t.id] = t;
  return idx;
}

export function buildSeriesBySkuDate(
  snap: SnapshotFixture,
): Record<string, Record<string, number>> {
  const idx: Record<string, Record<string, number>> = {};
  for (const s of snap.series) {
    if (!idx[s.item_sku]) idx[s.item_sku] = {};
    const existing = idx[s.item_sku][s.date];
    if (existing === undefined) {
      idx[s.item_sku][s.date] = s.value;
    } else {
      idx[s.item_sku][s.date] = Math.min(existing, s.value);
    }
  }
  return idx;
}

// Group series entries preserving customer context via item ranges
export function buildSeriesByItemId(snap: SnapshotFixture): Array<{
  itemId: string;
  sku: string;
  customerCode: string;
  entries: Array<{ date: string; value: number }>;
}> {
  const result: Array<{
    itemId: string;
    sku: string;
    customerCode: string;
    entries: Array<{ date: string; value: number }>;
  }> = [];

  // Build a map from operation_id to customer code
  const opCustomer: Record<string, string> = {};
  for (const r of snap.routing) {
    for (const op of r.operations) {
      const num = parseInt(op.operation_id.replace('op-', ''), 10);
      opCustomer[op.operation_id] = getCustomerForItem(`item-${String(num).padStart(4, '0')}`);
    }
  }

  // Group series by (sku, block position)
  const skuOps: Record<string, string[]> = {};
  for (const r of snap.routing) {
    skuOps[r.item_sku] = r.operations.map((o) => o.operation_id);
  }

  const skuEntryCount: Record<string, number> = {};
  const skuBlockBounds: Record<string, Array<{ opId: string; start: number; end: number }>> = {};

  for (const s of snap.series) {
    skuEntryCount[s.item_sku] = (skuEntryCount[s.item_sku] || 0) + 1;
  }

  for (const sku of Object.keys(skuOps)) {
    const ops = skuOps[sku];
    const total = skuEntryCount[sku] || 0;
    if (ops.length <= 1 || total === 0) continue;
    skuBlockBounds[sku] = [];
  }

  const skuSeenCount: Record<string, number> = {};
  const blockEntries: Record<string, Array<{ date: string; value: number }>> = {};

  for (const s of snap.series) {
    const count = skuSeenCount[s.item_sku] || 0;
    skuSeenCount[s.item_sku] = count + 1;

    const ops = skuOps[s.item_sku] || [];
    if (ops.length <= 1) {
      const key = ops[0] || s.item_sku;
      if (!blockEntries[key]) blockEntries[key] = [];
      blockEntries[key].push({ date: s.date, value: s.value });
    } else {
      const key = `${s.item_sku}::${count}`;
      if (!blockEntries[key]) blockEntries[key] = [];
      blockEntries[key].push({ date: s.date, value: s.value });
    }
  }

  // Build result from single-op entries
  for (const r of snap.routing) {
    if (r.operations.length === 1) {
      const opId = r.operations[0].operation_id;
      const entries = blockEntries[opId] || [];
      if (entries.length === 0) continue;
      result.push({
        itemId: opId,
        sku: r.item_sku,
        customerCode: opCustomer[opId] || '210020',
        entries,
      });
    } else {
      // Multi-op: reconstruct blocks from indexed entries
      const blocks: Array<Array<{ date: string; value: number }>> = [];
      let currentBlock: Array<{ date: string; value: number }> = [];
      let lastDate = '';

      const totalEntries = skuEntryCount[r.item_sku] || 0;
      for (let i = 0; i < totalEntries; i++) {
        const key = `${r.item_sku}::${i}`;
        const entries = blockEntries[key];
        if (!entries) continue;
        for (const e of entries) {
          if (lastDate && e.date <= lastDate && currentBlock.length > 0) {
            blocks.push([...currentBlock]);
            currentBlock = [];
          }
          currentBlock.push(e);
          lastDate = e.date;
        }
      }
      if (currentBlock.length > 0) blocks.push(currentBlock);

      // Assign blocks to operations
      for (let i = 0; i < Math.min(blocks.length, r.operations.length); i++) {
        const opId = r.operations[i].operation_id;
        result.push({
          itemId: opId,
          sku: r.item_sku,
          customerCode: opCustomer[opId] || '210020',
          entries: blocks[i],
        });
      }
    }
  }

  return result;
}
