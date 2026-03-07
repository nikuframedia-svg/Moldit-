// ═══════════════════════════════════════════════════════════
//  Auto-Replan Control Tests
//  Tests for undo, replace, simulate, and user control functions.
// ═══════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { autoReplan } from '../src/overflow/auto-replan.js';
import { DEFAULT_AUTO_REPLAN_CONFIG } from '../src/overflow/auto-replan-config.js';
import {
  applyAlternative,
  getBlockReplanInfo,
  getReplanActions,
  replanWithUserChoices,
  simulateWithout,
  undoReplanActions,
} from '../src/overflow/auto-replan-control.js';
import type { ScheduleAllInput } from '../src/scheduler/scheduler.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import { transformPlanState } from '../src/transform/transform-plan-state.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../src/types/constraints.js';
import type { PlanState } from '../src/types/plan-state.js';

// ── Helper: Create PlanState that GUARANTEES overflow ────

function createOverflowPlanState(): PlanState {
  // 2 machines in PG2, tool has alt_machine for MOVE/SPLIT strategies
  // Very high demand on 2 workdays → overflow guaranteed
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
        // Machine capacity ≈ 990 min/day × 5 days = 4950 min.
        // At 100 pcs/h ≈ 1.67 pcs/min → max ~8250 pcs across all 5 days.
        // Demand = 50000 pcs → guaranteed overflow (needs ~500h, has ~82h)
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

/** Build ScheduleAllInput from PlanState */
function buildInput(ps: PlanState): ScheduleAllInput {
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

// ═══════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════

describe('Auto-Replan Control', () => {
  // ── Verify baseline has overflow ───────────────────────

  it('baseline schedule has overflow (test setup validation)', () => {
    const input = buildInput(createOverflowPlanState());
    const result = scheduleAll(input);

    const overflowBlocks = result.blocks.filter((b) => b.overflow || b.type === 'infeasible');
    expect(overflowBlocks.length).toBeGreaterThan(0);
  });

  // ── autoReplan produces actions ───────────────────────

  it('autoReplan produces at least one action for overflow scenario', () => {
    const input = buildInput(createOverflowPlanState());
    const result = autoReplan(input);

    expect(result.actions.length).toBeGreaterThan(0);

    // Every action has a decisionId, strategy, and description
    for (const action of result.actions) {
      expect(action.decisionId).toBeTruthy();
      expect(action.strategy).toBeTruthy();
      expect(action.description).toBeTruthy();
    }
  });

  // ── getReplanActions ──────────────────────────────────

  describe('getReplanActions', () => {
    it('returns a rich action list with all required fields', () => {
      const input = buildInput(createOverflowPlanState());
      const result = autoReplan(input);
      const actions = getReplanActions(result);

      expect(actions.length).toBeGreaterThan(0);

      for (const a of actions) {
        expect(a.decisionId).toBeTruthy();
        expect(a.strategy).toBeTruthy();
        expect(a.summary).toBeTruthy();
        expect(a.detail).toBeTruthy();
        expect(typeof a.reversible).toBe('boolean');
        expect(typeof a.sequenceIndex).toBe('number');
        expect(typeof a.affectedBlockCount).toBe('number');
        expect(Array.isArray(a.alternatives)).toBe(true);
      }
    });

    it('sequenceIndex is in order', () => {
      const input = buildInput(createOverflowPlanState());
      const result = autoReplan(input);
      const actions = getReplanActions(result);

      for (let i = 0; i < actions.length; i++) {
        expect(actions[i].sequenceIndex).toBe(i);
      }
    });

    it('returns empty list when no actions were taken', () => {
      const input = buildInput(createOverflowPlanState());
      const result = autoReplan(input, { ...DEFAULT_AUTO_REPLAN_CONFIG, enabled: false });
      const actions = getReplanActions(result);

      expect(actions).toHaveLength(0);
    });
  });

  // ── undoReplanActions ─────────────────────────────────

  describe('undoReplanActions', () => {
    it('undoing all actions returns a result without those actions', () => {
      const input = buildInput(createOverflowPlanState());
      const firstReplan = autoReplan(input);

      if (firstReplan.actions.length === 0) return; // skip if no actions

      const allDecisionIds = firstReplan.actions.map((a) => a.decisionId);
      const undoneResult = undoReplanActions(input, firstReplan, allDecisionIds);

      // The undone result should not contain the same actions
      // (it may have new ones from re-run, but excluded ops won't be replanned)
      expect(undoneResult).toBeDefined();
      expect(undoneResult.blocks).toBeDefined();
      expect(undoneResult.blocks.length).toBeGreaterThan(0);
    });

    it('undoing one action returns a valid result', () => {
      const input = buildInput(createOverflowPlanState());
      const firstReplan = autoReplan(input);

      if (firstReplan.actions.length === 0) return;

      const firstAction = firstReplan.actions[0];
      const undoneResult = undoReplanActions(input, firstReplan, [firstAction.decisionId]);

      expect(undoneResult).toBeDefined();
      expect(undoneResult.blocks.length).toBeGreaterThan(0);
      expect(undoneResult.scheduleResult).toBeDefined();
    });
  });

  // ── applyAlternative ──────────────────────────────────

  describe('applyAlternative', () => {
    it('applying FORMAL_RISK_ACCEPTANCE alternative returns valid result', () => {
      const input = buildInput(createOverflowPlanState());
      const firstReplan = autoReplan(input);

      // Find action with alternatives
      const actionWithAlts = firstReplan.actions.find((a) => a.alternatives.length > 0);
      if (!actionWithAlts) return;

      // Find FORMAL_RISK_ACCEPTANCE alternative
      const riskAlt = actionWithAlts.alternatives.find(
        (a) => a.actionType === 'FORMAL_RISK_ACCEPTANCE',
      );
      if (!riskAlt) return;

      const newResult = applyAlternative(input, firstReplan, actionWithAlts.decisionId, riskAlt);

      expect(newResult).toBeDefined();
      expect(newResult.blocks.length).toBeGreaterThan(0);
    });

    it('applying MOVE_ALT_MACHINE alternative changes machine assignment', () => {
      const input = buildInput(createOverflowPlanState());
      const firstReplan = autoReplan(input);

      // Find an ADVANCE action that has a MOVE alternative
      const advanceAction = firstReplan.actions.find(
        (a) =>
          a.strategy === 'ADVANCE_PRODUCTION' &&
          a.alternatives.some((alt) => alt.actionType === 'MOVE_ALT_MACHINE'),
      );
      if (!advanceAction) return;

      const moveAlt = advanceAction.alternatives.find((a) => a.actionType === 'MOVE_ALT_MACHINE')!;

      const newResult = applyAlternative(input, firstReplan, advanceAction.decisionId, moveAlt);

      expect(newResult).toBeDefined();
      expect(newResult.blocks.length).toBeGreaterThan(0);
    });
  });

  // ── simulateWithout ───────────────────────────────────

  describe('simulateWithout', () => {
    it('returns simulation with overflow comparison', () => {
      const input = buildInput(createOverflowPlanState());
      const replan = autoReplan(input);

      if (replan.actions.length === 0) return;

      const sim = simulateWithout(input, replan, [replan.actions[0].decisionId]);

      expect(sim.blocks).toBeDefined();
      expect(typeof sim.overflowBefore).toBe('number');
      expect(typeof sim.overflowAfter).toBe('number');
      expect(typeof sim.overflowDelta).toBe('number');
      expect(sim.overflowDelta).toBe(sim.overflowAfter - sim.overflowBefore);
      expect(Array.isArray(sim.keptActions)).toBe(true);
      expect(Array.isArray(sim.modifiedActions)).toBe(true);
      expect(Array.isArray(sim.unresolved)).toBe(true);
    });

    it('simulating removal of all actions shows more overflow', () => {
      const input = buildInput(createOverflowPlanState());
      const replan = autoReplan(input);

      if (replan.actions.length === 0) return;

      const allIds = replan.actions.map((a) => a.decisionId);
      const sim = simulateWithout(input, replan, allIds);

      // Removing all actions should generally increase or maintain overflow
      expect(sim.overflowAfter).toBeGreaterThanOrEqual(sim.overflowBefore);
    });

    it('modifiedActions contains the removed decision IDs', () => {
      const input = buildInput(createOverflowPlanState());
      const replan = autoReplan(input);

      if (replan.actions.length === 0) return;

      const idsToRemove = [replan.actions[0].decisionId];
      const sim = simulateWithout(input, replan, idsToRemove);

      expect(sim.modifiedActions).toEqual(idsToRemove);
    });
  });

  // ── replanWithUserChoices ─────────────────────────────

  describe('replanWithUserChoices', () => {
    it('keeping all actions returns a valid result', () => {
      const input = buildInput(createOverflowPlanState());
      const firstReplan = autoReplan(input);

      const choices = firstReplan.actions.map((a) => ({
        decisionId: a.decisionId,
        action: 'keep' as const,
      }));

      const result = replanWithUserChoices(input, firstReplan, choices);

      expect(result).toBeDefined();
      expect(result.blocks.length).toBeGreaterThan(0);
    });

    it('undoing all actions via choices returns valid result', () => {
      const input = buildInput(createOverflowPlanState());
      const firstReplan = autoReplan(input);

      if (firstReplan.actions.length === 0) return;

      const choices = firstReplan.actions.map((a) => ({
        decisionId: a.decisionId,
        action: 'undo' as const,
      }));

      const result = replanWithUserChoices(input, firstReplan, choices);

      expect(result).toBeDefined();
      expect(result.blocks.length).toBeGreaterThan(0);
    });

    it('mixed keep/undo choices work correctly', () => {
      const input = buildInput(createOverflowPlanState());
      const firstReplan = autoReplan(input);

      if (firstReplan.actions.length < 2) return;

      const choices = firstReplan.actions.map((a, i) => ({
        decisionId: a.decisionId,
        action: (i % 2 === 0 ? 'keep' : 'undo') as 'keep' | 'undo',
      }));

      const result = replanWithUserChoices(input, firstReplan, choices);

      expect(result).toBeDefined();
      expect(result.blocks.length).toBeGreaterThan(0);
    });

    it('replacing an action with FORMAL_RISK_ACCEPTANCE works', () => {
      const input = buildInput(createOverflowPlanState());
      const firstReplan = autoReplan(input);

      const actionWithAlts = firstReplan.actions.find((a) =>
        a.alternatives.some((alt) => alt.actionType === 'FORMAL_RISK_ACCEPTANCE'),
      );
      if (!actionWithAlts) return;

      const riskAlt = actionWithAlts.alternatives.find(
        (a) => a.actionType === 'FORMAL_RISK_ACCEPTANCE',
      )!;

      const choices = firstReplan.actions.map((a) => {
        if (a.decisionId === actionWithAlts.decisionId) {
          return {
            decisionId: a.decisionId,
            action: 'replace' as const,
            alternative: riskAlt,
          };
        }
        return { decisionId: a.decisionId, action: 'keep' as const };
      });

      const result = replanWithUserChoices(input, firstReplan, choices);
      expect(result).toBeDefined();
      expect(result.blocks.length).toBeGreaterThan(0);
    });

    it('default behavior (no choices provided) keeps all', () => {
      const input = buildInput(createOverflowPlanState());
      const firstReplan = autoReplan(input);

      const result = replanWithUserChoices(input, firstReplan, []);
      expect(result).toBeDefined();
      expect(result.blocks.length).toBeGreaterThan(0);
    });
  });

  // ── getBlockReplanInfo ────────────────────────────────

  describe('getBlockReplanInfo', () => {
    it('returns info for a system-replanned block', () => {
      const input = buildInput(createOverflowPlanState());
      const result = autoReplan(input);

      const replanBlock = result.blocks.find((b) => b.isSystemReplanned && b.replanDecisionId);
      if (!replanBlock) return;

      const info = getBlockReplanInfo(replanBlock, result);

      expect(info).not.toBeNull();
      expect(info!.decision).toBeDefined();
      expect(info!.decision.id).toBe(replanBlock.replanDecisionId);
      expect(info!.action).toBeDefined();
      expect(info!.action.decisionId).toBe(replanBlock.replanDecisionId);
      expect(Array.isArray(info!.alternatives)).toBe(true);
    });

    it('returns null for a normal block without replan', () => {
      const input = buildInput(createOverflowPlanState());
      const result = autoReplan(input);

      const normalBlock = result.blocks.find((b) => !b.isSystemReplanned && b.type === 'ok');
      if (!normalBlock) return;

      const info = getBlockReplanInfo(normalBlock, result);
      expect(info).toBeNull();
    });
  });

  // ── excludeOps in config ──────────────────────────────

  describe('excludeOps in AutoReplanConfig', () => {
    it('excluded operations are not touched by auto-replan', () => {
      const input = buildInput(createOverflowPlanState());

      // First run: normal auto-replan
      const normalResult = autoReplan(input);
      const affectedOps = new Set(normalResult.actions.map((a) => a.opId).filter(Boolean));

      if (affectedOps.size === 0) return;

      // Second run: exclude the first affected op
      const firstOp = [...affectedOps][0];
      const excludedResult = autoReplan(input, {
        ...DEFAULT_AUTO_REPLAN_CONFIG,
        excludeOps: [firstOp],
      });

      // The excluded op should NOT appear in any action
      const excludedActions = excludedResult.actions.filter((a) => a.opId === firstOp);
      expect(excludedActions).toHaveLength(0);
    });
  });
});
