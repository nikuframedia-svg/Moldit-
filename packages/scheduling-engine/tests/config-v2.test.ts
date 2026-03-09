// Tests for Config Schema v2 (L2-L6 levels) + INCOMPOL_STANDARD
// Conforme Contrato C5

import { describe, expect, it } from 'vitest';
import type { SchedulingConfig } from '../src/config/scheduling-config.js';
import {
  DEFAULT_SCHEDULING_CONFIG,
  migrateConfig,
  POLICY_BALANCED,
  POLICY_INCOMPOL_STANDARD,
  POLICY_MAX_OTD,
  POLICY_MIN_SETUPS,
  POLICY_URGENT,
  SchedulingConfigSchema,
  validateConfig,
} from '../src/config/scheduling-config.js';

describe('Config Schema v2', () => {
  it('v1 config still parses without L2-L6 fields', () => {
    const v1 = {
      version: 2,
      weights: { otd: 0.7, setup: 0.2, utilization: 0.1 },
      dispatchRule: 'ATCS',
      direction: 'forward',
      frozenHorizonDays: 5,
      lotEconomicoMode: 'relaxed',
      emergencyNightShift: false,
      saIterations: 10_000,
    };
    const result = SchedulingConfigSchema.parse(v1);
    expect(result.version).toBe(2);
    expect(result.l2Rules).toBeUndefined();
    expect(result.l3Formulas).toBeUndefined();
    expect(result.l4Definitions).toBeUndefined();
    expect(result.l5Governance).toBeUndefined();
    expect(result.l6Strategy).toBeUndefined();
  });

  it('v2 config with L2 rules parses', () => {
    const config = SchedulingConfigSchema.parse({
      l2Rules: {
        rules: [
          { field: 'tardiness', operator: '>', value: 100, action: 'switch_dispatch:EDD' },
          { field: 'utilization', operator: '<', value: 0.5, action: 'enable_overtime' },
        ],
      },
    });
    expect(config.l2Rules!.rules).toHaveLength(2);
    expect(config.l2Rules!.rules[0].field).toBe('tardiness');
    expect(config.l2Rules!.rules[0].operator).toBe('>');
  });

  it('v2 config with L3 formulas parses', () => {
    const config = SchedulingConfigSchema.parse({
      l3Formulas: {
        formulas: [
          {
            name: 'urgency',
            expression: 'weight / prodTime * exp(-slack / avgProd)',
            variables: ['weight', 'prodTime', 'slack', 'avgProd'],
          },
        ],
      },
    });
    expect(config.l3Formulas!.formulas).toHaveLength(1);
    expect(config.l3Formulas!.formulas[0].name).toBe('urgency');
  });

  it('v2 config with L4 definitions parses', () => {
    const config = SchedulingConfigSchema.parse({
      l4Definitions: {
        definitions: [
          { name: 'atrasado', formula: 'end_min > due_date_min', threshold: 0 },
          { name: 'urgente', formula: 'slack < 120' },
        ],
      },
    });
    expect(config.l4Definitions!.definitions).toHaveLength(2);
    expect(config.l4Definitions!.definitions[0].name).toBe('atrasado');
    expect(config.l4Definitions!.definitions[1].threshold).toBeUndefined();
  });

  it('v2 config with L5 governance parses', () => {
    const config = SchedulingConfigSchema.parse({
      l5Governance: {
        defaultLevel: 'L2',
        approvalRules: [{ action: 'edit_plan_frozen', requiredLevel: 'L4', approvers: ['admin'] }],
      },
    });
    expect(config.l5Governance!.defaultLevel).toBe('L2');
    expect(config.l5Governance!.approvalRules).toHaveLength(1);
    expect(config.l5Governance!.approvalRules[0].approvers).toEqual(['admin']);
  });

  it('v2 config with L6 strategy parses', () => {
    const config = SchedulingConfigSchema.parse({
      l6Strategy: {
        steps: [
          { dispatchRule: 'EDD', maxIterations: 3 },
          { dispatchRule: 'ATCS', condition: 'tardiness > 50', maxIterations: 1 },
        ],
        fallbackRule: 'CR',
      },
    });
    expect(config.l6Strategy!.steps).toHaveLength(2);
    expect(config.l6Strategy!.fallbackRule).toBe('CR');
  });

  it('v2 full config with all levels parses', () => {
    const config = SchedulingConfigSchema.parse({
      l2Rules: { rules: [{ field: 'x', operator: '>', value: 1, action: 'a' }] },
      l3Formulas: { formulas: [{ name: 'f', expression: 'x+1' }] },
      l4Definitions: { definitions: [{ name: 'd', formula: 'x>0' }] },
      l5Governance: { defaultLevel: 'L3', approvalRules: [] },
      l6Strategy: { steps: [{ dispatchRule: 'SPT' }], fallbackRule: 'EDD' },
    });
    expect(config.l2Rules).toBeDefined();
    expect(config.l3Formulas).toBeDefined();
    expect(config.l4Definitions).toBeDefined();
    expect(config.l5Governance).toBeDefined();
    expect(config.l6Strategy).toBeDefined();
  });

  it('migrateConfig v1 → v2 preserves all v1 fields', () => {
    const v1Config = {
      version: 1,
      weights: { otd: 0.8, setup: 0.15, utilization: 0.05 },
      dispatchRule: 'EDD',
      direction: 'forward',
      frozenHorizonDays: 3,
      lotEconomicoMode: 'strict',
      emergencyNightShift: true,
      saIterations: 5000,
    };
    const migrated = migrateConfig(v1Config, 1);
    expect(migrated.version).toBe(2);
    expect(migrated.dispatchRule).toBe('EDD');
    expect(migrated.frozenHorizonDays).toBe(3);
    expect(migrated.emergencyNightShift).toBe(true);
    expect(migrated.saIterations).toBe(5000);
  });

  it('invalid L2 rule operator rejects', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        l2Rules: {
          rules: [{ field: 'x', operator: 'LIKE', value: 1, action: 'a' }],
        },
      }),
    ).toThrow();
  });

  it('L5 governance invalid level rejects', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        l5Governance: { defaultLevel: 'L99' },
      }),
    ).toThrow();
  });

  it('validateConfig with empty object returns defaults', () => {
    const config = validateConfig({});
    expect(config.version).toBe(2);
    expect(config.dispatchRule).toBe('ATCS');
    expect(config.weights.otd).toBeCloseTo(0.7);
    expect(config.l2Rules).toBeUndefined();
  });

  it('default config version is 2', () => {
    expect(DEFAULT_SCHEDULING_CONFIG.version).toBe(2);
  });
});

