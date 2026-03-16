/**
 * Scheduling API client — POST /v1/scheduling/run
 *
 * Calls the Python-ported ATCS scheduling pipeline.
 * Falls back to error if backend unavailable (caller handles fallback).
 */

import { config } from '../../../config';
import type {
  AdvanceAction,
  Block,
  DecisionEntry,
  EngineData,
  FeasibilityReport,
  MoveAction,
} from '../../../lib/engine';

export interface SchedulingRunRequest {
  engine_data: EngineData;
  rule: string;
  third_shift: boolean;
  max_tier?: number;
}

export interface SchedulingRunResponse {
  blocks: Block[];
  auto_moves: MoveAction[];
  auto_advances: AdvanceAction[];
  decisions: DecisionEntry[];
  feasibility_report: FeasibilityReport | null;
  solve_time_s: number;
  solver_used: string;
  n_blocks: number;
  n_ops: number;
}

export async function callPythonScheduler(
  request: SchedulingRunRequest,
): Promise<SchedulingRunResponse> {
  const base = config.apiBaseURL;
  const res = await fetch(`${base}/v1/scheduling/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Scheduling HTTP ${res.status}: ${await res.text().catch(() => 'unknown')}`);
  }
  return await res.json();
}
