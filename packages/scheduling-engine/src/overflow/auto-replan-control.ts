// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Auto-Replan User Control Layer
//
//  Pure functions for viewing, undoing, replacing, and
//  simulating auto-replan actions. Gives the user full
//  control over every system-made scheduling decision.
//
//  All functions are pure — no state, no side effects.
//  "Undo" = re-run scheduling with modified inputs.
// ═══════════════════════════════════════════════════════════

import type { ScheduleAllInput } from '../scheduler/scheduler.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { AdvanceAction, Block, MoveAction, ReplanStrategyType } from '../types/blocks.js';
import type { AlternativeAction, DecisionEntry } from '../types/decisions.js';
import type { EOp } from '../types/engine.js';
import type { AutoReplanAction, AutoReplanResult } from './auto-replan.js';
import { autoReplan } from './auto-replan.js';
import type { AutoReplanConfig } from './auto-replan-config.js';
import { DEFAULT_AUTO_REPLAN_CONFIG } from './auto-replan-config.js';

// ── Types ────────────────────────────────────────────────

/** Rich detail of a replan action for UI display */
export interface ReplanActionDetail {
  decisionId: string;
  strategy: ReplanStrategyType;
  opId: string;
  sku: string;
  machineId: string;
  summary: string;
  detail: string;
  alternatives: AlternativeAction[];
  reversible: boolean;
  sequenceIndex: number;
  affectedBlockCount: number;
}

/** User's choice for a specific replan action */
export interface UserReplanChoice {
  decisionId: string;
  action: 'keep' | 'undo' | 'replace';
  alternative?: AlternativeAction;
}

/** Simulation result (quick preview without full auto-replan) */
export interface ReplanSimulation {
  blocks: Block[];
  overflowAfter: number;
  overflowBefore: number;
  overflowDelta: number;
  keptActions: string[];
  modifiedActions: string[];
  unresolved: Array<{ opId: string; deficit: number; reason: string }>;
}

// ── Helpers ──────────────────────────────────────────────

/** Sum overflow minutes from blocks */
function sumOverflow(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.overflow && b.overflowMin) return sum + b.overflowMin;
    if (b.type === 'infeasible' && b.prodMin > 0) return sum + b.prodMin;
    return sum;
  }, 0);
}

/**
 * Reconstruct a ScheduleAllInput from original input + kept/replaced actions.
 * This is the core helper used by undo, apply alternative, and replanWithUserChoices.
 */
function rebuildInputFromActions(
  originalInput: ScheduleAllInput,
  previousResult: AutoReplanResult,
  keepDecisionIds: Set<string>,
  replacements: Map<string, AlternativeAction>,
): ScheduleAllInput {
  const moves: MoveAction[] = [...originalInput.moves];
  const advances: AdvanceAction[] = [...(originalInput.advanceOverrides ?? [])];
  // Deep copy: inner maps must not alias the caller's data
  const overtimeMap: Record<string, Record<number, number>> = {};
  for (const [mId, dayMap] of Object.entries(originalInput.overtimeMap ?? {})) {
    overtimeMap[mId] = { ...dayMap };
  }
  let ops = [...originalInput.ops];
  let thirdShift = originalInput.thirdShift ?? false;

  for (const action of previousResult.actions) {
    const isKept = keepDecisionIds.has(action.decisionId);
    const replacement = replacements.get(action.decisionId);

    if (isKept) {
      // Apply original action
      applyActionToInput(action, previousResult, moves, advances, overtimeMap, ops, (ts) => {
        thirdShift = ts;
      });
      ops = getOpsAfterAction(action, previousResult, ops);
    } else if (replacement) {
      // Apply alternative instead
      applyAlternativeToInput(replacement, action, moves, advances, overtimeMap, (ts) => {
        thirdShift = ts;
      });
    }
    // else: undone — don't apply anything
  }

  return {
    ...originalInput,
    ops,
    moves,
    advanceOverrides: advances.length > 0 ? advances : originalInput.advanceOverrides,
    thirdShift,
    overtimeMap: Object.keys(overtimeMap).length > 0 ? overtimeMap : undefined,
  };
}

