/**
 * useAndonStore.test.ts — Andon store unit tests.
 * Tests initial state, downtime registration, clearing, and drawer flow.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { ActiveDowntime } from '@/stores/useAndonStore';
import { useAndonStore } from '@/stores/useAndonStore';

const getState = () => useAndonStore.getState();
const actions = () => getState().actions;

const makeDt = (machineId: string): ActiveDowntime => ({
  machineId,
  category: 'avaria_mecanica',
  estimatedMin: 30,
  startedAt: Date.now(),
  downEventId: `evt-${machineId}`,
});

describe('useAndonStore', () => {
  beforeEach(() => {
    useAndonStore.setState({ downtimes: {}, drawerMachineId: null });
  });

  // ── Initial state ──

  it('starts with empty downtimes and no drawer open', () => {
    const s = getState();
    expect(s.downtimes).toEqual({});
    expect(s.drawerMachineId).toBeNull();
  });

  // ── Drawer ──

  it('openDrawer sets the machineId', () => {
    actions().openDrawer('PRM019');
    expect(getState().drawerMachineId).toBe('PRM019');
  });

  it('closeDrawer clears machineId', () => {
    actions().openDrawer('PRM031');
    actions().closeDrawer();
    expect(getState().drawerMachineId).toBeNull();
  });

  // ── Register downtime ──

  it('registerDowntime adds an active downtime entry', () => {
    const dt = makeDt('PRM019');
    actions().registerDowntime(dt);

    const downtimes = getState().downtimes;
    expect(downtimes.PRM019).toBeDefined();
    expect(downtimes.PRM019.category).toBe('avaria_mecanica');
    expect(downtimes.PRM019.estimatedMin).toBe(30);
  });

  it('registerDowntime overwrites existing downtime for same machine', () => {
    actions().registerDowntime(makeDt('PRM019'));
    const dt2: ActiveDowntime = {
      machineId: 'PRM019',
      category: 'falta_material',
      estimatedMin: null,
      startedAt: Date.now(),
      downEventId: 'evt-PRM019-2',
    };
    actions().registerDowntime(dt2);

    expect(getState().downtimes.PRM019.category).toBe('falta_material');
    expect(getState().downtimes.PRM019.estimatedMin).toBeNull();
  });

  // ── Clear downtime ──

  it('clearDowntime removes specific machine entry', () => {
    actions().registerDowntime(makeDt('PRM019'));
    actions().registerDowntime(makeDt('PRM031'));

    actions().clearDowntime('PRM019');

    const downtimes = getState().downtimes;
    expect(downtimes.PRM019).toBeUndefined();
    expect(downtimes.PRM031).toBeDefined();
  });

  it('clearDowntime is a no-op for non-existing machine', () => {
    actions().registerDowntime(makeDt('PRM031'));
    actions().clearDowntime('PRM999');
    expect(Object.keys(getState().downtimes)).toEqual(['PRM031']);
  });

  // ── Full machine down flow ──

  it('supports full down/recover cycle', () => {
    // Open drawer, register downtime, close drawer, then recover
    actions().openDrawer('PRM042');
    expect(getState().drawerMachineId).toBe('PRM042');

    actions().registerDowntime(makeDt('PRM042'));
    actions().closeDrawer();

    expect(getState().drawerMachineId).toBeNull();
    expect(getState().downtimes.PRM042).toBeDefined();

    // Recover
    actions().clearDowntime('PRM042');
    expect(getState().downtimes.PRM042).toBeUndefined();
  });
});
