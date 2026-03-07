// Testes de ToolTimeline constraint (F-14.5)
// Verifica que a mesma ferramenta física não corre em 2 máquinas simultaneamente

import { describe, expect, it } from 'vitest';
import { createToolTimeline, type EOp, type ETool, scheduleAll } from '../../lib/engine';

const nDays = 8;
const workdays = Array(nDays).fill(true) as boolean[];

describe('F-05: ToolTimeline Constraint', () => {
  describe('createToolTimeline — unit tests', () => {
    it('permite booking sem conflito', () => {
      const tl = createToolTimeline();
      tl.book('BFP079', 450, 930, 'PRM031');
      expect(tl.isAvailable('BFP079', 930, 1440, 'PRM039')).toBe(true);
    });

    it('permite mesmo tool na mesma máquina (sem conflito)', () => {
      const tl = createToolTimeline();
      tl.book('BFP079', 450, 930, 'PRM031');
      // Same machine, overlapping time — ok (tool is already there)
      expect(tl.isAvailable('BFP079', 450, 930, 'PRM031')).toBe(true);
    });

    it('bloqueia mesmo tool em máquinas diferentes com overlap', () => {
      const tl = createToolTimeline();
      tl.book('BFP079', 450, 930, 'PRM031');
      // Different machine, overlapping time — blocked
      expect(tl.isAvailable('BFP079', 500, 700, 'PRM039')).toBe(false);
    });

    it('findNextAvailable empurra para além do conflito', () => {
      const tl = createToolTimeline();
      tl.book('BFP079', 450, 930, 'PRM031');
      // PRM039 wants BFP079 at 450 for 480min — should be pushed to 930
      const slot = tl.findNextAvailable('BFP079', 450, 480, 1440, 'PRM039');
      expect(slot).toBe(930);
    });

    it('findNextAvailable retorna -1 quando não cabe no turno', () => {
      const tl = createToolTimeline();
      tl.book('BFP079', 450, 1320, 'PRM031'); // Almost full day on PRM031
      // PRM039 wants BFP079 for 300min, shiftEnd=1440 — only 120 min left
      const slot = tl.findNextAvailable('BFP079', 450, 300, 1440, 'PRM039');
      expect(slot).toBe(-1);
    });

    it('permite múltiplas instâncias quando instances > 1', () => {
      const tl = createToolTimeline();
      tl.book('BFP079', 450, 930, 'PRM031');
      // With instances=2, a second machine can use it at the same time
      expect(tl.isAvailable('BFP079', 450, 930, 'PRM039', 2)).toBe(true);
      // But a third machine cannot (already 1 booking on other machine, need <2)
      tl.book('BFP079', 450, 930, 'PRM039');
      expect(tl.isAvailable('BFP079', 450, 930, 'PRM042', 2)).toBe(false);
    });
  });

  describe('scheduleBatch integration — tool uniqueness', () => {
    // Simulate BFP079 scenario: same tool assigned to PRM031 (primary) and PRM039 (alt)
    const machines = [
      { id: 'PRM031', area: 'PG2', focus: true },
      { id: 'PRM039', area: 'PG2', focus: true },
    ];

    const tools: ETool[] = [
      {
        id: 'BFP079',
        m: 'PRM031',
        alt: 'PRM039',
        sH: 1.0,
        pH: 1681,
        op: 2,
        lt: 13000,
        stk: 0,
        nm: 'BFP079',
      },
      {
        id: 'BFP178',
        m: 'PRM039',
        alt: '-',
        sH: 0.75,
        pH: 1200,
        op: 1,
        lt: 5000,
        stk: 0,
        nm: 'BFP178',
      },
    ];

    const toolMap: Record<string, ETool> = {};
    tools.forEach((t) => {
      toolMap[t.id] = t;
    });

    const mSt: Record<string, string> = { PRM031: 'ok', PRM039: 'ok' };
    const tSt: Record<string, string> = { BFP079: 'ok', BFP178: 'ok' };

    it('BFP079 nunca está em PRM031 e PRM039 ao mesmo tempo', () => {
      // Large demand on BFP079 that exceeds PRM031 capacity (forces alt routing)
      const ops: EOp[] = [
        {
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM031',
          sku: 'SKU1',
          nm: 'P1',
          atr: 0,
          d: [30000, 30000, 30000, 0, 0, 0, 0, 0],
        },
        {
          id: 'OP02',
          t: 'BFP178',
          m: 'PRM039',
          sku: 'SKU2',
          nm: 'P2',
          atr: 0,
          d: [5000, 0, 0, 0, 0, 0, 0, 0],
        },
      ];

      const { blocks } = scheduleAll({
        ops,
        mSt,
        tSt,
        moves: [],
        machines,
        toolMap,
        workdays,
        nDays,
      });
      const bfp079Blocks = blocks.filter((b) => b.toolId === 'BFP079' && b.type === 'ok');

      // Check no temporal overlap across different machines
      let violations = 0;
      for (let i = 0; i < bfp079Blocks.length; i++) {
        for (let j = i + 1; j < bfp079Blocks.length; j++) {
          const a = bfp079Blocks[i],
            b = bfp079Blocks[j];
          if (a.machineId === b.machineId) continue;
          // Use absolute time for cross-day comparison
          const aStart = a.dayIdx * 1440 + (a.setupS ?? a.startMin);
          const aEnd = a.dayIdx * 1440 + a.endMin;
          const bStart = b.dayIdx * 1440 + (b.setupS ?? b.startMin);
          const bEnd = b.dayIdx * 1440 + b.endMin;
          if (aStart < bEnd && bStart < aEnd) violations++;
        }
      }

      expect(violations).toBe(0);
    });

    it('PRM039 consegue produzir BFP178 (não é roubada toda para BFP079)', () => {
      const ops: EOp[] = [
        {
          id: 'OP01',
          t: 'BFP079',
          m: 'PRM031',
          sku: 'SKU1',
          nm: 'P1',
          atr: 0,
          d: [13000, 13000, 0, 0, 0, 0, 0, 0],
        },
        {
          id: 'OP02',
          t: 'BFP178',
          m: 'PRM039',
          sku: 'SKU2',
          nm: 'P2',
          atr: 0,
          d: [5000, 0, 0, 0, 0, 0, 0, 0],
        },
      ];

      const { blocks } = scheduleAll({
        ops,
        mSt,
        tSt,
        moves: [],
        machines,
        toolMap,
        workdays,
        nDays,
      });
      const bfp178Produced = blocks
        .filter((b) => b.toolId === 'BFP178' && b.type === 'ok')
        .reduce((s, b) => s + b.qty, 0);

      // BFP178 should have some production (PRM039 is its primary machine)
      expect(bfp178Produced).toBeGreaterThan(0);
    });
  });
});