/** Apply an original auto-replan action to the input arrays */
function applyActionToInput(
  action: AutoReplanAction,
  previousResult: AutoReplanResult,
  moves: MoveAction[],
  advances: AdvanceAction[],
  overtimeMap: Record<string, Record<number, number>>,
  _ops: EOp[],
  setThirdShift: (v: boolean) => void,
): void {
  switch (action.strategy) {
    case 'ADVANCE_PRODUCTION': {
      const adv = previousResult.autoAdvances.find((a) => a.opId === action.opId);
      if (adv) advances.push(adv);
      break;
    }
    case 'MOVE_ALT_MACHINE': {
      const move = previousResult.autoMoves.find((m) => m.opId === action.opId);
      if (move) moves.push(move);
      break;
    }
    case 'OVERTIME': {
      const ot = previousResult.overtimeActions.find((o) => o.machineId === action.machineId);
      if (ot) {
        if (!overtimeMap[ot.machineId]) overtimeMap[ot.machineId] = {};
        overtimeMap[ot.machineId][ot.dayIdx] =
          (overtimeMap[ot.machineId][ot.dayIdx] ?? 0) + ot.extraMin;
      }
      break;
    }
    case 'THIRD_SHIFT':
      setThirdShift(true);
      break;
    // SPLIT_OPERATION is handled via getOpsAfterAction
  }
}

/** Get modified ops array after applying a SPLIT action */
function getOpsAfterAction(
  action: AutoReplanAction,
  previousResult: AutoReplanResult,
  ops: EOp[],
): EOp[] {
  if (action.strategy !== 'SPLIT_OPERATION') return ops;

  const split = previousResult.splitActions.find((s) => s.opId === action.opId);
  if (!split) return ops;

  const originalOp = ops.find((o) => o.id === action.opId);
  if (!originalOp) return ops;

  const fraction = split.fraction;
  const splitD = originalOp.d.map((v) => (v <= 0 ? 0 : Math.ceil(v * fraction)));
  const primaryD = originalOp.d.map((v, i) => Math.max(v - splitD[i], 0));
  const splitAtr = Math.ceil(Math.max(originalOp.atr, 0) * fraction);
  const primaryAtr = Math.max(originalOp.atr, 0) - splitAtr;

  const syntheticOp: EOp = {
    id: `${originalOp.id}__split`,
    t: originalOp.t,
    m: split.toMachine,
    sku: originalOp.sku,
    nm: originalOp.nm,
    atr: splitAtr,
    d: splitD,
    ltDays: originalOp.ltDays,
    cl: originalOp.cl,
    clNm: originalOp.clNm,
    pa: originalOp.pa,
    stk: 0,
    wip: 0,
    shippingDayIdx: originalOp.shippingDayIdx,
    shippingBufferHours: originalOp.shippingBufferHours,
  };

  const modifiedPrimary: EOp = { ...originalOp, atr: primaryAtr, d: primaryD };
  return [...ops.map((o) => (o.id === originalOp.id ? modifiedPrimary : o)), syntheticOp];
}

/** Translate an AlternativeAction into concrete input modifications */
function applyAlternativeToInput(
  alt: AlternativeAction,
  originalAction: AutoReplanAction,
  moves: MoveAction[],
  advances: AdvanceAction[],
  overtimeMap: Record<string, Record<number, number>>,
  setThirdShift: (v: boolean) => void,
): void {
  switch (alt.actionType) {
    case 'MOVE_ALT_MACHINE': {
      const opId = (alt.params.opId as string) ?? originalAction.opId;
      const toM = alt.params.toM as string;
      if (opId && toM) moves.push({ opId, toM });
      break;
    }
    case 'ADVANCE_PRODUCTION': {
      const opId = (alt.params.opId as string) ?? originalAction.opId;
      const advDays = (alt.params.advanceDays as number) ?? 1;
      const origEdd = (alt.params.originalEdd as number) ?? 0;
      if (opId) advances.push({ opId, advanceDays: advDays, originalEdd: origEdd });
      break;
    }
    case 'OVERTIME': {
      const machineId = (alt.params.machineId as string) ?? originalAction.machineId;
      const dayIdx = (alt.params.dayIdx as number) ?? 0;
      const extraMin = (alt.params.extraMin as number) ?? 60;
      if (machineId) {
        if (!overtimeMap[machineId]) overtimeMap[machineId] = {};
        overtimeMap[machineId][dayIdx] = (overtimeMap[machineId][dayIdx] ?? 0) + extraMin;
      }
      break;
    }
    case 'THIRD_SHIFT':
      setThirdShift(true);
      break;
    case 'FORMAL_RISK_ACCEPTANCE':
      // Do nothing — user accepts overflow
      break;
    case 'SPLIT_OPERATION':
      // Split via alternative is complex — skip (handled as MOVE or ADVANCE instead)
      break;
  }
}

