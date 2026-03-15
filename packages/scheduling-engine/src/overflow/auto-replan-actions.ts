// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Auto-Replan Action Builders & Finalization
//  Builds decision-registry-recorded actions and applies
//  system-replanned marks to final blocks.
// ═══════════════════════════════════════════════════════════

import { S1, S2 } from '../constants.js';
import type { ScheduleAllResult } from '../scheduler/scheduler.js';
import type {
  AdvanceAction,
  Block,
  MoveAction,
  ReplanStrategyType,
} from '../types/blocks.js';
import type { AlternativeAction, DecisionEntry } from '../types/decisions.js';
import type { AutoReplanAction, AutoReplanResult } from './auto-replan-types.js';

// ── Action builders ──────────────────────────────────────

export function buildAdvanceAction(
  result: { ob: Block; targetDay: number; advance: AdvanceAction; alternatives: AlternativeAction[]; metadata: Record<string, unknown> },
  schedResult: ScheduleAllResult,
  tardy = false,
): AutoReplanAction {
  const { ob, advance, alternatives, metadata } = result;
  const suffix = tardy ? ' (tardy)' : '';
  const decisionId = schedResult.registry.record({
    type: 'AUTO_REPLAN_ADVANCE',
    opId: ob.opId,
    toolId: ob.toolId,
    machineId: ob.machineId,
    detail: `Produção de ${ob.sku} antecipada ${advance.advanceDays} dias úteis em ${ob.machineId} (EDD ${advance.originalEdd} → ${result.targetDay}${tardy ? ', tardy' : ''})`,
    metadata,
    replanStrategy: 'ADVANCE_PRODUCTION',
    alternatives,
    reversible: true,
  });
  return {
    strategy: 'ADVANCE_PRODUCTION',
    opId: ob.opId,
    machineId: ob.machineId,
    decisionId,
    description: `Antecipada produção de ${ob.sku} em ${advance.advanceDays} dias${suffix}`,
    detail: `Produção de ${ob.sku} antecipada ${advance.advanceDays} dias úteis em ${ob.machineId}. EDD original: dia ${advance.originalEdd}, novo: dia ${result.targetDay}.${tardy ? ' Razão: tardiness.' : ''}`,
    alternatives,
    metadata,
  };
}

export function buildMoveAction(
  result: { ob: Block; move: MoveAction; altUtil: number; alternatives: AlternativeAction[]; metadata: Record<string, unknown> },
  schedResult: ScheduleAllResult,
  tardy = false,
): AutoReplanAction {
  const { ob, move, altUtil, alternatives, metadata } = result;
  const suffix = tardy ? ' (tardy)' : '';
  const decisionId = schedResult.registry.record({
    type: 'AUTO_REPLAN_MOVE',
    opId: ob.opId,
    toolId: ob.toolId,
    machineId: move.toM,
    detail: `${ob.sku} movido de ${ob.machineId} para ${move.toM}${tardy ? ' (tardy)' : ''} (utilização alt: ${Math.round(altUtil * 100)}%)`,
    metadata,
    replanStrategy: 'MOVE_ALT_MACHINE',
    alternatives,
    reversible: true,
  });
  return {
    strategy: 'MOVE_ALT_MACHINE',
    opId: ob.opId,
    machineId: move.toM,
    decisionId,
    description: `Movido ${ob.sku} para ${move.toM}${suffix}`,
    detail: `${ob.sku} movido de ${ob.machineId} para máquina alternativa ${move.toM}${suffix}. Utilização da alternativa: ${Math.round(altUtil * 100)}%.`,
    alternatives,
    metadata,
  };
}

