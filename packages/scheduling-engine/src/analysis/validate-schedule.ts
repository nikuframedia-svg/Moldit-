// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Schedule Validator
//  Post-schedule constraint checker (pure function)
//  Extracted from NikufraEngine.tsx validateSchedule()
// ═══════════════════════════════════════════════════════════

import { DAY_CAP, MINUTES_PER_DAY, S0, S2 } from '../constants.js';
import type { Block, MoveAction } from '../types/blocks.js';
import type { EMachine, EOp, ETool } from '../types/engine.js';
import { getBlockProductionForOp } from '../utils/block-production.js';
import { fmtMin } from '../utils/time.js';

// ── Validation-specific types ────────────────────────────────
// These are richer than the generic Violation in kpis.ts because
// they include affectedOps, suggestedFix, and action.

export type ValidationType =
  | 'TOOL_UNIQUENESS'
  | 'SETUP_CREW_OVERLAP'
  | 'MACHINE_OVERCAPACITY'
  | 'EFFICIENCY_WARNING'
  | 'DEADLINE_MISS';

export interface ScheduleViolation {
  id: string;
  type: ValidationType;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  affectedOps: Array<{ opId: string; toolId: string; machineId: string; dayIdx: number }>;
  suggestedFix: string | null;
  action: MoveAction | null;
}

export interface ScheduleValidationReport {
  valid: boolean;
  violations: ScheduleViolation[];
  summary: {
    toolConflicts: number;
    setupOverlaps: number;
    machineOvercapacity: number;
    efficiencyWarnings: number;
    deadlineMisses: number;
    /** Number of twin co-production blocks */
    twinBlocks: number;
    /** Distinct twin co-production groups */
    twinGroups: number;
  };
  checkedAt: number;
}

// ── Main Validation ─────────────────────────────────────────

/**
 * Validate a schedule for constraint violations.
 *
 * Checks:
 * 1. Tool uniqueness (same tool on different machines, overlapping time)
 * 2. Setup crew overlaps (2+ setups on different machines simultaneously)
 * 3. Machine overcapacity (exceeding DAY_CAP)
 * 4. Deadline misses (demand not covered)
 */
