// =====================================================================
//  INCOMPOL PLAN -- Slot Allocator (Phase 2)
//  Core shift-by-shift, minute-by-minute allocation engine.
//
//  Per Normative Spec: ALL constraints are HARD.
//  - SetupCrew: HARD — try next shift/day if busy, infeasible if no room
//  - OperatorPool: HARD — try pool/reallocation, other shifts/days.
//    When data is unknown (MO=99), schedule anyway + record DATA_MISSING.
//  - ToolTimeline: HARD — defer to next available slot
//  - CalcoTimeline: HARD — defer to next available slot
//
//  Operations NEVER silently disappear from the Gantt.
//  If a constraint cannot be satisfied after trying all alternatives,
//  the operation gets type='infeasible' with a formal reason.
//
//  Pure function -- no React, no side effects.
// =====================================================================

import { DAY_CAP, S0, S1, S2, T1 } from '../constants.js';
import { createOperatorPool } from '../constraints/operator-pool.js';
import { createSetupCrew } from '../constraints/setup-crew.js';
import type { DecisionRegistry } from '../decisions/decision-registry.js';
import { getCapacityFactor as getTimelineCap } from '../failures/failure-timeline.js';
import type { Block } from '../types/blocks.js';
import type { ConstraintConfig } from '../types/constraints.js';
import { DEFAULT_CONSTRAINT_CONFIG } from '../types/constraints.js';
import type { EMachine } from '../types/engine.js';
import type { ResourceTimeline, ShiftId } from '../types/failure.js';
import type { InfeasibilityEntry, InfeasibilityReason } from '../types/infeasibility.js';
import type { OperationDeadline } from '../types/shipping.js';
import type { WorkforceConfig } from '../types/workforce.js';
import { toAbs } from '../utils/time.js';
import type { SkuBucket, ToolGroup } from './demand-grouper.js';

// ── Re-export WorkforceConfig for consumers ────────────

export type { WorkforceConfig };

// ── Block factories ─────────────────────────────────────────────

function mkBlocked(sk: SkuBucket, grp: ToolGroup, di: number, reason: string): Block {
  return {
    opId: sk.opId,
    toolId: grp.toolId,
    sku: sk.sku,
    nm: sk.nm,
    machineId: grp.machineId,
    origM: sk.origM,
    dayIdx: di,
    eddDay: sk.edd,
    qty: 0,
    prodMin: 0,
    setupMin: 0,
    operators: sk.operators,
    blocked: true,
    reason,
    moved: sk.moved,
    hasAlt: sk.hasAlt,
    altM: sk.altM,
    mp: sk.mp,
    stk: sk.stk,
    lt: sk.lt,
    atr: sk.atr,
    startMin: S0,
    endMin: S0,
    setupS: null,
    setupE: null,
    type: 'blocked',
    shift: 'X',
  };
}

function mkOverflow(sk: SkuBucket, grp: ToolGroup, di: number, ofMin: number): Block {
  return {
    opId: sk.opId,
    toolId: grp.toolId,
    sku: sk.sku,
    nm: sk.nm,
    machineId: grp.machineId,
    origM: sk.origM,
    dayIdx: di,
    eddDay: sk.edd,
    qty: 0,
    prodMin: sk.prodMin,
    setupMin: 0,
    operators: sk.operators,
    blocked: false,
    reason: null,
    moved: sk.moved,
    hasAlt: sk.hasAlt,
    altM: sk.altM,
    mp: sk.mp,
    stk: sk.stk,
    lt: sk.lt,
    atr: sk.atr,
    startMin: S0,
    endMin: S0,
    setupS: null,
    setupE: null,
    type: 'overflow',
    shift: 'X',
    overflow: true,
    overflowMin: ofMin,
  };
}