export function buildSplitAction(
  c: { opId: string; toolId: string; machineId: string; altMachine: string; fraction: number; primaryDemand: number; altDemand: number },
  schedResult: ScheduleAllResult,
): AutoReplanAction {
  const alts: AlternativeAction[] = [
    { description: `Mover TODA a operação para ${c.altMachine}`, actionType: 'MOVE_ALT_MACHINE', params: { opId: c.opId, toM: c.altMachine } },
    { description: `Aceitar atraso formalmente`, actionType: 'FORMAL_RISK_ACCEPTANCE', params: { opId: c.opId } },
  ];
  const metadata = { fromMachine: c.machineId, toMachine: c.altMachine, fraction: c.fraction, primaryDemand: c.primaryDemand, altDemand: c.altDemand };
  const decisionId = schedResult.registry.record({
    type: 'AUTO_REPLAN_SPLIT', opId: c.opId, toolId: c.toolId, machineId: c.altMachine,
    detail: `Operação ${c.opId} dividida: ${Math.round((1 - c.fraction) * 100)}% em ${c.machineId}, ${Math.round(c.fraction * 100)}% em ${c.altMachine}`,
    metadata, replanStrategy: 'SPLIT_OPERATION', alternatives: alts, reversible: true,
  });
  return {
    strategy: 'SPLIT_OPERATION', opId: c.opId, machineId: c.altMachine, decisionId,
    description: `Operação ${c.opId} dividida entre ${c.machineId} e ${c.altMachine}`,
    detail: `${Math.round(c.fraction * 100)}% da produção movida para ${c.altMachine}. Primária: ${c.primaryDemand} pcs, Alternativa: ${c.altDemand} pcs.`,
    alternatives: alts, metadata,
  };
}

export function buildOvertimeAction(
  ot: { machineId: string; dayIdx: number; extraMin: number },
  schedResult: ScheduleAllResult,
): AutoReplanAction {
  const alts: AlternativeAction[] = [
    { description: `Activar 3.º turno em vez de horas extra`, actionType: 'THIRD_SHIFT', params: {} },
    { description: `Aceitar atraso formalmente`, actionType: 'FORMAL_RISK_ACCEPTANCE', params: {} },
  ];
  const metadata = { machineId: ot.machineId, dayIdx: ot.dayIdx, extraMin: ot.extraMin };
  const decisionId = schedResult.registry.record({
    type: 'AUTO_REPLAN_OVERTIME', machineId: ot.machineId, dayIdx: ot.dayIdx,
    detail: `Overtime +${ot.extraMin} min em ${ot.machineId} no dia ${ot.dayIdx}`,
    metadata, replanStrategy: 'OVERTIME', alternatives: alts, reversible: true,
  });
  return {
    strategy: 'OVERTIME', opId: '', machineId: ot.machineId, decisionId,
    description: `Overtime +${ot.extraMin} min em ${ot.machineId} dia ${ot.dayIdx}`,
    detail: `${ot.extraMin} minutos extra adicionados a ${ot.machineId} no dia ${ot.dayIdx}.`,
    alternatives: alts, metadata,
  };
}

export function buildThirdShiftAction(overflowReduction: number, schedResult: ScheduleAllResult): AutoReplanAction {
  const alts: AlternativeAction[] = [
    { description: `Aceitar atraso formalmente em vez de activar 3.º turno`, actionType: 'FORMAL_RISK_ACCEPTANCE', params: {} },
  ];
  const metadata = { overflowReduction };
  const decisionId = schedResult.registry.record({
    type: 'AUTO_REPLAN_THIRD_SHIFT',
    detail: `3.º turno activado globalmente (Z: 00:00-07:00, +420 min/dia). Redução de overflow: ${overflowReduction} min.`,
    metadata, replanStrategy: 'THIRD_SHIFT', alternatives: alts, reversible: true,
  });
  return {
    strategy: 'THIRD_SHIFT', opId: '', machineId: '', decisionId,
    description: `3.º turno activado globalmente`,
    detail: `Turno Z (00:00-07:00) activado em todas as máquinas. +420 min/dia de capacidade. Redução de overflow: ${overflowReduction} min.`,
    alternatives: alts, metadata,
  };
}

// ── Block marking ────────────────────────────────────────

export function markAdvanceBlocks(blocks: Block[], opId: string, advDays: number): void {
  for (const b of blocks) {
    if (b.opId === opId && b.type === 'ok') {
      b.isAdvanced = true;
      b.advancedByDays = advDays;
      b.isSystemReplanned = true;
      b.replanStrategy = 'ADVANCE_PRODUCTION';
    }
  }
}

export function markMoveBlocks(blocks: Block[], opId: string, strategy: ReplanStrategyType): void {
  for (const b of blocks) {
    if (b.opId === opId && b.type === 'ok') {
      b.isSystemReplanned = true;
      b.replanStrategy = strategy;
    }
  }
}

// ── Finalization ─────────────────────────────────────────

const DECISION_TYPE_MAP: Record<ReplanStrategyType, DecisionEntry['type']> = {
  ADVANCE_PRODUCTION: 'AUTO_REPLAN_ADVANCE',
  MOVE_ALT_MACHINE: 'AUTO_REPLAN_MOVE',
  SPLIT_OPERATION: 'AUTO_REPLAN_SPLIT',
  OVERTIME: 'AUTO_REPLAN_OVERTIME',
  THIRD_SHIFT: 'AUTO_REPLAN_THIRD_SHIFT',
};

