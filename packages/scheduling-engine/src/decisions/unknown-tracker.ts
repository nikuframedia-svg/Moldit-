// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Decision Tracker
//  Categorizes DecisionEntry[] by category for analysis
//  Groups decisions to identify data gaps and infeasibilities
//  Per Normative Spec §10: Full explainability
// ═══════════════════════════════════════════════════════════

import type { DecisionEntry, DecisionType } from '../types/decisions.js';

// ── Types ────────────────────────────────────────────────────

export type DecisionCategory =
  | 'data_missing' // Data gaps (setup, MO, pH, etc.)
  | 'infeasibility' // Operations declared infeasible
  | 'deadline_constraint' // Deadline influenced scheduling
  | 'operator_reallocation' // Pool operators borrowed
  | 'load_leveling' // Blocks moved for load balancing
  | 'overflow_routing' // Operations routed to alternative machines
  | 'backward_schedule' // Operations with backward-scheduled start dates
  | 'alternative_machine' // Rerouted to alt machine
  | 'tool_down' // Tools marked as down
  | 'machine_down' // Machines marked as down
  | 'failure_detected' // Temporal failure events detected
  | 'failure_mitigation' // Blocks rerouted due to failure
  | 'failure_unrecoverable' // Blocks without alternative (failure)
  | 'shipping_cutoff' // Shipping deadlines computed
  | 'production_start' // Production start decisions
  | 'capacity_computation' // OEE/capacity computations
  | 'scoring_decision' // Scoring decisions for ordering
  | 'twin_validation' // Twin piece validation anomalies
  | 'workforce_forecast' // D+1 workforce forecast warnings
  | 'other'; // Anything else

export interface CategorizedDecisions {
  /** Category name */
  category: DecisionCategory;
  /** Human-readable label */
  label: string;
  /** Entries in this category */
  entries: DecisionEntry[];
  /** Count */
  count: number;
}

export interface DecisionSummaryReport {
  /** All categories, sorted by count descending */
  categories: CategorizedDecisions[];
  /** Total decisions analyzed */
  total: number;
  /** Number of "data gap" decisions */
  dataGapCount: number;
  /** Number of infeasibility declarations */
  infeasibilityCount: number;
}

// ── Category mapping ────────────────────────────────────────

const TYPE_TO_CATEGORY: Record<DecisionType, DecisionCategory> = {
  DATA_MISSING: 'data_missing',
  INFEASIBILITY_DECLARED: 'infeasibility',
  DEADLINE_CONSTRAINT: 'deadline_constraint',
  OPERATOR_REALLOCATION: 'operator_reallocation',
  LOAD_LEVEL: 'load_leveling',
  OVERFLOW_ROUTE: 'overflow_routing',
  BACKWARD_SCHEDULE: 'backward_schedule',
  ALTERNATIVE_MACHINE: 'alternative_machine',
  TOOL_DOWN: 'tool_down',
  MACHINE_DOWN: 'machine_down',
  FAILURE_DETECTED: 'failure_detected',
  FAILURE_MITIGATION: 'failure_mitigation',
  FAILURE_UNRECOVERABLE: 'failure_unrecoverable',
  SHIPPING_CUTOFF: 'shipping_cutoff',
  PRODUCTION_START: 'production_start',
  CAPACITY_COMPUTATION: 'capacity_computation',
  SCORING_DECISION: 'scoring_decision',
  ADVANCE_PRODUCTION: 'overflow_routing',
  OPERATOR_CAPACITY_WARNING: 'operator_reallocation',
  AUTO_REPLAN_ADVANCE: 'overflow_routing',
  AUTO_REPLAN_MOVE: 'alternative_machine',
  AUTO_REPLAN_SPLIT: 'overflow_routing',
  AUTO_REPLAN_OVERTIME: 'capacity_computation',
  AUTO_REPLAN_THIRD_SHIFT: 'capacity_computation',
  TWIN_VALIDATION_ANOMALY: 'twin_validation',
  WORKFORCE_FORECAST_D1: 'workforce_forecast',
  WORKFORCE_COVERAGE_MISSING: 'workforce_forecast',
  LABOR_GROUP_UNMAPPED: 'workforce_forecast',
};

const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  data_missing: 'Dados em falta (setup, MO, pH)',
  infeasibility: 'Operacoes declaradas inviaveis',
  deadline_constraint: 'Prazo de entrega influenciou agendamento',
  operator_reallocation: 'Operadores realocados (pool)',
  load_leveling: 'Blocos movidos (nivelamento de carga)',
  overflow_routing: 'Operacoes encaminhadas para alternativa',
  backward_schedule: 'Datas de inicio calculadas (Prz.Fabrico)',
  alternative_machine: 'Reroteamento para maquina alternativa',
  tool_down: 'Ferramentas marcadas como down',
  machine_down: 'Maquinas marcadas como down',
  failure_detected: 'Avarias detectadas',
  failure_mitigation: 'Blocos reroteados por avaria',
  failure_unrecoverable: 'Blocos sem alternativa (avaria)',
  shipping_cutoff: 'Deadlines de expedição calculados',
  production_start: 'Decisões de início de produção',
  capacity_computation: 'Cálculos de capacidade (OEE)',
  scoring_decision: 'Scoring para ordenação de operações',
  twin_validation: 'Anomalias de validação de peças gémeas',
  workforce_forecast: 'Previsão D+1 de workforce',
  other: 'Outros',
};

// ── Categorize based on type ─────────────────────────────────

function getCategory(entry: DecisionEntry): DecisionCategory {
  return TYPE_TO_CATEGORY[entry.type] ?? 'other';
}

// ── Main function ────────────────────────────────────────────

/**
 * Categorize decision entries by type into human-readable groups.
 *
 * This is useful for the transparency panel, showing
 * the user all data gaps, infeasibilities, and scheduling decisions.
 *
 * @param entries - Array of DecisionEntry from the DecisionRegistry
 * @returns DecisionSummaryReport with categorized groups sorted by count
 */
export function categorizeUnknowns(entries: DecisionEntry[]): DecisionSummaryReport {
  const groups = new Map<DecisionCategory, DecisionEntry[]>();

  for (const entry of entries) {
    const cat = getCategory(entry);
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(entry);
  }

  const categories: CategorizedDecisions[] = [];
  for (const [category, catEntries] of groups) {
    categories.push({
      category,
      label: CATEGORY_LABELS[category],
      entries: catEntries,
      count: catEntries.length,
    });
  }

  // Sort by count descending
  categories.sort((a, b) => b.count - a.count);

  const dataGapCount = categories
    .filter((c) => c.category === 'data_missing')
    .reduce((s, c) => s + c.count, 0);

  const infeasibilityCount = categories
    .filter((c) => c.category === 'infeasibility')
    .reduce((s, c) => s + c.count, 0);

  return {
    categories,
    total: entries.length,
    dataGapCount,
    infeasibilityCount,
  };
}
