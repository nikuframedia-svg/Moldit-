// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Cascading Replanning for Failures
//
//  Orchestrates a re-scheduling run that accounts for mid-
//  horizon failures.  NOT a separate scheduler — re-uses
//  scheduleAll() with enriched timeline data.
//
//  Pure function — no side effects.
// ═══════════════════════════════════════════════════════════

import type { ScheduleAllInput, ScheduleAllResult } from '../scheduler/scheduler.js';
import { scheduleAll } from '../scheduler/scheduler.js';
import type { Block, MoveAction } from '../types/blocks.js';
import type { FailureEvent, ImpactedBlock, ReplanResult } from '../types/failure.js';
import { buildResourceTimelines } from './failure-timeline.js';
import { analyzeAllFailures } from './impact-analysis.js';

/**
 * Cascading replanning:
 *
 * 1. Build resource timelines from failure events
 * 2. Run impact analysis on the CURRENT schedule
 * 3. For affected blocks with alternatives, generate MoveActions
 * 4. Re-run scheduleAll with timelines + mitigation moves
 * 5. Report unrecoverable blocks
 *
 * @param baseInput  - Original scheduling input (without timelines)
 * @param failures   - Active failure events
 * @param currentBlocks - Current schedule to analyze impact against
 * @returns ReplanResult with new schedule, impacts, moves, and unrecoverable blocks
 */
export function cascadingReplan(
  baseInput: ScheduleAllInput,
  failures: FailureEvent[],
  currentBlocks: Block[],
): ReplanResult & { schedule: ScheduleAllResult } {
  const nDays = baseInput.nDays;
  const thirdShift = baseInput.thirdShift;

  // 1. Build temporal timelines
  const { machineTimelines, toolTimelines } = buildResourceTimelines(failures, nDays, thirdShift);

  // 2. Analyze impact on current schedule
  const impacts = analyzeAllFailures(failures, currentBlocks, nDays, thirdShift);

  // 3. Generate mitigation moves for blocks with alternatives
  const mitigationMoves: Array<{ opId: string; fromM: string; toM: string }> = [];
  const moveActions: MoveAction[] = [];
  const unrecoverableBlocks: ImpactedBlock[] = [];
  const movedOps = new Set<string>();

  for (const impact of impacts) {
    for (const ib of impact.impactedBlocks) {
      if (movedOps.has(ib.opId)) continue; // already handled

      if (ib.hasAlternative && ib.altMachine) {
        // Check alt machine is not also fully down during the failure
        const altTl = machineTimelines[ib.altMachine];
        let altAvailable = true;
        if (altTl) {
          const fe = impact.failureEvent;
          for (let d = fe.startDay; d <= fe.endDay && d < nDays; d++) {
            const shifts = thirdShift ? (['X', 'Y', 'Z'] as const) : (['X', 'Y'] as const);
            const hasAny = shifts.some((s) => (altTl[d]?.[s]?.capacityFactor ?? 1) > 0);
            if (!hasAny) {
              altAvailable = false;
              break;
            }
          }
        }

        if (altAvailable) {
          mitigationMoves.push({
            opId: ib.opId,
            fromM: ib.machineId,
            toM: ib.altMachine,
          });
          moveActions.push({ opId: ib.opId, toM: ib.altMachine });
          movedOps.add(ib.opId);
        } else {
          unrecoverableBlocks.push(ib);
          movedOps.add(ib.opId);
        }
      } else {
        unrecoverableBlocks.push(ib);
        movedOps.add(ib.opId);
      }
    }
  }

  // 4. Re-run scheduleAll with timelines + mitigation moves
  const combinedMoves = [...baseInput.moves, ...moveActions];
  const schedule = scheduleAll({
    ...baseInput,
    moves: combinedMoves,
    machineTimelines,
    toolTimelines,
  });

  return {
    schedule,
    impacts,
    mitigationMoves,
    unrecoverableBlocks,
  };
}
