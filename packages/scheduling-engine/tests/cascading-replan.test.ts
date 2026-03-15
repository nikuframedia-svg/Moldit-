// =====================================================================
//  INCOMPOL PLAN — Tests for cascading-replan.ts
//
//  Covers: no failures passthrough, single machine failure cascade,
//  multiple failures with partial coverage, op dedup.
//
//  Uses real scheduleAll() via replan-fixtures helpers.
// =====================================================================

import { describe, expect, it } from 'vitest';

import { cascadingReplan } from '../src/failures/cascading-replan.js';
import { scheduleAll } from '../src/scheduler/scheduler.js';
import type { Block } from '../src/types/blocks.js';
import type { FailureEvent } from '../src/types/failure.js';
import { buildScheduleInput, createModeratePlanState } from './helpers/replan-fixtures.js';

// ── Helpers ─────────────────────────────────────────────────────

/** Build a baseline schedule from moderate plan state */
function buildBaseline() {
  const ps = createModeratePlanState();
  const input = buildScheduleInput(ps);
  const result = scheduleAll(input);
  return { input, blocks: result.blocks };
}

// ══════════════════════════════════════════════════════════════════
//  1. No failures — schedule unchanged
// ══════════════════════════════════════════════════════════════════

describe('cascadingReplan', () => {
  it('returns schedule unchanged when no failures', () => {
    const { input, blocks } = buildBaseline();

    const result = cascadingReplan(input, [], blocks);

    expect(result.impacts).toHaveLength(0);
    expect(result.mitigationMoves).toHaveLength(0);
    expect(result.unrecoverableBlocks).toHaveLength(0);
    // Schedule should still be valid (scheduleAll ran with no timelines)
    expect(result.schedule.blocks.length).toBeGreaterThan(0);
  });

  // ══════════════════════════════════════════════════════════════════
  //  2. Single machine failure — affected blocks cascade
  // ══════════════════════════════════════════════════════════════════

  it('generates mitigation moves for blocks on failed machine with alternatives', () => {
    const { input, blocks } = buildBaseline();

    // Find a machine that has blocks with alternatives
    const blocksWithAlt = blocks.filter(
      (b) => b.type === 'ok' && b.hasAlt && b.altM && b.altM !== '-',
    );

    if (blocksWithAlt.length === 0) {
      // OP_MODERATE is on PRM039 with BWI003 which has alt=PRM042
      // Create a failure on PRM039
      const failure: FailureEvent = {
        id: 'F1',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 0,
        startShift: null,
        endDay: input.nDays - 1,
        endShift: null,
        severity: 'total',
        capacityFactor: 0,
        description: 'PRM039 total failure',
      };

      const result = cascadingReplan(input, [failure], blocks);

      // Should have impact analysis
      expect(result.impacts).toHaveLength(1);
      expect(result.impacts[0].failureEvent.id).toBe('F1');

      // Blocks on PRM039 with alt should generate mitigation moves
      const prm039Blocks = blocks.filter(
        (b) => b.machineId === 'PRM039' && b.type === 'ok' && b.qty > 0,
      );
      if (prm039Blocks.length > 0) {
        // Should have either mitigation moves or unrecoverable blocks
        expect(result.mitigationMoves.length + result.unrecoverableBlocks.length).toBeGreaterThan(0);
      }

      // Schedule should be re-run with timelines
      expect(result.schedule).toBeDefined();
      expect(result.schedule.blocks).toBeDefined();
      return;
    }

    // If we have blocks with alt, fail their machine
    const targetMachine = blocksWithAlt[0].machineId;
    const failure: FailureEvent = {
      id: 'F1',
      resourceType: 'machine',
      resourceId: targetMachine,
      startDay: 0,
      startShift: null,
      endDay: input.nDays - 1,
      endShift: null,
      severity: 'total',
      capacityFactor: 0,
    };

    const result = cascadingReplan(input, [failure], blocks);

    expect(result.impacts).toHaveLength(1);
    // Should generate mitigation moves to alt machines
    expect(result.mitigationMoves.length).toBeGreaterThan(0);
    // Each move should reference a valid alt machine
    for (const move of result.mitigationMoves) {
      expect(move.fromM).toBe(targetMachine);
      expect(move.toM).not.toBe(targetMachine);
    }
  });

  it('marks blocks as unrecoverable when no alternative machine available', () => {
    const { input, blocks } = buildBaseline();

    // PRM042 has BFP080 which has NO alt machine (alt='-')
    // Fail PRM042 to test unrecoverable path
    const failure: FailureEvent = {
      id: 'F_NO_ALT',
      resourceType: 'machine',
      resourceId: 'PRM042',
      startDay: 0,
      startShift: null,
      endDay: input.nDays - 1,
      endShift: null,
      severity: 'total',
      capacityFactor: 0,
      description: 'PRM042 total failure — no alt for BFP080',
    };

    const result = cascadingReplan(input, [failure], blocks);

    // BFP080 blocks have no alt → should be unrecoverable
    const prm042ImpactBlocks = blocks.filter(
      (b) => b.machineId === 'PRM042' && b.type === 'ok' && b.qty > 0,
    );
    if (prm042ImpactBlocks.length > 0) {
      expect(result.unrecoverableBlocks.length).toBeGreaterThan(0);
      for (const ub of result.unrecoverableBlocks) {
        expect(ub.machineId).toBe('PRM042');
      }
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  3. Multiple failures — partial coverage
  // ══════════════════════════════════════════════════════════════════

  it('handles multiple failures on different machines', () => {
    const { input, blocks } = buildBaseline();

    const failures: FailureEvent[] = [
      {
        id: 'F_039',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 0,
        startShift: null,
        endDay: 1,
        endShift: null,
        severity: 'total',
        capacityFactor: 0,
      },
      {
        id: 'F_042',
        resourceType: 'machine',
        resourceId: 'PRM042',
        startDay: 2,
        startShift: null,
        endDay: 3,
        endShift: null,
        severity: 'total',
        capacityFactor: 0,
      },
    ];

    const result = cascadingReplan(input, failures, blocks);

    // Should produce one impact report per failure
    expect(result.impacts).toHaveLength(2);
    expect(result.impacts[0].failureEvent.id).toBe('F_039');
    expect(result.impacts[1].failureEvent.id).toBe('F_042');

    // Schedule re-ran with both timelines applied
    expect(result.schedule).toBeDefined();
  });

  it('does not move to alt machine when alt is also fully down', () => {
    const { input, blocks } = buildBaseline();

    // Fail BOTH PRM039 (primary for BWI003) AND PRM042 (alt for BWI003)
    const failures: FailureEvent[] = [
      {
        id: 'F_PRI',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 0,
        startShift: null,
        endDay: input.nDays - 1,
        endShift: null,
        severity: 'total',
        capacityFactor: 0,
      },
      {
        id: 'F_ALT',
        resourceType: 'machine',
        resourceId: 'PRM042',
        startDay: 0,
        startShift: null,
        endDay: input.nDays - 1,
        endShift: null,
        severity: 'total',
        capacityFactor: 0,
      },
    ];

    const result = cascadingReplan(input, failures, blocks);

    // BWI003 ops should NOT generate mitigation moves (alt also down)
    // They should be unrecoverable
    const bwi003Moves = result.mitigationMoves.filter(
      (m) => m.toM === 'PRM042' && m.fromM === 'PRM039',
    );
    // PRM042 is fully down so no moves should target it
    expect(bwi003Moves).toHaveLength(0);

    // All impacted ops should be unrecoverable
    if (result.impacts[0].impactedBlocks.length > 0) {
      expect(result.unrecoverableBlocks.length).toBeGreaterThan(0);
    }
  });

  // ══════════════════════════════════════════════════════════════════
  //  4. Already-handled ops dedup
  // ══════════════════════════════════════════════════════════════════

  it('does not duplicate moves for the same opId across multiple impact reports', () => {
    const { input, blocks } = buildBaseline();

    // Two overlapping failures on the same machine — same blocks impacted twice
    const failures: FailureEvent[] = [
      {
        id: 'F1',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 0,
        startShift: null,
        endDay: 2,
        endShift: null,
        severity: 'total',
        capacityFactor: 0,
      },
      {
        id: 'F2',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 1,
        startShift: null,
        endDay: 3,
        endShift: null,
        severity: 'total',
        capacityFactor: 0,
      },
    ];

    const result = cascadingReplan(input, failures, blocks);

    // Both failures generate impact reports
    expect(result.impacts).toHaveLength(2);

    // But each opId should appear AT MOST once in mitigationMoves + unrecoverableBlocks
    const allOpIds = [
      ...result.mitigationMoves.map((m) => m.opId),
      ...result.unrecoverableBlocks.map((ub) => ub.opId),
    ];
    const uniqueOpIds = new Set(allOpIds);
    expect(allOpIds.length).toBe(uniqueOpIds.size);
  });

  it('movedOps dedup prevents second failure from re-moving same op', () => {
    const { input, blocks } = buildBaseline();

    // Create two failure events affecting same blocks
    const failures: FailureEvent[] = [
      {
        id: 'FA',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 0,
        startShift: 'X',
        endDay: 0,
        endShift: 'Y',
        severity: 'total',
        capacityFactor: 0,
      },
      {
        id: 'FB',
        resourceType: 'machine',
        resourceId: 'PRM039',
        startDay: 0,
        startShift: 'X',
        endDay: 0,
        endShift: 'Y',
        severity: 'partial',
        capacityFactor: 0.3,
      },
    ];

    const result = cascadingReplan(input, failures, blocks);

    // Collect all handled opIds
    const handled = [
      ...result.mitigationMoves.map((m) => m.opId),
      ...result.unrecoverableBlocks.map((ub) => ub.opId),
    ];
    // No duplicates
    expect(handled.length).toBe(new Set(handled).size);
  });
});
