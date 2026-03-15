/**
 * Solver API client — POST /v1/solver/schedule
 * Falls back to error if backend unavailable (caller handles fallback).
 */

import { config } from '../../../config';

// ── Request types (mirror backend schemas.py) ──

export interface OperationInput {
  id: string;
  machine_id: string;
  tool_id: string;
  duration_min: number;
  setup_min: number;
  operators: number;
  calco_code: string | null;
}

export interface JobInput {
  id: string;
  sku: string;
  due_date_min: number;
  weight: number;
  operations: OperationInput[];
}

export interface MachineInput {
  id: string;
  capacity_min: number;
}

export interface TwinPairInput {
  op_id_a: string;
  op_id_b: string;
  machine_id: string;
  tool_id: string;
}

export interface ConstraintConfigInput {
  setup_crew: boolean;
  tool_timeline: boolean;
  calco_timeline: boolean;
  operator_pool: boolean;
}

export interface SolverConfig {
  time_limit_s: number;
  objective: 'makespan' | 'tardiness' | 'weighted_tardiness';
  num_workers: number;
}

export interface SolverRequest {
  jobs: JobInput[];
  machines: MachineInput[];
  config: SolverConfig;
  twin_pairs: TwinPairInput[];
  constraints: ConstraintConfigInput;
}

// ── Response types ──

export interface ScheduledOp {
  op_id: string;
  job_id: string;
  machine_id: string;
  tool_id: string;
  start_min: number;
  end_min: number;
  setup_min: number;
  is_tardy: boolean;
  tardiness_min: number;
  is_twin_production: boolean;
  twin_partner_op_id: string | null;
}

export interface SolverResult {
  schedule: ScheduledOp[];
  makespan_min: number;
  total_tardiness_min: number;
  weighted_tardiness: number;
  solver_used: 'cpsat' | 'heuristic';
  solve_time_s: number;
  status: 'optimal' | 'feasible' | 'infeasible' | 'timeout';
  objective_value: number;
  n_ops: number;
  operator_warnings: Record<string, unknown>[];
}

// ── API call ──

export async function callServerSolver(request: SolverRequest): Promise<SolverResult> {
  const base = config.apiBaseURL;
  const res = await fetch(`${base}/v1/solver/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Solver HTTP ${res.status}: ${await res.text().catch(() => 'unknown')}`);
  }
  return await res.json();
}
