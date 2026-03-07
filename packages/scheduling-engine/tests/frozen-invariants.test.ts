// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Frozen Invariants Test Suite
//
//  This file FREEZES the entire system logic. Every constant, type,
//  configuration default, pipeline order, and behavioral rule is
//  pinned with explicit assertions.
//
//  If ANY assertion here fails, it means someone changed a frozen rule.
//  That change MUST be reviewed and approved before updating this file.
//
//  Sections:
//    A. Constants (shift boundaries, capacity, thresholds)
//    B. Type enums (decision types, infeasibility reasons, etc.)
//    C. Workforce configuration
//    D. Auto-replan configuration
//    E. Constraint configuration
//    F. Score weights
//    G. Pipeline order
//    H. Slot-allocator verification order
//    I. Behavioral rules (runtime checks)
//    J. Frozen-rules module self-consistency
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS } from '../src/analysis/score-schedule.js';
// ── Source imports (the ACTUAL code) ──
import {
  ADVANCE_UTIL_THRESHOLD,
  ALT_UTIL_THRESHOLD,
  BUCKET_WINDOW,
  DAY_CAP,
  DEFAULT_MO_CAPACITY,
  DEFAULT_OEE,
  DEFAULT_OVERTIME_MAX_PER_MACHINE,
  DEFAULT_OVERTIME_MAX_TOTAL,
  DEFAULT_SHIPPING_BUFFER_HOURS,
  KNOWN_FOCUS,
  LEVEL_HIGH_THRESHOLD,
  LEVEL_LOOKAHEAD,
  LEVEL_LOW_THRESHOLD,
  MAX_ADVANCE_DAYS,
  MAX_AUTO_MOVES,
  MAX_EDD_GAP,
  MAX_OVERFLOW_ITER,
  MINUTES_PER_DAY,
  OTD_TOLERANCE,
  RISK_CRITICAL_THRESHOLD,
  RISK_HIGH_THRESHOLD,
  RISK_MEDIUM_THRESHOLD,
  S0,
  S1,
  S2,
  SPLIT_MIN_DEFICIT,
  SPLIT_MIN_FRACTION,
  T1,
  TG_END,
} from '../src/constants.js';
// ── Operator pool (for runtime behavioral tests) ──
import { createOperatorPool } from '../src/constraints/operator-pool.js';
import { DEFAULT_AUTO_REPLAN_CONFIG } from '../src/overflow/auto-replan-config.js';
// ── Frozen-rules module (single source of truth for frozen values) ──
import {
  FROZEN_AUTO_REPLAN_DEFAULTS,
  FROZEN_BEHAVIORAL_RULES,
  FROZEN_BLOCK_TYPES,
  FROZEN_CONSTANTS,
  FROZEN_CONSTRAINT_CONFIG,
  FROZEN_CONSTRAINT_NAMES,
  FROZEN_DECISION_TYPES,
  FROZEN_INFEASIBILITY_REASONS,
  FROZEN_KNOWN_FOCUS,
  FROZEN_PIPELINE_STEPS,
  FROZEN_REMEDIATION_TYPES,
  FROZEN_REPLAN_STRATEGY_ORDER,
  FROZEN_REPLAN_STRATEGY_TYPES,
  FROZEN_SCORE_WEIGHTS,
  FROZEN_SLOT_CHECKS,
  FROZEN_START_REASONS,
  FROZEN_WORKFORCE_CONFIG,
} from '../src/rules/frozen-rules.js';
import type { ReplanStrategyType } from '../src/types/blocks.js';
import type { ConstraintName } from '../src/types/constraints.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../src/types/constraints.js';
import type { DecisionType } from '../src/types/decisions.js';
import type { InfeasibilityReason, RemediationType } from '../src/types/infeasibility.js';
import type { StartReason } from '../src/types/transparency.js';
import { DEFAULT_WORKFORCE_CONFIG } from '../src/types/workforce.js';

// ═══════════════════════════════════════════════════════════
//  A. FROZEN CONSTANTS
// ═══════════════════════════════════════════════════════════