export function validateSchedule(
  blocks: Block[],
  machines: EMachine[],
  TM: Record<string, ETool>,
  ops: EOp[],
  thirdShift?: boolean,
  nDays?: number,
): ScheduleValidationReport {
  // G3: Dynamic capacity -- 3rd shift adds 420 min (24:00-07:00)
  const eDayCap = thirdShift ? S2 - S0 : DAY_CAP; // 1440 or 1020

  const violations: ScheduleViolation[] = [];
  let vid = 0;
  const mkId = () => `V-${++vid}`;

  // -- Check 1: Tool Uniqueness (same tool on different machines, overlapping time) --
  const toolBlocks: Record<string, Block[]> = {};
  blocks
    .filter((b) => b.type === 'ok')
    .forEach((b) => {
      if (!toolBlocks[b.toolId]) toolBlocks[b.toolId] = [];
      toolBlocks[b.toolId].push(b);
    });
  for (const [toolId, tBlocks] of Object.entries(toolBlocks)) {
    for (let i = 0; i < tBlocks.length; i++) {
      for (let j = i + 1; j < tBlocks.length; j++) {
        const a = tBlocks[i],
          b = tBlocks[j];
        if (a.machineId === b.machineId) continue;
        const aS = a.dayIdx * MINUTES_PER_DAY + (a.setupS ?? a.startMin);
        const aE = a.dayIdx * MINUTES_PER_DAY + a.endMin;
        const bS = b.dayIdx * MINUTES_PER_DAY + (b.setupS ?? b.startMin);
        const bE = b.dayIdx * MINUTES_PER_DAY + b.endMin;
        if (aS < bE && bS < aE) {
          violations.push({
            id: mkId(),
            type: 'TOOL_UNIQUENESS',
            severity: 'critical',
            title: `${toolId} em 2 maquinas`,
            detail: `${a.machineId} (${fmtMin(a.setupS ?? a.startMin)}-${fmtMin(a.endMin)}) intersect ${b.machineId} (${fmtMin(b.setupS ?? b.startMin)}-${fmtMin(b.endMin)})`,
            affectedOps: [
              { opId: a.opId, toolId, machineId: a.machineId, dayIdx: a.dayIdx },
              { opId: b.opId, toolId, machineId: b.machineId, dayIdx: b.dayIdx },
            ],
            suggestedFix: `Mover ${toolId}/${b.machineId} para turno/dia diferente`,
            action: null,
          });
        }
      }
    }
  }

  // -- Check 2: Setup Crew Overlaps (2+ setups on different machines simultaneously) --
  const setupSlots = blocks
    .filter((b) => b.setupS != null && b.setupE != null)
    .map((b) => ({
      start: b.dayIdx * MINUTES_PER_DAY + b.setupS!,
      end: b.dayIdx * MINUTES_PER_DAY + b.setupE!,
      machine: b.machineId,
      opId: b.opId,
      toolId: b.toolId,
      dayIdx: b.dayIdx,
    }));
  for (let i = 0; i < setupSlots.length; i++) {
    for (let j = i + 1; j < setupSlots.length; j++) {
      if (setupSlots[i].machine === setupSlots[j].machine) continue;
      if (setupSlots[i].start < setupSlots[j].end && setupSlots[j].start < setupSlots[i].end) {
        violations.push({
          id: mkId(),
          type: 'SETUP_CREW_OVERLAP',
          severity: 'high',
          title: 'Setups sobrepostos',
          detail: `${setupSlots[i].machine} (${fmtMin(setupSlots[i].start % 1440)}-${fmtMin(setupSlots[i].end % 1440)}) intersect ${setupSlots[j].machine} (${fmtMin(setupSlots[j].start % 1440)}-${fmtMin(setupSlots[j].end % 1440)})`,
          affectedOps: [
            {
              opId: setupSlots[i].opId,
              toolId: setupSlots[i].toolId,
              machineId: setupSlots[i].machine,
              dayIdx: setupSlots[i].dayIdx,
            },
            {
              opId: setupSlots[j].opId,
              toolId: setupSlots[j].toolId,
              machineId: setupSlots[j].machine,
              dayIdx: setupSlots[j].dayIdx,
            },
          ],
          suggestedFix: 'Resequenciar setups para nao sobrepor',
          action: null,
        });
      }
    }
  }

  // -- Check 3: Machine Overcapacity --
  // DAY_CAP (1020 min) = hard limit (2 full shifts).
  // OEE is already baked into production times (prodMin inflated by 1/OEE),
  // so DAY_CAP is the only relevant threshold.
  const vNDays = nDays ?? (blocks.length > 0 ? Math.max(...blocks.map((b) => b.dayIdx)) + 1 : 0);
  for (const mc of machines) {
    for (let di = 0; di < vNDays; di++) {
      const dayOps = blocks.filter(
        (b) => b.machineId === mc.id && b.dayIdx === di && b.type === 'ok',
      );
      let totalMin = 0;
      for (const b of dayOps) {
        totalMin += b.endMin - b.startMin;
        if (b.setupS != null && b.setupE != null) totalMin += b.setupE - b.setupS;
      }
      if (Math.round(totalMin) > eDayCap) {
        violations.push({
          id: mkId(),
          type: 'MACHINE_OVERCAPACITY',
          severity: 'high',
          title: `${mc.id} excede capacidade dia ${di}`,
          detail: `${Math.round(totalMin)}min / ${eDayCap}min (${((totalMin / eDayCap) * 100).toFixed(0)}%)`,
          affectedOps: dayOps.map((b) => ({
            opId: b.opId,
            toolId: b.toolId,
            machineId: mc.id,
            dayIdx: di,
          })),
          suggestedFix: `Mover ${Math.round(totalMin - eDayCap)}min para dia seguinte ou alternativa`,
          action: null,
        });
      }
    }
  }

  // -- Check 4: Deadline Misses (demand not covered) --
  // Group by tool to avoid inflated violation counts when same tool serves multiple clients
  const opsByTool: Record<string, EOp[]> = {};
  for (const op of ops) {
    if (!opsByTool[op.t]) opsByTool[op.t] = [];
    opsByTool[op.t].push(op);
  }

  for (const [toolId, toolOps] of Object.entries(opsByTool)) {
    let toolDemand = 0;
    let toolProduced = 0;
    const affectedDays: ScheduleViolation['affectedOps'] = [];

    for (const op of toolOps) {
      const opDemand = op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0);
      if (opDemand <= 0) continue;
      toolDemand += opDemand;
      // Twin-aware production: uses outputs[] for co-production blocks
      toolProduced += getBlockProductionForOp(blocks, op.id);
      if (op.atr > 0) affectedDays.push({ opId: op.id, toolId: op.t, machineId: op.m, dayIdx: 0 });
      op.d.forEach((qty, di) => {
        if (qty > 0) affectedDays.push({ opId: op.id, toolId: op.t, machineId: op.m, dayIdx: di });
      });
    }

    if (toolDemand > 0 && toolProduced < toolDemand) {
      const pct = ((toolProduced / toolDemand) * 100).toFixed(0);
      const tool = TM[toolId];
      const skus = toolOps.map((o) => o.sku).filter((v, i, a) => a.indexOf(v) === i);
      const altM = tool?.alt && tool.alt !== '-' ? tool.alt : null;
      violations.push({
        id: mkId(),
        type: 'DEADLINE_MISS',
        severity: 'critical',
        title: `${toolId}/${skus.join(',')} -- demand nao coberta`,
        detail: `Producao: ${toolProduced.toLocaleString()} de ${toolDemand.toLocaleString()} (${pct}%) [${toolOps.length} ops]`,
        affectedOps:
          affectedDays.length > 0
            ? affectedDays
            : [{ opId: toolOps[0].id, toolId, machineId: toolOps[0].m, dayIdx: 0 }],
        suggestedFix:
          toolProduced === 0
            ? `Verificar disponibilidade de ${toolOps[0].m}/${toolId}`
            : altM
              ? `Mover para ${altM}`
              : 'Considerar overtime ou alternativa',
        action: altM ? { opId: toolOps[0].id, toM: altM } : null,
      });
    }
  }

  // Twin co-production summary
  const twinOkBlocks = blocks.filter((b) => b.type === 'ok' && b.isTwinProduction);
  const twinGroupIds = new Set(twinOkBlocks.map((b) => b.coProductionGroupId).filter(Boolean));

  const summary = {
    toolConflicts: violations.filter((v) => v.type === 'TOOL_UNIQUENESS').length,
    setupOverlaps: violations.filter((v) => v.type === 'SETUP_CREW_OVERLAP').length,
    machineOvercapacity: violations.filter((v) => v.type === 'MACHINE_OVERCAPACITY').length,
    efficiencyWarnings: violations.filter((v) => v.type === 'EFFICIENCY_WARNING').length,
    deadlineMisses: violations.filter((v) => v.type === 'DEADLINE_MISS').length,
    twinBlocks: twinOkBlocks.length,
    twinGroups: twinGroupIds.size,
  };

  return {
    valid:
      violations.filter((v) => v.severity === 'critical' || v.severity === 'high').length === 0,
    violations,
    summary,
    checkedAt: Date.now(),
  };
}
