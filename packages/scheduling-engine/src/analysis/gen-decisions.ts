// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Gen Decisions
//  Generates UI-facing replan proposals from blocked operations.
//  Scores alternative machines using running capacity tracking.
//  Migrated from NikufraEngine.tsx genDecisions()
// ═══════════════════════════════════════════════════════════

import { DAY_CAP } from '../constants.js';
import type { Block, MoveAction } from '../types/blocks.js';
import type { EMachine, EOp, ETool } from '../types/engine.js';
import { capAnalysis } from './cap-analysis.js';

// ── Types ────────────────────────────────────────────────

export type DecisionSeverity = 'critical' | 'high' | 'medium' | 'low';
export type DecisionKind = 'replan' | 'blocked';

export interface ReplanProposal {
  id: string;
  opId: string;
  type: DecisionKind;
  severity: DecisionSeverity;
  title: string;
  desc: string;
  reasoning: string[];
  impact: Record<string, unknown> | null;
  action: MoveAction | null;
}

// ── Main function ────────────────────────────────────────

/**
 * Generate UI-facing replan proposals for blocked operations.
 *
 * For each blocked operation (machine down), evaluates whether an
 * alternative machine is available, scores candidates using a running
 * capacity tracker (so each subsequent proposal accounts for cumulative
 * load from prior proposals), and produces a sorted list of proposals.
 *
 * Also emits warnings for operations below economic lot size.
 */
