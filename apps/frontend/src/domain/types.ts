/**
 * Domain types used by frontend code.
 *
 * Only types actually referenced in the codebase are kept here.
 * For Nikufra scheduling domain types → see nikufra-types.ts
 * For MRP domain types → see mrp/mrp-types.ts
 */

// ── Plan & Operations ──

export interface Plan {
  plan_id: string;
  snapshot_id?: string;
  snapshot_hash: string;
  plan_hash: string;
  status: 'CANDIDATE' | 'OFFICIAL';
  created_at: string;
  plan_params: PlanParams;
  workorders?: WorkOrder[];
  operations: PlanOperation[];
  kpi_pack: KPIPack;
  explain_trace?: ExplainTrace;
}

export interface PlanParams {
  timebox_s: number;
  seed: number;
  freeze_window_minutes?: number;
  objective_weights?: ObjectiveWeights;
  default_costs?: DefaultCosts;
  modes?: {
    allow_operation_split_across_shifts?: boolean;
    operator_capacity_model?: 'BUCKET_PER_SHIFT' | 'CONTINUOUS';
  };
}

export interface ObjectiveWeights {
  tardiness: number;
  setup_count: number;
  setup_time: number;
  setup_balance_by_shift: number;
  churn: number;
  overtime: number;
  coil_fragmentation: number;
  earliness: number;
}

export interface DefaultCosts {
  tardiness_eur_per_day: number;
  setup_eur_per_setup: number;
  setup_eur_per_minute: number;
  overtime_eur_per_hour: number;
  churn_eur_per_moved_operation: number;
}

export interface WorkOrder {
  workorder_id: string;
  snapshot_id: string;
  customer_code: string;
  item_sku: string;
  quantity: number;
  due_date: string;
  day_bucket: string;
  routing_ref: string;
  operations_required: OperationTemplate[];
}

export interface OperationTemplate {
  op_template_id: string;
  sequence: number;
  resource_code: string;
  alt_resources: string[];
  tool_code?: string;
  operators_required: number;
  setup_time_s: number;
  run_time_s: number;
}

export interface PlanOperation {
  operation_id: string;
  workorder_id: string;
  item_sku: string;
  resource_code: string;
  tool_code?: string;
  start_time: string;
  end_time: string;
  quantity: number;
  is_setup: boolean;
  operators_required: number;
}

export interface KPIPack {
  tardiness_total_days: number;
  setup_count_total: number;
  setup_count_by_shift?: Record<string, number>;
  setup_balance_penalty?: number;
  overtime_hours?: number;
  churn_ops_moved?: number;
  load_by_machine_day?: Record<string, Record<string, number>>;
}

// ── Explainability ──

export interface ExplainTrace {
  plan_id: string;
  snapshot_hash: string;
  generated_at: string;
  solver: {
    name: string;
    seed: number;
    timebox_s: number;
  };
  workorders: ExplainWorkorder[];
  global_notes: Array<{ note: string }>;
  objective_breakdown: ExplainObjective[];
}

export interface ExplainWorkorder {
  workorder_id: string;
  priority_rule?: {
    rule: string;
    tie_breakers: string[];
  };
  assignments: Array<{
    kind: string;
    resource_code?: string;
    tool_code?: string;
    why: string[];
    evidence_refs: string[];
  }>;
  constraints_checked: Array<{
    name: string;
    result: string;
    details: string;
    evidence_refs: string[];
  }>;
  evidence_refs: string[];
}

export interface ExplainObjective {
  objective: string;
  weight: number;
  value: number;
  contribution: number;
}

// ── Scenarios ──

export interface ScenarioDiff {
  scenario_id: string;
  baseline_plan_hash: string;
  diff: {
    move_operations: Array<{
      operation_id: string;
      from_resource: string;
      to_resource: string;
      reason: string;
    }>;
    freeze: {
      window_minutes: number;
    };
  };
  created_at: string;
}

export interface ScenarioExtended extends ScenarioDiff {
  name?: string;
  status: 'PENDING' | 'COMPUTING' | 'COMPUTED' | 'PR_CREATED' | 'FAILED';
  author?: string;
  kpi_deltas?: Partial<KPIPack>;
  moved_operations?: Array<{
    operation_id: string;
    item_sku: string;
    from_resource: string;
    to_resource: string;
    impact: string;
  }>;
  churn?: number;
}

export interface CreateScenarioParams {
  baseline_plan_id: string;
  name?: string;
  diff: {
    move_operations?: Array<{
      operation_id: string;
      from_resource: string;
      to_resource: string;
      reason: string;
    }>;
    freeze?: {
      window_minutes: number;
    };
    parameter_changes?: Record<string, unknown>;
  };
  author?: string;
}

export interface CreatePRParams {
  scenario_id?: string;
  baseline_plan_id: string;
  candidate_plan_id?: string;
  author: string;
  description?: string;
}

// ── Events ──

export type PlanEventType =
  | 'MACHINE_DOWN'
  | 'MACHINE_UP'
  | 'QUALITY_HOLD'
  | 'OPERATOR_ABSENT'
  | 'OPERATOR_BACK'
  | 'SCRAP_EVENT'
  | 'URGENT_ORDER'
  | 'ORDER_CANCELLED'
  | 'MATERIAL_SHORTAGE'
  | 'MATERIAL_ARRIVED'
  | 'RUSH_ORDER'
  | 'CUSTOM';

export interface PlanEvent {
  event_id: string;
  event_type: PlanEventType;
  occurred_at?: string;
  resource_code?: string;
  pool_code?: string;
  shift_code?: string;
  workorder_id?: string;
  material_code?: string;
  reason?: string;
  description: string;
  start_time: string;
  end_time?: string;
  date?: string;
  operators_count?: number;
  scrap_qty?: number;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  created_at: string;
  resolved_at?: string;
  affected_operations?: string[];
  scenario_id?: string;
  event_metadata?: Record<string, unknown>;
}
