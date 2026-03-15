import {
  ALT_UTIL_THRESHOLD, DAY_CAP, MAX_ADVANCE_DAYS, MAX_AUTO_MOVES, MAX_OVERFLOW_ITER, S0, S2,
} from '../constants.js';
import type { DecisionRegistry } from '../decisions/decision-registry.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { AdvanceAction, Block, MoveAction } from '../types/blocks.js';
import type { ConstraintConfig } from '../types/constraints.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../types/constraints.js';
import type { DecisionEntry } from '../types/decisions.js';
import type { EMachine, EOp, ETool } from '../types/engine.js';
import type { FeasibilityReport } from '../types/infeasibility.js';
import type { ResourceTimeline } from '../types/failure.js';
import type { DispatchRule } from '../types/kpis.js';
import type { TwinValidationReport } from '../types/twin.js';
import type { WorkforceConfig } from '../types/workforce.js';
import { computeOtdDeliveryFailures } from './otd-delivery-failures.js';
import { capAnalysis, computeAdvancedEdd, sumOverflow } from './overflow-helpers.js';
import type { TierState } from './tier-types.js';
import { runTier2 } from './tier2-tardiness.js';
import { runTier3, tier3Diag } from './tier3-otd-delivery.js';

export interface AutoRouteOverflowInput {
  ops: EOp[];
  mSt: Record<string, string>;
  tSt: Record<string, string>;
  userMoves: MoveAction[];
  machines: EMachine[];
  toolMap: Record<string, ETool>;
  workdays: boolean[];
  nDays: number;
  workforceConfig?: WorkforceConfig;
  rule?: DispatchRule;
  supplyBoosts?: Map<string, { boost: number }>;
  thirdShift?: boolean;
  constraintConfig?: ConstraintConfig;
  machineTimelines?: Record<string, ResourceTimeline>;
  toolTimelines?: Record<string, ResourceTimeline>;
  twinValidationReport?: TwinValidationReport;
  dates?: string[];
  orderBased?: boolean;
  maxTier?: 1 | 2 | 3 | 4;
}

