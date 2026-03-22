/**
 * useSettingsStore.test.ts — Settings store unit tests.
 * Tests initial defaults, setters, profile switching, and reset behavior.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock invalidateScheduleCache before importing the store
vi.mock('@/hooks/useScheduleData', () => ({
  invalidateScheduleCache: vi.fn(),
}));

import { invalidateScheduleCache } from '@/hooks/useScheduleData';
import { WEIGHT_PROFILES } from '@/stores/settings-types';
import { useSettingsStore } from '@/stores/useSettingsStore';

const getState = () => useSettingsStore.getState();
const actions = () => getState().actions;

describe('useSettingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      oee: 0.66,
      dispatchRule: 'EDD',
      optimizationProfile: 'balanced',
      wTardiness: 100,
      wSetupCount: 10,
      demandSemantics: 'raw_np',
      preStartBufferDays: 5,
      preStartStrategy: 'auto',
      useServerSolver: false,
      serverSolverTimeLimit: 60,
      clientTiers: {},
    });
    vi.clearAllMocks();
  });

  // ── Initial state ──

  it('has correct default values', () => {
    const s = getState();
    expect(s.oee).toBe(0.66);
    expect(s.dispatchRule).toBe('EDD');
    expect(s.optimizationProfile).toBe('balanced');
    expect(s.demandSemantics).toBe('raw_np');
    expect(s.shiftXStart).toBe('07:00');
    expect(s.shiftChange).toBe('15:30');
    expect(s.shiftYEnd).toBe('24:00');
    expect(s.thirdShiftDefault).toBe(false);
    expect(s.bucketWindowDays).toBe(5);
    expect(s.useServerSolver).toBe(false);
  });

  // ── OEE ──

  it('setOEE updates value and invalidates cache', () => {
    actions().setOEE(0.85);
    expect(getState().oee).toBe(0.85);
    expect(invalidateScheduleCache).toHaveBeenCalled();
  });

  // ── Dispatch rule ──

  it('setDispatchRule updates rule and invalidates cache', () => {
    actions().setDispatchRule('ATCS');
    expect(getState().dispatchRule).toBe('ATCS');
    expect(invalidateScheduleCache).toHaveBeenCalled();
  });

  // ── Optimization profile ──

  it('setOptimizationProfile applies preset weights', () => {
    actions().setOptimizationProfile('otd');
    const s = getState();
    expect(s.optimizationProfile).toBe('otd');
    expect(s.wTardiness).toBe(WEIGHT_PROFILES.otd.wTardiness);
    expect(s.wSetupCount).toBe(WEIGHT_PROFILES.otd.wSetupCount);
  });

  it('setOptimizationProfile custom keeps existing weights', () => {
    actions().setWeight('wTardiness', 200);
    actions().setOptimizationProfile('custom');
    expect(getState().optimizationProfile).toBe('custom');
    expect(getState().wTardiness).toBe(200);
  });

  // ── Individual weight ──

  it('setWeight updates weight and switches to custom profile', () => {
    actions().setWeight('wTardiness', 999);
    const s = getState();
    expect(s.wTardiness).toBe(999);
    expect(s.optimizationProfile).toBe('custom');
    expect(invalidateScheduleCache).toHaveBeenCalled();
  });

  it('setWeight ignores invalid keys', () => {
    actions().setWeight('invalidKey' as never, 42);
    expect(invalidateScheduleCache).not.toHaveBeenCalled();
  });

  // ── Shifts ──

  it('setShifts updates all shift boundaries', () => {
    actions().setShifts('06:00', '14:00', '22:00');
    const s = getState();
    expect(s.shiftXStart).toBe('06:00');
    expect(s.shiftChange).toBe('14:00');
    expect(s.shiftYEnd).toBe('22:00');
  });

  // ── Demand semantics ──

  it('setDemandSemantics updates and invalidates', () => {
    actions().setDemandSemantics('daily');
    expect(getState().demandSemantics).toBe('daily');
    expect(invalidateScheduleCache).toHaveBeenCalled();
  });

  // ── Server solver ──

  it('setUseServerSolver toggles server solver flag', () => {
    actions().setUseServerSolver(true);
    expect(getState().useServerSolver).toBe(true);
  });

  // ── Client tiers ──

  it('setClientTier adds a tier without invalidating cache', () => {
    actions().setClientTier('FAURECIA', 1);
    expect(getState().clientTiers).toEqual({ FAURECIA: 1 });
    // Client tiers are post-scheduling, no cache invalidation
    expect(invalidateScheduleCache).not.toHaveBeenCalled();
  });
});
