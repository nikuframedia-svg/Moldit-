// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — SetupCrew Constraint
//  Factory-wide: max 1 setup at a time across all machines
//  (Doc Mestre §6.2.3)
//
//  Mode: HARD — the setup crew is a single shared physical
//  resource. When a conflict exists, the engine MUST delay
//  the setup to the next available slot or block if no room.
// ═══════════════════════════════════════════════════════════

// ── Internal types ──

/** A booked setup time slot */
interface SetupSlot {
  start: number;
  end: number;
  machineId: string;
}

/** Result of checking setup crew availability */
export interface SetupCrewCheckResult {
  /** The earliest minute the setup can start without conflict (-1 if none in shift) */
  availableAt: number;
  /** Whether there is a conflict at the requested time */
  hasConflict: boolean;
  /** The conflicting slot (if any) */
  conflictWith?: { machineId: string; start: number; end: number };
}

// ── Factory ──

/**
 * Creates a SetupCrew constraint instance.
 *
 * SetupCrew ensures that only one machine performs a setup (tool change)
 * at any given time across the entire factory. This reflects the reality
 * that the setup crew is a single shared resource.
 *
 * This is a HARD constraint: the engine delays to the next available slot
 * or blocks if no room exists in the current shift.
 *
 * @example
 * ```ts
 * const crew = createSetupCrew()
 * const result = crew.check(420, 30, 930)  // start=07:00, dur=30min, shiftEnd=15:30
 * if (!result.hasConflict) {
 *   crew.book(result.availableAt, result.availableAt + 30, 'PRM019')
 * }
 * ```
 */
export function createSetupCrew() {
  const slots: SetupSlot[] = [];

  return {
    /**
     * Find the next available slot for a setup of the given duration.
     * Iterates through existing bookings to find a gap.
     *
     * @param earliest  - Earliest absolute minute the setup can start
     * @param duration  - Setup duration in minutes
     * @param shiftEnd  - Absolute minute when the current shift ends
     * @returns Absolute minute to start, or -1 if no room in this shift
     */
    findNextAvailable(earliest: number, duration: number, shiftEnd: number): number {
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
     * Check whether a setup can proceed at the given time without conflict.
     * Returns detailed information about availability and any conflict.
     *
     * @param earliest  - Desired start time (absolute minutes)
     * @param duration  - Setup duration in minutes
     * @param shiftEnd  - Shift end time (absolute minutes)
     * @returns SetupCrewCheckResult with availability info
     */
    check(earliest: number, duration: number, shiftEnd: number): SetupCrewCheckResult {
      // Check for conflict at the exact requested time
      let conflictSlot: SetupSlot | undefined;
      for (const s of slots) {
        if (earliest < s.end && earliest + duration > s.start) {
          conflictSlot = s;
          break;
        }
      }

      const availableAt = this.findNextAvailable(earliest, duration, shiftEnd);

      return {
        availableAt,
        hasConflict: conflictSlot !== undefined,
        conflictWith: conflictSlot
          ? { machineId: conflictSlot.machineId, start: conflictSlot.start, end: conflictSlot.end }
          : undefined,
      };
    },

    /**
     * Book a setup slot. Call this after scheduling the setup.
     *
     * @param start     - Start time (absolute minutes)
     * @param end       - End time (absolute minutes)
     * @param machineId - Machine performing the setup
     */
    book(start: number, end: number, machineId: string): void {
      slots.push({ start, end, machineId });
    },

    /** Get all booked setup slots (read-only copy) */
    getSlots(): ReadonlyArray<Readonly<SetupSlot>> {
      return [...slots];
    },

    /** Clear all booked slots (for test or reset) */
    clear(): void {
      slots.length = 0;
    },
  };
}

/** The return type of createSetupCrew() */
export type SetupCrew = ReturnType<typeof createSetupCrew>;