export function reRecordDecisions(actions: AutoReplanAction[], finalResult: ScheduleAllResult, thirdShift: boolean): void {
  for (const action of actions) {
    const newId = finalResult.registry.record({
      type: DECISION_TYPE_MAP[action.strategy],
      opId: action.opId || undefined,
      machineId: action.machineId || undefined,
      detail: action.detail,
      metadata: action.metadata ?? {},
      replanStrategy: action.strategy,
      alternatives: action.alternatives,
      reversible: true,
    });
    action.decisionId = newId;

    if (action.strategy === 'ADVANCE_PRODUCTION') {
      const advDays = (action.metadata?.advanceDays as number) ?? 0;
      for (const b of finalResult.blocks) {
        if (b.opId === action.opId && b.type === 'ok') {
          b.isSystemReplanned = true;
          b.replanStrategy = 'ADVANCE_PRODUCTION';
          b.replanDecisionId = newId;
          b.isAdvanced = true;
          b.advancedByDays = advDays;
        }
      }
    } else if (action.strategy === 'MOVE_ALT_MACHINE') {
      for (const b of finalResult.blocks) {
        if (b.opId === action.opId && b.type === 'ok' && b.machineId === action.machineId) {
          b.isSystemReplanned = true;
          b.replanStrategy = 'MOVE_ALT_MACHINE';
          b.replanDecisionId = newId;
        }
      }
    } else if (action.strategy === 'SPLIT_OPERATION') {
      for (const b of finalResult.blocks) {
        if (b.opId === `${action.opId}__split` || (b.isSplitPart && b.opId.endsWith('__split'))) {
          b.isSystemReplanned = true;
          b.replanStrategy = 'SPLIT_OPERATION';
          b.replanDecisionId = newId;
          b.isSplitPart = true;
          b.splitFromMachine = action.machineId;
        }
      }
    } else if (action.strategy === 'OVERTIME') {
      const otDayIdx = action.metadata?.dayIdx as number | undefined;
      const otExtra = action.metadata?.extraMin as number | undefined;
      const normalEnd = thirdShift ? S2 : S1;
      for (const b of finalResult.blocks) {
        if (b.machineId === action.machineId && b.type === 'ok' && (otDayIdx == null || b.dayIdx === otDayIdx) && b.endMin > normalEnd) {
          b.isSystemReplanned = true;
          b.replanStrategy = 'OVERTIME';
          b.replanDecisionId = newId;
          b.isOvertime = true;
          b.overtimeMin = Math.min(b.endMin - normalEnd, otExtra ?? b.endMin - normalEnd);
        }
      }
    } else if (action.strategy === 'THIRD_SHIFT') {
      for (const b of finalResult.blocks) {
        if (b.shift === 'Z' && b.type === 'ok') {
          b.isSystemReplanned = true;
          b.replanStrategy = 'THIRD_SHIFT';
          b.replanDecisionId = newId;
        }
      }
    }
  }
}

export function collectUnresolved(blocks: Block[], ops: Array<{ id: string; d: number[]; atr: number }>): Array<{ opId: string; deficit: number; reason: string }> {
  const unresolved: Array<{ opId: string; deficit: number; reason: string }> = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if ((b.type === 'infeasible' || (b.type === 'overflow' && b.overflowMin && b.overflowMin > 0)) && !seen.has(b.opId)) {
      seen.add(b.opId);
      const op = ops.find((o) => o.id === b.opId);
      const totalDemand = op ? op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0) : 0;
      const produced = blocks.filter((fb) => fb.opId === b.opId && fb.type === 'ok').reduce((s, fb) => s + fb.qty, 0);
      unresolved.push({ opId: b.opId, deficit: totalDemand - produced, reason: b.infeasibilityReason ?? 'CAPACITY_OVERFLOW' });
    }
  }
  return unresolved;
}

export function emptyResult(result: ScheduleAllResult): AutoReplanResult {
  return {
    blocks: result.blocks,
    scheduleResult: result,
    actions: [],
    autoMoves: [],
    autoAdvances: [],
    overtimeActions: [],
    splitActions: [],
    thirdShiftActivated: false,
    unresolved: [],
    registry: result.registry,
    decisions: result.decisions,
  };
}
