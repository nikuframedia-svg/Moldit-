// =====================================================================
//  INCOMPOL PLAN -- DecisionRegistry Tests
//  Verifies append-only logging, filtering, summary, and reset
//
//  Post-refactor: No 'SOFT_CONSTRAINT_OVERRIDE', 'UNKNOWN_DATA',
//  or 'DEFAULT_VALUE'. Replaced by 'DATA_MISSING', 'INFEASIBILITY_DECLARED',
//  'DEADLINE_CONSTRAINT', 'OPERATOR_REALLOCATION', 'ALTERNATIVE_MACHINE'.
//  getUnknowns() -> getDataGaps()
// =====================================================================

import { DecisionRegistry } from '../src/decisions/decision-registry.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Shorthand to record a DATA_MISSING decision for unknown setup time */
function recordDataMissing(reg: DecisionRegistry, toolId: string) {
  return reg.record({
    type: 'DATA_MISSING',
    toolId,
    machineId: 'PRM019',
    detail: `Tool ${toolId}: setup time not in ISOP, data missing`,
    metadata: { field: 'setup_time' },
  });
}

/** Shorthand to record an INFEASIBILITY_DECLARED decision */
function recordInfeasibility(reg: DecisionRegistry, opId: string) {
  return reg.record({
    type: 'INFEASIBILITY_DECLARED',
    opId,
    machineId: 'PRM039',
    detail: `Operation ${opId} declared infeasible: no slot available`,
    metadata: { constraint: 'SETUP_CREW' },
  });
}

/** Shorthand to record an OPERATOR_REALLOCATION decision */
function recordOperatorReallocation(reg: DecisionRegistry, area: string, dayIdx: number) {
  return reg.record({
    type: 'OPERATOR_REALLOCATION',
    machineId: 'PRM031',
    dayIdx,
    detail: `${area} day ${dayIdx}: pool operators reallocated`,
    metadata: { area, dayIdx },
  });
}

/** Shorthand to record a LOAD_LEVEL decision */
function recordLoadLevel(reg: DecisionRegistry, opId: string, fromDay: number, toDay: number) {
  return reg.record({
    type: 'LOAD_LEVEL',
    opId,
    machineId: 'PRM019',
    dayIdx: toDay,
    detail: `Moved ${opId} from day ${fromDay} to day ${toDay}`,
    metadata: { fromDay, toDay },
  });
}

/** Shorthand to record an OVERFLOW_ROUTE decision */
function recordOverflow(reg: DecisionRegistry, opId: string) {
  return reg.record({
    type: 'OVERFLOW_ROUTE',
    opId,
    machineId: 'PRM039',
    detail: `Overflow routed ${opId} to PRM039`,
    metadata: { fromMachine: 'PRM031', toMachine: 'PRM039' },
  });
}

/** Shorthand to record a BACKWARD_SCHEDULE decision */
function recordBackward(reg: DecisionRegistry, opId: string) {
  return reg.record({
    type: 'BACKWARD_SCHEDULE',
    opId,
    detail: `Op ${opId}: ltDays=3, delivery=day7, earliest=day4`,
    metadata: { ltDays: 3, deliveryDay: 7, earliestDay: 4 },
  });
}

/** Shorthand to record a DEADLINE_CONSTRAINT decision */
function recordDeadlineConstraint(reg: DecisionRegistry, opId: string) {
  return reg.record({
    type: 'DEADLINE_CONSTRAINT',
    opId,
    detail: `Op ${opId}: deadline influenced scheduling order`,
    metadata: { deadlineDay: 5 },
  });
}

// ── Tests ────────────────────────────────────────────────────────────

