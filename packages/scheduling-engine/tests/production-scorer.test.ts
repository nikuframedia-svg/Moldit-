// ═══════════════════════════════════════════════════════════════════════
//  INCOMPOL PLAN -- Production Scorer Tests
// ═══════════════════════════════════════════════════════════════════════

import { describe, expect, it } from 'vitest';
import { DAY_CAP } from '../src/constants.js';
import { DecisionRegistry } from '../src/decisions/decision-registry.js';
import { scoreOperations, sortGroupsByScore } from '../src/scheduler/production-scorer.js';
import type { DeficitEvolution, WorkContent } from '../src/types/scoring.js';
import type { OperationDeadline } from '../src/types/shipping.js';

// ── Helpers ──

function mkWC(opId: string, workContentHours: number, totalQty = 1000, pH = 100): WorkContent {
  const workContentMin = workContentHours * 60;
  return {
    opId,
    totalQty,
    pH,
    oee: 0.66,
    oeeSource: 'default',
    workContentHours,
    workContentMin,
    daysRequired: workContentMin / DAY_CAP,
  };
}

function mkDeadline(opId: string, shippingDayIdx: number, bufferHours = 0): OperationDeadline {
  const shippingDayEndAbs = shippingDayIdx * 1440 + 1440;
  const latestFinishAbs = Math.max(0, shippingDayEndAbs - bufferHours * 60);
  const latestFinishDay = Math.floor(latestFinishAbs / 1440);
  return {
    opId,
    shippingDayIdx,
    bufferHours,
    latestFinishAbs,
    latestFinishDay,
    latestFinishMin: latestFinishAbs % 1440,
    bufferSource: 'default',
    availableWorkdays: latestFinishDay + 1,
    shippingDayIsWorkday: true,
  };
}

function mkDeficit(opId: string, dailyDeficit: number[]): DeficitEvolution {
  let firstDeficitDay = -1;
  let maxDeficit = 0;
  for (let i = 0; i < dailyDeficit.length; i++) {
    if (dailyDeficit[i] < 0) {
      if (firstDeficitDay < 0) firstDeficitDay = i;
      if (-dailyDeficit[i] > maxDeficit) maxDeficit = -dailyDeficit[i];
    }
  }
  return { opId, dailyDeficit, firstDeficitDay, maxDeficit, initialStock: 0 };
}

