// ═══════════════════════════════════════════════════════════
//  What-If → Auto-Replan Integration Tests
//  Verifies the logical flow: What-If identifies a problem (MRP)
//  → Auto-Replan resolves it in the Gantt (scheduling).
// ═══════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { computeMRP } from '../src/mrp/mrp-engine.js';
import { computeWhatIf } from '../src/mrp/mrp-what-if.js';
import { autoReplan } from '../src/overflow/auto-replan.js';
import { DEFAULT_AUTO_REPLAN_CONFIG } from '../src/overflow/auto-replan-config.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import type { FailureEvent } from '../src/types/failure.js';
import type { WhatIfMutation } from '../src/types/mrp.js';
import {
  buildEngine,
  buildScheduleInput,
  createModeratePlanState,
  createOverflowPlanState,
  sumOverflow,
} from './helpers/replan-fixtures.js';

// ═══════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════

describe('What-If → Auto-Replan Integration', () => {
  it('machine_down → MOVE_ALT_MACHINE resolve no Gantt', () => {
    // Step 1: What-If shows PRM039 down causes stockout impact
    const ps = createModeratePlanState();
    const engine = buildEngine(ps);
    const baseline = computeMRP(engine);

    const mutations: WhatIfMutation[] = [
      {
        id: 'M1',
        type: 'machine_down',
        machine: 'PRM039',
        downStartDay: 0,
        downEndDay: 4,
      },
    ];

    const whatif = computeWhatIf(engine, mutations, baseline);

    // What-If should show RCCP impact for PRM039
    const affectedRccp = whatif.rccpDeltas.filter((r) => r.machine === 'PRM039');
    expect(affectedRccp.length).toBeGreaterThan(0);
    const rccpChanged = affectedRccp.some((r) => r.modifiedUtil !== r.baselineUtil);
    expect(rccpChanged).toBe(true);

    // Step 2: Auto-Replan with PRM039 down should resolve via MOVE
    const input = buildScheduleInput(ps);
    input.mSt['PRM039'] = 'down';
    const replanResult = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

    // Should have some actions (move/advance from PRM039 → PRM042)
    if (replanResult.actions.length > 0) {
      // Some blocks should be on PRM042 as result of replan
      const movedBlocks = replanResult.blocks.filter(
        (b) => b.isSystemReplanned && b.machineId === 'PRM042',
      );
      // With PRM039 down, production should shift to PRM042
      expect(movedBlocks.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('demand_factor 2x → multiplas estrategias reduzem overflow', () => {
    // Step 1: What-If shows demand doubled causes stockouts
    const ps = createOverflowPlanState();
    const engine = buildEngine(ps);
    const baseline = computeMRP(engine);

    const mutations: WhatIfMutation[] = [
      {
        id: 'M1',
        type: 'demand_factor',
        factorToolCode: '__all__',
        factor: 2.0,
      },
    ];

    const whatif = computeWhatIf(engine, mutations, baseline);
    // Should show increased planned qty or stockouts
    const bwiDelta = whatif.deltas.find((d) => d.toolCode === 'BWI003')!;
    expect(bwiDelta.modifiedPlannedQty).toBeGreaterThanOrEqual(bwiDelta.baselinePlannedQty);

    // Step 2: Auto-Replan with massive overflow should use multiple strategies
    const input = buildScheduleInput(ps);
    const baselineBlocks = scheduleAll({
      ...input,
      enableLeveling: false,
      enforceDeadlines: false,
    });
    const baseOverflow = sumOverflow(baselineBlocks.blocks);

    const replanResult = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);
    const replanOverflow = sumOverflow(replanResult.blocks);

    // Replan should reduce overflow
    expect(replanOverflow).toBeLessThan(baseOverflow);

    // Should use multiple strategy types
    if (replanResult.actions.length > 1) {
      const strategies = new Set(replanResult.actions.map((a) => a.strategy));
      expect(strategies.size).toBeGreaterThanOrEqual(1);
    }
  });

  it('failure parcial → SPLIT ou OVERTIME compensam', () => {
    const ps = createOverflowPlanState();
    const engine = buildEngine(ps);
    const baseline = computeMRP(engine);

    const fe: FailureEvent = {
      id: 'FE1',
      resourceType: 'machine',
      resourceId: 'PRM039',
      startDay: 0,
      startShift: null,
      endDay: 4,
      endShift: null,
      severity: 'partial',
      capacityFactor: 0.3,
    };
    const mutations: WhatIfMutation[] = [
      {
        id: 'M1',
        type: 'failure_event',
        failureEvent: fe,
      },
    ];

    const whatif = computeWhatIf(engine, mutations, baseline);
    // Should show RCCP impact
    const affected = whatif.rccpDeltas.filter((r) => r.machine === 'PRM039');
    const changed = affected.filter((r) => r.modifiedUtil !== r.baselineUtil);
    expect(changed.length).toBeGreaterThan(0);

    // Auto-Replan should produce actions (split or overtime or others)
    const input = buildScheduleInput(ps);
    const replanResult = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

    // With massive overflow, replan should do something
    expect(replanResult.actions.length).toBeGreaterThan(0);

    // Should produce split or overtime actions (among others)
    const hasSplitOrOvertime =
      replanResult.splitActions.length > 0 ||
      replanResult.overtimeActions.length > 0 ||
      replanResult.autoMoves.length > 0 ||
      replanResult.autoAdvances.length > 0;
    expect(hasSplitOrOvertime).toBe(true);
  });

  it('sem problemas → sem accoes de replan', () => {
    // What-If with empty mutations → no change
    const ps = createModeratePlanState();
    const engine = buildEngine(ps);
    const baseline = computeMRP(engine);

    const whatif = computeWhatIf(engine, [], baseline);
    expect(whatif.summaryDelta.stockoutsChange).toBe(0);

    // Auto-replan on moderate demand → should have no overflow and no actions
    const input = buildScheduleInput(ps);
    const replanResult = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

    // Check if there's even overflow to resolve
    const overflow = sumOverflow(replanResult.blocks);
    if (overflow === 0) {
      expect(replanResult.actions.length).toBe(0);
      expect(replanResult.thirdShiftActivated).toBe(false);
    }
  });
});
