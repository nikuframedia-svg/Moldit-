/**
 * solver-bridge.ts — Transform between EngineData and SolverRequest/Result.
 *
 * engineDataToSolverRequest: EngineData → SolverRequest (for backend CP-SAT)
 * solverResultToBlocks: SolverResult → Block[] (for Gantt display)
 */

import type {
  Block,
  EMachine,
  EngineData,
  EOp,
  ETool,
  TwinGroup,
} from '../../../lib/engine';
import { DAY_CAP, DEFAULT_OEE, S0, T1 } from '../../../lib/engine';
import type {
  ConstraintConfigInput,
  JobInput,
  MachineInput,
  OperationInput,
  ScheduledOp,
  SolverConfig,
  SolverRequest,
  SolverResult,
  TwinPairInput,
} from './solverApi';

// ── EngineData → SolverRequest ──

interface SolverBridgeConfig {
  oee: number;
  timeLimit: number;
  objective: 'makespan' | 'tardiness' | 'weighted_tardiness';
}

export function engineDataToSolverRequest(
  data: EngineData,
  cfg: SolverBridgeConfig,
): SolverRequest {
  const oee = cfg.oee || DEFAULT_OEE;

  const jobs: JobInput[] = [];
  const machineSet = new Set<string>();

  // Each EOp demand bucket → one job with one operation
  for (const op of data.ops) {
    const tool = data.toolMap[op.t];
    if (!tool) continue;

    const toolOee = tool.oee ?? oee;
    const pH = tool.pH;
    if (pH <= 0) continue;

    machineSet.add(op.m);

    // Each day with demand > 0 → separate job
    for (let dayIdx = 0; dayIdx < op.d.length; dayIdx++) {
      const qty = op.d[dayIdx];
      if (qty <= 0) continue;

      const jobId = `${op.id}_d${dayIdx}`;
      const durationMin = Math.ceil((qty / (pH * toolOee)) * 60);
      const setupMin = Math.round(tool.sH * 60);
      const dueDateMin = (dayIdx + 1) * DAY_CAP; // deadline = end of that day

      const operation: OperationInput = {
        id: jobId,
        machine_id: op.m,
        tool_id: op.t,
        duration_min: durationMin,
        setup_min: setupMin,
        operators: tool.op,
        calco_code: tool.calco ?? null,
      };

      jobs.push({
        id: jobId,
        sku: op.sku,
        due_date_min: dueDateMin,
        weight: 1.0,
        operations: [operation],
      });
    }
  }

  // Machines
  const machines: MachineInput[] = data.machines
    .filter((m: EMachine) => machineSet.has(m.id))
    .map((m: EMachine) => ({ id: m.id, capacity_min: DAY_CAP }));

  // Twin pairs
  const twinPairs: TwinPairInput[] = (data.twinGroups ?? []).map((tg: TwinGroup) => ({
    op_id_a: tg.opId1,
    op_id_b: tg.opId2,
    machine_id: tg.machine,
    tool_id: tg.tool,
  }));

  // Constraints (all enabled except operator pool)
  const constraints: ConstraintConfigInput = {
    setup_crew: true,
    tool_timeline: true,
    calco_timeline: true,
    operator_pool: false,
  };

  const solverConfig: SolverConfig = {
    time_limit_s: cfg.timeLimit,
    objective: cfg.objective,
    num_workers: 4,
  };

  return {
    jobs,
    machines,
    config: solverConfig,
    twin_pairs: twinPairs,
    constraints,
  };
}

// ── SolverResult → Block[] ──

export function solverResultToBlocks(
  result: SolverResult,
  data: EngineData,
): Block[] {
  // Build lookup maps
  const opMap = new Map<string, EOp>();
  for (const op of data.ops) {
    opMap.set(op.id, op);
  }

  const blocks: Block[] = [];

  for (const sop of result.schedule) {
    // Extract original opId from job id (format: "OP01_d3")
    const match = sop.op_id.match(/^(.+)_d(\d+)$/);
    if (!match) continue;

    const [, origOpId, dayIdxStr] = match;
    const eddDay = parseInt(dayIdxStr, 10);
    const op = opMap.get(origOpId);
    if (!op) continue;

    const tool = data.toolMap[op.t];
    if (!tool) continue;

    const block = sopToBlock(sop, op, tool, eddDay);
    blocks.push(block);
  }

  // Sort by machine + start
  blocks.sort((a, b) => a.machineId.localeCompare(b.machineId) || a.startMin - b.startMin);
  return blocks;
}

function sopToBlock(sop: ScheduledOp, op: EOp, tool: ETool, eddDay: number): Block {
  const dayIdx = Math.floor(sop.start_min / DAY_CAP);
  const startInDay = sop.start_min % DAY_CAP + S0;
  const shift: 'X' | 'Y' | 'Z' = startInDay < T1 ? 'X' : 'Y';

  // Calculate qty from duration
  const oee = tool.oee ?? DEFAULT_OEE;
  const prodMin = sop.end_min - sop.start_min - sop.setup_min;
  const qty = Math.round((prodMin / 60) * tool.pH * oee);

  return {
    opId: op.id,
    toolId: op.t,
    sku: op.sku,
    nm: op.nm,
    machineId: sop.machine_id,
    origM: op.m,
    dayIdx,
    eddDay,
    qty,
    prodMin: Math.max(prodMin, 0),
    setupMin: sop.setup_min,
    operators: tool.op,
    blocked: false,
    reason: null,
    moved: sop.machine_id !== op.m,
    hasAlt: tool.alt !== '-',
    altM: tool.alt !== '-' ? tool.alt : null,
    stk: tool.stk,
    lt: tool.lt,
    atr: op.atr,
    startMin: sop.start_min,
    endMin: sop.end_min,
    setupS: sop.setup_min > 0 ? sop.start_min : null,
    setupE: sop.setup_min > 0 ? sop.start_min + sop.setup_min : null,
    type: sop.is_tardy ? 'overflow' : 'ok',
    shift,
    isTwinProduction: sop.is_twin_production,
    coProductionGroupId: sop.twin_partner_op_id
      ? `twin_${[op.id, sop.twin_partner_op_id].sort().join('_')}`
      : undefined,
  };
}