describe('scoreOperations', () => {
  it('assigns higher score to overdue operations (slack < 0)', () => {
    const wcs = new Map([
      ['OP_OVERDUE', mkWC('OP_OVERDUE', 20)], // needs 20h, only has ~16.5h (1 day)
      ['OP_EASY', mkWC('OP_EASY', 2)], // needs 2h
    ]);
    const deadlines = new Map([
      ['OP_OVERDUE', mkDeadline('OP_OVERDUE', 0, 0)], // deadline = day 0 end
      ['OP_EASY', mkDeadline('OP_EASY', 7, 0)], // deadline = day 7 end
    ]);
    const deficits = new Map<string, DeficitEvolution>();

    const scores = scoreOperations(wcs, deficits, deadlines, 0, 8);

    const overdue = scores.get('OP_OVERDUE')!;
    const easy = scores.get('OP_EASY')!;
    expect(overdue.compositeScore).toBeGreaterThan(easy.compositeScore);
  });

  it('assigns higher score to critical operations (slack < 1 day)', () => {
    const wcs = new Map([
      ['OP_CRITICAL', mkWC('OP_CRITICAL', 10)], // needs 600min
      ['OP_COMFY', mkWC('OP_COMFY', 2)], // needs 120min
    ]);
    // OP_CRITICAL: deadline day 0, buffer=0 → latestFinish=1440, available=1440, slack=1440-600=840 < DAY_CAP=990 → CRITICAL
    // OP_COMFY: deadline day 7 → lots of slack → COMFORTABLE
    const deadlines = new Map([
      ['OP_CRITICAL', mkDeadline('OP_CRITICAL', 0, 0)],
      ['OP_COMFY', mkDeadline('OP_COMFY', 7, 0)],
    ]);
    const deficits = new Map<string, DeficitEvolution>();

    const scores = scoreOperations(wcs, deficits, deadlines, 0, 8);

    const critical = scores.get('OP_CRITICAL')!;
    const comfy = scores.get('OP_COMFY')!;
    expect(critical.slackTimeMin).toBeLessThan(DAY_CAP); // critical tier
    expect(comfy.compositeScore).toBeLessThan(critical.compositeScore);
  });

  it('operations without deadline get lowest tier', () => {
    const wcs = new Map([
      ['OP_NO_DL', mkWC('OP_NO_DL', 5)],
      ['OP_WITH_DL', mkWC('OP_WITH_DL', 5)],
    ]);
    const deadlines = new Map([['OP_WITH_DL', mkDeadline('OP_WITH_DL', 3)]]);
    const deficits = new Map<string, DeficitEvolution>();

    const scores = scoreOperations(wcs, deficits, deadlines, 0, 8);

    const noDl = scores.get('OP_NO_DL')!;
    const withDl = scores.get('OP_WITH_DL')!;
    expect(noDl.compositeScore).toBeLessThan(withDl.compositeScore);
  });

  it('higher density operations get bonus P3', () => {
    // Both have same deadline and similar slack, but OP_HEAVY needs much more capacity
    const wcs = new Map([
      ['OP_HEAVY', mkWC('OP_HEAVY', 15)], // 15h of work
      ['OP_LIGHT', mkWC('OP_LIGHT', 1)], // 1h of work
    ]);
    const deadlines = new Map([
      ['OP_HEAVY', mkDeadline('OP_HEAVY', 5)],
      ['OP_LIGHT', mkDeadline('OP_LIGHT', 5)],
    ]);
    const deficits = new Map<string, DeficitEvolution>();

    const scores = scoreOperations(wcs, deficits, deadlines, 0, 8);

    const heavy = scores.get('OP_HEAVY')!;
    const light = scores.get('OP_LIGHT')!;
    expect(heavy.density).toBeGreaterThan(light.density);
  });

  it('records SCORING_DECISION in registry', () => {
    const wcs = new Map([['OP01', mkWC('OP01', 5)]]);
    const deadlines = new Map([['OP01', mkDeadline('OP01', 3)]]);
    const deficits = new Map<string, DeficitEvolution>();
    const registry = new DecisionRegistry();

    scoreOperations(wcs, deficits, deadlines, 0, 8, registry);

    const decisions = registry.getByType('SCORING_DECISION');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].opId).toBe('OP01');
    expect(decisions[0].metadata).toHaveProperty('tier');
    expect(decisions[0].metadata).toHaveProperty('compositeScore');
  });

  it('uses working days for density when workdays array provided', () => {
    // 7 calendar days but only 3 working days (holiday week)
    const workdays = [true, false, true, false, true, false, false];
    const wcs = new Map([['OP01', mkWC('OP01', 15)]]);
    // Deadline at day 6 → latestFinishDay=7, calendarDays=8, 5/7 approx=6
    const deadlines = new Map([['OP01', mkDeadline('OP01', 6)]]);
    const deficits = new Map<string, DeficitEvolution>();

    const withWorkdays = scoreOperations(wcs, deficits, deadlines, 0, 7, undefined, workdays);
    const withoutWorkdays = scoreOperations(wcs, deficits, deadlines, 0, 7);

    const dWith = withWorkdays.get('OP01')!.density;
    const dWithout = withoutWorkdays.get('OP01')!.density;

    // With workdays: 3 working days → density is HIGHER (less capacity)
    // Without: ~6 estimated working days (5/7 approx) → density is lower
    expect(dWith).toBeGreaterThan(dWithout);
  });

  it('is deterministic — same inputs produce same scores', () => {
    const wcs = new Map([
      ['OP01', mkWC('OP01', 5)],
      ['OP02', mkWC('OP02', 5)],
    ]);
    const deadlines = new Map([
      ['OP01', mkDeadline('OP01', 3)],
      ['OP02', mkDeadline('OP02', 3)],
    ]);
    const deficits = new Map<string, DeficitEvolution>();

    const scores1 = scoreOperations(wcs, deficits, deadlines, 0, 8);
    const scores2 = scoreOperations(wcs, deficits, deadlines, 0, 8);

    expect(scores1.get('OP01')!.compositeScore).toBe(scores2.get('OP01')!.compositeScore);
    expect(scores1.get('OP02')!.compositeScore).toBe(scores2.get('OP02')!.compositeScore);
  });
});

