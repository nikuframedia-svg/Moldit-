// ═══════════════════════════════════════════════════════════
//  Shared Fixtures for What-If MRP & Auto-Replan Gantt Tests
//  Extracted from auto-replan-control.test.ts + new variants.
// ═══════════════════════════════════════════════════════════

import type { AutoReplanConfig } from '../../src/overflow/auto-replan-config.js';
import { DEFAULT_AUTO_REPLAN_CONFIG } from '../../src/overflow/auto-replan-config.js';
import type { ScheduleAllInput } from '../../src/scheduler/scheduler.js';
import { transformPlanState } from '../../src/transform/transform-plan-state.js';
import type { Block, ReplanStrategyType } from '../../src/types/blocks.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../../src/types/constraints.js';
import type { EngineData } from '../../src/types/engine.js';
import type { PlanState } from '../../src/types/plan-state.js';

// ── PlanState factories ──────────────────────────────────

/**
 * PlanState that GUARANTEES massive overflow.
 * 2 machines (PRM039+PRM042), BWI003 with alt, 50k pcs demand.
 * Capacity ~8250 pcs vs 50000 demand → overflow guaranteed.
 */
export function createOverflowPlanState(): PlanState {
  return {
    dates: ['02/03', '03/03', '04/03', '05/03', '06/03'],
    days_label: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
    workday_flags: [true, true, true, true, true],
    mo: {
      PG1: [3, 3, 3, 3, 3],
      PG2: [3, 3, 3, 3, 3],
    },
    machines: [
      { id: 'PRM039', area: 'PG2', man_minutes: [0, 0, 0, 0, 0] },
      { id: 'PRM042', area: 'PG2', man_minutes: [0, 0, 0, 0, 0] },
    ],
    tools: [
      {
        id: 'BWI003',
        machine: 'PRM039',
        alt_machine: 'PRM042',
        setup_hours: 0.5,
        pcs_per_hour: 100,
        operators: 1,
        skus: ['SKU_HEAVY'],
        names: ['Heavy Part'],
        lot_economic_qty: 0,
        stock: 0,
      },
      {
        id: 'BFP080',
        machine: 'PRM042',
        alt_machine: '-',
        setup_hours: 0.25,
        pcs_per_hour: 200,
        operators: 1,
        skus: ['SKU_LIGHT'],
        names: ['Light Part'],
        lot_economic_qty: 0,
        stock: 0,
      },
    ],
    operations: [
      {
        id: 'OP_HEAVY',
        machine: 'PRM039',
        tool: 'BWI003',
        sku: 'SKU_HEAVY',
        name: 'Heavy Part',
        pcs_per_hour: 100,
        atraso: 0,
        daily_qty: [10000, 10000, 10000, 10000, 10000],
        setup_hours: 0.5,
        operators: 1,
        stock: 0,
        status: 'PLANNED' as const,
      },
      {
        id: 'OP_LIGHT',
        machine: 'PRM042',
        tool: 'BFP080',
        sku: 'SKU_LIGHT',
        name: 'Light Part',
        pcs_per_hour: 200,
        atraso: 0,
        daily_qty: [100, 0, 0, 0, 0],
        setup_hours: 0.25,
        operators: 1,
        stock: 0,
        status: 'PLANNED' as const,
      },
    ],
    schedule: [],
    machine_loads: [],
    kpis: null,
    parsed_at: null,
    data_hash: null,
  };
}

/**
 * PlanState with MODERATE demand that fits within capacity.
 * For What-If tests where baseline has NO overflow.
 * BWI003: stock=0, demand=500/day (2500 total → ~1500 min production).
 * BFP080: stock=0, demand=200 day 0.
 * PRM039 RCCP utilization ~45% (1500min / 5 days / 673 scap).
 */