export interface AutoRouteOverflowResult {
  blocks: Block[];
  autoMoves: MoveAction[];
  autoAdvances: AdvanceAction[];
  decisions: DecisionEntry[];
  registry: DecisionRegistry;
  feasibilityReport: FeasibilityReport;
}
export function autoRouteOverflow(input: AutoRouteOverflowInput): AutoRouteOverflowResult {
  const {
    ops,
    mSt,
    tSt,
    userMoves,
    machines,
    toolMap,
    workdays,
    nDays,
    workforceConfig,
    rule = 'EDD',
    supplyBoosts,
    thirdShift,
    constraintConfig = DEFAULT_CONSTRAINT_CONFIG,
    machineTimelines,
    toolTimelines,
    twinValidationReport,
    dates,
    orderBased,
  } = input;
  const maxTier = input.maxTier ?? 4;

  const twinPartnerMap = new Map<string, string>();
  if (twinValidationReport?.twinGroups) {
    for (const tg of twinValidationReport.twinGroups) {
      twinPartnerMap.set(tg.opId1, tg.opId2);
      twinPartnerMap.set(tg.opId2, tg.opId1);
    }
  }

  const baseParams = {
    ops, mSt, tSt, machines, toolMap, workdays, nDays, workforceConfig,
    rule, supplyBoosts, thirdShift, constraintConfig, enforceDeadlines: false,
    machineTimelines, toolTimelines, twinValidationReport, dates, orderBased,
  };
  const runSchedule = (moves: MoveAction[], advances?: AdvanceAction[]) =>
    scheduleAll({ ...baseParams, moves, enableLeveling: false, advanceOverrides: advances });
  const runScheduleWithLeveling = (moves: MoveAction[], advances?: AdvanceAction[]) =>
    scheduleAll({ ...baseParams, moves, enableLeveling: true, advanceOverrides: advances });

  let schedResult = runSchedule(userMoves);
  let blocks = schedResult.blocks;
  let totalOverflowMin = sumOverflow(blocks);

  const autoMoves: MoveAction[] = [];
  const autoAdvances: AdvanceAction[] = [];

  const hardCap = thirdShift ? S2 - S0 : DAY_CAP;
  const preTier1TardyOps = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'ok' && b.eddDay != null && b.dayIdx > b.eddDay) {
      preTier1TardyOps.add(b.opId);
    }
  }

  // ── TIER 1: Resolve OVERFLOW ──
  if (totalOverflowMin > 0) {
    const maxSteps = MAX_AUTO_MOVES * MAX_OVERFLOW_ITER;

    for (let step = 0; step < maxSteps; step++) {
      if (autoMoves.length + autoAdvances.length >= MAX_AUTO_MOVES) break;

      const cap = capAnalysis(blocks, machines);
      const actionIds = new Set([
        ...userMoves.map((m) => m.opId),
        ...autoMoves.map((m) => m.opId),
        ...autoAdvances.map((a) => a.opId),
      ]);

      const allOverflowBlocks = blocks
        .filter(
          (b) =>
            ((b.overflow && b.overflowMin != null && b.overflowMin > 0) ||
              (b.type === 'infeasible' && b.prodMin > 0)) &&
            !actionIds.has(b.opId),
        )
        .sort((a, b) => {
          const aMin = a.overflow ? a.overflowMin || 0 : a.prodMin;
          const bMin = b.overflow ? b.overflowMin || 0 : b.prodMin;
          return bMin - aMin;
        });

      if (allOverflowBlocks.length === 0) break;

      let moved = false;
      const seenOps = new Set<string>();

      for (const ob of allOverflowBlocks) {
        if (seenOps.has(ob.opId)) continue;
        seenOps.add(ob.opId);

        const mId = ob.machineId;
        const mDays = cap[mId];
        if (!mDays) continue;

        for (let advDays = 1; advDays <= MAX_ADVANCE_DAYS; advDays++) {
          const targetDay = computeAdvancedEdd(ob.dayIdx, advDays, workdays);
          if (targetDay < 0) break;
          const trial: AdvanceAction[] = [
            ...autoAdvances,
            { opId: ob.opId, advanceDays: advDays, originalEdd: ob.dayIdx },
          ];
          const newResult = runSchedule([...userMoves, ...autoMoves], trial);
          const newOverflow = sumOverflow(newResult.blocks);

          if (newOverflow < totalOverflowMin) {
            autoAdvances.push({ opId: ob.opId, advanceDays: advDays, originalEdd: ob.dayIdx });
            blocks = newResult.blocks;
            schedResult = newResult;
            totalOverflowMin = newOverflow;
            moved = true;

            for (const b of blocks) {
              if (b.opId === ob.opId && b.type === 'ok') {
                b.isAdvanced = true;
                b.advancedByDays = advDays;
              }
            }

            const unschedMin = ob.overflow ? ob.overflowMin || 0 : ob.prodMin;
            schedResult.registry.record({
              type: 'ADVANCE_PRODUCTION',
              opId: ob.opId,
              toolId: ob.toolId,
              machineId: mId,
              detail: `Advanced ${ob.sku} production by ${advDays} working days on ${mId} (EDD ${ob.dayIdx} -> ${targetDay}, ${ob.type === 'infeasible' ? 'infeasible' : 'overflow'}: ${unschedMin}min)`,
              metadata: {
                originalEdd: ob.dayIdx,
                newEdd: targetDay,
                advanceDays: advDays,
                sku: ob.sku,
                overflowMin: unschedMin,
                machineId: mId,
              },
            });

            break;
          }
        }
        if (moved) break;
      }

      // ── Phase B: Alt machine routing ──
      if (!moved) {
        const altCandidates = allOverflowBlocks.filter(
          (b) =>
            b.hasAlt &&
            b.altM &&
            !actionIds.has(b.opId) &&
            mSt[b.altM!] !== 'down' &&
            !(
              machineTimelines?.[b.altM!] &&
              machineTimelines[b.altM!].every((day) =>
                (thirdShift ? (['X', 'Y', 'Z'] as const) : (['X', 'Y'] as const)).every(
                  (s) => (day[s]?.capacityFactor ?? 1) <= 0,
                ),
              )
            ),
        );

        const seenOpsAlt = new Set<string>();
        for (const ob of altCandidates) {
          if (seenOpsAlt.has(ob.opId)) continue;
          seenOpsAlt.add(ob.opId);

          const altM = ob.altM!;
          const altDays = cap[altM];
          if (!altDays) continue;

          const wDayCount = workdays ? workdays.filter(Boolean).length : nDays;
          const altTotalUsed = altDays.reduce((s, d) => s + d.prod + d.setup, 0);
          const altUtil = altTotalUsed / (wDayCount * hardCap);
          if (altUtil > ALT_UTIL_THRESHOLD) continue;

          const altRemaining = wDayCount * hardCap - altTotalUsed;
          if (altRemaining < 30) continue;

          const twinPartner = twinPartnerMap.get(ob.opId);
          const twinAlreadyMoved = twinPartner ? actionIds.has(twinPartner) : true;
          autoMoves.push({ opId: ob.opId, toM: altM });
          if (twinPartner && !twinAlreadyMoved) {
            autoMoves.push({ opId: twinPartner, toM: altM });
          }
          const newResult = runSchedule(
            [...userMoves, ...autoMoves],
            autoAdvances.length > 0 ? autoAdvances : undefined,
          );
          const newOverflow = sumOverflow(newResult.blocks);

          if (newOverflow < totalOverflowMin) {
            blocks = newResult.blocks;
            schedResult = newResult;
            totalOverflowMin = newOverflow;
            moved = true;
            const unschedMin = ob.overflow ? ob.overflowMin || 0 : ob.prodMin;
            schedResult.registry.record({
              type: 'OVERFLOW_ROUTE',
              opId: ob.opId,
              toolId: ob.toolId,
              machineId: altM,
              detail: `Moved ${ob.sku} from ${ob.machineId} to ${altM} (${ob.type === 'infeasible' ? 'infeasible' : 'overflow'}: ${unschedMin}min)`,
              metadata: {
                fromMachine: ob.machineId,
                toMachine: altM,
                overflowMin: unschedMin,
                sku: ob.sku,
                altUtil: Math.round(altUtil * 100),
              },
            });

            break;
          } else {
            autoMoves.pop();
            if (twinPartner && !twinAlreadyMoved) autoMoves.pop();
          }
        }
      }

      if (!moved) break;
      if (totalOverflowMin === 0) break;
    }
  }

  // Save Tier 1 decisions before Tier 2/3 replace schedResult
  const tier1Decisions = schedResult.registry.getAll().filter(
    (d) => d.type === 'ADVANCE_PRODUCTION' || d.type === 'OVERFLOW_ROUTE',
  );

  const tierState: TierState = { blocks, schedResult, autoMoves, autoAdvances };
  const tierCtx = {
    ops,
    userMoves,
    mSt,
    workdays,
    twinPartnerMap,
    thirdShift,
    machineTimelines,
    runSchedule,
    runScheduleWithLeveling,
  };

  // ── TIER 2: Resolve TARDINESS ──
  if (maxTier >= 2) {
    runTier2(tierState, tierCtx, preTier1TardyOps);
  }

  if (maxTier >= 3) {
    const allRules: DispatchRule[] = ['EDD', 'ATCS', 'CR', 'SPT', 'WSPT'];
    let bestOtdDCount = computeOtdDeliveryFailures(tierState.blocks, ops).count;
    let bestRuleState: TierState | null = null;
    const baseSchedParams = {
      ops, mSt, tSt, machines, toolMap, workdays, nDays, workforceConfig,
      supplyBoosts, thirdShift, constraintConfig, machineTimelines, toolTimelines,
      twinValidationReport, dates, orderBased, enforceDeadlines: false,
    };

    for (const tryRule of allRules) {
      const mkSched = (lvl: boolean) => (moves: MoveAction[], advances?: AdvanceAction[]) =>
        scheduleAll({ ...baseSchedParams, rule: tryRule, enableLeveling: lvl, moves, advanceOverrides: advances });

      const ts: TierState = {
        blocks: tierState.blocks, schedResult: tierState.schedResult,
        autoMoves: [...tierState.autoMoves],
        autoAdvances: tierState.autoAdvances.map((a) => ({ ...a })),
      };
      const fresh = mkSched(false)([...userMoves, ...ts.autoMoves], ts.autoAdvances.length > 0 ? ts.autoAdvances : undefined);
      ts.blocks = fresh.blocks; ts.schedResult = fresh;

      runTier3(ts, { ...tierCtx, runSchedule: mkSched(false), runScheduleWithLeveling: mkSched(true) }, toolMap);
      const cnt = computeOtdDeliveryFailures(ts.blocks, ops).count;
      tier3Diag[`rule_${tryRule}`] = cnt;
      if (cnt < bestOtdDCount) { bestOtdDCount = cnt; bestRuleState = ts; }
      if (bestOtdDCount === 0) break;
    }

    if (bestRuleState) {
      tierState.blocks = bestRuleState.blocks;
      tierState.schedResult = bestRuleState.schedResult;
      tierState.autoMoves = bestRuleState.autoMoves;
      tierState.autoAdvances = bestRuleState.autoAdvances;
    }
  }

  // Collect all decisions from Tier 1 + current registry (Tier 2/3)
  const prevDecisions = [
    ...tier1Decisions,
    ...tierState.schedResult.registry.getAll().filter(
      (d) => d.type === 'ADVANCE_PRODUCTION' || d.type === 'OVERFLOW_ROUTE',
    ),
  ];
  const finalMoves = [...userMoves, ...tierState.autoMoves];
  const finalAdvances = tierState.autoAdvances.length > 0 ? tierState.autoAdvances : undefined;
  const commonParams = {
    ops, mSt, tSt, moves: finalMoves, machines, toolMap, workdays, nDays,
    workforceConfig, rule, supplyBoosts, thirdShift, constraintConfig,
    machineTimelines, toolTimelines, advanceOverrides: finalAdvances,
    twinValidationReport, dates, orderBased,
  };

  let finalResult = scheduleAll({ ...commonParams, enableLeveling: false, enforceDeadlines: false });
  let bestOtdD = computeOtdDeliveryFailures(finalResult.blocks, ops).count;

  for (const enableLeveling of [false, true]) {
    for (const enforceDeadlines of [false, true]) {
      if (!enableLeveling && !enforceDeadlines) continue;
      const candidate = scheduleAll({ ...commonParams, enableLeveling, enforceDeadlines });
      const candidateOtdD = computeOtdDeliveryFailures(candidate.blocks, ops).count;
      if (candidateOtdD < bestOtdD) {
        finalResult = candidate;
        bestOtdD = candidateOtdD;
      }
    }
  }

  // ── Post-grid OTD-D repair: boost failing ops and re-try with advance combos ──
  if (bestOtdD > 0 && bestOtdD <= 5) {
    const failResult = computeOtdDeliveryFailures(finalResult.blocks, ops);
    const failOps = new Set(failResult.failures.map((f) => f.opId));
    const boostedSupply = new Map(supplyBoosts ?? []);
    for (const opId of failOps) boostedSupply.set(opId, { boost: 10 });

    // Try with boosted supply + various targeted advance amounts for failing ops
    for (let advDays = 0; advDays <= 40; advDays++) {
      const extraAdvances: AdvanceAction[] = [];
      if (advDays > 0) {
        for (const f of failResult.failures) {
          const existing = tierState.autoAdvances.find((a) => a.opId === f.opId && (a.targetEdd === f.day || a.targetEdd == null))?.advanceDays ?? 0;
          const td = existing + advDays;
          if (computeAdvancedEdd(f.day, td, workdays) >= 0) {
            extraAdvances.push({ opId: f.opId, advanceDays: td, originalEdd: f.day, targetEdd: f.day });
          }
        }
      }
      const boostAdvances = finalAdvances ? [...finalAdvances] : [];
      for (const ea of extraAdvances) {
        const idx = boostAdvances.findIndex((a) => a.opId === ea.opId);
        if (idx >= 0) boostAdvances[idx] = ea; else boostAdvances.push(ea);
      }
      const boostParams = {
        ...commonParams,
        supplyBoosts: boostedSupply.size > 0 ? boostedSupply : undefined,
        advanceOverrides: boostAdvances.length > 0 ? boostAdvances : undefined,
      };

      for (const enableLeveling of [false, true]) {
        for (const enforceDeadlines of [false, true]) {
          const candidate = scheduleAll({ ...boostParams, enableLeveling, enforceDeadlines });
          const candidateOtdD = computeOtdDeliveryFailures(candidate.blocks, ops).count;
          if (candidateOtdD < bestOtdD) {
            finalResult = candidate;
            bestOtdD = candidateOtdD;
            if (bestOtdD === 0) break;
          }
        }
        if (bestOtdD === 0) break;
      }
      if (bestOtdD === 0) break;
    }
    // Update tierState advances if we added extras
    if (bestOtdD === 0) {
      for (const f of failResult.failures) {
        const extra = finalAdvances?.find((a) => a.opId === f.opId);
        if (extra && !tierState.autoAdvances.some((a) => a.opId === f.opId)) {
          tierState.autoAdvances.push(extra);
        }
      }
    }
  }

  const advMap = new Map(tierState.autoAdvances.map((a) => [a.opId, a.advanceDays]));
  for (const b of finalResult.blocks) {
    const advDays = advMap.get(b.opId);
    if (advDays != null && b.type === 'ok') {
      b.isAdvanced = true;
      b.advancedByDays = advDays;
    }
  }

  // Re-inject all Tier 1/2/3 advance/overflow decisions into final registry
  const existingIds = new Set(finalResult.registry.getAll().map((d) => d.opId + d.type));
  for (const dec of prevDecisions) {
    const key = dec.opId + dec.type;
    if (!existingIds.has(key)) {
      finalResult.registry.record(dec);
      existingIds.add(key);
    }
  }

  tierState.blocks = finalResult.blocks;
  tierState.schedResult = finalResult;

  return {
    blocks: tierState.blocks,
    autoMoves: tierState.autoMoves,
    autoAdvances: tierState.autoAdvances,
    decisions: tierState.schedResult.decisions,
    registry: tierState.schedResult.registry,
    feasibilityReport: tierState.schedResult.feasibilityReport,
  };
}
