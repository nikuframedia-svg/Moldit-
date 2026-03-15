import { useScheduleComputed } from './useScheduleComputed';
import { useScheduleCore } from './useScheduleCore';

export function useScheduleEngine(initialView = 'plan') {
  const core = useScheduleCore(initialView);
  const computed = useScheduleComputed({
    engineData: core.engineData,
    rushOrders: core.rushOrders,
    mSt: core.mSt,
    tSt: core.tSt,
    moves: core.moves,
    failureEvents: core.failureEvents,
    replanTimelines: core.replanTimelines,
    appliedReplan: core.appliedReplan,
  });

  return {
    ...core,
    ...computed,
  };
}