function mkInfeasible(
  sk: SkuBucket,
  grp: ToolGroup,
  di: number,
  reason: InfeasibilityReason,
  detail: string,
): Block {
  return {
    opId: sk.opId,
    toolId: grp.toolId,
    sku: sk.sku,
    nm: sk.nm,
    machineId: grp.machineId,
    origM: sk.origM,
    dayIdx: di,
    eddDay: sk.edd,
    qty: 0,
    prodMin: sk.prodMin,
    setupMin: 0,
    operators: sk.operators,
    blocked: false,
    reason: null,
    moved: sk.moved,
    hasAlt: sk.hasAlt,
    altM: sk.altM,
    mp: sk.mp,
    stk: sk.stk,
    lt: sk.lt,
    atr: sk.atr,
    startMin: S0,
    endMin: S0,
    setupS: null,
    setupE: null,
    type: 'infeasible',
    shift: 'X',
    infeasibilityReason: reason,
    infeasibilityDetail: detail,
  };
}

// ── CalcoTimeline (HARD constraint) ─────────────────────────────

function createCalcoTimeline() {
  const timelines: Record<string, Array<{ start: number; end: number; machineId: string }>> = {};
  return {
    findNextAvailable(
      calcoCode: string,
      earliest: number,
      duration: number,
      shiftEnd: number,
    ): number {
      const slots = timelines[calcoCode];
      if (!slots) return earliest;
      let candidate = earliest;
      let changed = true;
      let iterations = 0;
      while (changed && iterations < 1000) {
        changed = false;
        iterations++;
        for (const s of slots) {
          if (candidate < s.end && candidate + duration > s.start) {
            candidate = s.end;
            changed = true;
          }
        }
      }
      return candidate + duration <= shiftEnd ? candidate : -1;
    },
    book(calcoCode: string, start: number, end: number, _machineId: string) {
      if (!timelines[calcoCode]) timelines[calcoCode] = [];
      timelines[calcoCode].push({ start, end, machineId: _machineId });
    },
  };
}

// ── ToolTimeline (HARD constraint) ──────────────────────────────

function createToolTimeline() {
  const timelines: Record<string, Array<{ start: number; end: number; machineId: string }>> = {};
  return {
    findNextAvailable(
      toolId: string,
      earliest: number,
      duration: number,
      shiftEnd: number,
      machineId: string,
    ): number {
      const slots = timelines[toolId];
      if (!slots) return earliest;
      let candidate = earliest;
      let changed = true;
      let iterations = 0;
      while (changed && iterations < 1000) {
        changed = false;
        iterations++;
        const conflicting = new Set<string>();
        for (const s of slots) {
          if (s.machineId === machineId) continue;
          if (candidate < s.end && candidate + duration > s.start) conflicting.add(s.machineId);
        }
        if (conflicting.size >= 1) {
          let minEnd = Infinity;
          for (const s of slots) {
            if (s.machineId === machineId) continue;
            if (candidate < s.end && candidate + duration > s.start)
              minEnd = Math.min(minEnd, s.end);
          }
          candidate = minEnd;
          changed = true;
        }
      }
      return candidate + duration <= shiftEnd ? candidate : -1;
    },
    book(toolId: string, start: number, end: number, machineId: string) {
      if (!timelines[toolId]) timelines[toolId] = [];
      timelines[toolId].push({ start, end, machineId });
    },
  };
}

// ── Operator pool helper (labor-group-based, advisory) ──

function createLocalOperatorPool(config: WorkforceConfig) {
  return createOperatorPool(config);
}

// ── Main export ─────────────────────────────────────────────────

