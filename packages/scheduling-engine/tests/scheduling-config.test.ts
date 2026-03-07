import { describe, expect, it } from 'vitest';
import type { SchedulingConfig } from '../src/config/scheduling-config.js';
import {
  DEFAULT_SCHEDULING_CONFIG,
  migrateConfig,
  POLICY_BALANCED,
  POLICY_MAX_OTD,
  POLICY_MIN_SETUPS,
  POLICY_URGENT,
  SchedulingConfigSchema,
  validateConfig,
} from '../src/config/scheduling-config.js';
import type { SchedulingContext, ScoringJob } from '../src/config/strategy.js';
import {
  BalancedStrategy,
  MaxOTDStrategy,
  MinSetupsStrategy,
  strategyFromConfig,
  WeightedCompositeStrategy,
} from '../src/config/strategy.js';

// ── Fixtures ─────────────────────────────────────────────

function makeJob(overrides: Partial<ScoringJob> = {}): ScoringJob {
  return {
    opId: 'OP1',
    toolId: 'T1',
    prodMin: 120,
    setupMin: 60,
    eddDay: 3,
    machineId: 'M1',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<SchedulingContext> = {}): SchedulingContext {
  return {
    currentDay: 0,
    nDays: 5,
    avgProdMin: 100,
    avgSetupMin: 50,
    previousToolId: null,
    machineUtil: 0.5,
    ...overrides,
  };
}

// ── Schema Validation ───────────────────────────────────

describe('SchedulingConfigSchema', () => {
  it('parses empty object with defaults', () => {
    const config = SchedulingConfigSchema.parse({});
    expect(config.version).toBe(1);
    expect(config.weights.otd).toBe(0.7);
    expect(config.weights.setup).toBe(0.2);
    expect(config.weights.utilization).toBe(0.1);
    expect(config.dispatchRule).toBe('ATCS');
    expect(config.direction).toBe('forward');
    expect(config.frozenHorizonDays).toBe(5);
    expect(config.lotEconomicoMode).toBe('relaxed');
    expect(config.emergencyNightShift).toBe(false);
    expect(config.saIterations).toBe(10_000);
  });

  it('accepts valid custom config', () => {
    const config = SchedulingConfigSchema.parse({
      weights: { otd: 0.5, setup: 0.3, utilization: 0.2 },
      dispatchRule: 'EDD',
      direction: 'backward',
      frozenHorizonDays: 3,
      lotEconomicoMode: 'strict',
      emergencyNightShift: true,
      saIterations: 5000,
    });
    expect(config.weights.otd).toBe(0.5);
    expect(config.dispatchRule).toBe('EDD');
    expect(config.direction).toBe('backward');
    expect(config.emergencyNightShift).toBe(true);
  });

  it('rejects weights that do not sum to 1', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        weights: { otd: 0.5, setup: 0.5, utilization: 0.5 },
      }),
    ).toThrow();
  });

  it('rejects negative weights', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        weights: { otd: -0.1, setup: 0.6, utilization: 0.5 },
      }),
    ).toThrow();
  });

  it('rejects weights > 1', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        weights: { otd: 1.5, setup: -0.3, utilization: -0.2 },
      }),
    ).toThrow();
  });

  it('rejects invalid dispatch rule', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        dispatchRule: 'INVALID',
      }),
    ).toThrow();
  });

  it('rejects invalid constraint mode', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        constraints: { setupCrew: { mode: 'soft' } },
      }),
    ).toThrow();
  });

  it('rejects frozenHorizonDays > 30', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        frozenHorizonDays: 50,
      }),
    ).toThrow();
  });

  it('rejects negative saIterations', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        saIterations: -1,
      }),
    ).toThrow();
  });

  it('accepts ATCS params', () => {
    const config = SchedulingConfigSchema.parse({
      atcsParams: { k1: 1.5, k2: 0.5 },
    });
    expect(config.atcsParams?.k1).toBe(1.5);
    expect(config.atcsParams?.k2).toBe(0.5);
  });

  it('rejects out-of-range ATCS params', () => {
    expect(() =>
      SchedulingConfigSchema.parse({
        atcsParams: { k1: 0, k2: 0.5 },
      }),
    ).toThrow();
  });
});

describe('validateConfig', () => {
  it('returns valid config from partial input', () => {
    const config = validateConfig({ dispatchRule: 'CR' });
    expect(config.dispatchRule).toBe('CR');
    expect(config.weights.otd).toBe(0.7); // default
  });

  it('throws on invalid input', () => {
    expect(() => validateConfig({ weights: { otd: 2 } })).toThrow();
  });
});

describe('migrateConfig', () => {
  it('returns defaults for pre-v1 / invalid input', () => {
    const config = migrateConfig(null, 0);
    expect(config).toEqual(DEFAULT_SCHEDULING_CONFIG);
  });

  it('migrates v1 config by parsing', () => {
    const config = migrateConfig({ dispatchRule: 'SPT' }, 1);
    expect(config.dispatchRule).toBe('SPT');
  });

  it('handles future version gracefully', () => {
    const config = migrateConfig({ dispatchRule: 'EDD' }, 99);
    expect(config.dispatchRule).toBe('EDD');
  });
});

