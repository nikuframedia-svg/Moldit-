// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — ToolTimeline Constraint
//  No two machines can use the same physical tool at the
//  same time (§6 bdmestre). Tools are physical objects that
//  must be moved between machines.
//
//  Mode: HARD — physically impossible to violate.
//  The engine MUST respect this constraint and delay or
//  block operations when a tool is in use elsewhere.
// ═══════════════════════════════════════════════════════════

import type { ConstraintName } from '../types/constraints.js';

// ── Internal types ──

/** A booked tool usage time slot on a specific machine */
interface ToolSlot {
  start: number;
  end: number;
  machineId: string;
}

/** Result of checking tool availability */
export interface ToolCheckResult {
  /** Whether the tool is available at the requested time/duration */
  isAvailable: boolean;
  /** Earliest minute the tool can be used (-1 if no room in shift) */
  availableAt: number;
  /** Number of conflicting machines (for multi-instance tools) */
  conflictCount: number;
  /** IDs of machines currently using this tool in the overlap window */
  conflictingMachines: string[];
}

// ── Constraint name constant ──

const CONSTRAINT_NAME: ConstraintName = 'TOOL_TIMELINE';
// Used internally for identification; suppress unused warning
void CONSTRAINT_NAME;

// ── Factory ──

/**
 * Creates a ToolTimeline constraint instance.
 *
 * ToolTimeline prevents two machines from using the same physical tool
 * simultaneously. Each tool defaults to 1 instance (one physical copy).
 * Some tools may have multiple instances (e.g., 2 copies of the same mold),
 * controlled by the `instances` parameter.
 *
 * This is a HARD constraint: tools are physical objects, and using
 * a tool that is physically on another machine is impossible.
 *
 * @example
 * ```ts
 * const tl = createToolTimeline()
 * const check = tl.check('BWI003', 500, 600, 'PRM019')
 * if (check.isAvailable) {
 *   tl.book('BWI003', 500, 600, 'PRM019')
 * }
 * ```
 */
export function createToolTimeline() {
  const timelines: Record<string, ToolSlot[]> = {};

  return {
    /**
     * Check whether a tool is available on a given machine during [start, end).
     * A tool on the SAME machine is always compatible (no conflict with self).
     * For tools with multiple instances, up to `instances` machines can use
     * the tool concurrently.
     *
     * @param toolId    - Tool code (e.g., 'BWI003')
     * @param start     - Absolute start minute
     * @param end       - Absolute end minute
     * @param machineId - Machine requesting the tool
     * @param instances - Number of physical tool copies (default 1)
     * @returns true if the tool is available
     */
    isAvailable(
      toolId: string,
      start: number,
      end: number,
      machineId: string,
      instances?: number,
    ): boolean {
      const slots = timelines[toolId];
      if (!slots) return true;
      const maxInst = instances ?? 1;
      const conflicting = new Set<string>();
      for (const s of slots) {
        if (s.machineId === machineId) continue;
        if (start < s.end && end > s.start) conflicting.add(s.machineId);
      }
      return conflicting.size < maxInst;
    },

    /**
     * Find the next available time for a tool on a given machine.
     * Scans existing bookings and finds the earliest gap that fits.
     *
     * @param toolId    - Tool code
     * @param earliest  - Earliest absolute minute
     * @param duration  - Required duration in minutes
     * @param shiftEnd  - Shift end (absolute minutes)
     * @param machineId - Machine requesting the tool
     * @param instances - Number of physical copies (default 1)
     * @returns Absolute minute to start, or -1 if no room in this shift
     */
    findNextAvailable(
      toolId: string,
      earliest: number,
      duration: number,
      shiftEnd: number,
      machineId: string,
      instances?: number,
    ): number {
      const slots = timelines[toolId];
      if (!slots) return earliest;
      const maxInst = instances ?? 1;
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
        if (conflicting.size >= maxInst) {
          let minEnd = Infinity;
          for (const s of slots) {
            if (s.machineId === machineId) continue;
            if (candidate < s.end && candidate + duration > s.start) {
              minEnd = Math.min(minEnd, s.end);
            }
          }
          candidate = minEnd;
          changed = true;
        }
      }
      return candidate + duration <= shiftEnd ? candidate : -1;
    },

    /**
     * Full check combining isAvailable + findNextAvailable with detailed info.
     *
     * @param toolId    - Tool code
     * @param start     - Desired start (absolute minutes)
     * @param duration  - Duration in minutes
     * @param shiftEnd  - Shift end (absolute minutes)
     * @param machineId - Machine requesting the tool
     * @param instances - Number of physical copies (default 1)
     * @returns ToolCheckResult with full availability details
     */
    check(
      toolId: string,
      start: number,
      duration: number,
      shiftEnd: number,
      machineId: string,
      instances?: number,
    ): ToolCheckResult {
      const slots = timelines[toolId];
      const maxInst = instances ?? 1;
      const conflictingMachines: string[] = [];

      if (slots) {
        const seen = new Set<string>();
        for (const s of slots) {
          if (s.machineId === machineId) continue;
          if (start < s.end && start + duration > s.start) {
            if (!seen.has(s.machineId)) {
              seen.add(s.machineId);
              conflictingMachines.push(s.machineId);
            }
          }
        }
      }

      const isAvail = conflictingMachines.length < maxInst;
      const availableAt = isAvail
        ? start
        : this.findNextAvailable(toolId, start, duration, shiftEnd, machineId, instances);

      return {
        isAvailable: isAvail,
        availableAt,
        conflictCount: conflictingMachines.length,
        conflictingMachines,
      };
    },

    /**
     * Book a tool usage on a machine.
     *
     * @param toolId    - Tool code
     * @param start     - Absolute start minute
     * @param end       - Absolute end minute
     * @param machineId - Machine using the tool
     */
    book(toolId: string, start: number, end: number, machineId: string): void {
      if (!timelines[toolId]) timelines[toolId] = [];
      timelines[toolId].push({ start, end, machineId });
    },

    /**
     * Get all bookings for a specific tool (read-only copy).
     *
     * @param toolId - Tool code
     * @returns Array of booked slots
     */
    getBookings(toolId: string): ReadonlyArray<Readonly<ToolSlot>> {
      return timelines[toolId] ? [...timelines[toolId]] : [];
    },

    /** Clear all timelines (for test or reset) */
    clear(): void {
      for (const key of Object.keys(timelines)) {
        delete timelines[key];
      }
    },
  };
}

/** The return type of createToolTimeline() */
export type ToolTimeline = ReturnType<typeof createToolTimeline>;
