// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Decision Registry
//  Append-only log of ALL scheduling decisions
//  Per Normative Spec §10: Full explainability
// ═══════════════════════════════════════════════════════════

import type { DecisionEntry, DecisionSummary, DecisionType } from '../types/decisions.js';

/**
 * DecisionRegistry — Tracks every scheduling decision.
 *
 * Usage:
 *   const registry = new DecisionRegistry()
 *   registry.record({ type: 'DATA_MISSING', toolId: 'BWI003', ... })
 *   const dataGaps = registry.getDataGaps()
 */
export class DecisionRegistry {
  private entries: DecisionEntry[] = [];
  private idCounter = 0;

  private generateId(): string {
    this.idCounter++;
    return `dec_${Date.now()}_${this.idCounter}`;
  }

  /** Record a new decision. Returns the decision ID. */
  record(params: Omit<DecisionEntry, 'id' | 'timestamp'>): string {
    const id = this.generateId();
    this.entries.push({ ...params, id, timestamp: Date.now() });
    return id;
  }

  /** Get all decisions */
  getAll(): DecisionEntry[] {
    return [...this.entries];
  }

  /** Get decisions by type */
  getByType(type: DecisionType): DecisionEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  /** Get all data gap decisions (missing data) */
  getDataGaps(): DecisionEntry[] {
    return this.entries.filter((e) => e.type === 'DATA_MISSING');
  }

  /** Get all infeasibility declarations */
  getInfeasibilities(): DecisionEntry[] {
    return this.entries.filter((e) => e.type === 'INFEASIBILITY_DECLARED');
  }

  /** Get load leveling moves */
  getLevelingMoves(): DecisionEntry[] {
    return this.entries.filter((e) => e.type === 'LOAD_LEVEL');
  }

  /** Get backward scheduling decisions */
  getBackwardSchedules(): DecisionEntry[] {
    return this.entries.filter((e) => e.type === 'BACKWARD_SCHEDULE');
  }

  /** Get operator reallocation decisions */
  getOperatorReallocations(): DecisionEntry[] {
    return this.entries.filter((e) => e.type === 'OPERATOR_REALLOCATION');
  }

  /** Get advance production decisions */
  getAdvanceProductions(): DecisionEntry[] {
    return this.entries.filter((e) => e.type === 'ADVANCE_PRODUCTION');
  }

  /** Get operator capacity warning decisions */
  getOperatorCapacityWarnings(): DecisionEntry[] {
    return this.entries.filter((e) => e.type === 'OPERATOR_CAPACITY_WARNING');
  }

  /** Get summary counts (single-pass) */
  getSummary(): DecisionSummary {
    const c = new Map<DecisionType, number>();
    for (const e of this.entries) c.set(e.type, (c.get(e.type) ?? 0) + 1);
    return {
      total: this.entries.length,
      dataMissing: c.get('DATA_MISSING') ?? 0,
      infeasibilities: c.get('INFEASIBILITY_DECLARED') ?? 0,
      loadLevelMoves: c.get('LOAD_LEVEL') ?? 0,
      overflowRoutes: c.get('OVERFLOW_ROUTE') ?? 0,
      advanceProductions: c.get('ADVANCE_PRODUCTION') ?? 0,
      backwardSchedules: c.get('BACKWARD_SCHEDULE') ?? 0,
      deadlineConstraints: c.get('DEADLINE_CONSTRAINT') ?? 0,
      operatorReallocations: c.get('OPERATOR_REALLOCATION') ?? 0,
      failureDetected: c.get('FAILURE_DETECTED') ?? 0,
      failureMitigations: c.get('FAILURE_MITIGATION') ?? 0,
      failureUnrecoverable: c.get('FAILURE_UNRECOVERABLE') ?? 0,
      shippingCutoffs: c.get('SHIPPING_CUTOFF') ?? 0,
      productionStarts: c.get('PRODUCTION_START') ?? 0,
      capacityComputations: c.get('CAPACITY_COMPUTATION') ?? 0,
      scoringDecisions: c.get('SCORING_DECISION') ?? 0,
      operatorCapacityWarnings: c.get('OPERATOR_CAPACITY_WARNING') ?? 0,
      autoReplanAdvance: c.get('AUTO_REPLAN_ADVANCE') ?? 0,
      autoReplanMove: c.get('AUTO_REPLAN_MOVE') ?? 0,
      autoReplanSplit: c.get('AUTO_REPLAN_SPLIT') ?? 0,
      autoReplanOvertime: c.get('AUTO_REPLAN_OVERTIME') ?? 0,
      autoReplanThirdShift: c.get('AUTO_REPLAN_THIRD_SHIFT') ?? 0,
      autoReplanTotal:
        (c.get('AUTO_REPLAN_ADVANCE') ?? 0) +
        (c.get('AUTO_REPLAN_MOVE') ?? 0) +
        (c.get('AUTO_REPLAN_SPLIT') ?? 0) +
        (c.get('AUTO_REPLAN_OVERTIME') ?? 0) +
        (c.get('AUTO_REPLAN_THIRD_SHIFT') ?? 0),
      twinValidationAnomalies: c.get('TWIN_VALIDATION_ANOMALY') ?? 0,
      workforceForecastD1: c.get('WORKFORCE_FORECAST_D1') ?? 0,
      workforceCoverageMissing: c.get('WORKFORCE_COVERAGE_MISSING') ?? 0,
    };
  }

  /** Get all auto-replan decisions */
  getAutoReplanDecisions(): DecisionEntry[] {
    return this.entries.filter(
      (e) =>
        e.type === 'AUTO_REPLAN_ADVANCE' ||
        e.type === 'AUTO_REPLAN_MOVE' ||
        e.type === 'AUTO_REPLAN_SPLIT' ||
        e.type === 'AUTO_REPLAN_OVERTIME' ||
        e.type === 'AUTO_REPLAN_THIRD_SHIFT',
    );
  }

  /** Get twin validation anomaly decisions */
  getTwinValidationAnomalies(): DecisionEntry[] {
    return this.entries.filter((e) => e.type === 'TWIN_VALIDATION_ANOMALY');
  }

  /** Get D+1 workforce forecast warnings */
  getWorkforceForecastWarnings(): DecisionEntry[] {
    return this.entries.filter(
      (e) => e.type === 'WORKFORCE_FORECAST_D1' || e.type === 'WORKFORCE_COVERAGE_MISSING',
    );
  }

  /** Get failure-related decisions */
  getFailureDecisions(): DecisionEntry[] {
    return this.entries.filter(
      (e) =>
        e.type === 'FAILURE_DETECTED' ||
        e.type === 'FAILURE_MITIGATION' ||
        e.type === 'FAILURE_UNRECOVERABLE',
    );
  }

  /** Reset the registry (for new scheduling run) */
  clear(): void {
    this.entries = [];
    this.idCounter = 0;
  }

  /** Number of decisions recorded */
  get size(): number {
    return this.entries.length;
  }
}
