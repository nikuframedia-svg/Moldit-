/**
 * settings-defaults.ts — Default values for L2 (Rules), L3 (Formulas), L4 (Definitions).
 *
 * Single source of truth for initial configurable logic state.
 * Imported by useSettingsStore (initial state) and settings pages (reset-to-defaults).
 */

import type { ConceptDefinition, FormulaConfig, RuleConfig } from './settings-types';

export const DEFAULT_DEFINITIONS: ConceptDefinition[] = [
  {
    id: 'atrasado',
    question: 'O que significa ATRASADO nesta fábrica?',
    label: 'Atrasado',
    expression: 'completionDay > deadline + toleranceHours / 17',
    variables: ['completionDay', 'deadline', 'toleranceHours', 'clientTier'],
    version: 1,
    versions: [],
  },
  {
    id: 'urgente',
    question: 'O que significa URGENTE?',
    label: 'Urgente',
    expression: 'slackHours < 24 and clientTier <= 2',
    variables: ['slackHours', 'clientTier', 'demandTotal', 'stock'],
    version: 1,
    versions: [],
  },
  {
    id: 'turno_noite',
    question: 'Quando é necessário TURNO NOITE?',
    label: 'Turno Noite',
    expression: 'load2Shifts > capacity2Shifts * 0.95',
    variables: ['load2Shifts', 'capacity2Shifts', 'pendingOrders'],
    version: 1,
    versions: [],
  },
  {
    id: 'robusto',
    question: 'Quando é que o plano é ROBUSTO?',
    label: 'Robusto',
    expression: 'stressTestOTD > 0.85 and stressTestCascade < 3',
    variables: ['stressTestOTD', 'stressTestCascade', 'bufferHours', 'violations'],
    version: 1,
    versions: [],
  },
];

export const DEFAULT_FORMULAS: FormulaConfig[] = [
  {
    id: 'priorityScoring',
    label: 'Priority Scoring',
    description: 'Cálculo de prioridade de cada job no dispatch ATCS',
    expression: '(clientTier * 10 + demandTotal / piecesPerHour) / (slack + 1)',
    variables: ['slack', 'setup', 'clientTier', 'demandTotal', 'piecesPerHour', 'stock', 'wip'],
    version: 1,
    versions: [],
  },
  {
    id: 'deviationCost',
    label: 'Custo de Desvio',
    description: 'Cálculo do custo de cada desvio no Decision Firewall',
    expression: 'deviationHours * multiplier * (6 - clientTier)',
    variables: ['deviationHours', 'clientTier', 'multiplier', 'originalPriority'],
    version: 1,
    versions: [],
  },
  {
    id: 'nightShiftTrigger',
    label: 'Trigger Turno Noite',
    description: 'Condição para sinalizar necessidade de turno noite',
    expression: 'load2Shifts / (capacity2Shifts + 1) * 100',
    variables: ['load2Shifts', 'capacity2Shifts', 'pendingOrders', 'avgSlack'],
    version: 1,
    versions: [],
  },
  {
    id: 'robustnessScore',
    label: 'Score de Robustez',
    description: 'Avaliação de robustez do plano (0-100)',
    expression: 'otdScore * 50 + (10 - cascadeRisk) * 3 + bufferHours / 10',
    variables: ['otdScore', 'cascadeRisk', 'bufferHours', 'violations'],
    version: 1,
    versions: [],
  },
];

export const DEFAULT_RULES: RuleConfig[] = [
  {
    id: 'r1',
    name: 'Clientes Tier 1 → CRITICAL',
    active: true,
    query: { combinator: 'and', rules: [{ field: 'cliente.tier', operator: '=', value: '1' }] },
    action: { type: 'set_priority', value: 'CRITICAL' },
    version: 1,
    versions: [],
  },
  {
    id: 'r2',
    name: 'Slack < 24h + Tier ≤ 2 → Alerta',
    active: true,
    query: {
      combinator: 'and',
      rules: [
        { field: 'slack_hours', operator: '<', value: '24' },
        { field: 'cliente.tier', operator: '<=', value: '2' },
      ],
    },
    action: { type: 'alert', value: 'Operação urgente - verificar capacidade' },
    version: 1,
    versions: [],
  },
];
