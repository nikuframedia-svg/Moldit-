// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — 2-Opt Resequencing
//  Post-processing pass to reduce setup count by swapping
//  consecutive block pairs within same machine/day.
//  Extracted from run-optimization.ts
// ═══════════════════════════════════════════════════════════

import type { Block } from '../types/blocks.js';
import type { ETool } from '../types/engine.js';

// ── Helper: Count setups ─────────────────────────────────

function countSetups(blocks: Block[]): number {
  let count = 0;
  let lastTool: string | null = null;
  blocks.forEach((b) => {
    if (b.toolId !== lastTool) {
      count++;
      lastTool = b.toolId;
    }
  });
  return Math.max(0, count - 1);
}

// ── 2-Opt Resequencing ───────────────────────────────────

/**
 * Post-processing pass: swap consecutive block pairs within same machine/day
 * to reduce setup count. Respects shift boundaries by recalculating times.
 */
export function twoOptResequence(blocks: Block[], TM: Record<string, ETool>): Block[] {
  const groups = new Map<string, Block[]>();
  blocks.forEach((b) => {
    if (b.type === 'blocked') return;
    const key = `${b.machineId}_${b.dayIdx}`;
    const arr = groups.get(key);
    if (arr) arr.push(b);
    else groups.set(key, [b]);
  });

  const improved: Block[] = [...blocks];
  groups.forEach((dayBlocks) => {
    if (dayBlocks.length < 2) return;

    let best = dayBlocks.slice();
    let bestSetups = countSetups(best);
    let didImprove = true;
    while (didImprove) {
      didImprove = false;
      for (let i = 0; i < best.length - 1; i++) {
        const swapped = best.slice();
        const tmp = swapped[i];
        swapped[i] = swapped[i + 1];
        swapped[i + 1] = tmp;
        const newSetups = countSetups(swapped);
        if (newSetups < bestSetups) {
          best = swapped;
          bestSetups = newSetups;
          didImprove = true;
        }
      }
    }

    if (bestSetups < countSetups(dayBlocks)) {
      let cursor = dayBlocks[0].startMin;
      if (dayBlocks[0].setupS !== null) cursor = dayBlocks[0].setupS!;
      let lastTool: string | null = null;

      best.forEach((b) => {
        const needSetup = b.toolId !== lastTool && TM[b.toolId] && TM[b.toolId].sH > 0;
        const setupDur = needSetup ? TM[b.toolId].sH * 60 : 0;
        const setupS = needSetup ? cursor : null;
        const setupE = needSetup ? cursor + setupDur : null;
        cursor += setupDur;
        const pStart = cursor;
        const pEnd = pStart + b.prodMin;

        const idx = improved.findIndex(
          (ib) => ib.opId === b.opId && ib.dayIdx === b.dayIdx && ib.machineId === b.machineId,
        );
        if (idx !== -1) {
          improved[idx] = {
            ...b,
            startMin: pStart,
            endMin: pEnd,
            setupS,
            setupE,
            setupMin: setupDur,
          };
        }
        cursor = pEnd;
        lastTool = b.toolId;
      });
    }
  });
  return improved;
}