describe('POLICY_INCOMPOL_STANDARD', () => {
  it('validates against schema', () => {
    const config = SchedulingConfigSchema.parse(POLICY_INCOMPOL_STANDARD);
    expect(config.dispatchRule).toBe('ATCS');
    expect(config.weights.otd).toBeCloseTo(0.7);
    expect(config.frozenHorizonDays).toBe(5);
    expect(config.emergencyNightShift).toBe(false);
  });

  it('includes L5 governance rules', () => {
    expect(POLICY_INCOMPOL_STANDARD.l5Governance).toBeDefined();
    expect(POLICY_INCOMPOL_STANDARD.l5Governance!.defaultLevel).toBe('L1');
    expect(POLICY_INCOMPOL_STANDARD.l5Governance!.approvalRules).toHaveLength(4);
  });

  it('has all 4 constraint modes as hard', () => {
    expect(POLICY_INCOMPOL_STANDARD.constraints!.setupCrew.mode).toBe('hard');
    expect(POLICY_INCOMPOL_STANDARD.constraints!.toolTimeline.mode).toBe('hard');
    expect(POLICY_INCOMPOL_STANDARD.constraints!.calcoTimeline.mode).toBe('hard');
    expect(POLICY_INCOMPOL_STANDARD.constraints!.operatorPool.mode).toBe('hard');
  });
});

describe('Existing policies still valid with v2 schema', () => {
  it('POLICY_MAX_OTD validates', () => {
    expect(() => SchedulingConfigSchema.parse(POLICY_MAX_OTD)).not.toThrow();
  });

  it('POLICY_MIN_SETUPS validates', () => {
    expect(() => SchedulingConfigSchema.parse(POLICY_MIN_SETUPS)).not.toThrow();
  });

  it('POLICY_BALANCED validates', () => {
    expect(() => SchedulingConfigSchema.parse(POLICY_BALANCED)).not.toThrow();
  });

  it('POLICY_URGENT validates', () => {
    expect(() => SchedulingConfigSchema.parse(POLICY_URGENT)).not.toThrow();
  });
});