/** Collect unresolved overflow from blocks */
function collectUnresolved(
  blocks: Block[],
  ops: EOp[],
): Array<{ opId: string; deficit: number; reason: string }> {
  const unresolved: Array<{ opId: string; deficit: number; reason: string }> = [];
  const seen = new Set<string>();

  for (const b of blocks) {
    if (
      (b.type === 'infeasible' || (b.type === 'overflow' && b.overflowMin && b.overflowMin > 0)) &&
      !seen.has(b.opId)
    ) {
      seen.add(b.opId);
      const op = ops.find((o) => o.id === b.opId);
      const totalDemand = op
        ? op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0)
        : 0;
      const produced = blocks
        .filter((fb) => fb.opId === b.opId && fb.type === 'ok')
        .reduce((s, fb) => s + fb.qty, 0);

      unresolved.push({
        opId: b.opId,
        deficit: totalDemand - produced,
        reason: b.infeasibilityReason ?? 'CAPACITY_OVERFLOW',
      });
    }
  }

  return unresolved;
}

// ── Public Functions ─────────────────────────────────────

/**
 * Get a rich, UI-ready list of all auto-replan actions.
 */
export function getReplanActions(result: AutoReplanResult): ReplanActionDetail[] {
  return result.actions.map((action, index) => {
    // Find the decision entry
    const decision = result.decisions.find((d) => d.id === action.decisionId);

    // Count affected blocks
    const affectedBlockCount = result.blocks.filter(
      (b) => b.replanDecisionId === action.decisionId,
    ).length;

    // Extract SKU from affected blocks or action detail
    const affectedBlock = result.blocks.find(
      (b) => b.replanDecisionId === action.decisionId && b.type === 'ok',
    );
    const sku = affectedBlock?.sku ?? '';

    return {
      decisionId: action.decisionId,
      strategy: action.strategy,
      opId: action.opId,
      sku,
      machineId: action.machineId,
      summary: action.description,
      detail: action.detail,
      alternatives: action.alternatives,
      reversible: decision?.reversible ?? true,
      sequenceIndex: index,
      affectedBlockCount,
    };
  });
}

/**
 * Undo specific auto-replan actions by re-running scheduling without them.
 * Actions not in `decisionIds` are kept. The system then runs autoReplan()
 * on remaining overflow, excluding the undone operations.
 */
export function undoReplanActions(
  originalInput: ScheduleAllInput,
  previousResult: AutoReplanResult,
  decisionIds: string[],
  config: AutoReplanConfig = DEFAULT_AUTO_REPLAN_CONFIG,
): AutoReplanResult {
  const undoSet = new Set(decisionIds);
  const keepSet = new Set(
    previousResult.actions.filter((a) => !undoSet.has(a.decisionId)).map((a) => a.decisionId),
  );

  // Collect opIds of undone actions to exclude from re-plan
  const undoneOpIds = previousResult.actions
    .filter((a) => undoSet.has(a.decisionId) && a.opId)
    .map((a) => a.opId);

  const rebuiltInput = rebuildInputFromActions(originalInput, previousResult, keepSet, new Map());

  // Re-run auto-replan with undone ops excluded
  return autoReplan(rebuiltInput, {
    ...config,
    excludeOps: [...(config.excludeOps ?? []), ...undoneOpIds],
  });
}

/**
 * Replace one auto-replan action with an alternative.
 * The original action is removed, the alternative is applied,
 * and auto-replan re-runs for remaining overflow.
 */