describe('Policy presets', () => {
  it('POLICY_MAX_OTD weights sum to 1', () => {
    const w = POLICY_MAX_OTD.weights!;
    expect(w.otd + w.setup + w.utilization).toBeCloseTo(1);
  });

  it('POLICY_MIN_SETUPS weights sum to 1', () => {
    const w = POLICY_MIN_SETUPS.weights!;
    expect(w.otd + w.setup + w.utilization).toBeCloseTo(1);
  });

  it('POLICY_BALANCED weights sum to 1', () => {
    const w = POLICY_BALANCED.weights!;
    expect(w.otd + w.setup + w.utilization).toBeCloseTo(1);
  });

  it('POLICY_URGENT weights sum to 1', () => {
    const w = POLICY_URGENT.weights!;
    expect(w.otd + w.setup + w.utilization).toBeCloseTo(1);
  });

  it('all presets validate as configs', () => {
    for (const preset of [POLICY_MAX_OTD, POLICY_MIN_SETUPS, POLICY_BALANCED, POLICY_URGENT]) {
      expect(() => SchedulingConfigSchema.parse(preset)).not.toThrow();
    }
  });
});

// ── Strategy Tests ──────────────────────────────────────

describe('MaxOTDStrategy', () => {
  const strategy = new MaxOTDStrategy();

  it('gives max priority to overdue jobs', () => {
    const job = makeJob({ eddDay: 0, prodMin: 100 });
    const ctx = makeCtx({ currentDay: 1 });
    expect(strategy.score(job, ctx)).toBe(1000);
  });

  it('gives higher priority to jobs closer to deadline', () => {
    const ctx = makeCtx({ currentDay: 0 });
    const urgent = strategy.score(makeJob({ eddDay: 1 }), ctx);
    const relaxed = strategy.score(makeJob({ eddDay: 4 }), ctx);
    expect(urgent).toBeGreaterThan(relaxed);
  });
});

describe('MinSetupsStrategy', () => {
  const strategy = new MinSetupsStrategy();

  it('gives max score when same tool', () => {
    const job = makeJob({ toolId: 'T1' });
    const ctx = makeCtx({ previousToolId: 'T1' });
    expect(strategy.score(job, ctx)).toBe(100);
  });

  it('gives lower score for different tool', () => {
    const job = makeJob({ toolId: 'T2', setupMin: 60 });
    const ctx = makeCtx({ previousToolId: 'T1', avgSetupMin: 60 });
    expect(strategy.score(job, ctx)).toBeLessThan(100);
  });

  it('gives neutral score when no previous tool', () => {
    const job = makeJob();
    const ctx = makeCtx({ previousToolId: null });
    expect(strategy.score(job, ctx)).toBe(50);
  });
});

describe('BalancedStrategy', () => {
  const strategy = new BalancedStrategy();

  it('returns positive score', () => {
    const score = strategy.score(makeJob(), makeCtx());
    expect(score).toBeGreaterThan(0);
  });

  it('favours urgent jobs over relaxed jobs', () => {
    const ctx = makeCtx({ currentDay: 0 });
    const urgent = strategy.score(makeJob({ eddDay: 1 }), ctx);
    const relaxed = strategy.score(makeJob({ eddDay: 4 }), ctx);
    expect(urgent).toBeGreaterThan(relaxed);
  });

  it('favours same-tool jobs', () => {
    const ctx = makeCtx({ previousToolId: 'T1' });
    const sameTool = strategy.score(makeJob({ toolId: 'T1' }), ctx);
    const diffTool = strategy.score(makeJob({ toolId: 'T2', setupMin: 60 }), ctx);
    expect(sameTool).toBeGreaterThan(diffTool);
  });
});

describe('WeightedCompositeStrategy', () => {
  it('combines two strategies', () => {
    const composite = new WeightedCompositeStrategy([
      { strategy: new MaxOTDStrategy(), weight: 0.7 },
      { strategy: new MinSetupsStrategy(), weight: 0.3 },
    ]);

    const score = composite.score(makeJob(), makeCtx());
    expect(score).toBeGreaterThan(0);
  });

  it('weight=0 eliminates a strategy contribution', () => {
    const onlyOTD = new WeightedCompositeStrategy([
      { strategy: new MaxOTDStrategy(), weight: 1.0 },
      { strategy: new MinSetupsStrategy(), weight: 0 },
    ]);
    const pureOTD = new MaxOTDStrategy();

    const job = makeJob();
    const ctx = makeCtx();
    expect(onlyOTD.score(job, ctx)).toBeCloseTo(pureOTD.score(job, ctx));
  });
});

describe('strategyFromConfig', () => {
  it('returns MaxOTDStrategy for high OTD weight', () => {
    const config = validateConfig({
      weights: { otd: 0.9, setup: 0.05, utilization: 0.05 },
    });
    const strategy = strategyFromConfig(config);
    expect(strategy.name).toBe('MaxOTD');
  });

  it('returns MinSetupsStrategy for high setup weight', () => {
    const config = validateConfig({
      weights: { otd: 0.1, setup: 0.8, utilization: 0.1 },
    });
    const strategy = strategyFromConfig(config);
    expect(strategy.name).toBe('MinSetups');
  });

  it('returns WeightedComposite for balanced weights', () => {
    const config = validateConfig({
      weights: { otd: 0.5, setup: 0.3, utilization: 0.2 },
    });
    const strategy = strategyFromConfig(config);
    expect(strategy.name).toBe('WeightedComposite');
  });
});
