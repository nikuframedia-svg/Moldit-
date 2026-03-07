// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Auto-Replan Orchestrator
//
//  Automatically resolves overflow operations by executing
//  strategies in priority order instead of just suggesting them.
//
//  Strategies (default order):
//    1. ADVANCE_PRODUCTION  — same machine, earlier days
//    2. MOVE_ALT_MACHINE    — move to alternative machine
//    3. SPLIT_OPERATION     — split between primary and alt
//    4. OVERTIME            — extend shift hours
//    5. THIRD_SHIFT         — activate 3rd shift (global, last resort)
//
//  Each action is:
//    - Marked as system-made (isSystemReplanned)
//    - Recorded in DecisionRegistry with explanation
//    - Provided with alternatives the user can choose instead
//    - Reversible by re-running without the action
//
//  Wraps autoRouteOverflow() for advance/move strategies.
//  Pure function — no side effects.
// ═══════════════════════════════════════════════════════════

import { computeD1WorkforceRisk } from '../analysis/workforce-forecast.js';
import { ALT_UTIL_THRESHOLD, DAY_CAP, S0, S1, S2 } from '../constants.js';
import type { DecisionRegistry } from '../decisions/decision-registry.js';
import type { ScheduleAllInput, ScheduleAllResult } from '../scheduler/scheduler.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type {
  AdvanceAction,
  Block,
  MoveAction,
  OvertimeAction,
  ReplanStrategyType,
  SplitAction,
} from '../types/blocks.js';
import type { AlternativeAction, DecisionEntry } from '../types/decisions.js';
import type { EMachine } from '../types/engine.js';
import type { AutoReplanConfig } from './auto-replan-config.js';
import { DEFAULT_AUTO_REPLAN_CONFIG } from './auto-replan-config.js';
import { tryOvertime } from './strategies/overtime-strategy.js';
import { trySplitOperation } from './strategies/split-strategy.js';
import { tryThirdShift } from './strategies/third-shift-strategy.js';

// ── Helpers ─────────────────────────────────────────────

/** Sum total overflow minutes */
function sumOverflow(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.overflow && b.overflowMin) return sum + b.overflowMin;
    if (b.type === 'infeasible' && b.prodMin > 0) return sum + b.prodMin;
    return sum;
  }, 0);
}

/** Sum production minutes of blocks scheduled AFTER their deadline (tardy but type='ok') */
function computeTardiness(blocks: Block[]): number {
  return blocks.reduce((sum, b) => {
    if (b.type === 'ok' && b.eddDay != null && b.dayIdx > b.eddDay) {
      return sum + b.prodMin;
    }
    return sum;
  }, 0);
}

/**
 * Compute per-machine per-day load from blocks.
 */
function capAnalysis(
  blocks: Block[],
  machines: EMachine[],
): Record<string, Array<{ prod: number; setup: number }>> {
  const result: Record<string, Array<{ prod: number; setup: number }>> = {};
  const nDays = blocks.reduce((mx, b) => Math.max(mx, b.dayIdx + 1), 0);

  for (const m of machines) {
    const days = Array.from({ length: nDays }, () => ({ prod: 0, setup: 0 }));
    for (const b of blocks) {
      if (b.machineId !== m.id || b.dayIdx < 0 || b.dayIdx >= nDays) continue;
      days[b.dayIdx].prod += b.prodMin;
      days[b.dayIdx].setup += b.setupMin;
    }
    result[m.id] = days;
  }
  return result;
}

/**
 * Count backward working days from `fromDay`.
 */
function computeAdvancedEdd(fromDay: number, advanceDays: number, workdays: boolean[]): number {
  let target = fromDay;
  let daysBack = 0;
  for (let d = fromDay - 1; d >= 0 && daysBack < advanceDays; d--) {
    if (!workdays || workdays[d]) {
      daysBack++;
      target = d;
    }
  }
  return daysBack === advanceDays ? target : -1;
}

// ── Types ───────────────────────────────────────────────

/** A single auto-replan action taken by the system */
export interface AutoReplanAction {
  /** Which strategy was used */
  strategy: ReplanStrategyType;
  /** Operation affected */
  opId: string;
  /** Machine involved */
  machineId: string;
  /** Decision ID in registry */
  decisionId: string;
  /** Human-readable description */
  description: string;
  /** Detailed explanation of what was done */
  detail: string;
  /** Alternatives the user could choose instead */
  alternatives: AlternativeAction[];
  /** Structured metadata from original decision (preserved for final re-recording) */
  metadata?: Record<string, unknown>;
}

/** Complete result of auto-replan */
export interface AutoReplanResult {
  /** Final blocks after all replan actions */
  blocks: Block[];
  /** Final scheduling result */
  scheduleResult: ScheduleAllResult;
  /** All auto-replan actions taken, in order */
  actions: AutoReplanAction[];
  /** Auto-generated move actions */
  autoMoves: MoveAction[];
  /** Auto-generated advance actions */
  autoAdvances: AdvanceAction[];
  /** Overtime actions applied */
  overtimeActions: OvertimeAction[];
  /** Split actions applied */
  splitActions: SplitAction[];
  /** Whether 3rd shift was activated by auto-replan */
  thirdShiftActivated: boolean;
  /** Remaining unresolved overflow operations */
  unresolved: Array<{ opId: string; deficit: number; reason: string }>;
  /** Full decision registry */
  registry: DecisionRegistry;
  /** All decisions */
  decisions: DecisionEntry[];
}

