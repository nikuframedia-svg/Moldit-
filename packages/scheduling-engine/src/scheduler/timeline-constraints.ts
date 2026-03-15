// =====================================================================
//  INCOMPOL PLAN -- Timeline Constraints
//  Calco timeline, tool timeline, and local operator pool helpers.
//  Extracted from slot-allocator.ts
// =====================================================================

import { createOperatorPool } from '../constraints/operator-pool.js';
import type { WorkforceConfig } from '../types/workforce.js';

// ── CalcoTimeline (HARD constraint) ─────────────────────────────

export function createCalcoTimeline() {
  const timelines: Record<string, Array<{ start: number; end: number; machineId: string }>> = {};
  return {
    findNextAvailable(
      calcoCode: string,
      earliest: number,
      duration: number,
      shiftEnd: number,
    ): number {
      const slots = timelines[calcoCode];
      if (!slots) return earliest;
      let candidate = earliest;
      let changed = true;
      let iterations = 0;
      while (changed && iterations < 1000) {
        changed = false;
        iterations++;
        for (const s of slots) {
          if (candidate < s.end && candidate + duration > s.start) {
            candidate = s.end;
            changed = true;
          }
        }
      }
      return candidate + duration <= shiftEnd ? candidate : -1;
    },
    book(calcoCode: string, start: number, end: number, _machineId: string) {
      if (!timelines[calcoCode]) timelines[calcoCode] = [];
      timelines[calcoCode].push({ start, end, machineId: _machineId });
    },
  };
}

// ── ToolTimeline (HARD constraint) ──────────────────────────────

export function createToolTimeline() {
  const timelines: Record<string, Array<{ start: number; end: number; machineId: string }>> = {};
  return {
    findNextAvailable(
      toolId: string,
      earliest: number,
      duration: number,
      shiftEnd: number,
      machineId: string,
    ): number {
      const slots = timelines[toolId];
      if (!slots) return earliest;
      let candidate = earliest;
      let changed = true;
      let iterations = 0;
      while (changed && iterations < 1000) {
        changed = false;
        iterations++;
        const conflicting = new Set<string>();
        for (const s of slots) {
          if (s.machineId === machineId) continue;
          if (candidate < s.end && candidate + duration > s.start) conflicting.add(s.machineId);
        }
        if (conflicting.size >= 1) {
          let minEnd = Infinity;
          for (const s of slots) {
            if (s.machineId === machineId) continue;
            if (candidate < s.end && candidate + duration > s.start)
              minEnd = Math.min(minEnd, s.end);
          }
          candidate = minEnd;
          changed = true;
        }
      }
      return candidate + duration <= shiftEnd ? candidate : -1;
    },
    book(toolId: string, start: number, end: number, machineId: string) {
      if (!timelines[toolId]) timelines[toolId] = [];
      timelines[toolId].push({ start, end, machineId });
    },
  };
}

// ── Operator pool helper (labor-group-based, advisory) ──

export function createLocalOperatorPool(config: WorkforceConfig) {
  return createOperatorPool(config);
}