export function genDecisions(
  ops: EOp[],
  mSt: Record<string, string>,
  _tSt: Record<string, string>,
  moves: MoveAction[],
  blocks: Block[],
  machines: EMachine[],
  TM: Record<string, ETool>,
  _focusIds: string[],
  tools: ETool[],
): ReplanProposal[] {
  const decs: ReplanProposal[] = [];
  const cap = capAnalysis(blocks, machines);

  // Running capacity tracker — accumulates load from proposed moves
  // so each subsequent decision sees the combined load of all prior decisions
  const runCap: Record<string, { prod: number; setup: number }[]> = {};
  for (const [mId, days] of Object.entries(cap)) {
    runCap[mId] = days.map((d) => ({ prod: d.prod, setup: d.setup }));
  }

  const blkOps = new Map<string, Block>();
  blocks
    .filter((b) => b.type === 'blocked' && !moves.find((mv) => mv.opId === b.opId))
    .forEach((b) => {
      if (!blkOps.has(b.opId)) blkOps.set(b.opId, b);
    });

  // Sort by severity: highest priority first (stock-zero + high-backlog first)
  const sortedBlk = [...blkOps.values()].sort((a, b) => {
    const toolA = TM[a.toolId],
      toolB = TM[b.toolId];
    const opA = ops.find((o) => o.id === a.opId),
      opB = ops.find((o) => o.id === b.opId);
    const sevA = (toolA && toolA.stk === 0 ? 10 : 0) + (opA ? opA.atr : 0);
    const sevB = (toolB && toolB.stk === 0 ? 10 : 0) + (opB ? opB.atr : 0);
    return sevB - sevA;
  });

  sortedBlk.forEach((b) => {
    const tool = TM[b.toolId],
      op = ops.find((o) => o.id === b.opId);
    if (!tool || !op) return;
    if (tool.pH <= 0) return; // Guard: skip operations with rate=0
    const totalPcs = op.d.reduce((a, v) => a + Math.max(v, 0), 0) + Math.max(op.atr, 0);
    const totalH = totalPcs / tool.pH,
      setupMinVal = tool.sH * 60;
    const hasStk = tool.stk > 0,
      stkDays = hasStk ? tool.stk / (tool.pH * 16) : 0;
    const sev =
      (op.atr > 20000 ? 4 : op.atr > 5000 ? 3 : op.atr > 0 ? 2 : 0) +
      (tool.stk === 0 && tool.lt > 0 ? 3 : 0) +
      (totalPcs > 20000 ? 2 : totalPcs > 5000 ? 1 : 0);
    const severity: DecisionSeverity =
      sev >= 5 ? 'critical' : sev >= 3 ? 'high' : sev >= 1 ? 'medium' : 'low';
    const R: string[] = [];

    if (b.reason === 'tool_down') {
      R.push(`Ferramenta ${b.toolId} AVARIADA.`);
      if (op.atr > 0) R.push(`Backlog: ${op.atr.toLocaleString()} pcs.`);
      decs.push({
        id: `D_${b.opId}_TF`,
        opId: b.opId,
        type: 'blocked',
        severity: op.atr > 0 ? 'critical' : 'high',
        title: `${b.toolId} avariada`,
        desc: `${b.nm} (${b.sku})`,
        reasoning: R,
        impact: { pcsLost: totalPcs, hrsLost: totalH.toFixed(1) },
        action: null,
      });
      return;
    }

    R.push(`Máquina ${b.origM} DOWN → ${b.toolId}/${b.sku} afetada.`);
    R.push(`Volume: ${totalPcs.toLocaleString()} pcs (${totalH.toFixed(1)}h).`);

    if (!b.hasAlt) {
      R.push('Sem alternativa (ISOP).');
      R.push(
        !hasStk
          ? 'STOCK ZERO → paragem.'
          : `Buffer: ${tool.stk.toLocaleString()} pcs (≈${stkDays.toFixed(1)}d).`,
      );
      decs.push({
        id: `D_${b.opId}_NA`,
        opId: b.opId,
        type: 'blocked',
        severity: !hasStk ? 'critical' : severity,
        title: `${b.toolId} sem alternativa`,
        desc: b.nm,
        reasoning: R,
        impact: { pcsLost: totalPcs, hrsLost: totalH.toFixed(1), stkDays: stkDays.toFixed(1) },
        action: null,
      });
      return;
    }

    const candidates: string[] = [];
    if (b.altM && mSt[b.altM] !== 'down') candidates.push(b.altM);

    if (candidates.length === 0) {
      R.push(`Alt. ${b.altM} TAMBÉM DOWN.`);
      decs.push({
        id: `D_${b.opId}_AD`,
        opId: b.opId,
        type: 'blocked',
        severity: 'critical',
        title: `${b.toolId}: ambas DOWN`,
        desc: b.nm,
        reasoning: R,
        impact: { pcsLost: totalPcs, hrsLost: totalH.toFixed(1) },
        action: null,
      });
      return;
    }

    // Score candidates using RUNNING capacity (includes load from prior decisions)
    const gNDays = op.d.length || 8;
    const scored = candidates.map((cId) => {
      const dLoad = Array.from({ length: gNDays }, (_, di) => {
        const dc = runCap[cId]?.[di] || { prod: 0, setup: 0 };
        const addProd = op.d[di] > 0 ? (op.d[di] / tool.pH) * 60 : 0;
        const firstProdDay = op.d.findIndex((v) => v > 0);
        const addSetup = di === firstProdDay || di === 0 ? setupMinVal : 0;
        const total = dc.prod + dc.setup + addProd + addSetup;
        return {
          day: di,
          current: dc.prod + dc.setup,
          added: addProd + addSetup,
          total,
          util: total / DAY_CAP,
        };
      });
      const peak = Math.max(...dLoad.map((d) => d.util));
      const overDays = dLoad.filter((d) => d.util > 1.0);
      const sharedMP =
        tool.mp != null &&
        tools.filter(
          (t2) => t2.mp === tool.mp && t2.id !== tool.id && (t2.m === cId || t2.alt === cId),
        ).length > 0;
      return {
        mId: cId,
        dLoad,
        peak,
        overDays,
        sharedMP,
        score: peak * 100 + overDays.length * 50 + setupMinVal * 0.1 - (sharedMP ? 30 : 0),
      };
    });
    scored.sort((a, b) => a.score - b.score);
    const best = scored[0];

    // Update running capacity with proposed move load
    if (runCap[best.mId]) {
      for (let di = 0; di < gNDays; di++) {
        if (!runCap[best.mId][di]) runCap[best.mId][di] = { prod: 0, setup: 0 };
        const addProd = op.d[di] > 0 ? (op.d[di] / tool.pH) * 60 : 0;
        const firstProdDay = op.d.findIndex((v) => v > 0);
        const addSetup = di === firstProdDay || di === 0 ? setupMinVal : 0;
        runCap[best.mId][di].prod += addProd;
        runCap[best.mId][di].setup += addSetup;
      }
    }

    R.push(`Alt. disponível: ${best.mId}.`);
    if (best.overDays.length > 0)
      R.push(
        `${best.mId} sobrecarga ${best.overDays.length}d (inclui ${decs.filter((d) => d.action?.toM === best.mId).length} ops já propostas).`,
      );
    else R.push(`Capacidade ${best.mId}: pico ${(best.peak * 100).toFixed(0)}% — OK.`);
    R.push(`Setup: +${setupMinVal}min (${tool.sH}h).`);
    if (best.sharedMP) R.push(`MP ${tool.mp} partilhada — agrupar.`);
    if (tool.op > 1) R.push(`Requer ${tool.op} operadores.`);
    if (!hasStk && tool.lt > 0) R.push('STOCK ZERO — OTD em risco.');
    R.push(`→ Mover ${b.toolId} → ${best.mId}.`);

    decs.push({
      id: `D_${b.opId}_RP`,
      opId: b.opId,
      type: 'replan',
      severity,
      title: `${b.toolId} → ${best.mId}`,
      desc: `${b.nm} (${b.sku})`,
      reasoning: R,
      impact: {
        fromM: b.origM,
        toM: best.mId,
        setupMin: setupMinVal,
        pcs: totalPcs,
        hrs: totalH.toFixed(1),
        destPeak: (best.peak * 100).toFixed(0),
        overDays: best.overDays.length,
        ops: tool.op,
        stockRisk: !hasStk && tool.lt > 0,
        atr: op.atr,
        sharedMP: best.sharedMP,
        dLoad: best.dLoad,
      },
      action: { opId: b.opId, toM: best.mId },
    });
  });

  // Lote económico warnings
  blocks
    .filter((b) => b.belowMinBatch && b.type === 'ok')
    .forEach((b) => {
      const tool = TM[b.toolId];
      if (!tool) return;
      decs.push({
        id: `D_${b.opId}_LT`,
        opId: b.opId,
        type: 'replan',
        severity: 'low',
        title: `${b.sku} abaixo lote econ.`,
        desc: `${b.qty.toLocaleString()} < ${tool.lt.toLocaleString()} pcs`,
        reasoning: [
          `Qty ${b.qty.toLocaleString()} abaixo lote económico ${tool.lt.toLocaleString()}.`,
          `Considerar agrupar com próxima encomenda.`,
        ],
        impact: { qty: b.qty, lotEconomic: tool.lt },
        action: null,
      });
    });

  const sO: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  decs.sort((a, b) =>
    a.type === 'replan' && b.type !== 'replan'
      ? -1
      : b.type === 'replan' && a.type !== 'replan'
        ? 1
        : (sO[a.severity] ?? 3) - (sO[b.severity] ?? 3),
  );
  return decs;
}