// ── Main export ─────────────────────────────────────────

/**
 * Auto-resolve overflow by executing strategies in priority order.
 *
 * Algorithm:
 * 1. Run initial scheduleAll() to get baseline
 * 2. For each strategy in config.strategyOrder:
 *    a. Find overflow candidates
 *    b. Try the strategy (greedy: 1 action at a time)
 *    c. Validate improvement (re-schedule)
 *    d. Record in DecisionRegistry with alternatives
 *    e. Mark blocks as system-replanned
 * 3. Remaining overflow → FORMAL_RISK_ACCEPTANCE
 *
 * @param input - Full scheduling input (same as scheduleAll)
 * @param config - Auto-replan configuration
 * @returns AutoReplanResult with final schedule and audit trail
 */
export function autoReplan(
  input: ScheduleAllInput,
  config: AutoReplanConfig = DEFAULT_AUTO_REPLAN_CONFIG,
): AutoReplanResult {
  // If auto-replan is disabled, just run normal schedule
  if (!config.enabled) {
    const result = scheduleAll(input);
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

  const autoMoves: MoveAction[] = [];
  const autoAdvances: AdvanceAction[] = [];
  const overtimeActions: OvertimeAction[] = [];
  const splitActions: SplitAction[] = [];
  const actions: AutoReplanAction[] = [];
  let thirdShiftActivated = false;
  // Deep copy: inner Record<number, number> must not alias the caller's data
  const currentOvertimeMap: Record<string, Record<number, number>> = {};
  for (const [mId, dayMap] of Object.entries(input.overtimeMap ?? {})) {
    currentOvertimeMap[mId] = { ...dayMap };
  }
  let currentThirdShift = input.thirdShift ?? false;
  let currentOps = [...input.ops];

  // Build current input for re-scheduling
  const buildInput = (): ScheduleAllInput => ({
    ...input,
    ops: currentOps,
    moves: [...input.moves, ...autoMoves],
    thirdShift: currentThirdShift,
    overtimeMap: Object.keys(currentOvertimeMap).length > 0 ? currentOvertimeMap : undefined,
    advanceOverrides: autoAdvances.length > 0 ? autoAdvances : input.advanceOverrides,
    enableLeveling: false,
    enforceDeadlines: false,
  });

  // Run initial schedule
  let schedResult = scheduleAll(buildInput());
  let blocks = schedResult.blocks;
  let totalOverflow = sumOverflow(blocks);

  if (totalOverflow === 0 && computeTardiness(blocks) === 0) {
    // Re-run with leveling and deadlines for final result
    const finalResult = scheduleAll({
      ...buildInput(),
      enableLeveling: true,
      enforceDeadlines: true,
    });
    return {
      blocks: finalResult.blocks,
      scheduleResult: finalResult,
      actions: [],
      autoMoves: [],
      autoAdvances: [],
      overtimeActions: [],
      splitActions: [],
      thirdShiftActivated: false,
      unresolved: [],
      registry: finalResult.registry,
      decisions: finalResult.decisions,
    };
  }

  const excludeOps = new Set<string>(config.excludeOps ?? []);
  let totalActions = 0;
  const wDayCount = input.workdays ? input.workdays.filter(Boolean).length : input.nDays;

  // Capture ops that are already tardy BEFORE Tier 1.
  // Tier 2 will only fix these — NOT ops that become tardy as a side effect
  // of Tier 1 advances (e.g. tool-group merging that pushes other ops later).
  const preTier1TardyOps = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'ok' && b.eddDay != null && b.dayIdx > b.eddDay) {
      preTier1TardyOps.add(b.opId);
    }
  }

  // Outer loop: repeat all strategies until no further improvement.
  // This allows later strategies (OVERTIME, THIRD_SHIFT) to free capacity
  // that earlier strategies (ADVANCE, MOVE) can then exploit.
  let outerImproved = true;
  let outerRound = 0;

  while (
    outerImproved &&
    totalOverflow > 0 &&
    totalActions < config.maxTotalActions &&
    outerRound < config.maxOuterRounds
  ) {
    outerImproved = false;
    outerRound++;
    const overflowBeforeRound = totalOverflow;

    // Recompute hardCap each round (may change after THIRD_SHIFT activation)
    const hardCap = currentThirdShift ? S2 - S0 : DAY_CAP;

    // Execute strategies in priority order
    for (const strategy of config.strategyOrder) {
      if (!config.strategies[strategy]) continue;
      if (totalOverflow === 0) break;
      if (totalActions >= config.maxTotalActions) break;

      switch (strategy) {
        // ── ADVANCE_PRODUCTION (with D+1 tiebreaker) ────────
        case 'ADVANCE_PRODUCTION': {
          const wfConfig = input.workforceConfig;
          let improved = true;
          while (improved && totalOverflow > 0 && totalActions < config.maxTotalActions) {
            improved = false;

            const overflowBlocks = blocks
              .filter(
                (b) =>
                  ((b.overflow && b.overflowMin != null && b.overflowMin > 0) ||
                    (b.type === 'infeasible' && b.prodMin > 0)) &&
                  !excludeOps.has(b.opId),
              )
              .sort((a, b) => {
                const aMin = a.overflow ? a.overflowMin || 0 : a.prodMin;
                const bMin = b.overflow ? b.overflowMin || 0 : b.prodMin;
                return bMin - aMin;
              });

            // Collect best candidate across all overflow blocks (D+1 tiebreaker)
            let bestAdv: {
              ob: Block;
              advDays: number;
              targetDay: number;
              newOverflow: number;
              newResult: ScheduleAllResult;
              d1Risk: number;
            } | null = null;

            const seenOps = new Set<string>();
            for (const ob of overflowBlocks) {
              if (seenOps.has(ob.opId)) continue;
              seenOps.add(ob.opId);

              // Try advancing 1..30 working days — take FIRST that improves per op
              for (let advDays = 1; advDays <= 30; advDays++) {
                const targetDay = computeAdvancedEdd(ob.dayIdx, advDays, input.workdays);
                if (targetDay < 0) break;

                const trial: AdvanceAction[] = [
                  ...autoAdvances,
                  { opId: ob.opId, advanceDays: advDays, originalEdd: ob.dayIdx },
                ];
                const newResult = scheduleAll({ ...buildInput(), advanceOverrides: trial });
                const newOverflow = sumOverflow(newResult.blocks);

                if (newOverflow < totalOverflow) {
                  const d1Risk = wfConfig
                    ? computeD1WorkforceRisk(newResult.blocks, wfConfig, input.workdays)
                    : 0;

                  if (
                    !bestAdv ||
                    newOverflow < bestAdv.newOverflow ||
                    (newOverflow === bestAdv.newOverflow && d1Risk < bestAdv.d1Risk)
                  ) {
                    bestAdv = { ob, advDays, targetDay, newOverflow, newResult, d1Risk };
                  }
                  break; // for this op, take first (smallest) advance that works
                }
              }
            }

            // Apply the best candidate
            if (bestAdv) {
              const { ob, advDays, targetDay, newOverflow, newResult } = bestAdv;
              autoAdvances.push({ opId: ob.opId, advanceDays: advDays, originalEdd: ob.dayIdx });
              blocks = newResult.blocks;
              schedResult = newResult;
              totalOverflow = newOverflow;
              improved = true;
              totalActions++;

              // Mark blocks
              for (const b of blocks) {
                if (b.opId === ob.opId && b.type === 'ok') {
                  b.isAdvanced = true;
                  b.advancedByDays = advDays;
                  b.isSystemReplanned = true;
                  b.replanStrategy = 'ADVANCE_PRODUCTION';
                }
              }

              // Build alternatives
              const tool = input.toolMap[ob.toolId];
              const alts: AlternativeAction[] = [];
              if (tool?.alt && tool.alt !== '-') {
                alts.push({
                  description: `Mover para máquina alternativa ${tool.alt}`,
                  actionType: 'MOVE_ALT_MACHINE',
                  params: { opId: ob.opId, toM: tool.alt },
                });
              }
              alts.push({
                description: `Aceitar atraso formalmente`,
                actionType: 'FORMAL_RISK_ACCEPTANCE',
                params: { opId: ob.opId },
              });

              const decisionId = schedResult.registry.record({
                type: 'AUTO_REPLAN_ADVANCE',
                opId: ob.opId,
                toolId: ob.toolId,
                machineId: ob.machineId,
                detail: `Produção de ${ob.sku} antecipada ${advDays} dias úteis em ${ob.machineId} (EDD ${ob.dayIdx} → ${targetDay})`,
                metadata: {
                  originalEdd: ob.dayIdx,
                  newEdd: targetDay,
                  advanceDays: advDays,
                  sku: ob.sku,
                },
                replanStrategy: 'ADVANCE_PRODUCTION',
                alternatives: alts,
                reversible: true,
              });

              actions.push({
                strategy: 'ADVANCE_PRODUCTION',
                opId: ob.opId,
                machineId: ob.machineId,
                decisionId,
                description: `Antecipada produção de ${ob.sku} em ${advDays} dias`,
                detail: `Produção de ${ob.sku} antecipada ${advDays} dias úteis em ${ob.machineId}. EDD original: dia ${ob.dayIdx}, novo: dia ${targetDay}.`,
                alternatives: alts,
                metadata: {
                  originalEdd: ob.dayIdx,
                  newEdd: targetDay,
                  advanceDays: advDays,
                  sku: ob.sku,
                },
              });
            }
          }
          break;
        }

        // ── MOVE_ALT_MACHINE (with D+1 tiebreaker) ─────────
        case 'MOVE_ALT_MACHINE': {
          const wfConfigMove = input.workforceConfig;
          let improved = true;
          while (improved && totalOverflow > 0 && totalActions < config.maxTotalActions) {
            improved = false;
            const cap = capAnalysis(blocks, input.machines);

            const altCandidates = blocks
              .filter(
                (b) =>
                  ((b.overflow && b.overflowMin != null && b.overflowMin > 0) ||
                    (b.type === 'infeasible' && b.prodMin > 0)) &&
                  b.hasAlt &&
                  b.altM &&
                  !excludeOps.has(b.opId) &&
                  input.mSt[b.altM!] !== 'down',
              )
              .sort((a, b) => {
                const aMin = a.overflow ? a.overflowMin || 0 : a.prodMin;
                const bMin = b.overflow ? b.overflowMin || 0 : b.prodMin;
                return bMin - aMin;
              });

            // Collect best candidate across all alt-machine options (D+1 tiebreaker)
            let bestMove: {
              ob: Block;
              altM: string;
              altUtil: number;
              newOverflow: number;
              newResult: ScheduleAllResult;
              d1Risk: number;
            } | null = null;

            const seenOps = new Set<string>();
            for (const ob of altCandidates) {
              if (seenOps.has(ob.opId)) continue;
              seenOps.add(ob.opId);

              const altM = ob.altM!;
              const altDays = cap[altM];
              if (!altDays) continue;

              const altTotalUsed = altDays.reduce((s, d) => s + d.prod + d.setup, 0);
              const altUtil = altTotalUsed / (wDayCount * hardCap);
              if (altUtil > ALT_UTIL_THRESHOLD) continue;

              autoMoves.push({ opId: ob.opId, toM: altM });
              const newResult = scheduleAll(buildInput());
              const newOverflow = sumOverflow(newResult.blocks);
              autoMoves.pop(); // always undo; apply only best candidate below

              if (newOverflow < totalOverflow) {
                const d1Risk = wfConfigMove
                  ? computeD1WorkforceRisk(newResult.blocks, wfConfigMove, input.workdays)
                  : 0;

                if (
                  !bestMove ||
                  newOverflow < bestMove.newOverflow ||
                  (newOverflow === bestMove.newOverflow && d1Risk < bestMove.d1Risk)
                ) {
                  bestMove = { ob, altM, altUtil, newOverflow, newResult, d1Risk };
                }
              }
            }

            // Apply the best candidate
            if (bestMove) {
              const { ob, altM, altUtil, newOverflow, newResult } = bestMove;
              autoMoves.push({ opId: ob.opId, toM: altM });
              blocks = newResult.blocks;
              schedResult = newResult;
              totalOverflow = newOverflow;
              improved = true;
              totalActions++;

              // Mark blocks
              for (const b of blocks) {
                if (b.opId === ob.opId && b.type === 'ok') {
                  b.isSystemReplanned = true;
                  b.replanStrategy = 'MOVE_ALT_MACHINE';
                }
              }

              const alts: AlternativeAction[] = [
                {
                  description: `Antecipar produção na máquina original ${ob.machineId}`,
                  actionType: 'ADVANCE_PRODUCTION',
                  params: { opId: ob.opId, machineId: ob.machineId },
                },
                {
                  description: `Aceitar atraso formalmente`,
                  actionType: 'FORMAL_RISK_ACCEPTANCE',
                  params: { opId: ob.opId },
                },
              ];

              const decisionId = schedResult.registry.record({
                type: 'AUTO_REPLAN_MOVE',
                opId: ob.opId,
                toolId: ob.toolId,
                machineId: altM,
                detail: `${ob.sku} movido de ${ob.machineId} para ${altM} (utilização alt: ${Math.round(altUtil * 100)}%)`,
                metadata: {
                  fromMachine: ob.machineId,
                  toMachine: altM,
                  sku: ob.sku,
                  altUtil: Math.round(altUtil * 100),
                },
                replanStrategy: 'MOVE_ALT_MACHINE',
                alternatives: alts,
                reversible: true,
              });

              actions.push({
                strategy: 'MOVE_ALT_MACHINE',
                opId: ob.opId,
                machineId: altM,
                decisionId,
                description: `Movido ${ob.sku} para ${altM}`,
                detail: `${ob.sku} movido de ${ob.machineId} para máquina alternativa ${altM}. Utilização da alternativa: ${Math.round(altUtil * 100)}%.`,
                alternatives: alts,
                metadata: {
                  fromMachine: ob.machineId,
                  toMachine: altM,
                  sku: ob.sku,
                  altUtil: Math.round(altUtil * 100),
                },
              });
            }
          }
          break;
        }

        // ── SPLIT_OPERATION ─────────────────────────────────
        case 'SPLIT_OPERATION': {
          let splitImproved = true;
          while (splitImproved && totalOverflow > 0 && totalActions < config.maxTotalActions) {
            splitImproved = false;

            const splitResult = trySplitOperation(
              buildInput(),
              blocks,
              totalOverflow,
              config.split,
              excludeOps,
            );

            if (splitResult.split && splitResult.candidate && splitResult.syntheticOp) {
              splitImproved = true;
              const c = splitResult.candidate;
              blocks = splitResult.blocks;
              schedResult = splitResult.schedResult;
              totalOverflow = totalOverflow - splitResult.overflowReduction;
              totalActions++;

              // Update current ops with the split
              currentOps = [
                ...currentOps.map((o) =>
                  o.id === c.opId
                    ? {
                        ...o,
                        d: o.d.map((v, i) => Math.max(v - (splitResult.syntheticOp!.d[i] ?? 0), 0)),
                        atr: Math.max((o.atr ?? 0) - (splitResult.syntheticOp!.atr ?? 0), 0),
                      }
                    : o,
                ),
                splitResult.syntheticOp,
              ];

              splitActions.push({
                opId: c.opId,
                fraction: c.fraction,
                toMachine: c.altMachine,
              });

              const alts: AlternativeAction[] = [
                {
                  description: `Mover TODA a operação para ${c.altMachine}`,
                  actionType: 'MOVE_ALT_MACHINE',
                  params: { opId: c.opId, toM: c.altMachine },
                },
                {
                  description: `Aceitar atraso formalmente`,
                  actionType: 'FORMAL_RISK_ACCEPTANCE',
                  params: { opId: c.opId },
                },
              ];

              const decisionId = schedResult.registry.record({
                type: 'AUTO_REPLAN_SPLIT',
                opId: c.opId,
                toolId: c.toolId,
                machineId: c.altMachine,
                detail: `Operação ${c.opId} dividida: ${Math.round((1 - c.fraction) * 100)}% em ${c.machineId}, ${Math.round(c.fraction * 100)}% em ${c.altMachine}`,
                metadata: {
                  fromMachine: c.machineId,
                  toMachine: c.altMachine,
                  fraction: c.fraction,
                  primaryDemand: c.primaryDemand,
                  altDemand: c.altDemand,
                },
                replanStrategy: 'SPLIT_OPERATION',
                alternatives: alts,
                reversible: true,
              });

              actions.push({
                strategy: 'SPLIT_OPERATION',
                opId: c.opId,
                machineId: c.altMachine,
                decisionId,
                description: `Operação ${c.opId} dividida entre ${c.machineId} e ${c.altMachine}`,
                detail: `${Math.round(c.fraction * 100)}% da produção movida para ${c.altMachine}. Primária: ${c.primaryDemand} pcs, Alternativa: ${c.altDemand} pcs.`,
                alternatives: alts,
                metadata: {
                  fraction: c.fraction,
                  primaryDemand: c.primaryDemand,
                  altDemand: c.altDemand,
                  fromMachine: c.machineId,
                  toMachine: c.altMachine,
                },
              });

              excludeOps.add(c.opId);
            }
          }
          break;
        }

        // ── OVERTIME ────────────────────────────────────────
        case 'OVERTIME': {
          let otImproved = true;
          while (otImproved && totalOverflow > 0 && totalActions < config.maxTotalActions) {
            otImproved = false;

            const overtimeResult = tryOvertime(
              buildInput(),
              blocks,
              totalOverflow,
              config.overtime,
              excludeOps,
            );

            if (overtimeResult.activated) {
              otImproved = true;
              blocks = overtimeResult.blocks;
              schedResult = overtimeResult.schedResult;
              totalOverflow = totalOverflow - overtimeResult.overflowReduction;
              totalActions++;

              // Update overtime map
              for (const ot of overtimeResult.overtimeActions) {
                if (!currentOvertimeMap[ot.machineId]) currentOvertimeMap[ot.machineId] = {};
                currentOvertimeMap[ot.machineId][ot.dayIdx] =
                  (currentOvertimeMap[ot.machineId][ot.dayIdx] ?? 0) + ot.extraMin;
              }

              overtimeActions.push(...overtimeResult.overtimeActions);

              const alts: AlternativeAction[] = [
                {
                  description: `Activar 3.º turno em vez de horas extra`,
                  actionType: 'THIRD_SHIFT',
                  params: {},
                },
                {
                  description: `Aceitar atraso formalmente`,
                  actionType: 'FORMAL_RISK_ACCEPTANCE',
                  params: {},
                },
              ];

              for (const ot of overtimeResult.overtimeActions) {
                const decisionId = schedResult.registry.record({
                  type: 'AUTO_REPLAN_OVERTIME',
                  machineId: ot.machineId,
                  dayIdx: ot.dayIdx,
                  detail: `Overtime +${ot.extraMin} min em ${ot.machineId} no dia ${ot.dayIdx}`,
                  metadata: { machineId: ot.machineId, dayIdx: ot.dayIdx, extraMin: ot.extraMin },
                  replanStrategy: 'OVERTIME',
                  alternatives: alts,
                  reversible: true,
                });

                actions.push({
                  strategy: 'OVERTIME',
                  opId: '',
                  machineId: ot.machineId,
                  decisionId,
                  description: `Overtime +${ot.extraMin} min em ${ot.machineId} dia ${ot.dayIdx}`,
                  detail: `${ot.extraMin} minutos extra adicionados a ${ot.machineId} no dia ${ot.dayIdx}.`,
                  alternatives: alts,
                  metadata: { machineId: ot.machineId, dayIdx: ot.dayIdx, extraMin: ot.extraMin },
                });
              }
            }
          }
          break;
        }

        // ── THIRD_SHIFT ─────────────────────────────────────
        case 'THIRD_SHIFT': {
          const thirdShiftResult = tryThirdShift(buildInput(), blocks, totalOverflow);

          if (thirdShiftResult.activated) {
            blocks = thirdShiftResult.blocks;
            schedResult = thirdShiftResult.schedResult;
            totalOverflow = totalOverflow - thirdShiftResult.overflowReduction;
            currentThirdShift = true;
            thirdShiftActivated = true;
            totalActions++;

            const alts: AlternativeAction[] = [
              {
                description: `Aceitar atraso formalmente em vez de activar 3.º turno`,
                actionType: 'FORMAL_RISK_ACCEPTANCE',
                params: {},
              },
            ];

            const decisionId = schedResult.registry.record({
              type: 'AUTO_REPLAN_THIRD_SHIFT',
              detail: `3.º turno activado globalmente (Z: 00:00-07:00, +420 min/dia). Redução de overflow: ${thirdShiftResult.overflowReduction} min.`,
              metadata: { overflowReduction: thirdShiftResult.overflowReduction },
              replanStrategy: 'THIRD_SHIFT',
              alternatives: alts,
              reversible: true,
            });

            actions.push({
              strategy: 'THIRD_SHIFT',
              opId: '',
              machineId: '',
              decisionId,
              description: `3.º turno activado globalmente`,
              detail: `Turno Z (00:00-07:00) activado em todas as máquinas. +420 min/dia de capacidade. Redução de overflow: ${thirdShiftResult.overflowReduction} min.`,
              alternatives: alts,
              metadata: { overflowReduction: thirdShiftResult.overflowReduction },
            });
          }
          break;
        }
      } // end switch
    } // end for strategyOrder

    // If this round reduced overflow, loop again
    if (totalOverflow < overflowBeforeRound) {
      outerImproved = true;
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  TIER 2: Resolve TARDINESS (blocks scheduled after their EDD)
  //  Only runs after overflow strategies are exhausted.
  //  Uses advance + alt machine routing for tardy operations.
  // ════════════════════════════════════════════════════════════════

  let totalTardiness = computeTardiness(blocks);

  while (totalTardiness > 0 && totalActions < config.maxTotalActions) {
    let tardyImproved = false;
    const hardCapT2 = currentThirdShift ? S2 - S0 : DAY_CAP;

    // Find tardy blocks: type='ok' but scheduled after deadline.
    // Only fix ops that were ALREADY tardy before Tier 1 — skip ops that
    // became tardy as a side effect of Tier 1 advances (tool-group merging).
    const tardyBlocks = blocks
      .filter(
        (b) =>
          b.type === 'ok' &&
          b.eddDay != null &&
          b.dayIdx > b.eddDay &&
          preTier1TardyOps.has(b.opId) &&
          !excludeOps.has(b.opId),
      )
      .sort((a, b) => b.prodMin - a.prodMin);

    if (tardyBlocks.length === 0) break;

    // ── Try ADVANCING tardy operations ──────────────────────
    const wfConfigT2 = input.workforceConfig;
    let bestTardyAdv: {
      ob: Block;
      advDays: number;
      targetDay: number;
      newTardiness: number;
      newResult: ScheduleAllResult;
      d1Risk: number;
    } | null = null;

    const seenTardyOps = new Set<string>();
    for (const ob of tardyBlocks) {
      if (seenTardyOps.has(ob.opId)) continue;
      seenTardyOps.add(ob.opId);

      const obEdd = ob.eddDay ?? ob.dayIdx;
      for (let advDays = 1; advDays <= 30; advDays++) {
        const targetDay = computeAdvancedEdd(obEdd, advDays, input.workdays);
        if (targetDay < 0) break;

        const trial: AdvanceAction[] = [
          ...autoAdvances,
          { opId: ob.opId, advanceDays: advDays, originalEdd: obEdd },
        ];
        const newResult = scheduleAll({ ...buildInput(), advanceOverrides: trial });
        const newTardiness = computeTardiness(newResult.blocks);

        if (newTardiness < totalTardiness && sumOverflow(newResult.blocks) === 0) {
          const d1Risk = wfConfigT2
            ? computeD1WorkforceRisk(newResult.blocks, wfConfigT2, input.workdays)
            : 0;

          if (
            !bestTardyAdv ||
            newTardiness < bestTardyAdv.newTardiness ||
            (newTardiness === bestTardyAdv.newTardiness && d1Risk < bestTardyAdv.d1Risk)
          ) {
            bestTardyAdv = { ob, advDays, targetDay, newTardiness, newResult, d1Risk };
          }
          break; // for this op, take first (smallest) advance that works
        }
      }
    }

    // Apply the best advance candidate
    if (bestTardyAdv) {
      const { ob, advDays, targetDay, newTardiness, newResult } = bestTardyAdv;
      const obEdd = ob.eddDay ?? ob.dayIdx;
      autoAdvances.push({ opId: ob.opId, advanceDays: advDays, originalEdd: obEdd });
      blocks = newResult.blocks;
      schedResult = newResult;
      totalTardiness = newTardiness;
      tardyImproved = true;
      totalActions++;

      for (const b of blocks) {
        if (b.opId === ob.opId && b.type === 'ok') {
          b.isAdvanced = true;
          b.advancedByDays = advDays;
          b.isSystemReplanned = true;
          b.replanStrategy = 'ADVANCE_PRODUCTION';
        }
      }

      const tool = input.toolMap[ob.toolId];
      const alts: AlternativeAction[] = [];
      if (tool?.alt && tool.alt !== '-') {
        alts.push({
          description: `Mover para máquina alternativa ${tool.alt}`,
          actionType: 'MOVE_ALT_MACHINE',
          params: { opId: ob.opId, toM: tool.alt },
        });
      }
      alts.push({
        description: `Aceitar atraso formalmente`,
        actionType: 'FORMAL_RISK_ACCEPTANCE',
        params: { opId: ob.opId },
      });

      const decisionId = schedResult.registry.record({
        type: 'AUTO_REPLAN_ADVANCE',
        opId: ob.opId,
        toolId: ob.toolId,
        machineId: ob.machineId,
        detail: `Produção de ${ob.sku} antecipada ${advDays} dias úteis em ${ob.machineId} (EDD ${obEdd} → ${targetDay}, tardy)`,
        metadata: { originalEdd: obEdd, newEdd: targetDay, advanceDays: advDays, sku: ob.sku },
        replanStrategy: 'ADVANCE_PRODUCTION',
        alternatives: alts,
        reversible: true,
      });

      actions.push({
        strategy: 'ADVANCE_PRODUCTION',
        opId: ob.opId,
        machineId: ob.machineId,
        decisionId,
        description: `Antecipada produção de ${ob.sku} em ${advDays} dias (tardy)`,
        detail: `Produção de ${ob.sku} antecipada ${advDays} dias úteis em ${ob.machineId}. EDD original: dia ${obEdd}, novo: dia ${targetDay}. Razão: tardiness.`,
        alternatives: alts,
        metadata: { originalEdd: obEdd, newEdd: targetDay, advanceDays: advDays, sku: ob.sku },
      });
    }

    // ── Try ALT MACHINE for tardy operations ────────────────
    if (!bestTardyAdv) {
      const capT2 = capAnalysis(blocks, input.machines);
      const wDayCountT2 = input.workdays ? input.workdays.filter(Boolean).length : input.nDays;

      let bestTardyMove: {
        ob: Block;
        altM: string;
        altUtil: number;
        newTardiness: number;
        newResult: ScheduleAllResult;
        d1Risk: number;
      } | null = null;

      const seenOpsAlt = new Set<string>();
      for (const ob of tardyBlocks) {
        if (seenOpsAlt.has(ob.opId)) continue;
        seenOpsAlt.add(ob.opId);
        if (!ob.hasAlt || !ob.altM || input.mSt[ob.altM!] === 'down') continue;

        const altM = ob.altM!;
        const altDays = capT2[altM];
        if (!altDays) continue;

        const altTotalUsed = altDays.reduce((s, d) => s + d.prod + d.setup, 0);
        const altUtil = altTotalUsed / (wDayCountT2 * hardCapT2);
        if (altUtil > ALT_UTIL_THRESHOLD) continue;

        autoMoves.push({ opId: ob.opId, toM: altM });
        const newResult = scheduleAll(buildInput());
        const newTardiness = computeTardiness(newResult.blocks);
        autoMoves.pop();

        if (newTardiness < totalTardiness && sumOverflow(newResult.blocks) === 0) {
          const d1Risk = wfConfigT2
            ? computeD1WorkforceRisk(newResult.blocks, wfConfigT2, input.workdays)
            : 0;

          if (
            !bestTardyMove ||
            newTardiness < bestTardyMove.newTardiness ||
            (newTardiness === bestTardyMove.newTardiness && d1Risk < bestTardyMove.d1Risk)
          ) {
            bestTardyMove = { ob, altM, altUtil, newTardiness, newResult, d1Risk };
          }
        }
      }

      if (bestTardyMove) {
        const { ob, altM, altUtil, newTardiness, newResult } = bestTardyMove;
        autoMoves.push({ opId: ob.opId, toM: altM });
        blocks = newResult.blocks;
        schedResult = newResult;
        totalTardiness = newTardiness;
        tardyImproved = true;
        totalActions++;

        for (const b of blocks) {
          if (b.opId === ob.opId && b.type === 'ok') {
            b.isSystemReplanned = true;
            b.replanStrategy = 'MOVE_ALT_MACHINE';
          }
        }

        const alts: AlternativeAction[] = [
          {
            description: `Antecipar produção na máquina original ${ob.machineId}`,
            actionType: 'ADVANCE_PRODUCTION',
            params: { opId: ob.opId, machineId: ob.machineId },
          },
          {
            description: `Aceitar atraso formalmente`,
            actionType: 'FORMAL_RISK_ACCEPTANCE',
            params: { opId: ob.opId },
          },
        ];

        const decisionId = schedResult.registry.record({
          type: 'AUTO_REPLAN_MOVE',
          opId: ob.opId,
          toolId: ob.toolId,
          machineId: altM,
          detail: `${ob.sku} movido de ${ob.machineId} para ${altM} (tardy, utilização alt: ${Math.round(altUtil * 100)}%)`,
          metadata: {
            fromMachine: ob.machineId,
            toMachine: altM,
            sku: ob.sku,
            altUtil: Math.round(altUtil * 100),
          },
          replanStrategy: 'MOVE_ALT_MACHINE',
          alternatives: alts,
          reversible: true,
        });

        actions.push({
          strategy: 'MOVE_ALT_MACHINE',
          opId: ob.opId,
          machineId: altM,
          decisionId,
          description: `Movido ${ob.sku} para ${altM} (tardy)`,
          detail: `${ob.sku} movido de ${ob.machineId} para máquina alternativa ${altM} (tardy). Utilização da alternativa: ${Math.round(altUtil * 100)}%.`,
          alternatives: alts,
          metadata: {
            fromMachine: ob.machineId,
            toMachine: altM,
            sku: ob.sku,
            altUtil: Math.round(altUtil * 100),
          },
        });
      }
    }

    if (!tardyImproved) break;
  }

  // ── Final run with leveling + deadlines ────────────────
  const finalResult = scheduleAll({
    ...buildInput(),
    enableLeveling: true,
    enforceDeadlines: true,
  });

  // Re-record auto-replan decisions into the final registry and update IDs
  const decisionTypeMap: Record<ReplanStrategyType, DecisionEntry['type']> = {
    ADVANCE_PRODUCTION: 'AUTO_REPLAN_ADVANCE',
    MOVE_ALT_MACHINE: 'AUTO_REPLAN_MOVE',
    SPLIT_OPERATION: 'AUTO_REPLAN_SPLIT',
    OVERTIME: 'AUTO_REPLAN_OVERTIME',
    THIRD_SHIFT: 'AUTO_REPLAN_THIRD_SHIFT',
  };

  for (const action of actions) {
    const newDecisionId = finalResult.registry.record({
      type: decisionTypeMap[action.strategy],
      opId: action.opId || undefined,
      machineId: action.machineId || undefined,
      detail: action.detail,
      metadata: action.metadata ?? {},
      replanStrategy: action.strategy,
      alternatives: action.alternatives,
      reversible: true,
    });

    action.decisionId = newDecisionId;

    // Apply system-replanned marks to final blocks
    if (action.strategy === 'ADVANCE_PRODUCTION') {
      const advDays = (action.metadata?.advanceDays as number) ?? 0;
      for (const b of finalResult.blocks) {
        if (b.opId === action.opId && b.type === 'ok') {
          b.isSystemReplanned = true;
          b.replanStrategy = 'ADVANCE_PRODUCTION';
          b.replanDecisionId = newDecisionId;
          b.isAdvanced = true;
          b.advancedByDays = advDays;
        }
      }
    } else if (action.strategy === 'MOVE_ALT_MACHINE') {
      for (const b of finalResult.blocks) {
        if (b.opId === action.opId && b.type === 'ok' && b.machineId === action.machineId) {
          b.isSystemReplanned = true;
          b.replanStrategy = 'MOVE_ALT_MACHINE';
          b.replanDecisionId = newDecisionId;
        }
      }
    } else if (action.strategy === 'SPLIT_OPERATION') {
      for (const b of finalResult.blocks) {
        if (b.opId === `${action.opId}__split` || (b.isSplitPart && b.opId.endsWith('__split'))) {
          b.isSystemReplanned = true;
          b.replanStrategy = 'SPLIT_OPERATION';
          b.replanDecisionId = newDecisionId;
          b.isSplitPart = true;
          b.splitFromMachine = action.machineId;
        }
      }
    } else if (action.strategy === 'OVERTIME') {
      const otDayIdx = action.metadata?.dayIdx as number | undefined;
      const otExtra = action.metadata?.extraMin as number | undefined;
      const normalEnd = currentThirdShift ? S2 : S1;
      for (const b of finalResult.blocks) {
        if (
          b.machineId === action.machineId &&
          b.type === 'ok' &&
          (otDayIdx == null || b.dayIdx === otDayIdx) &&
          b.endMin > normalEnd
        ) {
          b.isSystemReplanned = true;
          b.replanStrategy = 'OVERTIME';
          b.replanDecisionId = newDecisionId;
          b.isOvertime = true;
          b.overtimeMin = Math.min(b.endMin - normalEnd, otExtra ?? b.endMin - normalEnd);
        }
      }
    } else if (action.strategy === 'THIRD_SHIFT') {
      for (const b of finalResult.blocks) {
        if (b.shift === 'Z' && b.type === 'ok') {
          b.isSystemReplanned = true;
          b.replanStrategy = 'THIRD_SHIFT';
          b.replanDecisionId = newDecisionId;
        }
      }
    }
  }

  // ── Collect unresolved overflow ────────────────────────
  const unresolved: Array<{ opId: string; deficit: number; reason: string }> = [];
  const unresolvedOps = new Set<string>();

  for (const b of finalResult.blocks) {
    if (
      (b.type === 'infeasible' || (b.type === 'overflow' && b.overflowMin && b.overflowMin > 0)) &&
      !unresolvedOps.has(b.opId)
    ) {
      unresolvedOps.add(b.opId);
      const op = currentOps.find((o) => o.id === b.opId);
      const totalDemand = op
        ? op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0)
        : 0;
      const produced = finalResult.blocks
        .filter((fb) => fb.opId === b.opId && fb.type === 'ok')
        .reduce((s, fb) => s + fb.qty, 0);

      unresolved.push({
        opId: b.opId,
        deficit: totalDemand - produced,
        reason: b.infeasibilityReason ?? 'CAPACITY_OVERFLOW',
      });
    }
  }

  return {
    blocks: finalResult.blocks,
    scheduleResult: finalResult,
    actions,
    autoMoves,
    autoAdvances,
    overtimeActions,
    splitActions,
    thirdShiftActivated,
    unresolved,
    registry: finalResult.registry,
    decisions: finalResult.registry.getAll(),
  };
}
