// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- Shipping Cutoff Tests
//
//  Verifies computeShippingDeadlines correctly computes latest finish
//  times from shipping day, buffer, and shift boundaries.
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { S1 } from '../src/constants.js';
import { DecisionRegistry } from '../src/decisions/decision-registry.js';
import { computeShippingDeadlines } from '../src/scheduler/shipping-cutoff.js';
import type { EOp } from '../src/types/engine.js';
import type { ShippingCutoffConfig } from '../src/types/shipping.js';

// Helper: create a minimal EOp for testing
function mkOp(id: string, sku: string, d: number[], atr = 0): EOp {
  return {
    id,
    t: 'T01',
    m: 'M01',
    sku,
    nm: sku,
    atr,
    d,
  };
}

const allWorkdays = (n: number) => new Array(n).fill(true);

describe('computeShippingDeadlines', () => {
  const defaultConfig: ShippingCutoffConfig = { defaultBufferHours: 0 };

  it('computes deadline for simple 8-day operation', () => {
    // Demand on day 5 (last day with demand)
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 100, 0, 0, 200, 0, 0])];
    const result = computeShippingDeadlines(ops, allWorkdays(8), 8, defaultConfig);

    expect(result.size).toBe(1);
    const dl = result.get('OP01')!;
    expect(dl.shippingDayIdx).toBe(5);
    expect(dl.bufferHours).toBe(0);
    expect(dl.bufferSource).toBe('default');
    // latestFinishAbs = (5 * 1440 + 1440) - 0 = 8640 (end of day 5 = 24:00)
    expect(dl.latestFinishAbs).toBe(5 * 1440 + S1);
    expect(dl.latestFinishDay).toBe(Math.floor(dl.latestFinishAbs / 1440));
    expect(dl.latestFinishMin).toBe(dl.latestFinishAbs % 1440);
    // All 8 days are workdays, latestFinishDay=6 → 7 workdays available (days 0-6)
    expect(dl.availableWorkdays).toBe(7);
    expect(dl.shippingDayIsWorkday).toBe(true);
  });

  it('uses SKU override buffer when available', () => {
    const ops = [mkOp('OP01', 'SKU01', [100, 0, 0])];
    const config: ShippingCutoffConfig = {
      defaultBufferHours: 24,
      skuOverrides: { SKU01: 48 },
    };
    const result = computeShippingDeadlines(ops, allWorkdays(3), 3, config);
    const dl = result.get('OP01')!;
    expect(dl.bufferHours).toBe(48);
    expect(dl.bufferSource).toBe('sku');
    // latestFinishAbs = (0 * 1440 + 1440) - (48 * 60) = 1440 - 2880 = max(0, -1440) = 0
    expect(dl.latestFinishAbs).toBe(0);
  });

  it('uses order override buffer (takes precedence over SKU)', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 100])];
    const config: ShippingCutoffConfig = {
      defaultBufferHours: 24,
      skuOverrides: { SKU01: 48 },
      orderOverrides: { OP01: 12 },
    };
    const result = computeShippingDeadlines(ops, allWorkdays(3), 3, config);
    const dl = result.get('OP01')!;
    expect(dl.bufferHours).toBe(12);
    expect(dl.bufferSource).toBe('order');
  });

  it('handles backlog-only operation (shipping day = 0)', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 0], 5000)];
    const result = computeShippingDeadlines(ops, allWorkdays(3), 3, defaultConfig);
    const dl = result.get('OP01')!;
    expect(dl.shippingDayIdx).toBe(0);
    // latestFinishAbs = (0 * 1440 + 1440) - 0 = 1440 (end of day 0 = 24:00)
    expect(dl.latestFinishAbs).toBe(S1);
  });

  it('skips operations with no demand and no backlog', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 0], 0)];
    const result = computeShippingDeadlines(ops, allWorkdays(3), 3, defaultConfig);
    expect(result.size).toBe(0);
  });

  it('handles demand on the last day of horizon', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 0, 0, 0, 0, 0, 500])];
    const result = computeShippingDeadlines(ops, allWorkdays(8), 8, defaultConfig);
    const dl = result.get('OP01')!;
    expect(dl.shippingDayIdx).toBe(7);
    // latestFinishAbs = (7 * 1440 + 1440) - 0 = 11520 (end of day 7 = 24:00)
    expect(dl.latestFinishAbs).toBe(7 * 1440 + S1);
  });

  it('handles zero buffer (production can run until shipping moment)', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 100])];
    const config: ShippingCutoffConfig = { defaultBufferHours: 0 };
    const result = computeShippingDeadlines(ops, allWorkdays(3), 3, config);
    const dl = result.get('OP01')!;
    expect(dl.bufferHours).toBe(0);
    // latestFinishAbs = (2 * 1440 + 1440) - 0 = 4320
    expect(dl.latestFinishAbs).toBe(2 * 1440 + S1);
  });

  it('clamps latestFinishAbs to 0 when buffer exceeds available time', () => {
    const ops = [mkOp('OP01', 'SKU01', [100])];
    const config: ShippingCutoffConfig = { defaultBufferHours: 48 };
    const result = computeShippingDeadlines(ops, allWorkdays(1), 1, config);
    const dl = result.get('OP01')!;
    // latestFinishAbs = (0 * 1440 + 1440) - (48 * 60) = 1440 - 2880 = -1440 → clamped to 0
    expect(dl.latestFinishAbs).toBe(0);
  });

  it('processes multiple operations independently', () => {
    const ops = [mkOp('OP01', 'SKU01', [100, 0, 0, 0]), mkOp('OP02', 'SKU02', [0, 0, 0, 200])];
    const result = computeShippingDeadlines(ops, allWorkdays(4), 4, defaultConfig);
    expect(result.size).toBe(2);

    const dl1 = result.get('OP01')!;
    const dl2 = result.get('OP02')!;
    expect(dl1.shippingDayIdx).toBe(0);
    expect(dl2.shippingDayIdx).toBe(3);
    expect(dl2.latestFinishAbs).toBeGreaterThan(dl1.latestFinishAbs);
  });

  it('records decisions in the registry', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 100])];
    const registry = new DecisionRegistry();
    computeShippingDeadlines(ops, allWorkdays(2), 2, defaultConfig, registry);

    const decisions = registry.getByType('SHIPPING_CUTOFF');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].opId).toBe('OP01');
    expect(decisions[0].metadata).toMatchObject({
      shippingDayIdx: 1,
      bufferHours: 0,
      bufferSource: 'default',
    });
  });

  it('changing buffer from 24 to 48 moves deadline back 24h (1440 min)', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 0, 0, 500])];
    const nDays = 5;
    const workdays = allWorkdays(nDays);

    const result24 = computeShippingDeadlines(ops, workdays, nDays, { defaultBufferHours: 24 });
    const result48 = computeShippingDeadlines(ops, workdays, nDays, { defaultBufferHours: 48 });

    const dl24 = result24.get('OP01')!;
    const dl48 = result48.get('OP01')!;

    // 48h buffer pushes deadline back 24h (1440 min) relative to 24h buffer
    expect(dl24.latestFinishAbs - dl48.latestFinishAbs).toBe(24 * 60);
  });

  it('uses op.shippingBufferHours when set (per-operation buffer)', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 0, 0, 100])];
    ops[0].shippingBufferHours = 12;
    const result = computeShippingDeadlines(ops, allWorkdays(5), 5, defaultConfig);
    const dl = result.get('OP01')!;
    expect(dl.bufferHours).toBe(12);
    expect(dl.bufferSource).toBe('operation');
    // latestFinishAbs = (4 * 1440 + 1440) - (12 * 60) = 7200 - 720 = 6480
    expect(dl.latestFinishAbs).toBe(4 * 1440 + S1 - 12 * 60);
  });

  it('op.shippingBufferHours overrides SKU override', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 100])];
    ops[0].shippingBufferHours = 6;
    const config: ShippingCutoffConfig = {
      defaultBufferHours: 0,
      skuOverrides: { SKU01: 48 },
    };
    const result = computeShippingDeadlines(ops, allWorkdays(3), 3, config);
    const dl = result.get('OP01')!;
    expect(dl.bufferHours).toBe(6);
    expect(dl.bufferSource).toBe('operation');
  });

  it('orderOverrides overrides op.shippingBufferHours', () => {
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 100])];
    ops[0].shippingBufferHours = 6;
    const config: ShippingCutoffConfig = {
      defaultBufferHours: 0,
      orderOverrides: { OP01: 24 },
    };
    const result = computeShippingDeadlines(ops, allWorkdays(3), 3, config);
    const dl = result.get('OP01')!;
    expect(dl.bufferHours).toBe(24);
    expect(dl.bufferSource).toBe('order');
  });

  it('counts available workdays correctly with weekends', () => {
    // 8-day horizon: Mon,Tue,Wed,Thu,Fri,Sat,Sun,Mon
    const workdays = [true, true, true, true, true, false, false, true];
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 0, 0, 0, 0, 0, 500])];
    const result = computeShippingDeadlines(ops, workdays, 8, defaultConfig);
    const dl = result.get('OP01')!;

    expect(dl.shippingDayIdx).toBe(7);
    expect(dl.shippingDayIsWorkday).toBe(true);
    // latestFinishDay = 8 (day 7 + 1440min → day 8), but nDays=8 so count days 0-7
    // Workdays in 0-7: days 0,1,2,3,4,7 = 6 workdays (skip 5,6)
    // But latestFinishDay = floor((7*1440+1440)/1440) = 8, capped by nDays
    // Count workdays 0 to min(8, 7) = 7: days 0,1,2,3,4,7 = 6
    expect(dl.availableWorkdays).toBe(6);
  });

  it('detects shipping on non-workday', () => {
    // Demand on day 5 (Saturday, non-workday)
    const workdays = [true, true, true, true, true, false, false, true];
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 0, 0, 0, 100, 0, 0])];
    const result = computeShippingDeadlines(ops, workdays, 8, defaultConfig);
    const dl = result.get('OP01')!;

    expect(dl.shippingDayIdx).toBe(5);
    expect(dl.shippingDayIsWorkday).toBe(false);
    // latestFinishDay = floor((5*1440+1440)/1440) = 6
    // Workdays in 0-6: days 0,1,2,3,4 = 5 (days 5,6 are non-workdays)
    expect(dl.availableWorkdays).toBe(5);
  });

  it('records workday info in decision registry', () => {
    const workdays = [true, true, false, true];
    const ops = [mkOp('OP01', 'SKU01', [0, 0, 0, 100])];
    const registry = new DecisionRegistry();
    computeShippingDeadlines(ops, workdays, 4, defaultConfig, registry);

    const decisions = registry.getByType('SHIPPING_CUTOFF');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].metadata).toMatchObject({
      shippingDayIdx: 3,
      shippingDayIsWorkday: true,
      availableWorkdays: 3, // days 0,1,3 (day 2 is non-workday), up to latestFinishDay=4 but capped at nDays-1=3
    });
  });
});
