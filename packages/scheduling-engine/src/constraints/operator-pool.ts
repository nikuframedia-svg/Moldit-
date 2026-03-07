// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — OperatorPool Constraint (Labor-Group-Based)
//  Per-window, per-labor-group operator capacity check.
//
//  Uses WorkforceConfig with LaborWindow[] per labor group
//  (Grandes, Medias). Capacity varies by time window:
//    07:00-15:30, 15:30-16:00, 16:00-00:00
//
//  Mode: ADVISORY — operator capacity warns but never blocks.
//
//  Peak concurrent model: each machine's peak operator demand
//  in a window is tracked; group total = sum of machine peaks.
//
//  R8: Machines not mapped → unmapped=true (flagged, not blocked).
//  R9: Blocks spanning windows → evaluated per segment, WORST wins.
// ═══════════════════════════════════════════════════════════

import type { LaborWindow, WorkforceConfig } from '../types/workforce.js';

// ── Result type ──

/** Result of checking operator capacity */
export interface OperatorCheckResult {
  /** Whether there is enough capacity (across all overlapping windows) */
  hasCapacity: boolean;
  /** Available operator slots (minimum across windows) */
  available: number;
  /** Resolved labor group (undefined if machine not mapped) */
  laborGroup: string | undefined;
  /** Whether the machine is not mapped to any labor group (R8) */
  unmapped: boolean;
  /** Worst window shortage: max(0, peakNeed - capacity) across windows */
  worstWindowShortage: number;
}

// ── Factory ──

/**
 * Creates an OperatorPool constraint instance using labor-group-based configuration.
 *
 * Machines are mapped to labor groups via config.machineToLaborGroup.
 * Capacity is looked up per labor group per time window.
 * Machines not in the mapping are unconstrained but flagged as unmapped (R8).
 *
 * Uses a "peak concurrent" model: each machine's peak operator demand
 * in a window is tracked, and the group total is the sum of peaks.
 *
 * @param config - WorkforceConfig with laborGroups and machine-to-laborGroup mapping
 */
export function createOperatorPool(config: WorkforceConfig) {
  /**
   * Resolve labor group for a machine. Returns undefined if not mapped.
   */
  function resolveLaborGroup(machineId: string): string | undefined {
    return config.machineToLaborGroup[machineId];
  }

  /**
   * Get all windows that overlap with a time range [startMin, endMin).
   */
  function getOverlappingWindows(
    laborGroup: string,
    startMin: number,
    endMin: number,
  ): LaborWindow[] {
    const windows = config.laborGroups[laborGroup];
    if (!windows) return [];
    return windows.filter((w) => startMin < w.end && endMin > w.start);
  }

  // ── State ──

  /** Peak operators per machine per window: key = "di:windowStart:machineId" */
  const machPeak: Record<string, number> = {};

  /** Sum of peaks per group per window: key = "di:windowStart:laborGroup" */
  const groupTotal: Record<string, number> = {};

  return {
    /**
     * Check if there is enough operator capacity for a block [startMin, endMin).
     * Does NOT modify state — use book() to commit.
     *
     * R9: If the block spans multiple windows, checks each segment separately
     * and returns the WORST result.
     *
     * R8: Machines not mapped return unmapped=true.
     *
     * @param di        - Day index (0-based)
     * @param startMin  - Block start minute within day
     * @param endMin    - Block end minute within day
     * @param operators - Number of operators needed
     * @param machineId - Machine ID (resolved to labor group internally)
     * @returns OperatorCheckResult
     */
    checkCapacity(
      di: number,
      startMin: number,
      endMin: number,
      operators: number,
      machineId: string,
    ): OperatorCheckResult {
      const laborGroup = resolveLaborGroup(machineId);
      if (!laborGroup) {
        return {
          hasCapacity: true,
          available: Infinity,
          laborGroup: undefined,
          unmapped: true,
          worstWindowShortage: 0,
        };
      }

      const windows = getOverlappingWindows(laborGroup, startMin, endMin);
      if (windows.length === 0) {
        return {
          hasCapacity: true,
          available: Infinity,
          laborGroup,
          unmapped: false,
          worstWindowShortage: 0,
        };
      }

      let overallHasCapacity = true;
      let minAvailable = Infinity;
      let worstShortage = 0;

      for (const w of windows) {
        const machKey = `${di}:${w.start}:${machineId}`;
        const groupKey = `${di}:${w.start}:${laborGroup}`;

        const currentMachPeak = machPeak[machKey] || 0;
        const delta = Math.max(0, operators - currentMachPeak);
        const currentGroupTotal = groupTotal[groupKey] || 0;
        const newTotal = currentGroupTotal + delta;

        const available = w.capacity - currentGroupTotal;
        if (available < minAvailable) minAvailable = available;

        if (newTotal > w.capacity) {
          overallHasCapacity = false;
          const shortage = newTotal - w.capacity;
          if (shortage > worstShortage) worstShortage = shortage;
        }
      }

      return {
        hasCapacity: overallHasCapacity,
        available: Math.max(0, minAvailable),
        laborGroup,
        unmapped: false,
        worstWindowShortage: worstShortage,
      };
    },

    /**
     * Simplified capacity check (returns boolean).
     */
    hasCapacity(
      di: number,
      startMin: number,
      endMin: number,
      operators: number,
      machineId: string,
    ): boolean {
      return this.checkCapacity(di, startMin, endMin, operators, machineId).hasCapacity;
    },

    /**
     * Book operator demand. Updates the peak model state.
     * Call this AFTER deciding to schedule the block.
     *
     * R9: Books into each overlapping window segment separately.
     *
     * @param di        - Day index (0-based)
     * @param startMin  - Block start minute within day
     * @param endMin    - Block end minute within day
     * @param operators - Number of operators
     * @param machineId - Machine ID (resolved to labor group internally)
     */
    book(di: number, startMin: number, endMin: number, operators: number, machineId: string): void {
      const laborGroup = resolveLaborGroup(machineId);
      if (!laborGroup) return;

      const windows = getOverlappingWindows(laborGroup, startMin, endMin);

      for (const w of windows) {
        const machKey = `${di}:${w.start}:${machineId}`;
        const currentMachPeak = machPeak[machKey] || 0;
        const delta = Math.max(0, operators - currentMachPeak);
        machPeak[machKey] = Math.max(currentMachPeak, operators);

        const groupKey = `${di}:${w.start}:${laborGroup}`;
        groupTotal[groupKey] = (groupTotal[groupKey] || 0) + delta;
      }
    },

    /**
     * Get current usage for a labor group/window/day.
     *
     * @param di          - Day index
     * @param windowStart - Window start minute
     * @param laborGroup  - Labor group ID
     * @returns Current total operator demand (sum of machine peaks)
     */
    getCurrentUsage(di: number, windowStart: number, laborGroup: string): number {
      return groupTotal[`${di}:${windowStart}:${laborGroup}`] || 0;
    },

    /**
     * Resolve the labor group for a machine.
     */
    getLaborGroup(machineId: string): string | undefined {
      return resolveLaborGroup(machineId);
    },

    /** Clear all state (for test or reset) */
    clear(): void {
      for (const key of Object.keys(machPeak)) delete machPeak[key];
      for (const key of Object.keys(groupTotal)) delete groupTotal[key];
    },
  };
}

/** The return type of createOperatorPool() */
export type OperatorPool = ReturnType<typeof createOperatorPool>;
