import { DAY_CAP, DEFAULT_OEE, MAX_AUTO_MOVES } from '../constants.js';
import type { AdvanceAction, Block } from '../types/blocks.js';
import type { ETool } from '../types/engine.js';
import { computeOtdDeliveryFailures } from './otd-delivery-failures.js';
import { computeAdvancedEdd, computeTardiness } from './overflow-helpers.js';
import type { TierContext, TierState } from './tier-types.js';

export const tier3Diag: Record<string, number> = {
  initialCount: 0, finalCount: 0, trialsAttempted: 0, trialsAccepted: 0, tardinessBudget: 0, preTardiness: 0,
};

type FailInfo = { day: number; shortfall: number };

function collectFails(
  otdResult: ReturnType<typeof computeOtdDeliveryFailures>,
  excludeIds: Set<string>,
): [string, FailInfo][] {
  const byOp = new Map<string, FailInfo>();
  for (const f of otdResult.failures) {
    const ex = byOp.get(f.opId);
    if (!ex || f.shortfall > ex.shortfall) byOp.set(f.opId, { day: f.day, shortfall: f.shortfall });
  }
  return [...byOp.entries()].filter(([id]) => !excludeIds.has(id)).sort((a, b) => b[1].shortfall - a[1].shortfall);
}

function isAcceptable(newOtdCount: number, prevOtdCount: number, newBlocks: Block[], tardinessBudget: number): boolean {
  tier3Diag.trialsAttempted++;
  if (newOtdCount >= prevOtdCount) { tier3Diag._rejectNoImprovement = (tier3Diag._rejectNoImprovement ?? 0) + 1; return false; }
  if (computeTardiness(newBlocks) > tardinessBudget) { tier3Diag._rejectTardiness = (tier3Diag._rejectTardiness ?? 0) + 1; return false; }
  tier3Diag.trialsAccepted++;
  return true;
}