describe('A. Frozen Constants', () => {
  describe('A.1 Shift boundaries', () => {
    it('S0 = 420 (07:00)', () => {
      expect(S0).toBe(420);
      expect(FROZEN_CONSTANTS.S0).toBe(420);
      expect(S0).toBe(FROZEN_CONSTANTS.S0);
    });

    it('T1 = 930 (15:30)', () => {
      expect(T1).toBe(930);
      expect(FROZEN_CONSTANTS.T1).toBe(930);
      expect(T1).toBe(FROZEN_CONSTANTS.T1);
    });

    it('TG_END = 960 (16:00)', () => {
      expect(TG_END).toBe(960);
      expect(FROZEN_CONSTANTS.TG_END).toBe(960);
      expect(TG_END).toBe(FROZEN_CONSTANTS.TG_END);
    });

    it('S1 = 1440 (24:00)', () => {
      expect(S1).toBe(1440);
      expect(FROZEN_CONSTANTS.S1).toBe(1440);
      expect(S1).toBe(FROZEN_CONSTANTS.S1);
    });

    it('S2 = 1860 (07:00 next day = S1 + S0)', () => {
      expect(S2).toBe(1860);
      expect(FROZEN_CONSTANTS.S2).toBe(1860);
      expect(S2).toBe(S1 + S0);
    });

    it('MINUTES_PER_DAY = 1440', () => {
      expect(MINUTES_PER_DAY).toBe(1440);
      expect(FROZEN_CONSTANTS.MINUTES_PER_DAY).toBe(1440);
    });

    it('shift durations are correct', () => {
      const shiftX = T1 - S0; // 07:00 - 15:30 = 510 min
      const shiftY = S1 - T1; // 15:30 - 00:00 = 510 min
      const shiftZ = S2 - S1; // 00:00 - 07:00 = 420 min
      expect(shiftX).toBe(510);
      expect(shiftY).toBe(510);
      expect(shiftZ).toBe(420);
    });
  });

  describe('A.2 Capacity', () => {
    it('DAY_CAP = 1020 (S1 - S0)', () => {
      expect(DAY_CAP).toBe(1020);
      expect(FROZEN_CONSTANTS.DAY_CAP).toBe(1020);
      expect(DAY_CAP).toBe(S1 - S0);
    });

    it('DEFAULT_OEE = 0.66', () => {
      expect(DEFAULT_OEE).toBe(0.66);
      expect(FROZEN_CONSTANTS.DEFAULT_OEE).toBe(0.66);
    });
  });

  describe('A.3 Scheduling parameters', () => {
    it('BUCKET_WINDOW = 5', () => {
      expect(BUCKET_WINDOW).toBe(5);
      expect(FROZEN_CONSTANTS.BUCKET_WINDOW).toBe(5);
    });

    it('MAX_EDD_GAP = 5', () => {
      expect(MAX_EDD_GAP).toBe(5);
      expect(FROZEN_CONSTANTS.MAX_EDD_GAP).toBe(5);
    });

    it('MAX_AUTO_MOVES = 50', () => {
      expect(MAX_AUTO_MOVES).toBe(50);
      expect(FROZEN_CONSTANTS.MAX_AUTO_MOVES).toBe(50);
    });

    it('MAX_OVERFLOW_ITER = 3', () => {
      expect(MAX_OVERFLOW_ITER).toBe(3);
      expect(FROZEN_CONSTANTS.MAX_OVERFLOW_ITER).toBe(3);
    });

    it('ALT_UTIL_THRESHOLD = 0.95', () => {
      expect(ALT_UTIL_THRESHOLD).toBe(0.95);
      expect(FROZEN_CONSTANTS.ALT_UTIL_THRESHOLD).toBe(0.95);
    });

    it('MAX_ADVANCE_DAYS = Infinity', () => {
      expect(MAX_ADVANCE_DAYS).toBe(Infinity);
      expect(FROZEN_CONSTANTS.MAX_ADVANCE_DAYS).toBe(Infinity);
    });

    it('ADVANCE_UTIL_THRESHOLD = 0.95', () => {
      expect(ADVANCE_UTIL_THRESHOLD).toBe(0.95);
      expect(FROZEN_CONSTANTS.ADVANCE_UTIL_THRESHOLD).toBe(0.95);
    });

    it('OTD_TOLERANCE = 1.0', () => {
      expect(OTD_TOLERANCE).toBe(1.0);
      expect(FROZEN_CONSTANTS.OTD_TOLERANCE).toBe(1.0);
    });
  });

  describe('A.4 Load leveling', () => {
    it('LEVEL_LOW_THRESHOLD = 0.60', () => {
      expect(LEVEL_LOW_THRESHOLD).toBe(0.6);
      expect(FROZEN_CONSTANTS.LEVEL_LOW_THRESHOLD).toBe(0.6);
    });

    it('LEVEL_HIGH_THRESHOLD = 0.75', () => {
      expect(LEVEL_HIGH_THRESHOLD).toBe(0.75);
      expect(FROZEN_CONSTANTS.LEVEL_HIGH_THRESHOLD).toBe(0.75);
    });

    it('LEVEL_LOOKAHEAD = 15', () => {
      expect(LEVEL_LOOKAHEAD).toBe(15);
      expect(FROZEN_CONSTANTS.LEVEL_LOOKAHEAD).toBe(15);
    });
  });

  describe('A.5 Risk grid', () => {
    it('RISK_MEDIUM_THRESHOLD = 0.85', () => {
      expect(RISK_MEDIUM_THRESHOLD).toBe(0.85);
      expect(FROZEN_CONSTANTS.RISK_MEDIUM_THRESHOLD).toBe(0.85);
    });

    it('RISK_HIGH_THRESHOLD = 0.95', () => {
      expect(RISK_HIGH_THRESHOLD).toBe(0.95);
      expect(FROZEN_CONSTANTS.RISK_HIGH_THRESHOLD).toBe(0.95);
    });

    it('RISK_CRITICAL_THRESHOLD = 1.0', () => {
      expect(RISK_CRITICAL_THRESHOLD).toBe(1.0);
      expect(FROZEN_CONSTANTS.RISK_CRITICAL_THRESHOLD).toBe(1.0);
    });
  });

  describe('A.6 Auto-replan parameters', () => {
    it('DEFAULT_OVERTIME_MAX_PER_MACHINE = 450', () => {
      expect(DEFAULT_OVERTIME_MAX_PER_MACHINE).toBe(450);
      expect(FROZEN_CONSTANTS.DEFAULT_OVERTIME_MAX_PER_MACHINE).toBe(450);
    });

    it('DEFAULT_OVERTIME_MAX_TOTAL = 2700', () => {
      expect(DEFAULT_OVERTIME_MAX_TOTAL).toBe(2700);
      expect(FROZEN_CONSTANTS.DEFAULT_OVERTIME_MAX_TOTAL).toBe(2700);
    });

    it('SPLIT_MIN_FRACTION = 0.30', () => {
      expect(SPLIT_MIN_FRACTION).toBe(0.3);
      expect(FROZEN_CONSTANTS.SPLIT_MIN_FRACTION).toBe(0.3);
    });

    it('SPLIT_MIN_DEFICIT = 60', () => {
      expect(SPLIT_MIN_DEFICIT).toBe(60);
      expect(FROZEN_CONSTANTS.SPLIT_MIN_DEFICIT).toBe(60);
    });
  });

  describe('A.7 Other constants', () => {
    it('DEFAULT_SHIPPING_BUFFER_HOURS = 0', () => {
      expect(DEFAULT_SHIPPING_BUFFER_HOURS).toBe(0);
      expect(FROZEN_CONSTANTS.DEFAULT_SHIPPING_BUFFER_HOURS).toBe(0);
    });

    it('DEFAULT_MO_CAPACITY = 99', () => {
      expect(DEFAULT_MO_CAPACITY).toBe(99);
      expect(FROZEN_CONSTANTS.DEFAULT_MO_CAPACITY).toBe(99);
    });
  });

  describe('A.8 Known focus machines', () => {
    it('KNOWN_FOCUS has exactly 6 machines', () => {
      expect(KNOWN_FOCUS.size).toBe(6);
      expect(FROZEN_KNOWN_FOCUS).toHaveLength(6);
    });

    it('KNOWN_FOCUS contains exact machines', () => {
      const expected = ['PRM019', 'PRM020', 'PRM031', 'PRM039', 'PRM042', 'PRM043'];
      for (const m of expected) {
        expect(KNOWN_FOCUS.has(m)).toBe(true);
      }
      expect([...KNOWN_FOCUS].sort()).toEqual(expected.sort());
    });

    it('FROZEN_KNOWN_FOCUS matches KNOWN_FOCUS', () => {
      expect([...FROZEN_KNOWN_FOCUS].sort()).toEqual([...KNOWN_FOCUS].sort());
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  B. FROZEN TYPE ENUMS
// ═══════════════════════════════════════════════════════════

describe('B. Frozen Type Enums', () => {
  describe('B.1 DecisionTypes — exactly 28', () => {
    it('FROZEN_DECISION_TYPES has exactly 28 entries', () => {
      expect(FROZEN_DECISION_TYPES).toHaveLength(28);
    });

    it('contains all expected decision types', () => {
      const expected: DecisionType[] = [
        'BACKWARD_SCHEDULE',
        'LOAD_LEVEL',
        'OVERFLOW_ROUTE',
        'ADVANCE_PRODUCTION',
        'DATA_MISSING',
        'INFEASIBILITY_DECLARED',
        'DEADLINE_CONSTRAINT',
        'OPERATOR_REALLOCATION',
        'ALTERNATIVE_MACHINE',
        'TOOL_DOWN',
        'MACHINE_DOWN',
        'FAILURE_DETECTED',
        'FAILURE_MITIGATION',
        'FAILURE_UNRECOVERABLE',
        'SHIPPING_CUTOFF',
        'PRODUCTION_START',
        'CAPACITY_COMPUTATION',
        'SCORING_DECISION',
        'OPERATOR_CAPACITY_WARNING',
        'AUTO_REPLAN_ADVANCE',
        'AUTO_REPLAN_MOVE',
        'AUTO_REPLAN_SPLIT',
        'AUTO_REPLAN_OVERTIME',
        'AUTO_REPLAN_THIRD_SHIFT',
        'TWIN_VALIDATION_ANOMALY',
        'WORKFORCE_FORECAST_D1',
        'WORKFORCE_COVERAGE_MISSING',
        'LABOR_GROUP_UNMAPPED',
      ];
      expect([...FROZEN_DECISION_TYPES].sort()).toEqual(expected.sort());
    });

    it('no duplicates', () => {
      const set = new Set(FROZEN_DECISION_TYPES);
      expect(set.size).toBe(FROZEN_DECISION_TYPES.length);
    });
  });

  describe('B.2 InfeasibilityReasons — exactly 11', () => {
    it('FROZEN_INFEASIBILITY_REASONS has exactly 11 entries', () => {
      expect(FROZEN_INFEASIBILITY_REASONS).toHaveLength(11);
    });

    it('contains all expected reasons', () => {
      const expected: InfeasibilityReason[] = [
        'SETUP_CREW_EXHAUSTED',
        'OPERATOR_CAPACITY',
        'TOOL_CONFLICT',
        'CALCO_CONFLICT',
        'DEADLINE_VIOLATION',
        'MACHINE_DOWN',
        'CAPACITY_OVERFLOW',
        'DATA_MISSING',
        'MACHINE_PARTIAL_DOWN',
        'TOOL_DOWN_TEMPORAL',
        'SHIPPING_CUTOFF_VIOLATION',
      ];
      expect([...FROZEN_INFEASIBILITY_REASONS].sort()).toEqual(expected.sort());
    });

    it('no duplicates', () => {
      const set = new Set(FROZEN_INFEASIBILITY_REASONS);
      expect(set.size).toBe(FROZEN_INFEASIBILITY_REASONS.length);
    });
  });

  describe('B.3 RemediationTypes — exactly 7', () => {
    it('FROZEN_REMEDIATION_TYPES has exactly 7 entries', () => {
      expect(FROZEN_REMEDIATION_TYPES).toHaveLength(7);
    });

    it('contains all expected types', () => {
      const expected: RemediationType[] = [
        'THIRD_SHIFT',
        'EXTRA_OPERATORS',
        'OVERTIME',
        'SPLIT_OPERATION',
        'ADVANCE_PRODUCTION',
        'TRANSFER_ALT_MACHINE',
        'FORMAL_RISK_ACCEPTANCE',
      ];
      expect([...FROZEN_REMEDIATION_TYPES].sort()).toEqual(expected.sort());
    });

    it('no duplicates', () => {
      const set = new Set(FROZEN_REMEDIATION_TYPES);
      expect(set.size).toBe(FROZEN_REMEDIATION_TYPES.length);
    });
  });

  describe('B.4 StartReasons — exactly 6', () => {
    it('FROZEN_START_REASONS has exactly 6 entries', () => {
      expect(FROZEN_START_REASONS).toHaveLength(6);
    });

    it('contains all expected reasons', () => {
      const expected: StartReason[] = [
        'urgency_slack_critical',
        'density_heavy_load',
        'free_window_available',
        'setup_reduction',
        'future_load_relief',
        'deficit_elimination',
      ];
      expect([...FROZEN_START_REASONS].sort()).toEqual(expected.sort());
    });

    it('no duplicates', () => {
      const set = new Set(FROZEN_START_REASONS);
      expect(set.size).toBe(FROZEN_START_REASONS.length);
    });
  });

  describe('B.5 BlockTypes — exactly 4', () => {
    it('FROZEN_BLOCK_TYPES has exactly 4 entries', () => {
      expect(FROZEN_BLOCK_TYPES).toHaveLength(4);
    });

    it('contains ok, blocked, overflow, infeasible', () => {
      expect([...FROZEN_BLOCK_TYPES].sort()).toEqual(['blocked', 'infeasible', 'ok', 'overflow']);
    });
  });

  describe('B.6 ReplanStrategyTypes — exactly 5', () => {
    it('FROZEN_REPLAN_STRATEGY_TYPES has exactly 5 entries', () => {
      expect(FROZEN_REPLAN_STRATEGY_TYPES).toHaveLength(5);
    });

    it('contains all expected strategies', () => {
      const expected: ReplanStrategyType[] = [
        'ADVANCE_PRODUCTION',
        'MOVE_ALT_MACHINE',
        'SPLIT_OPERATION',
        'OVERTIME',
        'THIRD_SHIFT',
      ];
      expect([...FROZEN_REPLAN_STRATEGY_TYPES].sort()).toEqual(expected.sort());
    });

    it('no duplicates', () => {
      const set = new Set(FROZEN_REPLAN_STRATEGY_TYPES);
      expect(set.size).toBe(FROZEN_REPLAN_STRATEGY_TYPES.length);
    });
  });

  describe('B.7 ConstraintNames — exactly 4', () => {
    it('FROZEN_CONSTRAINT_NAMES has exactly 4 entries', () => {
      expect(FROZEN_CONSTRAINT_NAMES).toHaveLength(4);
    });

    it('contains all expected names', () => {
      const expected: ConstraintName[] = [
        'SETUP_CREW',
        'TOOL_TIMELINE',
        'CALCO_TIMELINE',
        'OPERATOR_POOL',
      ];
      expect([...FROZEN_CONSTRAINT_NAMES].sort()).toEqual(expected.sort());
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  C. FROZEN WORKFORCE CONFIGURATION
// ═══════════════════════════════════════════════════════════

describe('C. Frozen Workforce Configuration', () => {
  describe('C.1 Labor groups structure', () => {
    it('has exactly 2 labor groups: Grandes and Medias', () => {
      const groups = Object.keys(DEFAULT_WORKFORCE_CONFIG.laborGroups);
      expect(groups.sort()).toEqual(['Grandes', 'Medias']);
    });

    it('each group has exactly 3 windows', () => {
      expect(DEFAULT_WORKFORCE_CONFIG.laborGroups.Grandes).toHaveLength(3);
      expect(DEFAULT_WORKFORCE_CONFIG.laborGroups.Medias).toHaveLength(3);
    });
  });

  describe('C.2 Grandes windows', () => {
    const g = DEFAULT_WORKFORCE_CONFIG.laborGroups.Grandes;

    it('window 1: [S0, T1) capacity 6', () => {
      expect(g[0]).toEqual({ start: 420, end: 930, capacity: 6 });
    });

    it('window 2: [T1, TG_END) capacity 6', () => {
      expect(g[1]).toEqual({ start: 930, end: 960, capacity: 6 });
    });

    it('window 3: [TG_END, S1) capacity 5', () => {
      expect(g[2]).toEqual({ start: 960, end: 1440, capacity: 5 });
    });
  });

  describe('C.3 Medias windows', () => {
    const m = DEFAULT_WORKFORCE_CONFIG.laborGroups.Medias;

    it('window 1: [S0, T1) capacity 9', () => {
      expect(m[0]).toEqual({ start: 420, end: 930, capacity: 9 });
    });

    it('window 2: [T1, TG_END) capacity 8', () => {
      expect(m[1]).toEqual({ start: 930, end: 960, capacity: 8 });
    });

    it('window 3: [TG_END, S1) capacity 4', () => {
      expect(m[2]).toEqual({ start: 960, end: 1440, capacity: 4 });
    });
  });

  describe('C.4 Machine-to-labor-group mapping', () => {
    const map = DEFAULT_WORKFORCE_CONFIG.machineToLaborGroup;

    it('PRM019 → Grandes', () => expect(map.PRM019).toBe('Grandes'));
    it('PRM031 → Grandes', () => expect(map.PRM031).toBe('Grandes'));
    it('PRM039 → Grandes', () => expect(map.PRM039).toBe('Grandes'));
    it('PRM043 → Grandes', () => expect(map.PRM043).toBe('Grandes'));
    it('PRM042 → Medias', () => expect(map.PRM042).toBe('Medias'));
    it('PRM020 is NOT mapped', () => expect(map.PRM020).toBeUndefined());

    it('has exactly 5 mappings', () => {
      expect(Object.keys(map)).toHaveLength(5);
    });
  });

  describe('C.5 Frozen workforce config matches DEFAULT', () => {
    it('Grandes capacities match: [6, 6, 5]', () => {
      const frozen = FROZEN_WORKFORCE_CONFIG.laborGroups.Grandes;
      expect(frozen.map((w) => w.capacity)).toEqual([6, 6, 5]);
    });

    it('Medias capacities match: [9, 8, 4]', () => {
      const frozen = FROZEN_WORKFORCE_CONFIG.laborGroups.Medias;
      expect(frozen.map((w) => w.capacity)).toEqual([9, 8, 4]);
    });

    it('machine mapping matches', () => {
      expect(FROZEN_WORKFORCE_CONFIG.machineToLaborGroup).toEqual(
        DEFAULT_WORKFORCE_CONFIG.machineToLaborGroup,
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  D. FROZEN AUTO-REPLAN CONFIGURATION
// ═══════════════════════════════════════════════════════════

describe('D. Frozen Auto-Replan Configuration', () => {
  describe('D.1 Strategy order', () => {
    it('default order: Advance > AltMaq > Split > Overtime > 3rdShift', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.strategyOrder).toEqual([
        'ADVANCE_PRODUCTION',
        'MOVE_ALT_MACHINE',
        'SPLIT_OPERATION',
        'OVERTIME',
        'THIRD_SHIFT',
      ]);
    });

    it('frozen order matches default', () => {
      expect([...FROZEN_REPLAN_STRATEGY_ORDER]).toEqual(DEFAULT_AUTO_REPLAN_CONFIG.strategyOrder);
    });
  });

  describe('D.2 All strategies enabled by default', () => {
    it('all 5 strategies are true', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.strategies.ADVANCE_PRODUCTION).toBe(true);
      expect(DEFAULT_AUTO_REPLAN_CONFIG.strategies.MOVE_ALT_MACHINE).toBe(true);
      expect(DEFAULT_AUTO_REPLAN_CONFIG.strategies.SPLIT_OPERATION).toBe(true);
      expect(DEFAULT_AUTO_REPLAN_CONFIG.strategies.OVERTIME).toBe(true);
      expect(DEFAULT_AUTO_REPLAN_CONFIG.strategies.THIRD_SHIFT).toBe(true);
    });
  });

  describe('D.3 Limits', () => {
    it('maxOuterRounds = 5', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.maxOuterRounds).toBe(5);
      expect(FROZEN_AUTO_REPLAN_DEFAULTS.maxOuterRounds).toBe(5);
    });

    it('maxTotalActions = 50 (MAX_AUTO_MOVES)', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.maxTotalActions).toBe(50);
      expect(FROZEN_AUTO_REPLAN_DEFAULTS.maxTotalActions).toBe(50);
    });

    it('maxIterations = 150 (50 * 3)', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.maxIterations).toBe(150);
      expect(FROZEN_AUTO_REPLAN_DEFAULTS.maxIterations).toBe(150);
      expect(DEFAULT_AUTO_REPLAN_CONFIG.maxIterations).toBe(MAX_AUTO_MOVES * MAX_OVERFLOW_ITER);
    });
  });

  describe('D.4 Overtime limits', () => {
    it('maxMinPerMachinePerDay = 450', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.overtime.maxMinPerMachinePerDay).toBe(450);
      expect(FROZEN_AUTO_REPLAN_DEFAULTS.overtime.maxMinPerMachinePerDay).toBe(450);
    });

    it('maxMinTotalPerDay = 2700', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.overtime.maxMinTotalPerDay).toBe(2700);
      expect(FROZEN_AUTO_REPLAN_DEFAULTS.overtime.maxMinTotalPerDay).toBe(2700);
    });
  });

  describe('D.5 Split limits', () => {
    it('minFractionOnOriginal = 0.30', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.split.minFractionOnOriginal).toBe(0.3);
      expect(FROZEN_AUTO_REPLAN_DEFAULTS.split.minFractionOnOriginal).toBe(0.3);
    });

    it('minDeficitForSplit = 60', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.split.minDeficitForSplit).toBe(60);
      expect(FROZEN_AUTO_REPLAN_DEFAULTS.split.minDeficitForSplit).toBe(60);
    });
  });

  describe('D.6 Enabled by default', () => {
    it('auto-replan is enabled', () => {
      expect(DEFAULT_AUTO_REPLAN_CONFIG.enabled).toBe(true);
      expect(FROZEN_AUTO_REPLAN_DEFAULTS.enabled).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  E. FROZEN CONSTRAINT CONFIGURATION
// ═══════════════════════════════════════════════════════════

describe('E. Frozen Constraint Configuration', () => {
  it('setupCrew mode = hard', () => {
    expect(DEFAULT_CONSTRAINT_CONFIG.setupCrew.mode).toBe('hard');
    expect(FROZEN_CONSTRAINT_CONFIG.setupCrew.mode).toBe('hard');
  });

  it('toolTimeline mode = hard', () => {
    expect(DEFAULT_CONSTRAINT_CONFIG.toolTimeline.mode).toBe('hard');
    expect(FROZEN_CONSTRAINT_CONFIG.toolTimeline.mode).toBe('hard');
  });

  it('calcoTimeline mode = hard', () => {
    expect(DEFAULT_CONSTRAINT_CONFIG.calcoTimeline.mode).toBe('hard');
    expect(FROZEN_CONSTRAINT_CONFIG.calcoTimeline.mode).toBe('hard');
  });

  it('operatorPool mode = hard (but behavior is advisory)', () => {
    expect(DEFAULT_CONSTRAINT_CONFIG.operatorPool.mode).toBe('hard');
    expect(FROZEN_CONSTRAINT_CONFIG.operatorPool.mode).toBe('hard');
  });

  it('exactly 4 constraints configured', () => {
    expect(Object.keys(DEFAULT_CONSTRAINT_CONFIG)).toHaveLength(4);
  });
});

// ═══════════════════════════════════════════════════════════
//  F. FROZEN SCORE WEIGHTS
// ═══════════════════════════════════════════════════════════

describe('F. Frozen Score Weights', () => {
  it('tardiness = 100.0', () => {
    expect(DEFAULT_WEIGHTS.tardiness).toBe(100.0);
    expect(FROZEN_SCORE_WEIGHTS.tardiness).toBe(100.0);
  });

  it('setup_count = 10.0', () => {
    expect(DEFAULT_WEIGHTS.setup_count).toBe(10.0);
    expect(FROZEN_SCORE_WEIGHTS.setup_count).toBe(10.0);
  });

  it('setup_time = 1.0', () => {
    expect(DEFAULT_WEIGHTS.setup_time).toBe(1.0);
    expect(FROZEN_SCORE_WEIGHTS.setup_time).toBe(1.0);
  });

  it('setup_balance = 30.0', () => {
    expect(DEFAULT_WEIGHTS.setup_balance).toBe(30.0);
    expect(FROZEN_SCORE_WEIGHTS.setup_balance).toBe(30.0);
  });

  it('churn = 5.0', () => {
    expect(DEFAULT_WEIGHTS.churn).toBe(5.0);
    expect(FROZEN_SCORE_WEIGHTS.churn).toBe(5.0);
  });

  it('overflow = 50.0', () => {
    expect(DEFAULT_WEIGHTS.overflow).toBe(50.0);
    expect(FROZEN_SCORE_WEIGHTS.overflow).toBe(50.0);
  });

  it('below_min_batch = 5.0', () => {
    expect(DEFAULT_WEIGHTS.below_min_batch).toBe(5.0);
    expect(FROZEN_SCORE_WEIGHTS.below_min_batch).toBe(5.0);
  });

  it('capacity_variance = 20.0', () => {
    expect(DEFAULT_WEIGHTS.capacity_variance).toBe(20.0);
    expect(FROZEN_SCORE_WEIGHTS.capacity_variance).toBe(20.0);
  });

  it('setup_density = 15.0', () => {
    expect(DEFAULT_WEIGHTS.setup_density).toBe(15.0);
    expect(FROZEN_SCORE_WEIGHTS.setup_density).toBe(15.0);
  });

  it('all weights match frozen module', () => {
    expect(DEFAULT_WEIGHTS).toEqual({ ...FROZEN_SCORE_WEIGHTS });
  });
});

// ═══════════════════════════════════════════════════════════
//  G. FROZEN PIPELINE ORDER
// ═══════════════════════════════════════════════════════════

describe('G. Frozen Pipeline Order', () => {
  it('pipeline has exactly 16 steps', () => {
    expect(FROZEN_PIPELINE_STEPS).toHaveLength(16);
  });

  it('step order is exact', () => {
    expect(FROZEN_PIPELINE_STEPS).toEqual([
      'twin_validation_recording',
      'shipping_deadlines',
      'work_content',
      'deficit_evolution',
      'backward_scheduling',
      'scoring',
      'demand_grouping',
      'sort_and_merge',
      'machine_ordering',
      'slot_allocation',
      'load_leveling',
      'block_merging',
      'enforce_deadlines',
      'feasibility_report',
      'workforce_forecast_d1',
      'transparency_report',
    ]);
  });

  it('twin validation is FIRST step', () => {
    expect(FROZEN_PIPELINE_STEPS[0]).toBe('twin_validation_recording');
  });

  it('backward_scheduling comes before demand_grouping', () => {
    const bwIdx = FROZEN_PIPELINE_STEPS.indexOf('backward_scheduling');
    const dgIdx = FROZEN_PIPELINE_STEPS.indexOf('demand_grouping');
    expect(bwIdx).toBeLessThan(dgIdx);
  });

  it('slot_allocation comes after machine_ordering', () => {
    const moIdx = FROZEN_PIPELINE_STEPS.indexOf('machine_ordering');
    const saIdx = FROZEN_PIPELINE_STEPS.indexOf('slot_allocation');
    expect(moIdx).toBeLessThan(saIdx);
  });

  it('enforce_deadlines comes after block_merging', () => {
    const bmIdx = FROZEN_PIPELINE_STEPS.indexOf('block_merging');
    const edIdx = FROZEN_PIPELINE_STEPS.indexOf('enforce_deadlines');
    expect(bmIdx).toBeLessThan(edIdx);
  });

  it('workforce_forecast_d1 comes after feasibility_report', () => {
    const frIdx = FROZEN_PIPELINE_STEPS.indexOf('feasibility_report');
    const wfIdx = FROZEN_PIPELINE_STEPS.indexOf('workforce_forecast_d1');
    expect(frIdx).toBeLessThan(wfIdx);
  });

  it('transparency_report is LAST step', () => {
    expect(FROZEN_PIPELINE_STEPS[FROZEN_PIPELINE_STEPS.length - 1]).toBe('transparency_report');
  });
});

// ═══════════════════════════════════════════════════════════
//  H. FROZEN SLOT-ALLOCATOR VERIFICATION ORDER
// ═══════════════════════════════════════════════════════════

describe('H. Frozen Slot-Allocator Verification Order', () => {
  it('has exactly 7 checks', () => {
    expect(FROZEN_SLOT_CHECKS).toHaveLength(7);
  });

  it('exact order matches slot-allocator.ts implementation', () => {
    expect(FROZEN_SLOT_CHECKS).toEqual([
      'setup_crew',
      'machine_capacity',
      'failure_timeline',
      'operator_pool',
      'calco_timeline',
      'tool_timeline',
      'shipping_cutoff',
    ]);
  });

  it('setup_crew is FIRST (before production loop)', () => {
    expect(FROZEN_SLOT_CHECKS[0]).toBe('setup_crew');
  });

  it('operator_pool comes BEFORE calco and tool', () => {
    const opIdx = FROZEN_SLOT_CHECKS.indexOf('operator_pool');
    const calcoIdx = FROZEN_SLOT_CHECKS.indexOf('calco_timeline');
    const toolIdx = FROZEN_SLOT_CHECKS.indexOf('tool_timeline');
    expect(opIdx).toBeLessThan(calcoIdx);
    expect(opIdx).toBeLessThan(toolIdx);
  });

  it('calco_timeline comes BEFORE tool_timeline', () => {
    const calcoIdx = FROZEN_SLOT_CHECKS.indexOf('calco_timeline');
    const toolIdx = FROZEN_SLOT_CHECKS.indexOf('tool_timeline');
    expect(calcoIdx).toBeLessThan(toolIdx);
  });

  it('shipping_cutoff is LAST check', () => {
    expect(FROZEN_SLOT_CHECKS[FROZEN_SLOT_CHECKS.length - 1]).toBe('shipping_cutoff');
  });
});

// ═══════════════════════════════════════════════════════════
//  I. FROZEN BEHAVIORAL RULES (runtime checks)
// ═══════════════════════════════════════════════════════════

describe('I. Frozen Behavioral Rules', () => {
  describe('I.1 Operator pool is ADVISORY (never blocks)', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.operatorPoolIsAdvisory).toBe(true);
    });

    it('operator pool schedules even when overloaded', () => {
      // Verify via actual code: create a pool, overload it, check it still returns
      const pool = createOperatorPool(DEFAULT_WORKFORCE_CONFIG);

      // Book all capacity on day 0, window 07:00-15:30, for Grandes
      pool.book(0, 420, 930, 6, 'PRM019'); // fills 6/6

      // Try to add more — should report overload but NOT crash or block
      const result = pool.checkCapacity(0, 420, 930, 2, 'PRM031');
      expect(result.hasCapacity).toBe(false); // reports overload
      expect(result.unmapped).toBe(false);
      // But the system NEVER blocks — it's the scheduler's job to proceed anyway
    });
  });

  describe('I.2 PRM020 is unmapped', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.prm020Unmapped).toBe(true);
    });

    it('PRM020 returns unmapped=true from operator pool', () => {
      const pool = createOperatorPool(DEFAULT_WORKFORCE_CONFIG);
      const result = pool.checkCapacity(0, 420, 930, 5, 'PRM020');
      expect(result.unmapped).toBe(true);
      expect(result.hasCapacity).toBe(true); // unmapped = no constraint
    });
  });

  describe('I.3 Setup crew exclusive', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.setupCrewExclusive).toBe(true);
    });
  });

  describe('I.4 Tool timeline same-machine exception', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.toolTimelineSameMachineException).toBe(true);
    });
  });

  describe('I.5 Calco timeline NO same-machine exception', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.calcoTimelineNoSameMachineException).toBe(true);
    });
  });

  describe('I.6 Blocks never disappear', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.blocksNeverDisappear).toBe(true);
    });
  });

  describe('I.7 Supply boost overrides dispatch', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.supplyBoostOverridesDispatch).toBe(true);
    });
  });

  describe('I.8 Load leveling only backward', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.loadLevelingOnlyBackward).toBe(true);
    });
  });

  describe('I.9 MRP twin max not sum', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.mrpTwinMaxNotSum).toBe(true);
    });
  });

  describe('I.10 Never invent data', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.neverInventData).toBe(true);
    });
  });

  describe('I.11 Third shift is global', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.thirdShiftIsGlobal).toBe(true);
    });
  });

  describe('I.12 Score = -Infinity on lost pieces', () => {
    it('behavioral rule flag is true', () => {
      expect(FROZEN_BEHAVIORAL_RULES.scoreMinusInfinityOnLostPieces).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  J. FROZEN-RULES MODULE SELF-CONSISTENCY
// ═══════════════════════════════════════════════════════════

describe('J. Frozen-Rules Module Self-Consistency', () => {
  it('all frozen constants match src/constants.ts', () => {
    expect(FROZEN_CONSTANTS.S0).toBe(S0);
    expect(FROZEN_CONSTANTS.T1).toBe(T1);
    expect(FROZEN_CONSTANTS.TG_END).toBe(TG_END);
    expect(FROZEN_CONSTANTS.S1).toBe(S1);
    expect(FROZEN_CONSTANTS.S2).toBe(S2);
    expect(FROZEN_CONSTANTS.DAY_CAP).toBe(DAY_CAP);
    expect(FROZEN_CONSTANTS.DEFAULT_OEE).toBe(DEFAULT_OEE);
    expect(FROZEN_CONSTANTS.BUCKET_WINDOW).toBe(BUCKET_WINDOW);
    expect(FROZEN_CONSTANTS.MAX_EDD_GAP).toBe(MAX_EDD_GAP);
    expect(FROZEN_CONSTANTS.MAX_AUTO_MOVES).toBe(MAX_AUTO_MOVES);
    expect(FROZEN_CONSTANTS.MAX_OVERFLOW_ITER).toBe(MAX_OVERFLOW_ITER);
    expect(FROZEN_CONSTANTS.ALT_UTIL_THRESHOLD).toBe(ALT_UTIL_THRESHOLD);
    expect(FROZEN_CONSTANTS.MAX_ADVANCE_DAYS).toBe(MAX_ADVANCE_DAYS);
    expect(FROZEN_CONSTANTS.ADVANCE_UTIL_THRESHOLD).toBe(ADVANCE_UTIL_THRESHOLD);
    expect(FROZEN_CONSTANTS.OTD_TOLERANCE).toBe(OTD_TOLERANCE);
    expect(FROZEN_CONSTANTS.LEVEL_LOW_THRESHOLD).toBe(LEVEL_LOW_THRESHOLD);
    expect(FROZEN_CONSTANTS.LEVEL_HIGH_THRESHOLD).toBe(LEVEL_HIGH_THRESHOLD);
    expect(FROZEN_CONSTANTS.LEVEL_LOOKAHEAD).toBe(LEVEL_LOOKAHEAD);
    expect(FROZEN_CONSTANTS.RISK_MEDIUM_THRESHOLD).toBe(RISK_MEDIUM_THRESHOLD);
    expect(FROZEN_CONSTANTS.RISK_HIGH_THRESHOLD).toBe(RISK_HIGH_THRESHOLD);
    expect(FROZEN_CONSTANTS.RISK_CRITICAL_THRESHOLD).toBe(RISK_CRITICAL_THRESHOLD);
    expect(FROZEN_CONSTANTS.DEFAULT_SHIPPING_BUFFER_HOURS).toBe(DEFAULT_SHIPPING_BUFFER_HOURS);
    expect(FROZEN_CONSTANTS.DEFAULT_OVERTIME_MAX_PER_MACHINE).toBe(
      DEFAULT_OVERTIME_MAX_PER_MACHINE,
    );
    expect(FROZEN_CONSTANTS.DEFAULT_OVERTIME_MAX_TOTAL).toBe(DEFAULT_OVERTIME_MAX_TOTAL);
    expect(FROZEN_CONSTANTS.SPLIT_MIN_FRACTION).toBe(SPLIT_MIN_FRACTION);
    expect(FROZEN_CONSTANTS.SPLIT_MIN_DEFICIT).toBe(SPLIT_MIN_DEFICIT);
    expect(FROZEN_CONSTANTS.DEFAULT_MO_CAPACITY).toBe(DEFAULT_MO_CAPACITY);
  });

  it('frozen score weights match src/analysis/score-schedule.ts', () => {
    expect(FROZEN_SCORE_WEIGHTS.tardiness).toBe(DEFAULT_WEIGHTS.tardiness);
    expect(FROZEN_SCORE_WEIGHTS.setup_count).toBe(DEFAULT_WEIGHTS.setup_count);
    expect(FROZEN_SCORE_WEIGHTS.setup_time).toBe(DEFAULT_WEIGHTS.setup_time);
    expect(FROZEN_SCORE_WEIGHTS.setup_balance).toBe(DEFAULT_WEIGHTS.setup_balance);
    expect(FROZEN_SCORE_WEIGHTS.churn).toBe(DEFAULT_WEIGHTS.churn);
    expect(FROZEN_SCORE_WEIGHTS.overflow).toBe(DEFAULT_WEIGHTS.overflow);
    expect(FROZEN_SCORE_WEIGHTS.below_min_batch).toBe(DEFAULT_WEIGHTS.below_min_batch);
    expect(FROZEN_SCORE_WEIGHTS.capacity_variance).toBe(DEFAULT_WEIGHTS.capacity_variance);
    expect(FROZEN_SCORE_WEIGHTS.setup_density).toBe(DEFAULT_WEIGHTS.setup_density);
  });

  it('frozen auto-replan defaults match src/overflow/auto-replan-config.ts', () => {
    expect(FROZEN_AUTO_REPLAN_DEFAULTS.enabled).toBe(DEFAULT_AUTO_REPLAN_CONFIG.enabled);
    expect(FROZEN_AUTO_REPLAN_DEFAULTS.maxTotalActions).toBe(
      DEFAULT_AUTO_REPLAN_CONFIG.maxTotalActions,
    );
    expect(FROZEN_AUTO_REPLAN_DEFAULTS.maxIterations).toBe(
      DEFAULT_AUTO_REPLAN_CONFIG.maxIterations,
    );
    expect(FROZEN_AUTO_REPLAN_DEFAULTS.maxOuterRounds).toBe(
      DEFAULT_AUTO_REPLAN_CONFIG.maxOuterRounds,
    );
    expect(FROZEN_AUTO_REPLAN_DEFAULTS.overtime.maxMinPerMachinePerDay).toBe(
      DEFAULT_AUTO_REPLAN_CONFIG.overtime.maxMinPerMachinePerDay,
    );
    expect(FROZEN_AUTO_REPLAN_DEFAULTS.overtime.maxMinTotalPerDay).toBe(
      DEFAULT_AUTO_REPLAN_CONFIG.overtime.maxMinTotalPerDay,
    );
    expect(FROZEN_AUTO_REPLAN_DEFAULTS.split.minFractionOnOriginal).toBe(
      DEFAULT_AUTO_REPLAN_CONFIG.split.minFractionOnOriginal,
    );
    expect(FROZEN_AUTO_REPLAN_DEFAULTS.split.minDeficitForSplit).toBe(
      DEFAULT_AUTO_REPLAN_CONFIG.split.minDeficitForSplit,
    );
  });

  it('frozen constraint config matches src/types/constraints.ts', () => {
    expect(FROZEN_CONSTRAINT_CONFIG.setupCrew.mode).toBe(DEFAULT_CONSTRAINT_CONFIG.setupCrew.mode);
    expect(FROZEN_CONSTRAINT_CONFIG.toolTimeline.mode).toBe(
      DEFAULT_CONSTRAINT_CONFIG.toolTimeline.mode,
    );
    expect(FROZEN_CONSTRAINT_CONFIG.calcoTimeline.mode).toBe(
      DEFAULT_CONSTRAINT_CONFIG.calcoTimeline.mode,
    );
    expect(FROZEN_CONSTRAINT_CONFIG.operatorPool.mode).toBe(
      DEFAULT_CONSTRAINT_CONFIG.operatorPool.mode,
    );
  });

  it('mathematical relationships hold', () => {
    // S2 = S1 + S0
    expect(FROZEN_CONSTANTS.S2).toBe(FROZEN_CONSTANTS.S1 + FROZEN_CONSTANTS.S0);
    // DAY_CAP = S1 - S0
    expect(FROZEN_CONSTANTS.DAY_CAP).toBe(FROZEN_CONSTANTS.S1 - FROZEN_CONSTANTS.S0);
    // maxIterations = maxTotalActions * MAX_OVERFLOW_ITER
    expect(FROZEN_AUTO_REPLAN_DEFAULTS.maxIterations).toBe(
      FROZEN_AUTO_REPLAN_DEFAULTS.maxTotalActions * FROZEN_CONSTANTS.MAX_OVERFLOW_ITER,
    );
  });
});