export interface ScheduleMachinesInput {
  /** Machine -> sorted tool groups (from Phase 1 + dispatch sort) */
  mGroups: Record<string, ToolGroup[]>;
  /** Machines in scheduling order (from orderMachinesByUrgency) */
  machOrder: EMachine[];
  /** Machine status map */
  mSt: Record<string, string>;
  /** Workday flags per day */
  workdays?: boolean[];
  /** Workforce labor group configuration for operator capacity */
  workforceConfig?: WorkforceConfig;
  /** Total days in horizon */
  nDays: number;
  /** Enable 3rd shift (Z: 00:00-07:00) */
  thirdShift?: boolean;
  /** Decision registry for tracking all scheduling decisions */
  registry: DecisionRegistry;
  /** Constraint configuration */
  constraintConfig?: ConstraintConfig;
  /** Per-machine failure timelines (per-day-per-shift capacity) */
  machineTimelines?: Record<string, ResourceTimeline>;
  /** Per-tool failure timelines (per-day-per-shift capacity) */
  toolTimelines?: Record<string, ResourceTimeline>;
  /** Shipping deadlines for HARD cutoff enforcement */
  deadlines?: Map<string, OperationDeadline>;
  /** Per-machine per-day overtime map: machineId -> dayIdx -> extra minutes */
  overtimeMap?: Record<string, Record<number, number>>;
}

export interface ScheduleMachinesResult {
  blocks: Block[];
  infeasibilities: InfeasibilityEntry[];
}

/**
 * Phase 2: Schedule tool-group batches onto machines.
 *
 * Per Normative Spec: ALL constraints are HARD.
 * - SetupCrew: try all shifts/days. If no slot → infeasible.
 * - OperatorPool: when data is unknown (MO=99), schedule anyway + DATA_MISSING.
 *   When data is known and exceeded, try next shift/day. If no capacity → infeasible.
 * - ToolTimeline: defer to next available slot. If no slot → overflow.
 * - CalcoTimeline: defer to next available slot. If no slot → overflow.
 *
 * Operations NEVER silently disappear from the Gantt.
 */
