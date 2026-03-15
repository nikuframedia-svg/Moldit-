// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Enforce Deadlines (Step 7.5)
//  Converts overflow blocks to infeasible when demand not met.
//  Generates remediation proposals.
// ═══════════════════════════════════════════════════════════

import type { Block } from '../types/blocks.js';
import type { EOp, ETool } from '../types/engine.js';
import type { InfeasibilityEntry, RemediationProposal } from '../types/infeasibility.js';
import { getBlockProductionForOp } from '../utils/block-production.js';

export interface EnforceDeadlinesInput {
  ops: EOp[];
  blocks: Block[];
  toolMap: Record<string, ETool>;
  mSt: Record<string, string>;
  tSt: Record<string, string>;
  thirdShift?: boolean;
  useNewPipeline: boolean;
}

export interface EnforceDeadlinesResult {
  infeasibilities: InfeasibilityEntry[];
  remediations: RemediationProposal[];
}

/**
 * Convert overflow blocks to infeasible when demand is not fully met.
 * Generates remediation proposals for each deficit.
 */
export function enforceDeadlines(input: EnforceDeadlinesInput): EnforceDeadlinesResult {
  const { ops, blocks, toolMap, mSt, tSt, thirdShift, useNewPipeline } = input;

  const infeasibilities: InfeasibilityEntry[] = [];
  const remediations: RemediationProposal[] = [];
  const deadlineReason = useNewPipeline
    ? ('SHIPPING_CUTOFF_VIOLATION' as const)
    : ('DEADLINE_VIOLATION' as const);

  for (const op of ops) {
    const totalDemand = op.d.reduce((s, v) => s + Math.max(v, 0), 0) + Math.max(op.atr, 0);
    if (totalDemand <= 0) continue;
    const produced = getBlockProductionForOp(blocks, op.id);

    if (produced < totalDemand) {
      const tool = toolMap[op.t];
      const deficit = totalDemand - produced;
      const deficitMin = tool && tool.pH > 0 ? (deficit / tool.pH) * 60 : 0;

      // Convert overflow blocks for this op to infeasible — with precise reason
      for (const b of blocks) {
        if (b.opId === op.id && b.type === 'overflow') {
          b.type = 'infeasible';

          if (mSt[b.machineId] === 'down') {
            b.infeasibilityReason = 'MACHINE_DOWN';
            b.infeasibilityDetail = `Máquina ${b.machineId} parada. Procura ${totalDemand}, produzido ${produced}, deficit ${deficit}`;
          } else if (b.effectiveCapacityFactor != null && b.effectiveCapacityFactor < 1.0) {
            b.infeasibilityReason = 'MACHINE_PARTIAL_DOWN';
            b.infeasibilityDetail = `Máquina ${b.machineId} com capacidade reduzida (${Math.round(b.effectiveCapacityFactor * 100)}%). Deficit ${deficit}`;
          } else if (tSt[b.toolId] === 'down') {
            b.infeasibilityReason = 'TOOL_DOWN_TEMPORAL';
            b.infeasibilityDetail = `Ferramenta ${b.toolId} parada. Deficit ${deficit}`;
          } else {
            b.infeasibilityReason = 'CAPACITY_OVERFLOW';
            b.infeasibilityDetail = `Capacidade esgotada em ${b.machineId}. Procura ${totalDemand}, produzido ${produced}, deficit ${deficit}`;
          }
        }
      }

      // Remediation proposals
      if (!thirdShift) {
        remediations.push({
          type: 'THIRD_SHIFT',
          opId: op.id,
          toolId: op.t,
          machineId: op.m,
          capacityGainMin: 420,
          automated: false,
          description: `Activar 3.º turno em ${op.m} — +420 min/dia`,
        });
      }
      if (tool?.alt && tool.alt !== '-') {
        remediations.push({
          type: 'TRANSFER_ALT_MACHINE',
          opId: op.id,
          toolId: op.t,
          machineId: tool.alt,
          capacityGainMin: deficitMin,
          automated: true,
          description: `Mover ${op.t} para ${tool.alt}`,
        });
      }
      remediations.push({
        type: 'ADVANCE_PRODUCTION',
        opId: op.id,
        toolId: op.t,
        machineId: op.m,
        capacityGainMin: deficitMin,
        automated: true,
        description: `Antecipar produção de ${op.t}/${op.sku} — ${deficit} pcs`,
      });
      remediations.push({
        type: 'OVERTIME',
        opId: op.id,
        toolId: op.t,
        machineId: op.m,
        capacityGainMin: Math.min(deficitMin, 120),
        automated: false,
        description: `Overtime em ${op.m} — até +120 min`,
      });
      remediations.push({
        type: 'FORMAL_RISK_ACCEPTANCE',
        opId: op.id,
        toolId: op.t,
        machineId: op.m,
        capacityGainMin: 0,
        automated: false,
        description: `Aceitar atraso de ${deficit} pcs em ${op.sku} — requer aprovação formal`,
      });

      // Determine dominant reason for the infeasibility entry
      const opInfBlocks = blocks.filter((b) => b.opId === op.id && b.type === 'infeasible');
      const dominantReason =
        opInfBlocks.length > 0 && opInfBlocks[0].infeasibilityReason
          ? opInfBlocks[0].infeasibilityReason
          : deadlineReason;

      infeasibilities.push({
        opId: op.id,
        toolId: op.t,
        machineId: op.m,
        reason: dominantReason,
        detail: `Demand ${totalDemand}, produced ${produced}, deficit ${deficit}`,
        attemptedAlternatives: ['Slot allocation', 'Load leveling'],
        suggestion: remediations
          .filter((r) => r.opId === op.id)
          .map((r) => r.description)
          .join('; '),
      });
    }
  }

  return { infeasibilities, remediations };
}