export function runTier3(
  state: TierState,
  ctx: TierContext,
  toolMap?: Record<string, ETool>,
): void {
  const { ops, userMoves, mSt, workdays, twinPartnerMap, runSchedule } = ctx;
  const runBulk = ctx.runScheduleWithLeveling ?? runSchedule;

  let otdResult = computeOtdDeliveryFailures(state.blocks, ops);
  Object.assign(tier3Diag, { initialCount: otdResult.count, finalCount: otdResult.count, trialsAttempted: 0, trialsAccepted: 0 });
  if (otdResult.count === 0) return;

  const preTardiness = computeTardiness(state.blocks);
  const tardinessBudget = Math.max(preTardiness * 1.50, preTardiness + 500);
  tier3Diag.tardinessBudget = tardinessBudget;
  tier3Diag.preTardiness = preTardiness;

  // ── Main loop: untargeted advances (advances ALL buckets for the op) ──
  for (let t3 = 0; t3 < MAX_AUTO_MOVES && otdResult.count > 0; t3++) {
    if (state.autoMoves.length + state.autoAdvances.length >= MAX_AUTO_MOVES) break;

    const movedIds = new Set([...userMoves.map((m) => m.opId), ...state.autoMoves.map((m) => m.opId)]);
    const sortedFails = collectFails(otdResult, movedIds);

    if (sortedFails.length === 0) break;

    let otdImproved = false;

    // Phase A: Advance (untargeted — all buckets)
    for (const [opId, info] of sortedFails) {
      const existingIdx = state.autoAdvances.findIndex((a) => a.opId === opId);
      const existingDays = existingIdx >= 0 ? state.autoAdvances[existingIdx].advanceDays : 0;

      for (let addDays = 1; addDays <= 30; addDays++) {
        const totalAdvDays = existingDays + addDays;
        if (computeAdvancedEdd(info.day, totalAdvDays, workdays) < 0) break;

        const trial = state.autoAdvances.filter((a) => a.opId !== opId)
          .concat({ opId, advanceDays: totalAdvDays, originalEdd: info.day });
        const nr = runSchedule([...userMoves, ...state.autoMoves], trial);
        const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);

        if (isAcceptable(newOtd.count, otdResult.count, nr.blocks, tardinessBudget)) {
          if (existingIdx >= 0) state.autoAdvances.splice(existingIdx, 1);
          state.autoAdvances.push({ opId, advanceDays: totalAdvDays, originalEdd: info.day });
          state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd; otdImproved = true;
          for (const b of state.blocks) { if (b.opId === opId && b.type === 'ok') { b.isAdvanced = true; b.advancedByDays = totalAdvDays; } }
          nr.registry.record({ type: 'ADVANCE_PRODUCTION', opId, toolId: '', machineId: '',
            detail: `Advanced ${opId} by ${totalAdvDays}d (OTD-D shortfall ${info.shortfall} pcs)`,
            metadata: { advanceDays: totalAdvDays, reason: 'otd_delivery', shortfall: info.shortfall } });
          break;
        }
      }
      if (otdImproved) break;
    }

    // Phase B: Move to alt machine
    if (!otdImproved) {
      for (const [opId, info] of sortedFails) {
        const ob = state.blocks.find((b) => b.opId === opId && b.hasAlt && b.altM);
        if (!ob?.altM || mSt[ob.altM] === 'down') continue;
        const tp = twinPartnerMap.get(opId), tpMoved = tp ? movedIds.has(tp) : true;
        state.autoMoves.push({ opId, toM: ob.altM });
        if (tp && !tpMoved) state.autoMoves.push({ opId: tp, toM: ob.altM });
        const nr = runSchedule([...userMoves, ...state.autoMoves], state.autoAdvances.length > 0 ? state.autoAdvances : undefined);
        const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);
        if (isAcceptable(newOtd.count, otdResult.count, nr.blocks, tardinessBudget)) {
          state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd; otdImproved = true;
          nr.registry.record({ type: 'OVERFLOW_ROUTE', opId, toolId: ob.toolId, machineId: ob.altM,
            detail: `Moved ${opId} to ${ob.altM} (OTD-D shortfall ${info.shortfall} pcs)`,
            metadata: { fromMachine: ob.machineId, toMachine: ob.altM, reason: 'otd_delivery' } });
          break;
        }
        state.autoMoves.pop();
        if (tp && !tpMoved) state.autoMoves.pop();
      }
    }

    // Phase C: Move + advance combo
    if (!otdImproved) {
      for (const [opId, info] of sortedFails) {
        const ob = state.blocks.find((b) => b.opId === opId && b.hasAlt && b.altM);
        if (!ob?.altM || mSt[ob.altM] === 'down') continue;
        const tp = twinPartnerMap.get(opId), tpMoved = tp ? movedIds.has(tp) : true;
        for (let advDays = 1; advDays <= 30; advDays++) {
          if (computeAdvancedEdd(info.day, advDays, workdays) < 0) break;
          state.autoMoves.push({ opId, toM: ob.altM });
          if (tp && !tpMoved) state.autoMoves.push({ opId: tp, toM: ob.altM });
          const trialAdv = [...state.autoAdvances, { opId, advanceDays: advDays, originalEdd: info.day }];
          const nr = runSchedule([...userMoves, ...state.autoMoves], trialAdv);
          const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);
          if (isAcceptable(newOtd.count, otdResult.count, nr.blocks, tardinessBudget)) {
            state.autoAdvances.push({ opId, advanceDays: advDays, originalEdd: info.day });
            state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd; otdImproved = true;
            break;
          }
          state.autoMoves.pop();
          if (tp && !tpMoved) state.autoMoves.pop();
        }
        if (otdImproved) break;
      }
    }

    // Phase D: Batch advance (simultaneous, untargeted)
    if (!otdImproved) {
      const batchOps = new Map(sortedFails.map(([id, info]) => [id, info.day]));
      if (batchOps.size > 1) {
        for (let advDays = 1; advDays <= 60; advDays++) {
          const ba: AdvanceAction[] = [];
          for (const [opId, day] of batchOps) {
            const td = (state.autoAdvances.find((a) => a.opId === opId)?.advanceDays ?? 0) + advDays;
            if (computeAdvancedEdd(day, td, workdays) >= 0) ba.push({ opId, advanceDays: td, originalEdd: day });
          }
          if (ba.length < 2) continue;
          const ids = new Set(ba.map((a) => a.opId));
          const trial = [...state.autoAdvances.filter((a) => !ids.has(a.opId)), ...ba];
          const nr = runBulk([...userMoves, ...state.autoMoves], trial);
          const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);
          if (isAcceptable(newOtd.count, otdResult.count, nr.blocks, tardinessBudget)) {
            state.autoAdvances = state.autoAdvances.filter((a) => !ids.has(a.opId));
            for (const a of ba) state.autoAdvances.push(a);
            state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd; otdImproved = true;
            break;
          }
        }
      }
    }

    // Phase E: Computed advance (capacity-based)
    if (!otdImproved && toolMap) {
      for (const [opId, info] of sortedFails) {
        const op = ops.find((o) => o.id === opId);
        const tool = op ? toolMap[op.t] : undefined;
        if (!tool || tool.pH <= 0) continue;
        const neededDays = Math.min(Math.ceil(info.shortfall / (tool.pH * DEFAULT_OEE * (DAY_CAP / 60))) + 2, 60);
        const eIdx = state.autoAdvances.findIndex((a) => a.opId === opId);
        const totalDays = (eIdx >= 0 ? state.autoAdvances[eIdx].advanceDays : 0) + neededDays;
        if (computeAdvancedEdd(info.day, totalDays, workdays) < 0) continue;
        const trial = state.autoAdvances.filter((a) => a.opId !== opId)
          .concat({ opId, advanceDays: totalDays, originalEdd: info.day });
        const nr = runBulk([...userMoves, ...state.autoMoves], trial);
        const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);
        if (isAcceptable(newOtd.count, otdResult.count, nr.blocks, tardinessBudget)) {
          if (eIdx >= 0) state.autoAdvances.splice(eIdx, 1);
          state.autoAdvances.push({ opId, advanceDays: totalDays, originalEdd: info.day });
          state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd; otdImproved = true;
          break;
        }
        // Fallback: move + computed advance
        const ob = state.blocks.find((b) => b.opId === opId && b.hasAlt && b.altM);
        if (ob?.altM && mSt[ob.altM] !== 'down') {
          const tp = twinPartnerMap.get(opId), tpM = tp ? movedIds.has(tp) : true;
          state.autoMoves.push({ opId, toM: ob.altM });
          if (tp && !tpM) state.autoMoves.push({ opId: tp, toM: ob.altM });
          const nr2 = runBulk([...userMoves, ...state.autoMoves], trial);
          const nOtd = computeOtdDeliveryFailures(nr2.blocks, ops);
          if (isAcceptable(nOtd.count, otdResult.count, nr2.blocks, tardinessBudget)) {
            if (eIdx >= 0) state.autoAdvances.splice(eIdx, 1);
            state.autoAdvances.push({ opId, advanceDays: totalDays, originalEdd: info.day });
            state.blocks = nr2.blocks; state.schedResult = nr2; otdResult = nOtd; otdImproved = true;
            break;
          }
          state.autoMoves.pop();
          if (tp && !tpM) state.autoMoves.pop();
        }
      }
    }

    if (!otdImproved) break;
  }

  // ── Phase F: Global advance for all ops ──
  if (otdResult.count > 0 && toolMap) {
    const movedIds = new Set([...userMoves.map((m) => m.opId), ...state.autoMoves.map((m) => m.opId)]);
    const sortedFails = collectFails(otdResult, movedIds);

    if (sortedFails.length > 0) {
      const ga: AdvanceAction[] = [];
      for (const op of ops) {
        let lastDD = 0;
        for (let d = op.d.length - 1; d >= 0; d--) { if (op.d[d] > 0) { lastDD = d; break; } }
        const eDays = state.autoAdvances.find((a) => a.opId === op.id)?.advanceDays ?? 0;
        let wd = 0;
        for (let d = 0; d <= lastDD && d < workdays.length; d++) { if (!workdays || workdays[d]) wd++; }
        if (Math.max(eDays, wd) > eDays) ga.push({ opId: op.id, advanceDays: Math.max(eDays, wd), originalEdd: lastDD });
      }
      if (ga.length > 0) {
        const ids = new Set(ga.map((a) => a.opId));
        const trial = [...state.autoAdvances.filter((a) => !ids.has(a.opId)), ...ga];
        const nr = runBulk([...userMoves, ...state.autoMoves], trial);
        const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);
        if (isAcceptable(newOtd.count, otdResult.count, nr.blocks, tardinessBudget)) {
          state.autoAdvances = state.autoAdvances.filter((a) => !ids.has(a.opId));
          for (const a of ga) state.autoAdvances.push(a);
          state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd;
          for (const b of state.blocks) { if (ids.has(b.opId) && b.type === 'ok') b.isAdvanced = true; }
        }
      }
    }

    // Phase G: Tool contention
    if (otdResult.count > 0) {
      const postFFails = collectFails(computeOtdDeliveryFailures(state.blocks, ops), movedIds);
      const tGroups = new Map<string, { opId: string; info: FailInfo }[]>();
      for (const [opId, info] of postFFails) {
        const op = ops.find((o) => o.id === opId);
        if (op) { if (!tGroups.has(op.t)) tGroups.set(op.t, []); tGroups.get(op.t)!.push({ opId, info }); }
      }
      for (const [, group] of tGroups) {
        if (group.length < 2) continue;
        const op0 = ops.find((o) => o.id === group[0].opId);
        const tool = op0 ? toolMap[op0.t] : undefined;
        if (!tool?.alt || tool.alt === '-' || mSt[tool.alt] === 'down') continue;
        const altM = tool.alt;
        const tm = [...state.autoMoves];
        for (const { opId } of group.slice(Math.ceil(group.length / 2))) {
          if (!tm.some((m) => m.opId === opId)) {
            tm.push({ opId, toM: altM });
            const tp = twinPartnerMap.get(opId);
            if (tp && !movedIds.has(tp) && !tm.some((m) => m.opId === tp)) tm.push({ opId: tp, toM: altM });
          }
        }
        const ta: AdvanceAction[] = state.autoAdvances.map((a) => ({ ...a }));
        const dCap = tool.pH * DEFAULT_OEE * (DAY_CAP / 60);
        for (const { opId, info } of group) {
          const ex = ta.find((a) => a.opId === opId);
          const td = (ex?.advanceDays ?? 0) + Math.min(Math.ceil(info.shortfall / dCap) + 3, 70);
          if (computeAdvancedEdd(info.day, td, workdays) >= 0) {
            if (ex) { ex.advanceDays = td; ex.originalEdd = info.day; } else ta.push({ opId, advanceDays: td, originalEdd: info.day });
          }
        }
        const nr = runBulk([...userMoves, ...tm], ta);
        const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);
        if (isAcceptable(newOtd.count, otdResult.count, nr.blocks, tardinessBudget)) {
          state.autoMoves = tm; state.autoAdvances = ta; state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd;
        }
      }
    }
  }

  // ── Phase H: TARGETED per-bucket advance with relaxed budget ──
  // When only a few failures remain, untargeted advances cascade.
  // Try advancing ONLY the specific failing bucket (targetEdd) with a relaxed budget.
  if (otdResult.count > 0 && otdResult.count <= 10 && toolMap) {
    const savedDecisions = state.schedResult.registry.getAll();
    const relaxedBudget = Math.max(tardinessBudget * 3, preTardiness + 5000);
    const movedIds2 = new Set([...userMoves.map((m) => m.opId), ...state.autoMoves.map((m) => m.opId)]);
    const remainFails = collectFails(otdResult, movedIds2);

    // Try targeted advance for each remaining failure individually
    for (let pass = 0; pass < 3 && otdResult.count > 0; pass++) {
      const indFails = collectFails(otdResult, movedIds2);
      for (const [opId, info] of indFails) {
        for (let advDays = 1; advDays <= 80; advDays++) {
          // Don't touch existing untargeted advances — add a SEPARATE targeted one
          const td = advDays;
          if (computeAdvancedEdd(info.day, td, workdays) < 0) break;
          const trial = [...state.autoAdvances, { opId, advanceDays: td, originalEdd: info.day, targetEdd: info.day }];
          const nr = runBulk([...userMoves, ...state.autoMoves], trial);
          const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);
          if (newOtd.count < otdResult.count && computeTardiness(nr.blocks) <= relaxedBudget) {
            tier3Diag.trialsAttempted++;
            tier3Diag.trialsAccepted++;
            state.autoAdvances = trial;
            state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd;
            for (const d of savedDecisions) nr.registry.record(d);
            break;
          }
        }
        if (otdResult.count === 0) break;
      }
    }

    // Try simultaneous targeted advance of all remaining failures
    if (otdResult.count > 0) {
      for (let advDays = 1; advDays <= 80; advDays++) {
        const ba: AdvanceAction[] = [];
        for (const [opId, info] of remainFails) {
          if (computeAdvancedEdd(info.day, advDays, workdays) >= 0) {
            ba.push({ opId, advanceDays: advDays, originalEdd: info.day, targetEdd: info.day });
          }
        }
        if (ba.length === 0) continue;
        const trial = [...state.autoAdvances, ...ba];
        const nr = runBulk([...userMoves, ...state.autoMoves], trial);
        const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);
        if (newOtd.count < otdResult.count && computeTardiness(nr.blocks) <= relaxedBudget) {
          tier3Diag.trialsAttempted++;
          tier3Diag.trialsAccepted++;
          state.autoAdvances = trial;
          state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd;
          for (const d of savedDecisions) nr.registry.record(d);
          if (otdResult.count === 0) break;
        }
      }
    }

    // Try move+targeted advance combo for remaining failures with alt machines
    if (otdResult.count > 0) {
      const remainFails2 = collectFails(otdResult, movedIds2);
      for (const [opId, info] of remainFails2) {
        const ob = state.blocks.find((b) => b.opId === opId && b.hasAlt && b.altM);
        if (!ob?.altM || mSt[ob.altM] === 'down') continue;
        const tp = twinPartnerMap.get(opId);
        const tpMoved = tp ? movedIds2.has(tp) : true;
        for (let advDays = 0; advDays <= 60; advDays++) {
          const td = advDays;
          if (advDays > 0 && computeAdvancedEdd(info.day, td, workdays) < 0) break;
          const tm = [...state.autoMoves, { opId, toM: ob.altM }];
          if (tp && !tpMoved) tm.push({ opId: tp, toM: ob.altM });
          const ta = advDays > 0
            ? [...state.autoAdvances, { opId, advanceDays: td, originalEdd: info.day, targetEdd: info.day }]
            : state.autoAdvances;
          const nr = runBulk([...userMoves, ...tm], ta.length > 0 ? ta : undefined);
          const newOtd = computeOtdDeliveryFailures(nr.blocks, ops);
          if (newOtd.count < otdResult.count && computeTardiness(nr.blocks) <= relaxedBudget) {
            tier3Diag.trialsAttempted++;
            tier3Diag.trialsAccepted++;
            state.autoMoves = tm;
            state.autoAdvances = ta;
            state.blocks = nr.blocks; state.schedResult = nr; otdResult = newOtd;
            for (const d of savedDecisions) nr.registry.record(d);
            break;
          }
        }
        if (otdResult.count === 0) break;
      }
    }
  }

  tier3Diag.finalCount = otdResult.count;
}