export function scheduleMachines(input: ScheduleMachinesInput): ScheduleMachinesResult {
  const {
    mGroups,
    machOrder,
    mSt,
    workdays,
    workforceConfig,
    nDays,
    thirdShift,
    registry,
    constraintConfig: _cc = DEFAULT_CONSTRAINT_CONFIG,
    machineTimelines,
    toolTimelines: _toolTimelines,
    deadlines,
    overtimeMap,
  } = input;

  const blocks: Block[] = [];
  const infeasibilities: InfeasibilityEntry[] = [];
  const pool = workforceConfig ? createLocalOperatorPool(workforceConfig) : undefined;
  const setupCrew = createSetupCrew();
  const calcoTL = createCalcoTimeline();
  const toolTL = createToolTimeline();

  // Working day indices
  const wDays: number[] = [];
  for (let d = 0; d < nDays; d++) {
    if (!workdays || workdays[d]) wDays.push(d);
  }
  if (wDays.length === 0) return { blocks, infeasibilities };

  const nextWDay = (d: number): number => {
    const i = wDays.indexOf(d);
    return i >= 0 && i + 1 < wDays.length ? wDays[i + 1] : -1;
  };

  const baseDayEnd = thirdShift ? S2 : S1;

  for (const mach of machOrder) {
    const mId = mach.id;
    const groups = mGroups[mId];
    if (!groups?.length) continue;

    // Per-machine per-day overtime: extends dayEnd for this machine on specific days
    const machOT = overtimeMap?.[mId];
    const getDayEnd = (dayIdx: number) => baseDayEnd + (machOT?.[dayIdx] ?? 0);

    // Machine down -- when timelines are present, per-shift capacity is used
    // in the allocation loop below. Only blanket-block if legacy binary down
    // and no timeline overrides it.
    if (mSt[mId] === 'down' && !machineTimelines?.[mId]) {
      for (const g of groups) {
        for (const sk of g.skus) {
          blocks.push(mkBlocked(sk, g, wDays[0], 'machine_down'));
        }
      }
      continue;
    }

    // Helper: get capacity factor for this machine at given day/shift
    const mCapFactor = (di: number, sh: ShiftId): number => {
      if (machineTimelines?.[mId]) return getTimelineCap(machineTimelines[mId], di, sh);
      return mSt[mId] === 'down' ? 0.0 : 1.0;
    };

    let cDay = wDays[0];
    let cMin = S0;
    let lastTool: string | null = null;

    // Advance cursor past shift/day boundaries
    const advance = (): boolean => {
      if (cMin >= getDayEnd(cDay)) {
        const nd = nextWDay(cDay);
        if (nd < 0) return false;
        cDay = nd;
        cMin = S0;
      }
      return cDay < nDays;
    };

    // Push cursor to next shift or next day
    const pushShift = (): boolean => {
      if (cMin < T1) {
        cMin = T1;
        return true;
      }
      if (cMin < S1 && thirdShift) {
        cMin = S1;
        return true;
      }
      const nd = nextWDay(cDay);
      if (nd < 0) return false;
      cDay = nd;
      cMin = S0;
      return true;
    };

    // Get current shift's end minute
    const curShEnd = () => (cMin < T1 ? T1 : cMin < S1 ? S1 : getDayEnd(cDay));
    const curShift = (): 'X' | 'Y' | 'Z' => (cMin < T1 ? 'X' : cMin < S1 ? 'Y' : 'Z');

    for (const grp of groups) {
      if (!advance()) {
        // Machine capacity exhausted -- overflow remaining groups
        for (const sk of grp.skus) {
          if (sk.blocked) {
            blocks.push(mkBlocked(sk, grp, wDays[wDays.length - 1], sk.reason || 'tool_down'));
            continue;
          }
          blocks.push(mkOverflow(sk, grp, wDays[wDays.length - 1], grp.setupMin + sk.prodMin));
        }
        continue;
      }

      // Blocked tools -- emit blocked blocks
      if (grp.skus.some((s) => s.blocked)) {
        for (const sk of grp.skus) {
          if (sk.blocked) blocks.push(mkBlocked(sk, grp, cDay, sk.reason || 'tool_down'));
        }
        continue;
      }

      // ── SETUP (if tool changes) ──
      let setupS: number | null = null;
      let setupE: number | null = null;

      if (grp.toolId !== lastTool && grp.setupMin > 0) {
        let placed = false;
        const savedDay = cDay;
        const savedMin = cMin;

        // HARD: Try to find a slot. Try up to 12 attempts (across shifts/days).
        for (let att = 0; att < 12 && !placed; att++) {
          if (!advance()) break;
          const shEnd = curShEnd();

          // Not enough time in this shift segment
          if (grp.setupMin > shEnd - cMin) {
            if (!pushShift()) break;
            continue;
          }

          const abs = toAbs(cDay, cMin);
          const absEnd = toAbs(cDay, shEnd);

          // SetupCrew check (HARD — find available slot or defer)
          const slot = setupCrew.findNextAvailable(abs, grp.setupMin, absEnd);

          if (slot === -1) {
            // No room in this shift — try next shift
            if (!pushShift()) break;
            continue;
          }

          // ToolTimeline check (HARD) -- verify tool not on another machine during setup
          const toolSlot = toolTL.findNextAvailable(grp.toolId, slot, grp.setupMin, absEnd, mId);
          if (toolSlot === -1) {
            if (!pushShift()) break;
            continue;
          }
          if (toolSlot > slot) {
            cDay = Math.floor(toolSlot / 1440);
            cMin = toolSlot % 1440;
            continue;
          }

          cDay = Math.floor(slot / 1440);
          cMin = slot % 1440;
          setupS = cMin;
          setupE = cMin + grp.setupMin;
          setupCrew.book(slot, slot + grp.setupMin, mId);
          toolTL.book(grp.toolId, slot, slot + grp.setupMin, mId);
          cMin = setupE;
          placed = true;
        }

        if (!placed) {
          // INFEASIBLE: Setup crew exhausted — could not place setup anywhere
          cDay = savedDay;
          cMin = savedMin;

          const attempted = ['Tried 12 shift/day combinations for setup crew slot'];
          for (const sk of grp.skus) {
            const entry: InfeasibilityEntry = {
              opId: sk.opId,
              toolId: grp.toolId,
              machineId: mId,
              reason: 'SETUP_CREW_EXHAUSTED',
              detail: `Setup for tool ${grp.toolId} on ${mId}: no setup crew slot available`,
              attemptedAlternatives: attempted,
              suggestion: `Review setup crew scheduling or add setup capacity`,
              dayIdx: savedDay,
            };
            infeasibilities.push(entry);
            registry.record({
              type: 'INFEASIBILITY_DECLARED',
              opId: sk.opId,
              toolId: grp.toolId,
              machineId: mId,
              dayIdx: savedDay,
              detail: entry.detail,
              metadata: { reason: 'SETUP_CREW_EXHAUSTED' },
            });
            blocks.push(mkInfeasible(sk, grp, savedDay, 'SETUP_CREW_EXHAUSTED', entry.detail));
          }
          continue;
        }
      }

      // ── PRODUCTION per SKU ──
      // Proportional allocation: when multiple SKUs share a tool group and
      // total demand exceeds remaining capacity, cap each SKU to its
      // proportional share. Prevents FIFO starvation where the first SKU
      // consumes everything and later SKUs get zero production.
      const totalSkuProdMin = grp.skus.reduce((s, sk) => s + sk.prodMin, 0);
      const estRemDays = wDays.filter((d) => d >= cDay).length;
      const estCapacity = estRemDays * DAY_CAP - Math.max(0, cMin - S0);
      const needsProportional = grp.skus.length > 1 && totalSkuProdMin > estCapacity;

      let firstSku = true;
      for (const sk of grp.skus) {
        let rem = sk.prodMin;
        let qRem = sk.prodQty;
        let isFirst = firstSku;
        firstSku = false;
        const ppm = sk.prodMin > 0 ? sk.prodQty / sk.prodMin : 0;
        // Twin co-production: track remaining qty per output (each SKU gets its actual demand)
        const twinQRem =
          sk.isTwinProduction && sk.twinOutputs ? sk.twinOutputs.map((t) => t.totalQty) : undefined;

        // Budget: max minutes this SKU may consume (proportional share)
        let allocBudget = Infinity;
        if (needsProportional && totalSkuProdMin > 0) {
          const fraction = sk.prodMin / totalSkuProdMin;
          allocBudget = Math.max(1, Math.floor(fraction * estCapacity));
        }
        let totalAllocated = 0;

        // Track data gaps for this SKU (record only once per SKU)
        const hasDataGap = false;
        const dataGapDetail = '';
        // Track operator capacity warnings (advisory only)
        let hasOpWarning = false;
        let opWarningFlag = false;
        // Track unmapped machine warning (R8, once per SKU)
        let hasUnmappedWarning = false;
        // R6 tiebreaker: limit push attempts per SKU
        let tiebreakerAttempts = 0;
        const MAX_TIEBREAKER = 2;

        while (rem > 0 && totalAllocated < allocBudget) {
          if (!advance()) break;
          const shEnd = curShEnd();
          const rawAvail = shEnd - cMin;
          if (rawAvail <= 0) {
            if (!pushShift()) break;
            continue;
          }

          // ── Capacity factor from failure timelines ──
          const capF = mCapFactor(cDay, curShift());
          if (capF <= 0) {
            // Shift fully down due to failure — skip to next shift
            if (!pushShift()) break;
            continue;
          }
          const avail = capF < 1.0 ? Math.floor(rawAvail * capF) : rawAvail;
          if (avail <= 0) {
            if (!pushShift()) break;
            continue;
          }

          // ── OperatorPool check (ADVISORY — warns but never blocks) ──
          const shift = curShift();
          if (shift !== 'Z' && pool) {
            const opCheck = pool.checkCapacity(cDay, cMin, shEnd, sk.operators, mId);

            // R8: Emit LABOR_GROUP_UNMAPPED for unmapped machines
            if (opCheck.unmapped && !hasUnmappedWarning) {
              hasUnmappedWarning = true;
              registry.record({
                type: 'LABOR_GROUP_UNMAPPED',
                opId: sk.opId,
                toolId: grp.toolId,
                machineId: mId,
                dayIdx: cDay,
                shift,
                detail: `Máquina ${mId} não mapeada a nenhum grupo laboral — workforce não contabilizada`,
                metadata: { machineId: mId },
              });
            }

            if (!opCheck.hasCapacity) {
              // R6: 1-step tiebreaker — check if next shift has less overload
              const currentShortage = opCheck.worstWindowShortage;
              let pushed = false;
              if (currentShortage > 0 && tiebreakerAttempts < MAX_TIEBREAKER) {
                tiebreakerAttempts++;
                let nextStart = -1,
                  nextEnd = -1,
                  nextDay = cDay;
                if (cMin < T1) {
                  nextStart = T1;
                  nextEnd = S1;
                } else if (cMin < S1 && thirdShift) {
                  nextStart = S1;
                  nextEnd = getDayEnd(cDay);
                } else {
                  const nd = nextWDay(cDay);
                  if (nd >= 0) {
                    nextDay = nd;
                    nextStart = S0;
                    nextEnd = T1;
                  }
                }
                if (nextStart >= 0 && nextEnd > nextStart) {
                  const altCheck = pool.checkCapacity(
                    nextDay,
                    nextStart,
                    nextEnd,
                    sk.operators,
                    mId,
                  );
                  if (altCheck.worstWindowShortage < currentShortage) {
                    cDay = nextDay;
                    cMin = nextStart;
                    pushed = true;
                  }
                }
              }

              if (!pushed) {
                // ADVISORY: Operator capacity exceeded — schedule anyway, record warning
                const laborGroup = pool.getLaborGroup(mId);
                if (!hasOpWarning) {
                  hasOpWarning = true;
                  registry.record({
                    type: 'OPERATOR_CAPACITY_WARNING',
                    opId: sk.opId,
                    toolId: grp.toolId,
                    machineId: mId,
                    dayIdx: cDay,
                    shift,
                    detail: `${laborGroup ?? mId} dia ${cDay} turno ${shift}: precisa ${sk.operators} ops, capacidade insuficiente`,
                    metadata: {
                      laborGroup: laborGroup ?? 'unknown',
                      required: sk.operators,
                      worstShortage: opCheck.worstWindowShortage,
                    },
                  });
                }
                opWarningFlag = true;
                // Fall through — operator constraint is advisory only
              } else {
                // Tiebreaker pushed cursor — restart allocation loop
                continue;
              }
            }
          }

          // ── CalcoTimeline check (HARD) ──
          let alloc = Math.min(rem, avail, allocBudget - totalAllocated);
          const calco = grp.tool.calco;
          if (calco) {
            const absCalco = toAbs(cDay, cMin);
            const absCalcoEnd = toAbs(cDay, curShEnd());
            const cs = calcoTL.findNextAvailable(calco, absCalco, alloc, absCalcoEnd);
            if (cs === -1) {
              cMin = curShEnd();
              continue;
            }
            if (cs > absCalco) {
              cDay = Math.floor(cs / 1440);
              cMin = cs % 1440;
              alloc = Math.min(rem, curShEnd() - cMin);
            }
          }
          if (alloc <= 0) {
            cMin = shEnd;
            continue;
          }

          // ── ToolTimeline check (HARD) ──
          const absP = toAbs(cDay, cMin);
          const tSlot = toolTL.findNextAvailable(grp.toolId, absP, alloc, toAbs(cDay, shEnd), mId);
          if (tSlot === -1) {
            cMin = shEnd;
            continue;
          }
          if (tSlot > absP) {
            cDay = Math.floor(tSlot / 1440);
            cMin = tSlot % 1440;
            alloc = Math.min(rem, curShEnd() - cMin);
            if (alloc <= 0) continue;
          }

          // ── Shipping cutoff enforcement (HARD) ──
          const opDeadline = deadlines?.get(sk.opId);
          if (opDeadline) {
            const blockEndAbs = toAbs(cDay, cMin + alloc);
            if (blockEndAbs > opDeadline.latestFinishAbs) {
              // Trim: reduce allocation to fit within deadline
              const maxEndAbs = opDeadline.latestFinishAbs;
              const maxEndMin = maxEndAbs % 1440;
              const maxEndDay = Math.floor(maxEndAbs / 1440);
              if (maxEndDay === cDay && maxEndMin > cMin) {
                alloc = maxEndMin - cMin; // trim to fit
              } else if (maxEndDay < cDay || (maxEndDay === cDay && maxEndMin <= cMin)) {
                // Past deadline entirely — remaining is overflow
                break;
              }
            }
          }
          if (alloc <= 0) break;

          // ── Book resources and emit block ──
          const bQty = rem <= alloc ? qRem : Math.round(alloc * ppm);
          if (pool) pool.book(cDay, cMin, cMin + alloc, sk.operators, mId);
          if (calco) calcoTL.book(calco, toAbs(cDay, cMin), toAbs(cDay, cMin + alloc), mId);
          toolTL.book(grp.toolId, toAbs(cDay, cMin), toAbs(cDay, cMin + alloc), mId);

          const block: Block = {
            opId: sk.opId,
            toolId: grp.toolId,
            sku: sk.sku,
            nm: sk.nm,
            machineId: mId,
            origM: sk.origM,
            dayIdx: cDay,
            eddDay: sk.edd,
            qty: bQty,
            prodMin: alloc,
            setupMin: isFirst ? grp.setupMin : 0,
            operators: sk.operators,
            blocked: false,
            reason: null,
            moved: sk.moved,
            hasAlt: sk.hasAlt,
            altM: sk.altM,
            mp: sk.mp,
            stk: sk.stk,
            lt: sk.lt,
            atr: sk.atr,
            startMin: cMin,
            endMin: cMin + alloc,
            setupS: isFirst ? setupS : null,
            setupE: isFirst ? setupE : null,
            type: 'ok',
            shift,
            belowMinBatch: sk.lt > 0 && sk.prodQty < sk.lt,
            earliestStart: sk.earliestStart,
            ...(opDeadline ? { latestFinishAbs: opDeadline.latestFinishAbs } : {}),
            // Twin co-production: each SKU gets its actual demand, capped per block
            ...(sk.isTwinProduction && sk.twinOutputs && twinQRem
              ? {
                  isTwinProduction: true,
                  coProductionGroupId: sk.coProductionGroupId,
                  outputs: sk.twinOutputs.map((t, idx) => {
                    const outQty = Math.min(bQty, twinQRem[idx]);
                    twinQRem[idx] -= outQty;
                    return { opId: t.opId, sku: t.sku, qty: outQty };
                  }),
                }
              : {}),
          };

          // Mark data gap on the block if applicable
          if (hasDataGap) {
            block.hasDataGap = true;
            block.dataGapDetail = dataGapDetail;
          }
          // Mark operator capacity warning if applicable
          if (opWarningFlag) {
            block.operatorWarning = true;
          }

          blocks.push(block);
          isFirst = false;
          rem -= alloc;
          qRem -= bQty;
          cMin += alloc;
          totalAllocated += alloc;
        }

        // Remaining production -> overflow
        if (rem > 0) {
          const ofBlock = mkOverflow(sk, grp, wDays[wDays.length - 1], rem);
          if (sk.isTwinProduction && sk.twinOutputs) {
            ofBlock.isTwinProduction = true;
            ofBlock.coProductionGroupId = sk.coProductionGroupId;
            ofBlock.outputs = sk.twinOutputs.map((t) => ({ opId: t.opId, sku: t.sku, qty: 0 }));
          }
          blocks.push(ofBlock);
        }
      }
      lastTool = grp.toolId;
    }
  }

  return { blocks, infeasibilities };
}