describe('sortGroupsByScore', () => {
  it('sorts groups by highest operation score (descending)', () => {
    const scores = new Map([
      [
        'OP01',
        {
          opId: 'OP01',
          compositeScore: 100,
          slackTimeMin: 0,
          deficitAtDeadline: 0,
          deadlineProximityDays: 0,
          workContentHours: 0,
          density: 0,
          justification: '',
        },
      ],
      [
        'OP02',
        {
          opId: 'OP02',
          compositeScore: 500,
          slackTimeMin: 0,
          deficitAtDeadline: 0,
          deadlineProximityDays: 0,
          workContentHours: 0,
          density: 0,
          justification: '',
        },
      ],
      [
        'OP03',
        {
          opId: 'OP03',
          compositeScore: 300,
          slackTimeMin: 0,
          deficitAtDeadline: 0,
          deadlineProximityDays: 0,
          workContentHours: 0,
          density: 0,
          justification: '',
        },
      ],
    ]);

    const groups = [
      { toolId: 'T1', skus: [{ opId: 'OP01' }] },
      { toolId: 'T2', skus: [{ opId: 'OP02' }] },
      { toolId: 'T3', skus: [{ opId: 'OP03' }] },
    ];

    const sorted = sortGroupsByScore(groups, scores);
    expect(sorted[0].toolId).toBe('T2'); // score 500
    expect(sorted[1].toolId).toBe('T3'); // score 300
    expect(sorted[2].toolId).toBe('T1'); // score 100
  });

  it('uses max score when group has multiple operations', () => {
    const scores = new Map([
      [
        'OP01',
        {
          opId: 'OP01',
          compositeScore: 100,
          slackTimeMin: 0,
          deficitAtDeadline: 0,
          deadlineProximityDays: 0,
          workContentHours: 0,
          density: 0,
          justification: '',
        },
      ],
      [
        'OP02',
        {
          opId: 'OP02',
          compositeScore: 800,
          slackTimeMin: 0,
          deficitAtDeadline: 0,
          deadlineProximityDays: 0,
          workContentHours: 0,
          density: 0,
          justification: '',
        },
      ],
      [
        'OP03',
        {
          opId: 'OP03',
          compositeScore: 500,
          slackTimeMin: 0,
          deficitAtDeadline: 0,
          deadlineProximityDays: 0,
          workContentHours: 0,
          density: 0,
          justification: '',
        },
      ],
    ]);

    const groups = [
      { toolId: 'T1', skus: [{ opId: 'OP01' }, { opId: 'OP02' }] }, // max = 800
      { toolId: 'T2', skus: [{ opId: 'OP03' }] }, // max = 500
    ];

    const sorted = sortGroupsByScore(groups, scores);
    expect(sorted[0].toolId).toBe('T1'); // max score 800
    expect(sorted[1].toolId).toBe('T2'); // score 500
  });

  it('breaks ties by toolId for determinism', () => {
    const scores = new Map([
      [
        'OP01',
        {
          opId: 'OP01',
          compositeScore: 500,
          slackTimeMin: 0,
          deficitAtDeadline: 0,
          deadlineProximityDays: 0,
          workContentHours: 0,
          density: 0,
          justification: '',
        },
      ],
      [
        'OP02',
        {
          opId: 'OP02',
          compositeScore: 500,
          slackTimeMin: 0,
          deficitAtDeadline: 0,
          deadlineProximityDays: 0,
          workContentHours: 0,
          density: 0,
          justification: '',
        },
      ],
    ]);

    const groups = [
      { toolId: 'BFP079', skus: [{ opId: 'OP01' }] },
      { toolId: 'BWI003', skus: [{ opId: 'OP02' }] },
    ];

    const sorted = sortGroupsByScore(groups, scores);
    expect(sorted[0].toolId).toBe('BFP079'); // lexicographic first
    expect(sorted[1].toolId).toBe('BWI003');
  });

  it('does not mutate original array', () => {
    const scores = new Map([
      [
        'OP01',
        {
          opId: 'OP01',
          compositeScore: 100,
          slackTimeMin: 0,
          deficitAtDeadline: 0,
          deadlineProximityDays: 0,
          workContentHours: 0,
          density: 0,
          justification: '',
        },
      ],
    ]);
    const groups = [{ toolId: 'T1', skus: [{ opId: 'OP01' }] }];
    const original = [...groups];

    sortGroupsByScore(groups, scores);
    expect(groups).toEqual(original);
  });
});
