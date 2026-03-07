// =====================================================================
//  INCOMPOL PLAN -- Constraint Tests
//  Verifies all 4 constraints: SetupCrew, ToolTimeline,
//  CalcoTimeline, OperatorPool
//
//  Factory context: Nikufra presses (PRM019/PG1, PRM031/PG2, PRM039/PG2)
//  Shift X: 07:00 (420min) to 15:30 (930min)
//  Shift Y: 15:30 (930min) to 24:00 (1440min)
//
//  Post-refactor: ALL constraints are HARD. No 'soft' mode.
//  No buildViolation() / buildUnknownDataViolation() — violations
//  are now formal InfeasibilityEntry records handled by the scheduler.
// =====================================================================

import { createCalcoTimeline } from '../src/constraints/calco-timeline.js';
import { createOperatorPool } from '../src/constraints/operator-pool.js';
import { createSetupCrew } from '../src/constraints/setup-crew.js';
import { createToolTimeline } from '../src/constraints/tool-timeline.js';
import type { WorkforceConfig } from '../src/types/workforce.js';

// ── Shift constants (from src/constants.ts) ──

const SHIFT_X_START = 420; // 07:00
const SHIFT_X_END = 930; // 15:30
const SHIFT_Y_END = 1440; // 24:00

// ══════════════════════════════════════════════════════════════════════
//  1. SetupCrew — max 1 setup at a time across factory
// ══════════════════════════════════════════════════════════════════════

