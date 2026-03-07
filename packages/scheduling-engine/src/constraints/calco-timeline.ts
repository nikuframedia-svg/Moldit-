// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — CalcoTimeline Constraint
//  No two machines can use the same calco code simultaneously
//  (FULL_SPEC §8). Calco codes represent material/alloy types
//  that require dedicated furnace or melt preparation.
//
//  Mode: HARD — physically impossible to violate.
//  Two machines cannot draw from the same calco run at once.
// ═══════════════════════════════════════════════════════════

import type { ConstraintName } from '../types/constraints.js';

// ── Internal types ──

/** A booked calco usage time slot */
interface CalcoSlot {
  start: number;
  end: number;
  machineId: string;
}

/** Result of checking calco availability */
export interface CalcoCheckResult {
  /** Whether the calco is available at the requested time */
  isAvailable: boolean;
  /** Earliest minute the calco can be used (-1 if no room in shift) */
  availableAt: number;
  /** Machine currently using this calco (if conflicting) */
  conflictMachine?: string;
}

// ── Constraint name constant ──

const CONSTRAINT_NAME: ConstraintName = 'CALCO_TIMELINE';
// Used internally for identification; suppress unused warning
void CONSTRAINT_NAME;

// ── Factory ──

/**
 * Creates a CalcoTimeline constraint instance.
 *
 * CalcoTimeline prevents two machines from using the same calco code
 * (material alloy preparation) simultaneously. Each calco code is a
 * shared physical resource (furnace batch / melt preparation).
 *
 * This is a HARD constraint: the calco preparation is a single
 * physical batch that cannot be split across machines at the same time.
 *
 * @example
 * ```ts
 * const ct = createCalcoTimeline()
 * const check = ct.check('CALCO-A1', 500, 120, 930)
 * if (check.isAvailable) {
 *   ct.book('CALCO-A1', 500, 620, 'PRM019')
 * }
 * ```
 */
export function createCalcoTimeline() {
  const timelines: Record<string, CalcoSlot[]> = {};

  return {
    /**
     * Check whether a calco code is available during [start, end).
     *
     * @param calcoCode - Calco code (e.g., 'CALCO-A1')
     * @param start     - Absolute start minute
     * @param end       - Absolute end minute
     * @returns true if no other machine is using this calco in the interval
     */
    isAvailable(calcoCode: string, start: number, end: number): boolean {
      const slots = timelines[calcoCode];
      if (!slots) return true;
      return !slots.some((s) => start < s.end && end > s.start);
    },

    /**
     * Find the next available time for a calco code.
     * Scans existing bookings and finds the earliest gap.
     *
     * @param calcoCode - Calco code
     * @param earliest  - Earliest absolute minute
     * @param duration  - Required duration in minutes
     * @param shiftEnd  - Shift end (absolute minutes)
     * @returns Absolute minute to start, or -1 if no room in this shift
     */
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

    /**
     * Full check combining isAvailable + findNextAvailable with detailed info.
     *
     * @param calcoCode - Calco code
     * @param start     - Desired start (absolute minutes)
     * @param duration  - Duration in minutes
     * @param shiftEnd  - Shift end (absolute minutes)
     * @returns CalcoCheckResult with availability details
     */
    check(calcoCode: string, start: number, duration: number, shiftEnd: number): CalcoCheckResult {
      const slots = timelines[calcoCode];
      let conflictMachine: string | undefined;

      if (slots) {
        for (const s of slots) {
          if (start < s.end && start + duration > s.start) {
            conflictMachine = s.machineId;
            break;
          }
        }
      }

      const isAvail = conflictMachine === undefined;
      const availableAt = isAvail
        ? start
        : this.findNextAvailable(calcoCode, start, duration, shiftEnd);

      return {
        isAvailable: isAvail,
        availableAt,
        conflictMachine,
      };
    },

    /**
     * Book a calco code usage on a machine.
     *
     * @param calcoCode - Calco code
     * @param start     - Absolute start minute
     * @param end       - Absolute end minute
     * @param machineId - Machine using the calco
     */
    book(calcoCode: string, start: number, end: number, machineId: string): void {
      if (!timelines[calcoCode]) timelines[calcoCode] = [];
      timelines[calcoCode].push({ start, end, machineId });
    },

    /**
     * Get all bookings for a specific calco code (read-only copy).
     *
     * @param calcoCode - Calco code
     * @returns Array of booked slots
     */
    getBookings(calcoCode: string): ReadonlyArray<Readonly<CalcoSlot>> {
      return timelines[calcoCode] ? [...timelines[calcoCode]] : [];
    },

    /** Clear all timelines (for test or reset) */
    clear(): void {
      for (const key of Object.keys(timelines)) {
        delete timelines[key];
      }
    },
  };
}

/** The return type of createCalcoTimeline() */
export type CalcoTimeline = ReturnType<typeof createCalcoTimeline>;
