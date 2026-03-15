/**
 * useUIStore.test.ts — UI store unit tests.
 * Tests initial state, sidebar toggle, theme switching, and focus management.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useUIStore } from '@/stores/useUIStore';

const getState = () => useUIStore.getState();
const actions = () => getState().actions;

describe('useUIStore', () => {
  beforeEach(() => {
    useUIStore.setState({
      commandPaletteOpen: false,
      focus: {},
      contextPanelOpen: false,
      contextEntity: null,
      temporalZoom: 'day',
      selectedDayIdx: 0,
      theme: 'dark',
      sidebarCollapsed: false,
      sidebarMobileOpen: false,
      mrpRiskCount: 0,
    });
  });

  // ── Initial state ──

  it('has correct initial values', () => {
    const s = getState();
    expect(s.commandPaletteOpen).toBe(false);
    expect(s.focus).toEqual({});
    expect(s.theme).toBe('dark');
    expect(s.sidebarCollapsed).toBe(false);
    expect(s.temporalZoom).toBe('day');
    expect(s.selectedDayIdx).toBe(0);
  });

  // ── Sidebar ──

  it('toggleSidebar flips collapsed state', () => {
    expect(getState().sidebarCollapsed).toBe(false);
    actions().toggleSidebar();
    expect(getState().sidebarCollapsed).toBe(true);
    actions().toggleSidebar();
    expect(getState().sidebarCollapsed).toBe(false);
  });

  it('setSidebarCollapsed sets explicit value', () => {
    actions().setSidebarCollapsed(true);
    expect(getState().sidebarCollapsed).toBe(true);
  });

  // ── Theme ──

  it('setTheme sets theme directly', () => {
    actions().setTheme('light');
    expect(getState().theme).toBe('light');
  });

  it('toggleTheme switches between light and dark', () => {
    expect(getState().theme).toBe('dark');
    actions().toggleTheme();
    expect(getState().theme).toBe('light');
    actions().toggleTheme();
    expect(getState().theme).toBe('dark');
  });

  // ── Command palette ──

  it('openCommandPalette / closeCommandPalette', () => {
    actions().openCommandPalette();
    expect(getState().commandPaletteOpen).toBe(true);
    actions().closeCommandPalette();
    expect(getState().commandPaletteOpen).toBe(false);
  });

  it('toggleCommandPalette flips state', () => {
    actions().toggleCommandPalette();
    expect(getState().commandPaletteOpen).toBe(true);
    actions().toggleCommandPalette();
    expect(getState().commandPaletteOpen).toBe(false);
  });

  // ── Focus ──

  it('setFocus merges context', () => {
    actions().setFocus({ machine: 'PRM019' });
    expect(getState().focus.machine).toBe('PRM019');
    actions().setFocus({ day: '2026-03-05' });
    expect(getState().focus).toEqual({ machine: 'PRM019', day: '2026-03-05' });
  });

  it('clearFocus resets to empty', () => {
    actions().setFocus({ machine: 'PRM031', toolId: 'T1' });
    actions().clearFocus();
    expect(getState().focus).toEqual({});
  });

  // ── Context panel ──

  it('openContextPanel / closeContextPanel', () => {
    actions().openContextPanel({ type: 'machine', id: 'PRM042' });
    expect(getState().contextPanelOpen).toBe(true);
    expect(getState().contextEntity).toEqual({ type: 'machine', id: 'PRM042' });
    actions().closeContextPanel();
    expect(getState().contextPanelOpen).toBe(false);
    expect(getState().contextEntity).toBeNull();
  });

  // ── MRP risk count ──

  it('setMrpRiskCount updates count', () => {
    actions().setMrpRiskCount(7);
    expect(getState().mrpRiskCount).toBe(7);
  });
});
