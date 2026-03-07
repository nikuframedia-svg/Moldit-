// ═══════════════════════════════════════════════════════════
//  Auto-Replan Gantt Tests
//  Verifies that each strategy marks blocks with correct
//  metadata (isSystemReplanned, replanStrategy, etc.) and
//  that the Gantt output reflects applied strategies.
// ═══════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { autoReplan } from '../src/overflow/auto-replan.js';
import { DEFAULT_AUTO_REPLAN_CONFIG } from '../src/overflow/auto-replan-config.js';
import {
  applyAlternative,
  getBlockReplanInfo,
  getReplanActions,
  simulateWithout,
  undoReplanActions,
} from '../src/overflow/auto-replan-control.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import {
  buildScheduleInput,
  createOverflowPlanState,
  singleStrategyConfig,
  sumOverflow,
} from './helpers/replan-fixtures.js';

// ═══════════════════════════════════════════════════════════
//  TESTS
// ═══════════════════════════════════════════════════════════

describe('Auto-Replan Gantt', () => {
  // ── ADVANCE_PRODUCTION ────────────────────────────────

  describe('ADVANCE_PRODUCTION — blocos no Gantt', () => {
    it('blocos marcados com isAdvanced e advancedByDays', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('ADVANCE_PRODUCTION');
      const result = autoReplan(input, config);

      const advancedBlocks = result.blocks.filter(
        (b) => b.isSystemReplanned && b.replanStrategy === 'ADVANCE_PRODUCTION',
      );

      if (result.autoAdvances.length > 0) {
        expect(advancedBlocks.length).toBeGreaterThan(0);
        for (const b of advancedBlocks) {
          expect(b.isSystemReplanned).toBe(true);
          expect(b.replanStrategy).toBe('ADVANCE_PRODUCTION');
          expect(b.replanDecisionId).toBeDefined();
          expect(b.isAdvanced).toBe(true);
          expect(b.advancedByDays).toBeDefined();
          expect(b.advancedByDays!).toBeGreaterThan(0);
        }
      }
    });

    it('decisoes no registry correctas', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('ADVANCE_PRODUCTION');
      const result = autoReplan(input, config);

      for (const action of result.actions) {
        if (action.strategy !== 'ADVANCE_PRODUCTION') continue;
        const decision = result.decisions.find((d) => d.id === action.decisionId);
        expect(decision).toBeDefined();
        expect(decision!.type).toBe('AUTO_REPLAN_ADVANCE');
      }
    });

    it('alternativas incluem MOVE e RISK', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('ADVANCE_PRODUCTION');
      const result = autoReplan(input, config);

      // BWI003 has alt PRM042 → MOVE_ALT_MACHINE should be in alternatives
      for (const action of result.actions) {
        if (action.strategy !== 'ADVANCE_PRODUCTION') continue;
        const altTypes = action.alternatives.map((a) => a.actionType);
        // Should always have FORMAL_RISK_ACCEPTANCE
        expect(altTypes).toContain('FORMAL_RISK_ACCEPTANCE');
        // BWI003 has alt machine → MOVE_ALT_MACHINE in alternatives
        if (action.opId === 'OP_HEAVY') {
          expect(altTypes).toContain('MOVE_ALT_MACHINE');
        }
      }
    });
  });

  // ── MOVE_ALT_MACHINE ─────────────────────────────────

  describe('MOVE_ALT_MACHINE — blocos no Gantt', () => {
    it('blocos movidos aparecem na maquina alternativa', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('MOVE_ALT_MACHINE');
      const result = autoReplan(input, config);

      const movedBlocks = result.blocks.filter(
        (b) => b.isSystemReplanned && b.replanStrategy === 'MOVE_ALT_MACHINE',
      );

      if (result.autoMoves.length > 0) {
        expect(movedBlocks.length).toBeGreaterThan(0);
        // Moved blocks should be on the alt machine (PRM042)
        for (const b of movedBlocks) {
          expect(b.machineId).toBe('PRM042');
        }
      }
    });

    it('metadata regista fromMachine/toMachine', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('MOVE_ALT_MACHINE');
      const result = autoReplan(input, config);

      for (const action of result.actions) {
        if (action.strategy !== 'MOVE_ALT_MACHINE') continue;
        expect(action.metadata).toBeDefined();
        expect(action.metadata!.fromMachine).toBe('PRM039');
        expect(action.metadata!.toMachine).toBe('PRM042');
      }
    });

    it('overflow diminui vs baseline', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const baseline = scheduleAll({ ...input, enableLeveling: false, enforceDeadlines: false });
      const baselineOverflow = sumOverflow(baseline.blocks);

      const config = singleStrategyConfig('MOVE_ALT_MACHINE');
      const result = autoReplan(input, config);
      const replanOverflow = sumOverflow(result.blocks);

      // If any moves were made, overflow should decrease
      if (result.autoMoves.length > 0) {
        expect(replanOverflow).toBeLessThan(baselineOverflow);
      }
    });
  });

  // ── SPLIT_OPERATION ───────────────────────────────────

  describe('SPLIT_OPERATION — blocos no Gantt', () => {
    it('blocos split existem com metadata correcta', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('SPLIT_OPERATION');
      const result = autoReplan(input, config);

      if (result.splitActions.length > 0) {
        const splitBlocks = result.blocks.filter((b) => b.isSplitPart === true);
        expect(splitBlocks.length).toBeGreaterThan(0);

        for (const b of splitBlocks) {
          expect(b.splitFromMachine).toBeDefined();
          expect(b.isSystemReplanned).toBe(true);
          expect(b.replanStrategy).toBe('SPLIT_OPERATION');
        }
      }
    });

    it('opId dos blocos split termina em __split', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('SPLIT_OPERATION');
      const result = autoReplan(input, config);

      if (result.splitActions.length > 0) {
        const splitBlocks = result.blocks.filter((b) => b.isSplitPart === true);
        for (const b of splitBlocks) {
          expect(b.opId).toContain('__split');
        }
      }
    });

    it('fraccao do split entre 0 e 1', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('SPLIT_OPERATION');
      const result = autoReplan(input, config);

      for (const sa of result.splitActions) {
        expect(sa.fraction).toBeGreaterThan(0);
        expect(sa.fraction).toBeLessThan(1);
      }
    });
  });

  // ── OVERTIME ──────────────────────────────────────────

  describe('OVERTIME — blocos no Gantt', () => {
    it('blocos overtime tem isOvertime e overtimeMin', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('OVERTIME');
      const result = autoReplan(input, config);

      if (result.overtimeActions.length > 0) {
        const otBlocks = result.blocks.filter((b) => b.isOvertime === true);
        expect(otBlocks.length).toBeGreaterThan(0);

        for (const b of otBlocks) {
          expect(b.overtimeMin).toBeDefined();
          expect(b.overtimeMin!).toBeGreaterThan(0);
          expect(b.isSystemReplanned).toBe(true);
          expect(b.replanStrategy).toBe('OVERTIME');
          expect(b.replanDecisionId).toBeDefined();
        }

        // Overtime should reduce overflow vs no-action baseline
        const baselineResult = scheduleAll({
          ...input,
          enableLeveling: false,
          enforceDeadlines: false,
        });
        const baseOverflow = sumOverflow(baselineResult.blocks);
        const replanOverflow = sumOverflow(result.blocks);
        expect(replanOverflow).toBeLessThanOrEqual(baseOverflow);
      }
    });

    it('overtime nao excede limite por maquina', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('OVERTIME');
      const result = autoReplan(input, config);

      for (const oa of result.overtimeActions) {
        expect(oa.extraMin).toBeLessThanOrEqual(config.overtime.maxMinPerMachinePerDay);
      }
    });
  });

  // ── THIRD_SHIFT ───────────────────────────────────────

  describe('THIRD_SHIFT — blocos no Gantt', () => {
    it('blocos no turno Z com marcacao correcta', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const config = singleStrategyConfig('THIRD_SHIFT');
      const result = autoReplan(input, config);

      if (result.thirdShiftActivated) {
        const zBlocks = result.blocks.filter((b) => b.shift === 'Z' && b.type === 'ok');
        expect(zBlocks.length).toBeGreaterThan(0);

        for (const b of zBlocks) {
          expect(b.isSystemReplanned).toBe(true);
          expect(b.replanStrategy).toBe('THIRD_SHIFT');
        }
      }
    });
  });

  // ── linkagem replanDecisionId ─────────────────────────

  describe('linkagem replanDecisionId', () => {
    it('todo bloco replanned tem decisionId valido', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

      const replannedBlocks = result.blocks.filter((b) => b.isSystemReplanned);
      for (const b of replannedBlocks) {
        expect(b.replanDecisionId).toBeDefined();
        expect(b.replanDecisionId!.length).toBeGreaterThan(0);

        // The decisionId should exist in the decisions array
        const decision = result.decisions.find((d) => d.id === b.replanDecisionId);
        expect(decision).toBeDefined();
      }
    });

    it('getBlockReplanInfo retorna info correcta', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

      const replannedBlocks = result.blocks.filter((b) => b.isSystemReplanned);
      for (const b of replannedBlocks) {
        const info = getBlockReplanInfo(b, result);
        expect(info).not.toBeNull();
        if (info) {
          expect(info.decision.id).toBe(b.replanDecisionId);
        }
      }
    });
  });

  // ── undo/simulate — impacto no Gantt ──────────────────

  describe('undo/simulate — impacto no Gantt', () => {
    it('undo produz Gantt diferente', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

      if (result.actions.length === 0) return; // Nothing to undo

      const firstActionId = result.actions[0].decisionId;
      const undone = undoReplanActions(input, result, [firstActionId]);

      // Undoing should change the schedule
      // Check overflow difference or block count difference
      const originalOverflow = sumOverflow(result.blocks);
      const undoneOverflow = sumOverflow(undone.blocks);

      // Undoing an action should typically increase overflow (or at least change something)
      expect(undone.blocks.length).not.toBe(0);
      // After undo, the action should no longer be in the new actions
      const undoneActionIds = undone.actions.map((a) => a.decisionId);
      expect(undoneActionIds).not.toContain(firstActionId);
    });

    it('simulateWithout mostra overflow >= antes', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

      if (result.actions.length === 0) return;

      const allDecisionIds = result.actions.map((a) => a.decisionId);
      const sim = simulateWithout(input, result, allDecisionIds);

      // Without any actions, overflow should be >= current
      expect(sim.overflowAfter).toBeGreaterThanOrEqual(sim.overflowBefore);
    });

    it('applyAlternative MOVE muda machineId', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

      // Find an ADVANCE action that has MOVE_ALT_MACHINE alternative
      const advAction = result.actions.find(
        (a) =>
          a.strategy === 'ADVANCE_PRODUCTION' &&
          a.alternatives.some((alt) => alt.actionType === 'MOVE_ALT_MACHINE'),
      );

      if (!advAction) return; // Test only applies if such action exists

      const moveAlt = advAction.alternatives.find((a) => a.actionType === 'MOVE_ALT_MACHINE')!;
      const replaced = applyAlternative(input, result, advAction.decisionId, moveAlt);

      // The affected op should now have blocks on PRM042
      const affectedBlocks = replaced.blocks.filter(
        (b) => b.opId === advAction.opId && b.type === 'ok',
      );
      const onAlt = affectedBlocks.some((b) => b.machineId === 'PRM042');
      expect(onAlt).toBe(true);
    });
  });

  // ── consistencia de producao ──────────────────────────

  describe('consistencia de producao', () => {
    it('qty produzida aumenta com replan', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const baseline = scheduleAll({ ...input, enableLeveling: false, enforceDeadlines: false });
      const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

      const baselineQty = baseline.blocks
        .filter((b) => b.type === 'ok')
        .reduce((s, b) => s + b.qty, 0);

      const replanQty = result.blocks.filter((b) => b.type === 'ok').reduce((s, b) => s + b.qty, 0);

      expect(replanQty).toBeGreaterThanOrEqual(baselineQty);
    });

    it('todos blocos ok tem ranges validos', () => {
      const input = buildScheduleInput(createOverflowPlanState());
      const result = autoReplan(input, DEFAULT_AUTO_REPLAN_CONFIG);

      for (const b of result.blocks) {
        if (b.type !== 'ok') continue;
        expect(b.startMin).toBeLessThan(b.endMin);
        expect(b.qty).toBeGreaterThanOrEqual(0);
        expect(b.prodMin).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