describe('DecisionRegistry', () => {
  let reg: DecisionRegistry;

  beforeEach(() => {
    reg = new DecisionRegistry();
  });

  describe('record()', () => {
    it('returns a non-empty id string', () => {
      const id = recordDataMissing(reg, 'BWI003');
      expect(id).toBeTruthy();
      expect(typeof id).toBe('string');
      expect(id.startsWith('dec_')).toBe(true);
    });

    it('returns a unique id for every call', () => {
      const id1 = recordDataMissing(reg, 'BWI003');
      const id2 = recordDataMissing(reg, 'BFP079');
      expect(id1).not.toBe(id2);
    });

    it('increments size after each record', () => {
      expect(reg.size).toBe(0);
      recordDataMissing(reg, 'BWI003');
      expect(reg.size).toBe(1);
      recordOperatorReallocation(reg, 'PG2', 3);
      expect(reg.size).toBe(2);
    });
  });

  describe('getAll()', () => {
    it('returns empty array when no decisions recorded', () => {
      expect(reg.getAll()).toEqual([]);
    });

    it('returns all entries in insertion order', () => {
      recordDataMissing(reg, 'BWI003');
      recordOperatorReallocation(reg, 'PG1', 0);
      recordInfeasibility(reg, 'OP-PRM039-BWI003');

      const all = reg.getAll();
      expect(all).toHaveLength(3);
      expect(all[0].type).toBe('DATA_MISSING');
      expect(all[1].type).toBe('OPERATOR_REALLOCATION');
      expect(all[2].type).toBe('INFEASIBILITY_DECLARED');
    });

    it('returns a copy (mutations do not affect registry)', () => {
      recordDataMissing(reg, 'BWI003');
      const all = reg.getAll();
      all.push({
        id: 'fake',
        timestamp: 0,
        type: 'LOAD_LEVEL',
        detail: 'injected',
        metadata: {},
      });
      expect(reg.getAll()).toHaveLength(1);
    });
  });

  describe('getByType()', () => {
    beforeEach(() => {
      recordDataMissing(reg, 'BWI003');
      recordOperatorReallocation(reg, 'PG2', 3);
      recordInfeasibility(reg, 'OP-PRM039-BWI003');
      recordLoadLevel(reg, 'OP-PRM019-BFP079', 6, 4);
      recordOverflow(reg, 'OP-PRM031-BWI003');
      recordBackward(reg, 'OP-PRM019-BFP079');
    });

    it('filters DATA_MISSING correctly', () => {
      const gaps = reg.getByType('DATA_MISSING');
      expect(gaps).toHaveLength(1);
      expect(gaps[0].toolId).toBe('BWI003');
    });

    it('filters OPERATOR_REALLOCATION correctly', () => {
      const reallocations = reg.getByType('OPERATOR_REALLOCATION');
      expect(reallocations).toHaveLength(1);
      expect(reallocations[0].metadata['area']).toBe('PG2');
    });

    it('filters LOAD_LEVEL correctly', () => {
      const levels = reg.getByType('LOAD_LEVEL');
      expect(levels).toHaveLength(1);
      expect(levels[0].metadata['fromDay']).toBe(6);
    });

    it('returns empty array when no matches', () => {
      const downs = reg.getByType('MACHINE_DOWN');
      expect(downs).toEqual([]);
    });
  });

  describe('getDataGaps()', () => {
    it('returns only DATA_MISSING entries', () => {
      recordDataMissing(reg, 'BWI003');
      recordDataMissing(reg, 'BFP079');
      recordOperatorReallocation(reg, 'PG2', 5);
      recordInfeasibility(reg, 'OP-PRM039-BWI003');
      recordLoadLevel(reg, 'OP-PRM019-BFP079', 6, 4);
      recordOverflow(reg, 'OP-PRM031-BWI003');

      const gaps = reg.getDataGaps();
      expect(gaps).toHaveLength(2);

      const types = gaps.map((u) => u.type);
      expect(types).toEqual(['DATA_MISSING', 'DATA_MISSING']);
      expect(types).not.toContain('LOAD_LEVEL');
      expect(types).not.toContain('OVERFLOW_ROUTE');
    });

    it('returns empty array when only non-DATA_MISSING decisions exist', () => {
      recordLoadLevel(reg, 'OP-PRM019-BFP079', 6, 4);
      recordOverflow(reg, 'OP-PRM031-BWI003');
      recordBackward(reg, 'OP-PRM019-BFP079');

      expect(reg.getDataGaps()).toEqual([]);
    });
  });

  describe('getSummary()', () => {
    it('returns zeroes when registry is empty', () => {
      const s = reg.getSummary();
      expect(s.total).toBe(0);
      expect(s.dataMissing).toBe(0);
      expect(s.infeasibilities).toBe(0);
      expect(s.loadLevelMoves).toBe(0);
      expect(s.overflowRoutes).toBe(0);
      expect(s.backwardSchedules).toBe(0);
      expect(s.deadlineConstraints).toBe(0);
      expect(s.operatorReallocations).toBe(0);
    });

    it('has correct counts for mixed decisions', () => {
      recordDataMissing(reg, 'BWI003');
      recordDataMissing(reg, 'BFP079');
      recordOperatorReallocation(reg, 'PG1', 0);
      recordOperatorReallocation(reg, 'PG2', 3);
      recordOperatorReallocation(reg, 'PG2', 5);
      recordInfeasibility(reg, 'OP-PRM039-BWI003');
      recordLoadLevel(reg, 'OP-PRM019-BFP079', 6, 4);
      recordLoadLevel(reg, 'OP-PRM019-BFP079', 7, 5);
      recordOverflow(reg, 'OP-PRM031-BWI003');
      recordBackward(reg, 'OP-PRM019-BFP079');
      recordDeadlineConstraint(reg, 'OP-PRM019-BFP056');

      const s = reg.getSummary();
      expect(s.total).toBe(11);
      expect(s.dataMissing).toBe(2);
      expect(s.operatorReallocations).toBe(3);
      expect(s.infeasibilities).toBe(1);
      expect(s.loadLevelMoves).toBe(2);
      expect(s.overflowRoutes).toBe(1);
      expect(s.backwardSchedules).toBe(1);
      expect(s.deadlineConstraints).toBe(1);
    });
  });

  describe('clear()', () => {
    it('resets all entries and size to 0', () => {
      recordDataMissing(reg, 'BWI003');
      recordOperatorReallocation(reg, 'PG2', 3);
      recordLoadLevel(reg, 'OP-PRM019-BFP079', 6, 4);
      expect(reg.size).toBe(3);

      reg.clear();

      expect(reg.size).toBe(0);
      expect(reg.getAll()).toEqual([]);
      expect(reg.getDataGaps()).toEqual([]);
      expect(reg.getSummary().total).toBe(0);
    });

    it('allows recording new decisions after clear', () => {
      recordDataMissing(reg, 'BWI003');
      reg.clear();

      const id = recordInfeasibility(reg, 'OP-PRM039-BWI003');
      expect(id).toBeTruthy();
      expect(reg.size).toBe(1);
      expect(reg.getAll()[0].type).toBe('INFEASIBILITY_DECLARED');
    });
  });
});