export function applyAlternative(
  originalInput: ScheduleAllInput,
  previousResult: AutoReplanResult,
  decisionId: string,
  alternative: AlternativeAction,
  config: AutoReplanConfig = DEFAULT_AUTO_REPLAN_CONFIG,
): AutoReplanResult {
  const keepSet = new Set(
    previousResult.actions.filter((a) => a.decisionId !== decisionId).map((a) => a.decisionId),
  );

  const replacements = new Map<string, AlternativeAction>();
  replacements.set(decisionId, alternative);

  // Collect the opId of the replaced action to exclude from re-plan
  const replacedAction = previousResult.actions.find((a) => a.decisionId === decisionId);
  const excludeOpIds = replacedAction?.opId ? [replacedAction.opId] : [];

  const rebuiltInput = rebuildInputFromActions(
    originalInput,
    previousResult,
    keepSet,
    replacements,
  );

  return autoReplan(rebuiltInput, {
    ...config,
    excludeOps: [...(config.excludeOps ?? []), ...excludeOpIds],
  });
}

/**
 * Quick simulation of undoing actions — runs scheduleAll() once
 * without full auto-replan. Shows the overflow impact of undoing.
 */
export function simulateWithout(
  originalInput: ScheduleAllInput,
  previousResult: AutoReplanResult,
  decisionIds: string[],
): ReplanSimulation {
  const undoSet = new Set(decisionIds);
  const keepSet = new Set(
    previousResult.actions.filter((a) => !undoSet.has(a.decisionId)).map((a) => a.decisionId),
  );

  const rebuiltInput = rebuildInputFromActions(originalInput, previousResult, keepSet, new Map());

  // Single scheduleAll() — no auto-replan
  const result = scheduleAll({
    ...rebuiltInput,
    enableLeveling: true,
    enforceDeadlines: true,
  });

  const overflowBefore = sumOverflow(previousResult.blocks);
  const overflowAfter = sumOverflow(result.blocks);

  return {
    blocks: result.blocks,
    overflowAfter,
    overflowBefore,
    overflowDelta: overflowAfter - overflowBefore,
    keptActions: [...keepSet],
    modifiedActions: decisionIds,
    unresolved: collectUnresolved(result.blocks, rebuiltInput.ops),
  };
}

/**
 * Full user control: specify keep/undo/replace for each action.
 * Actions not mentioned in `choices` default to 'keep'.
 */
export function replanWithUserChoices(
  originalInput: ScheduleAllInput,
  previousResult: AutoReplanResult,
  choices: UserReplanChoice[],
  config: AutoReplanConfig = DEFAULT_AUTO_REPLAN_CONFIG,
): AutoReplanResult {
  const choiceMap = new Map(choices.map((c) => [c.decisionId, c]));

  const keepSet = new Set<string>();
  const replacements = new Map<string, AlternativeAction>();
  const excludeOpIds: string[] = [];

  for (const action of previousResult.actions) {
    const choice = choiceMap.get(action.decisionId);

    if (!choice || choice.action === 'keep') {
      keepSet.add(action.decisionId);
    } else if (choice.action === 'replace' && choice.alternative) {
      replacements.set(action.decisionId, choice.alternative);
      if (action.opId) excludeOpIds.push(action.opId);
    } else if (choice.action === 'undo') {
      if (action.opId) excludeOpIds.push(action.opId);
    }
  }

  const rebuiltInput = rebuildInputFromActions(
    originalInput,
    previousResult,
    keepSet,
    replacements,
  );

  return autoReplan(rebuiltInput, {
    ...config,
    excludeOps: [...(config.excludeOps ?? []), ...excludeOpIds],
  });
}

/**
 * Get full replan context for a specific block.
 * Returns the decision, action, and alternatives that created/modified it.
 */
export function getBlockReplanInfo(
  block: Block,
  result: AutoReplanResult,
): {
  decision: DecisionEntry;
  action: AutoReplanAction;
  alternatives: AlternativeAction[];
} | null {
  if (!block.replanDecisionId) return null;

  const action = result.actions.find((a) => a.decisionId === block.replanDecisionId);
  if (!action) return null;

  const decision = result.decisions.find((d) => d.id === block.replanDecisionId);
  if (!decision) return null;

  return {
    decision,
    action,
    alternatives: action.alternatives,
  };
}
