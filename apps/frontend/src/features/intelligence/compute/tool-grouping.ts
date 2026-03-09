// compute/tool-grouping.ts — Feature 6: Tool Grouping Optimizer

import { MACHINE_AREA, MACHINES } from './constants';
import type { NkData } from './types';

export interface ToolGroupResult {
  machine: string;
  area: string;
  currentSequence: string[];
  optimalSequence: string[];
  currentSetups: number;
  optimalSetups: number;
  savedSetups: number;
  savedMinutes: number;
}

export function computeToolGrouping(nk: NkData): ToolGroupResult[] {
  const results: ToolGroupResult[] = [];

  for (const machineId of MACHINES) {
    const machineTools = nk.tools.filter((t) => t.m === machineId);
    if (machineTools.length <= 1) continue;

    const current = machineTools.map((t) => t.id);

    const optimal = [...machineTools]
      .sort((a, b) => {
        const prefA = a.id.replace(/\d+/g, '');
        const prefB = b.id.replace(/\d+/g, '');
        if (prefA !== prefB) return prefA.localeCompare(prefB);
        return a.id.localeCompare(b.id);
      })
      .map((t) => t.id);

    const countSetups = (seq: string[]): number => {
      let count = 0;
      for (let i = 1; i < seq.length; i++) {
        if (seq[i] !== seq[i - 1]) count++;
      }
      return count;
    };

    const currentSetups = countSetups(current);
    const optimalSetups = countSetups(optimal);
    const avgSetupMin = machineTools.reduce((s, t) => s + t.s * 60, 0) / machineTools.length;

    results.push({
      machine: machineId,
      area: MACHINE_AREA[machineId],
      currentSequence: current,
      optimalSequence: optimal,
      currentSetups,
      optimalSetups,
      savedSetups: Math.max(0, currentSetups - optimalSetups),
      savedMinutes: Math.max(0, currentSetups - optimalSetups) * avgSetupMin,
    });
  }

  return results.sort((a, b) => b.savedMinutes - a.savedMinutes);
}
