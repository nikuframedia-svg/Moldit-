/**
 * useFactoryPulse.test.ts — Factory pulse hook tests.
 * Tests pulse computation from schedule data and andon downtimes.
 */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies
vi.mock('@/hooks/useScheduleData', () => ({
  useScheduleData: vi.fn(),
}));

vi.mock('@/stores/useAndonStore', () => ({
  useAndonDowntimes: vi.fn(),
}));

vi.mock('@/utils/explicitText', () => ({
  formatTimeSince: vi.fn(() => 'ha 15 minutos'),
}));

import { useScheduleData } from '@/hooks/useScheduleData';
import { useAndonDowntimes } from '@/stores/useAndonStore';
import { useFactoryPulse } from '@/hooks/useFactoryPulse';

const mockScheduleData = useScheduleData as ReturnType<typeof vi.fn>;
const mockDowntimes = useAndonDowntimes as ReturnType<typeof vi.fn>;

describe('useFactoryPulse', () => {
  beforeEach(() => {
    mockDowntimes.mockReturnValue({});
  });

  it('returns null when loading', () => {
    mockScheduleData.mockReturnValue({ loading: true, engine: null });
    const { result } = renderHook(() => useFactoryPulse());
    expect(result.current).toBeNull();
  });

  it('returns null when engine is missing', () => {
    mockScheduleData.mockReturnValue({ loading: false, engine: null });
    const { result } = renderHook(() => useFactoryPulse());
    expect(result.current).toBeNull();
  });

  it('returns ok status when factory runs normally', () => {
    mockScheduleData.mockReturnValue({
      loading: false,
      engine: { machines: ['PRM019', 'PRM031', 'PRM039', 'PRM042', 'PRM043'] },
      metrics: { tardinessDays: 0, otdDelivery: 98 },
      coverageAudit: { isComplete: true, zeroCovered: 0, partiallyCovered: 0 },
      validation: { violations: [] },
    });

    const { result } = renderHook(() => useFactoryPulse());
    expect(result.current).not.toBeNull();
    expect(result.current!.status).toBe('ok');
    expect(result.current!.headline).toBe('Fabrica a funcionar normalmente.');
    expect(result.current!.urgentItems).toHaveLength(0);
  });

  it('returns critical status with machine downtimes', () => {
    mockScheduleData.mockReturnValue({
      loading: false,
      engine: { machines: ['PRM019', 'PRM031', 'PRM039', 'PRM042', 'PRM043'] },
      metrics: { tardinessDays: 0, otdDelivery: 98 },
      coverageAudit: { isComplete: true, zeroCovered: 0, partiallyCovered: 0 },
      validation: { violations: [] },
    });
    mockDowntimes.mockReturnValue({
      PRM019: { machineId: 'PRM019', startedAt: Date.now() - 900_000 },
    });

    const { result } = renderHook(() => useFactoryPulse());
    expect(result.current!.status).toBe('critical');
    expect(result.current!.urgentItems.some((u) => u.icon === 'machine')).toBe(true);
  });

  it('includes tardy items when tardiness > 0', () => {
    mockScheduleData.mockReturnValue({
      loading: false,
      engine: { machines: ['PRM019'] },
      metrics: { tardinessDays: 3, otdDelivery: 85 },
      coverageAudit: { isComplete: true, zeroCovered: 0, partiallyCovered: 0 },
      validation: { violations: [] },
    });

    const { result } = renderHook(() => useFactoryPulse());
    const tardy = result.current!.urgentItems.find((u) => u.id === 'tardy');
    expect(tardy).toBeDefined();
    expect(tardy!.semantic).toBe('critical');
  });
});
