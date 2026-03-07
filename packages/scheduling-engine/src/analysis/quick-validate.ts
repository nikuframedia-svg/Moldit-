// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Quick Validate
//  Fast sanity checks on a schedule: tool uniqueness,
//  setup crew overlap, and machine overcapacity.
//  Migrated from NikufraEngine.tsx quickValidate()
// ═══════════════════════════════════════════════════════════

import { DAY_CAP } from '../constants.js';
import type { Block } from '../types/blocks.js';
import type { EMachine, ETool } from '../types/engine.js';

export interface QuickValidateResult {
  criticalCount: number;
  highCount: number;
  warnings: string[];
}

/**
 * Quick sanity checks on a schedule.
 *
 * Checks:
 * 1. Tool Uniqueness — same tool on 2+ machines at the same time
 * 2. Setup Crew Overlap — 2+ setups on different machines simultaneously
 * 3. Machine Overcapacity — total load > DAY_CAP per day
 *
 * NOTE: Uses DAY_CAP (hard capacity limit = 1020 min), the physical limit.
 */
export function quickValidate(
  blocks: Block[],
  _machines: EMachine[],
  _TM: Record<string, ETool>,
): QuickValidateResult {
  let criticalCount = 0;
  let highCount = 0;
  const warnings: string[] = [];
  const okBlocks = blocks.filter((b) => b.type === 'ok');

  // ── Check 1: Tool Uniqueness (same tool on 2+ machines, overlapping) ──
  const toolByM: Record<string, Array<{ m: string; s: number; e: number }>> = {};
  for (const b of okBlocks) {
    if (!toolByM[b.toolId]) toolByM[b.toolId] = [];
    toolByM[b.toolId].push({
      m: b.machineId,
      s: b.dayIdx * 1440 + (b.setupS ?? b.startMin),
      e: b.dayIdx * 1440 + b.endMin,
    });
  }
  for (const [tid, slots] of Object.entries(toolByM)) {
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slots[i].m === slots[j].m) continue;
        if (slots[i].s < slots[j].e && slots[j].s < slots[i].e) {
          criticalCount++;
          warnings.push(`${tid} em ${slots[i].m} e ${slots[j].m} ao mesmo tempo`);
        }
      }
    }
  }

  // ── Check 2: Setup Crew Overlap (2+ setups on different machines simultaneously) ──
  const setups: Array<{ s: number; e: number; m: string; t: string }> = [];
  for (const b of okBlocks) {
    if (b.setupS != null && b.setupE != null)
      setups.push({
        s: b.dayIdx * 1440 + b.setupS,
        e: b.dayIdx * 1440 + b.setupE,
        m: b.machineId,
        t: b.toolId,
      });
  }
  for (let i = 0; i < setups.length; i++) {
    for (let j = i + 1; j < setups.length; j++) {
      if (setups[i].m === setups[j].m) continue;
      if (setups[i].s < setups[j].e && setups[j].s < setups[i].e) {
        highCount++;
        warnings.push(
          `Setups sobrepostos: ${setups[i].t}/${setups[i].m} ∩ ${setups[j].t}/${setups[j].m}`,
        );
      }
    }
  }

  // ── Check 3: Machine Overcapacity (>DAY_CAP min/day) ──
  // Uses DAY_CAP (1020 min) — the HARD physical limit.
  const mDayLoad: Record<string, number> = {};
  for (const b of okBlocks) {
    const key = `${b.machineId}:${b.dayIdx}`;
    let dur = b.endMin - b.startMin;
    if (b.setupS != null && b.setupE != null) dur += b.setupE - b.setupS;
    mDayLoad[key] = (mDayLoad[key] || 0) + dur;
  }
  for (const [key, load] of Object.entries(mDayLoad)) {
    if (Math.round(load) > DAY_CAP) {
      highCount++;
      const [mid, di] = key.split(':');
      warnings.push(`${mid} excede capacidade dia ${di} (${Math.round(load)}/${DAY_CAP}min)`);
    }
  }

  return { criticalCount, highCount, warnings };
}