export function createModeratePlanState(): PlanState {
  return {
    dates: ['02/03', '03/03', '04/03', '05/03', '06/03'],
    days_label: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'],
    workday_flags: [true, true, true, true, true],
    mo: {
      PG1: [3, 3, 3, 3, 3],
      PG2: [3, 3, 3, 3, 3],
    },
    machines: [
      { id: 'PRM039', area: 'PG2', man_minutes: [0, 0, 0, 0, 0] },
      { id: 'PRM042', area: 'PG2', man_minutes: [0, 0, 0, 0, 0] },
    ],
    tools: [
      {
        id: 'BWI003',
        machine: 'PRM039',
        alt_machine: 'PRM042',
        setup_hours: 0.5,
        pcs_per_hour: 100,
        operators: 1,
        skus: ['SKU_HEAVY'],
        names: ['Heavy Part'],
        lot_economic_qty: 0,
        stock: 0,
      },
      {
        id: 'BFP080',
        machine: 'PRM042',
        alt_machine: '-',
        setup_hours: 0.25,
        pcs_per_hour: 200,
        operators: 1,
        skus: ['SKU_LIGHT'],
        names: ['Light Part'],
        lot_economic_qty: 0,
        stock: 0,
      },
    ],
    operations: [
      {
        id: 'OP_MODERATE',
        machine: 'PRM039',
        tool: 'BWI003',
        sku: 'SKU_HEAVY',
        name: 'Heavy Part',
        pcs_per_hour: 100,
        atraso: 0,
        daily_qty: [500, 500, 500, 500, 500],
        setup_hours: 0.5,
        operators: 1,
        stock: 0,
        status: 'PLANNED' as const,
      },
      {
        id: 'OP_SMALL',
        machine: 'PRM042',
        tool: 'BFP080',
        sku: 'SKU_LIGHT',
        name: 'Light Part',
        pcs_per_hour: 200,
        atraso: 0,
        daily_qty: [200, 0, 0, 0, 0],
        setup_hours: 0.25,
        operators: 1,
        stock: 0,
        status: 'PLANNED' as const,
      },
    ],
    schedule: [],
    machine_loads: [],
    kpis: null,
    parsed_at: null,
    data_hash: null,
  };
}

// ── Builders ─────────────────────────────────────────────

/** Build ScheduleAllInput from PlanState */
export function buildScheduleInput(ps: PlanState): ScheduleAllInput {
  const engine = transformPlanState(ps);

  const mSt: Record<string, string> = {};
  engine.machines.forEach((m) => {
    mSt[m.id] = 'running';
  });

  const tSt: Record<string, string> = {};
  engine.tools.forEach((t) => {
    tSt[t.id] = 'running';
  });

  return {
    ops: engine.ops,
    mSt,
    tSt,
    moves: [],
    machines: engine.machines,
    toolMap: engine.toolMap,
    workdays: engine.workdays,
    nDays: engine.nDays,
    workforceConfig: engine.workforceConfig,
    constraintConfig: DEFAULT_CONSTRAINT_CONFIG,
    thirdShift: false,
  };
}

/** Build EngineData from PlanState (for MRP/What-If tests) */
export function buildEngine(ps: PlanState): EngineData {
  return transformPlanState(ps);
}

// ── Config helpers ───────────────────────────────────────

/**
 * AutoReplanConfig with only ONE strategy enabled.
 * All others disabled. maxTotalActions capped at 10 for speed.
 */
export function singleStrategyConfig(strategy: ReplanStrategyType): AutoReplanConfig {
  const strategies: Record<ReplanStrategyType, boolean> = {
    ADVANCE_PRODUCTION: false,
    MOVE_ALT_MACHINE: false,
    SPLIT_OPERATION: false,
    OVERTIME: false,
    THIRD_SHIFT: false,
  };
  strategies[strategy] = true;

  return {
    ...DEFAULT_AUTO_REPLAN_CONFIG,
    strategies,
    maxTotalActions: 10,
    maxOuterRounds: 3,
  };
}

// ── Analysis helpers ─────────────────────────────────────

/** Sum total overflow minutes across all overflow/infeasible blocks */
export function sumOverflow(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.overflow && b.overflowMin) return sum + b.overflowMin;
    if (b.type === 'infeasible' && b.prodMin > 0) return sum + b.prodMin;
    return sum;
  }, 0);
}
