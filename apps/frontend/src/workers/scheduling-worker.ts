// ═══════════════════════════════════════════════════════════
//  Scheduling Web Worker
//  Runs ATCS dispatch + Simulated Annealing off the main thread.
//  Communicates via postMessage: receives SAInput + config,
//  sends back progress updates and final SAResult.
// ═══════════════════════════════════════════════════════════

import type { SAConfig, SAInput, SAResult } from '../lib/engine';
import {
  DEFAULT_WORKFORCE_CONFIG,
  runSimulatedAnnealing,
  scheduleAll,
} from '../lib/engine';

// ── Message protocol ──────────────────────────────────────

export interface WorkerRequest {
  type: 'run-sa';
  input: SAInput;
  config?: Partial<SAConfig>;
}

export interface WorkerProgressMessage {
  type: 'progress';
  pct: number;
}

export interface WorkerResultMessage {
  type: 'result';
  result: SAResult;
}

export interface WorkerErrorMessage {
  type: 'error';
  error: string;
}

export type WorkerResponse = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

// ── Worker entry point ────────────────────────────────────

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { type, input, config } = event.data;

  if (type !== 'run-sa') {
    const errorMsg: WorkerErrorMessage = { type: 'error', error: `Unknown message type: ${type}` };
    self.postMessage(errorMsg);
    return;
  }

  try {
    // Run initial ATCS schedule to get baseline blocks
    const initResult = scheduleAll({
      ops: input.ops,
      mSt: input.mSt,
      tSt: input.tSt,
      moves: input.initialMoves ?? [],
      machines: input.machines,
      toolMap: input.TM,
      workdays: input.workdays,
      nDays: input.nDays,
      rule: input.rule ?? 'ATCS',
      thirdShift: input.thirdShift,
      workforceConfig: input.workforceConfig ?? DEFAULT_WORKFORCE_CONFIG,
      machineTimelines: input.machineTimelines,
      toolTimelines: input.toolTimelines,
      twinValidationReport: input.twinValidationReport,
      dates: input.dates,
      orderBased: input.orderBased,
      atcsParams: input.atcsParams,
    });

    // Attach initial blocks for SA baseline comparison
    const saInput: SAInput = {
      ...input,
      initialBlocks: initResult.blocks,
    };

    // Run SA with progress callback
    const result = runSimulatedAnnealing(saInput, config ?? {}, (pct: number) => {
      const progress: WorkerProgressMessage = { type: 'progress', pct };
      self.postMessage(progress);
    });

    const resultMsg: WorkerResultMessage = { type: 'result', result };
    self.postMessage(resultMsg);
  } catch (err) {
    const errorMsg: WorkerErrorMessage = {
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errorMsg);
  }
};