describe('SetupCrew', () => {
  it('books a setup slot and stores it', () => {
    const crew = createSetupCrew();

    crew.book(SHIFT_X_START, SHIFT_X_START + 30, 'PRM019');

    const slots = crew.getSlots();
    expect(slots).toHaveLength(1);
    expect(slots[0].start).toBe(SHIFT_X_START);
    expect(slots[0].end).toBe(SHIFT_X_START + 30);
    expect(slots[0].machineId).toBe('PRM019');
  });

  it('findNextAvailable returns earliest when no bookings', () => {
    const crew = createSetupCrew();
    const result = crew.findNextAvailable(SHIFT_X_START, 30, SHIFT_X_END);
    expect(result).toBe(SHIFT_X_START);
  });

  it('findNextAvailable returns gap after existing booking', () => {
    const crew = createSetupCrew();
    // PRM031 has setup at 450-480 (30 min)
    crew.book(450, 480, 'PRM031');

    // PRM019 wants setup of 20 min starting at 450
    // Should be pushed to 480 (after PRM031 finishes)
    const result = crew.findNextAvailable(450, 20, SHIFT_X_END);
    expect(result).toBe(480);
  });

  it('findNextAvailable returns -1 when no room in shift', () => {
    const crew = createSetupCrew();
    // Book almost the entire shift X
    crew.book(SHIFT_X_START, SHIFT_X_END - 10, 'PRM039');

    // Try to fit a 20-minute setup -- only 10 min left, should return -1
    const result = crew.findNextAvailable(SHIFT_X_START, 20, SHIFT_X_END);
    expect(result).toBe(-1);
  });

  it('check() detects conflict at requested time', () => {
    const crew = createSetupCrew();
    crew.book(450, 480, 'PRM031');

    const result = crew.check(460, 20, SHIFT_X_END);
    expect(result.hasConflict).toBe(true);
    expect(result.conflictWith).toBeDefined();
    expect(result.conflictWith!.machineId).toBe('PRM031');
    expect(result.availableAt).toBe(480);
  });

  it('check() reports no conflict when time is clear', () => {
    const crew = createSetupCrew();
    crew.book(450, 480, 'PRM031');

    const result = crew.check(500, 20, SHIFT_X_END);
    expect(result.hasConflict).toBe(false);
    expect(result.conflictWith).toBeUndefined();
    expect(result.availableAt).toBe(500);
  });

  it('clear() removes all booked slots', () => {
    const crew = createSetupCrew();
    crew.book(450, 480, 'PRM019');
    crew.book(500, 530, 'PRM031');
    expect(crew.getSlots()).toHaveLength(2);

    crew.clear();
    expect(crew.getSlots()).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  2. ToolTimeline — no tool on 2 machines simultaneously
// ══════════════════════════════════════════════════════════════════════

describe('ToolTimeline', () => {
  it('allows same tool on the same machine (no self-conflict)', () => {
    const tl = createToolTimeline();
    tl.book('BFP079', 450, 600, 'PRM019');

    // Same tool, same machine, overlapping time -- should be OK
    const avail = tl.isAvailable('BFP079', 500, 650, 'PRM019');
    expect(avail).toBe(true);
  });

  it('detects conflict when same tool on different machine', () => {
    const tl = createToolTimeline();
    // BFP079 used on PRM019 from 450 to 600
    tl.book('BFP079', 450, 600, 'PRM019');

    // PRM031 tries to use BFP079 at overlapping time
    const avail = tl.isAvailable('BFP079', 500, 700, 'PRM031');
    expect(avail).toBe(false);
  });

  it('allows different tools on different machines', () => {
    const tl = createToolTimeline();
    tl.book('BFP079', 450, 600, 'PRM019');

    // Different tool (BWI003) on PRM031 -- no conflict
    const avail = tl.isAvailable('BWI003', 450, 600, 'PRM031');
    expect(avail).toBe(true);
  });

  it('allows same tool after previous booking ends', () => {
    const tl = createToolTimeline();
    tl.book('BFP079', 450, 600, 'PRM019');

    // PRM031 uses BFP079 starting at 600 (exactly when PRM019 finishes)
    const avail = tl.isAvailable('BFP079', 600, 750, 'PRM031');
    expect(avail).toBe(true);
  });

  it('findNextAvailable slides past conflicting booking', () => {
    const tl = createToolTimeline();
    tl.book('BFP079', 450, 600, 'PRM019');

    // PRM031 wants BFP079 for 60 min starting at 500
    // Should be pushed to 600 (when PRM019 releases it)
    const next = tl.findNextAvailable('BFP079', 500, 60, SHIFT_X_END, 'PRM031');
    expect(next).toBe(600);
  });

  it('findNextAvailable returns -1 when tool busy for rest of shift', () => {
    const tl = createToolTimeline();
    // Tool busy until very near end of shift
    tl.book('BFP079', 450, SHIFT_X_END - 10, 'PRM019');

    // PRM031 needs 60 minutes -- not enough time left after 920
    const next = tl.findNextAvailable('BFP079', 450, 60, SHIFT_X_END, 'PRM031');
    expect(next).toBe(-1);
  });

  it('check() returns detailed conflict info', () => {
    const tl = createToolTimeline();
    tl.book('BFP079', 450, 600, 'PRM019');

    const result = tl.check('BFP079', 500, 60, SHIFT_X_END, 'PRM031');
    expect(result.isAvailable).toBe(false);
    expect(result.conflictCount).toBe(1);
    expect(result.conflictingMachines).toContain('PRM019');
    expect(result.availableAt).toBe(600);
  });

  it('check() reports available when no conflict', () => {
    const tl = createToolTimeline();

    const result = tl.check('BWI003', 450, 60, SHIFT_X_END, 'PRM039');
    expect(result.isAvailable).toBe(true);
    expect(result.conflictCount).toBe(0);
    expect(result.conflictingMachines).toEqual([]);
    expect(result.availableAt).toBe(450);
  });

  it('clear() removes all timelines', () => {
    const tl = createToolTimeline();
    tl.book('BFP079', 450, 600, 'PRM019');
    tl.book('BWI003', 500, 700, 'PRM039');

    tl.clear();
    expect(tl.getBookings('BFP079')).toEqual([]);
    expect(tl.getBookings('BWI003')).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  3. CalcoTimeline — same calco code conflicts across machines
// ══════════════════════════════════════════════════════════════════════

describe('CalcoTimeline', () => {
  it('allows first booking of a calco code', () => {
    const ct = createCalcoTimeline();
    const avail = ct.isAvailable('CALCO-A1', 450, 600);
    expect(avail).toBe(true);
  });

  it('detects conflict when same calco used on overlapping time', () => {
    const ct = createCalcoTimeline();
    ct.book('CALCO-A1', 450, 600, 'PRM019');

    // PRM031 tries CALCO-A1 while PRM019 is still using it
    const avail = ct.isAvailable('CALCO-A1', 500, 700);
    expect(avail).toBe(false);
  });

  it('allows same calco code after previous booking ends', () => {
    const ct = createCalcoTimeline();
    ct.book('CALCO-A1', 450, 600, 'PRM019');

    // Starts exactly when previous ends
    const avail = ct.isAvailable('CALCO-A1', 600, 750);
    expect(avail).toBe(true);
  });

  it('allows different calco codes at the same time', () => {
    const ct = createCalcoTimeline();
    ct.book('CALCO-A1', 450, 600, 'PRM019');

    // Different calco code -- no conflict
    const avail = ct.isAvailable('CALCO-B2', 450, 600);
    expect(avail).toBe(true);
  });

  it('findNextAvailable pushes past conflicting booking', () => {
    const ct = createCalcoTimeline();
    ct.book('CALCO-A1', 450, 600, 'PRM019');

    // Need 60 min of CALCO-A1, starting at 500
    const next = ct.findNextAvailable('CALCO-A1', 500, 60, SHIFT_X_END);
    expect(next).toBe(600);
  });

  it('findNextAvailable returns -1 when no room in shift', () => {
    const ct = createCalcoTimeline();
    ct.book('CALCO-A1', 450, SHIFT_X_END - 5, 'PRM019');

    // Need 30 min, but only 5 min left after the booking
    const next = ct.findNextAvailable('CALCO-A1', 450, 30, SHIFT_X_END);
    expect(next).toBe(-1);
  });

  it('check() returns conflict details', () => {
    const ct = createCalcoTimeline();
    ct.book('CALCO-A1', 450, 600, 'PRM019');

    const result = ct.check('CALCO-A1', 500, 60, SHIFT_X_END);
    expect(result.isAvailable).toBe(false);
    expect(result.conflictMachine).toBe('PRM019');
    expect(result.availableAt).toBe(600);
  });

  it('check() reports available when no conflict', () => {
    const ct = createCalcoTimeline();

    const result = ct.check('CALCO-A1', 450, 60, SHIFT_X_END);
    expect(result.isAvailable).toBe(true);
    expect(result.conflictMachine).toBeUndefined();
    expect(result.availableAt).toBe(450);
  });

  it('clear() removes all timelines', () => {
    const ct = createCalcoTimeline();
    ct.book('CALCO-A1', 450, 600, 'PRM019');
    ct.book('CALCO-B2', 500, 700, 'PRM031');

    ct.clear();
    expect(ct.getBookings('CALCO-A1')).toEqual([]);
    expect(ct.getBookings('CALCO-B2')).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════
//  4. OperatorPool — per-window per-labor-group operator capacity
// ══════════════════════════════════════════════════════════════════════

describe('OperatorPool', () => {
  // Labor-group-based config:
  //   Grandes (PRM019, PRM031, PRM039):
  //     420-930 cap=6, 930-960 cap=6, 960-1440 cap=5
  //   Medias (PRM042):
  //     420-930 cap=9, 930-960 cap=8, 960-1440 cap=4
  const makeConfig = (): WorkforceConfig => ({
    laborGroups: {
      Grandes: [
        { start: 420, end: 930, capacity: 6 },
        { start: 930, end: 960, capacity: 6 },
        { start: 960, end: 1440, capacity: 5 },
      ],
      Medias: [
        { start: 420, end: 930, capacity: 9 },
        { start: 930, end: 960, capacity: 8 },
        { start: 960, end: 1440, capacity: 4 },
      ],
    },
    machineToLaborGroup: {
      PRM019: 'Grandes',
      PRM031: 'Grandes',
      PRM039: 'Grandes',
      PRM042: 'Medias',
    },
  });

  describe('checkCapacity()', () => {
    it('returns hasCapacity=true when demand fits', () => {
      const pool = createOperatorPool(makeConfig());
      const result = pool.checkCapacity(3, 420, 930, 2, 'PRM019');
      expect(result.hasCapacity).toBe(true);
      expect(result.available).toBe(6);
      expect(result.laborGroup).toBe('Grandes');
    });

    it('returns hasCapacity=false when demand exceeds capacity', () => {
      const pool = createOperatorPool(makeConfig());
      // Grandes 420-930 cap=6, requesting 7 on one machine
      const result = pool.checkCapacity(3, 420, 930, 7, 'PRM019');
      expect(result.hasCapacity).toBe(false);
    });

    it('returns unconstrained for unmapped machine', () => {
      const pool = createOperatorPool(makeConfig());
      const result = pool.checkCapacity(0, 420, 930, 100, 'PRM999');
      expect(result.hasCapacity).toBe(true);
      expect(result.available).toBe(Infinity);
      expect(result.laborGroup).toBeUndefined();
    });

    it('uses shift-specific capacity (Y window has less than X window)', () => {
      const pool = createOperatorPool(makeConfig());
      // Grandes 960-1440 cap=5, requesting 6
      const result = pool.checkCapacity(0, 960, 1440, 6, 'PRM019');
      expect(result.hasCapacity).toBe(false);
    });
  });

  describe('book()', () => {
    it('tracks usage and reduces available capacity', () => {
      const pool = createOperatorPool(makeConfig());

      // Book 2 operators on PRM019 (Grandes, day 3, window 420-930)
      pool.book(3, 420, 930, 2, 'PRM019');

      // Now check: 6 total, 2 used => 4 available
      const result = pool.checkCapacity(3, 420, 930, 1, 'PRM031');
      expect(result.available).toBe(4);
      expect(result.hasCapacity).toBe(true);
    });

    it('does not double-count same machine peak operators', () => {
      const pool = createOperatorPool(makeConfig());

      // Book 2 operators on PRM019
      pool.book(3, 420, 930, 2, 'PRM019');
      // Book 3 operators on same machine PRM019 (peak model: takes max=3, delta=1)
      pool.book(3, 420, 930, 3, 'PRM019');

      // Labor group total should be 3 (peak of PRM019), not 2+3=5
      const usage = pool.getCurrentUsage(3, 420, 'Grandes');
      expect(usage).toBe(3);
    });

    it('accumulates peaks across different machines in same labor group', () => {
      const pool = createOperatorPool(makeConfig());

      // PRM019 needs 2 operators
      pool.book(3, 420, 930, 2, 'PRM019');
      // PRM031 needs 3 operators
      pool.book(3, 420, 930, 3, 'PRM031');

      // Total Grandes usage = 2 + 3 = 5
      const usage = pool.getCurrentUsage(3, 420, 'Grandes');
      expect(usage).toBe(5);
    });

    it('detects capacity exceeded after booking', () => {
      const pool = createOperatorPool(makeConfig());

      // Grandes 420-930 cap=6. Book 4 on PRM019
      pool.book(3, 420, 930, 4, 'PRM019');

      // PRM031 wants 3 more => total 7 > capacity 6
      const result = pool.checkCapacity(3, 420, 930, 3, 'PRM031');
      expect(result.hasCapacity).toBe(false);
      expect(result.available).toBe(2);
    });

    it('ignores booking for unmapped machine', () => {
      const pool = createOperatorPool(makeConfig());
      pool.book(0, 420, 930, 10, 'PRM999');
      // No labor group affected — all groups still have full capacity
      expect(pool.getCurrentUsage(0, 420, 'Grandes')).toBe(0);
    });
  });

  describe('hasCapacity()', () => {
    it('returns true when no prior bookings', () => {
      const pool = createOperatorPool(makeConfig());
      expect(pool.hasCapacity(3, 420, 930, 5, 'PRM019')).toBe(true);
    });

    it('returns false when at capacity', () => {
      const pool = createOperatorPool(makeConfig());
      pool.book(3, 420, 930, 6, 'PRM019');

      // Grandes at capacity (6/6), PRM031 wants 1 more
      expect(pool.hasCapacity(3, 420, 930, 1, 'PRM031')).toBe(false);
    });

    it('returns true for unmapped machine', () => {
      const pool = createOperatorPool(makeConfig());
      expect(pool.hasCapacity(0, 420, 930, 100, 'UNMAPPED')).toBe(true);
    });
  });

  describe('getLaborGroup()', () => {
    it('resolves mapped machine to labor group', () => {
      const pool = createOperatorPool(makeConfig());
      expect(pool.getLaborGroup('PRM019')).toBe('Grandes');
      expect(pool.getLaborGroup('PRM042')).toBe('Medias');
    });

    it('returns undefined for unmapped machine', () => {
      const pool = createOperatorPool(makeConfig());
      expect(pool.getLaborGroup('PRM999')).toBeUndefined();
    });
  });

  describe('clear()', () => {
    it('resets all state', () => {
      const pool = createOperatorPool(makeConfig());
      pool.book(3, 420, 930, 4, 'PRM019');

      pool.clear();

      expect(pool.getCurrentUsage(3, 420, 'Grandes')).toBe(0);
    });
  });

  describe('cross-group isolation', () => {
    it('booking on Grandes does not affect Medias', () => {
      const pool = createOperatorPool(makeConfig());

      pool.book(0, 420, 930, 6, 'PRM019'); // Fill Grandes

      // Medias should still have full capacity
      const result = pool.checkCapacity(0, 420, 930, 9, 'PRM042');
      expect(result.hasCapacity).toBe(true);
      expect(result.available).toBe(9);
    });
  });
});
