/**
 * useClassifications — Pre-computes L2/L3/L4 classification results for all operations.
 *
 * Runs once per schedule computation + config change.
 * Returns Maps keyed by opId for O(1) lookup at render time.
 * ~700 ops × 10 expressions = ~7000 evaluations (<5ms).
 */

import { useMemo } from 'react';
import type { RuleAction } from '../stores/settings-types';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  blockKey,
  buildOpVars,
  buildRuleContext,
  evaluateDefinition,
  evaluateFormula,
  evaluateRule,
} from '../domain/configurable-logic-eval';
import { useScheduleData } from './useScheduleData';

export interface ClassificationResults {
  /** opId → Set of definition IDs that match */
  opDefinitions: Map<string, Set<string>>;
  /** blockKey (opId-dayIdx) → Set of definition IDs that match */
  blockDefinitions: Map<string, Set<string>>;
  /** Aggregate counts per definition ID */
  definitionCounts: Record<string, number>;
  /** opId → formula results { formulaId: number } */
  opFormulas: Map<string, Record<string, number>>;
  /** opId → matched rule actions */
  opRuleActions: Map<string, RuleAction[]>;
}

const EMPTY: ClassificationResults = {
  opDefinitions: new Map(),
  blockDefinitions: new Map(),
  definitionCounts: {},
  opFormulas: new Map(),
  opRuleActions: new Map(),
};

export function useClassifications(): ClassificationResults {
  const definitions = useSettingsStore((s) => s.definitions);
  const formulas = useSettingsStore((s) => s.formulas);
  const rules = useSettingsStore((s) => s.rules);
  const clientTiers = useSettingsStore((s) => s.clientTiers);
  const { engine, blocks } = useScheduleData();

  return useMemo(() => {
    if (!engine || !blocks || blocks.length === 0) return EMPTY;

    const opDefs = new Map<string, Set<string>>();
    const blkDefs = new Map<string, Set<string>>();
    const defCounts: Record<string, number> = {};
    const opFormResults = new Map<string, Record<string, number>>();
    const opRuleActs = new Map<string, RuleAction[]>();

    // Initialize counts
    for (const def of definitions) defCounts[def.id] = 0;

    // Evaluate per operation (definitions + formulas + rules)
    for (const op of engine.ops) {
      const vars = buildOpVars(op, engine, clientTiers);

      // L4: Definitions
      const matchedDefs = new Set<string>();
      for (const def of definitions) {
        if (evaluateDefinition(def, vars)) {
          matchedDefs.add(def.id);
          defCounts[def.id]++;
        }
      }
      if (matchedDefs.size > 0) opDefs.set(op.id, matchedDefs);

      // L3: Formulas
      const formulaResults: Record<string, number> = {};
      for (const formula of formulas) {
        formulaResults[formula.id] = evaluateFormula(formula, vars);
      }
      opFormResults.set(op.id, formulaResults);

      // L2: Rules
      const activeRules = rules.filter((r) => r.active);
      if (activeRules.length > 0) {
        const ctx = buildRuleContext(op, engine, clientTiers);
        const actions: RuleAction[] = [];
        for (const rule of activeRules) {
          if (evaluateRule(rule.query, ctx)) {
            actions.push(rule.action);
          }
        }
        if (actions.length > 0) opRuleActs.set(op.id, actions);
      }
    }

    // Propagate op-level definitions to block level
    for (const b of blocks) {
      const defs = opDefs.get(b.opId);
      if (defs) blkDefs.set(blockKey(b), defs);
    }

    return {
      opDefinitions: opDefs,
      blockDefinitions: blkDefs,
      definitionCounts: defCounts,
      opFormulas: opFormResults,
      opRuleActions: opRuleActs,
    };
  }, [engine, blocks, definitions, formulas, rules, clientTiers]);
}
