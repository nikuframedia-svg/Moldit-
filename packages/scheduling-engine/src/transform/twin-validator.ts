// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — Twin Pieces Validator (Pecas Gemeas)
//  Validates operational credibility of 1:1 twin piece pairs
//
//  Validation Rules (ALL must pass for a valid pair):
//    1. No self-reference (sku !== twinSku)
//    2. Counterpart exists in operations
//    3. Bidirectional link (A→B AND B→A)
//    4. Machine must match
//    5. Tool must match
//    6. Pecas/H must match
//    7. Nº Pessoas must match
//
//  Fields that CAN differ:
//    - Lote economico
//    - Prz.Fabrico (ltDays)
//
//  Invalid pairs → single-SKU mode + warning
//  Pure function — no side effects
// ═══════════════════════════════════════════════════════════

import type {
  TwinAnomalyCode,
  TwinAnomalyEntry,
  TwinGroup,
  TwinValidationReport,
} from '../types/twin.js';

// ── Input type (decoupled from engine types) ──────────────

export interface TwinValidationInput {
  id: string;
  sku: string;
  machine: string;
  tool: string;
  pH: number;
  operators: number;
  twin?: string;
  ltDays?: number;
  lotEconomic?: number;
}

// ── Validation logic ──────────────────────────────────────

function validatePair(
  op: TwinValidationInput,
  counterpart: TwinValidationInput | undefined,
): TwinAnomalyEntry | null {
  const twinSku = op.twin!.trim();

  // Rule 1: Self-reference
  if (twinSku === op.sku) {
    return {
      opId: op.id,
      sku: op.sku,
      twinSku,
      code: 'self_reference',
      detail: `Operação ${op.id} (${op.sku}): referência circular — peça gémea aponta para si própria`,
      machine: op.machine,
      tool: op.tool,
    };
  }

  // Rule 2: Counterpart exists
  if (!counterpart) {
    return {
      opId: op.id,
      sku: op.sku,
      twinSku,
      code: 'counterpart_missing',
      detail: `Operação ${op.id} (${op.sku}): peça gémea ${twinSku} não encontrada nas operações`,
      machine: op.machine,
      tool: op.tool,
    };
  }

  // Rule 3: Bidirectional link
  if (!counterpart.twin || counterpart.twin.trim() !== op.sku) {
    return {
      opId: op.id,
      sku: op.sku,
      twinSku,
      code: 'one_way_link',
      detail: `Operação ${op.id} (${op.sku}): ligação unidirecional — ${op.sku}→${counterpart.sku} mas ${counterpart.sku} não referencia ${op.sku}`,
      machine: op.machine,
      tool: op.tool,
      counterpartMachine: counterpart.machine,
      counterpartTool: counterpart.tool,
    };
  }

  // Rule 4: Machine match
  if (op.machine !== counterpart.machine) {
    return {
      opId: op.id,
      sku: op.sku,
      twinSku,
      code: 'machine_mismatch',
      detail: `Operação ${op.id} (${op.sku}): máquinas diferentes — ${op.machine} vs ${counterpart.machine}`,
      machine: op.machine,
      tool: op.tool,
      counterpartMachine: counterpart.machine,
      counterpartTool: counterpart.tool,
    };
  }

  // Rule 5: Tool match
  if (op.tool !== counterpart.tool) {
    return {
      opId: op.id,
      sku: op.sku,
      twinSku,
      code: 'tool_mismatch',
      detail: `Operação ${op.id} (${op.sku}): ferramentas diferentes — ${op.tool} vs ${counterpart.tool}`,
      machine: op.machine,
      tool: op.tool,
      counterpartMachine: counterpart.machine,
      counterpartTool: counterpart.tool,
    };
  }

  // Rule 6: Pecas/H match
  if (op.pH !== counterpart.pH) {
    return {
      opId: op.id,
      sku: op.sku,
      twinSku,
      code: 'rate_mismatch',
      detail: `Operação ${op.id} (${op.sku}): peças/hora diferentes — ${op.pH} vs ${counterpart.pH}`,
      machine: op.machine,
      tool: op.tool,
      counterpartMachine: counterpart.machine,
      counterpartTool: counterpart.tool,
    };
  }

  // Rule 7: Operator count match
  if (op.operators !== counterpart.operators) {
    return {
      opId: op.id,
      sku: op.sku,
      twinSku,
      code: 'people_mismatch',
      detail: `Operação ${op.id} (${op.sku}): nº operadores diferente — ${op.operators} vs ${counterpart.operators}`,
      machine: op.machine,
      tool: op.tool,
      counterpartMachine: counterpart.machine,
      counterpartTool: counterpart.tool,
    };
  }

  // All checks passed
  return null;
}

// ── Main export ───────────────────────────────────────────

/**
 * Validate twin piece references across all operations.
 *
 * Returns valid TwinGroup[] and TwinValidationReport with anomalies.
 * Pure function — no side effects.
 */
export function validateTwinReferences(ops: TwinValidationInput[]): TwinValidationReport {
  const anomalies: TwinAnomalyEntry[] = [];
  const twinGroups: TwinGroup[] = [];

  // Track which operations have already been paired to avoid double-counting.
  // Uses opId (not SKU pair) so that multiple operations for the same SKU pair
  // (e.g. different clients) each get their own TwinGroup.
  const pairedOps = new Set<string>();

  // Build SKU → ALL operations lookup (multi-client: same SKU, different ops)
  const skuOps = new Map<string, TwinValidationInput[]>();
  for (const op of ops) {
    const list = skuOps.get(op.sku);
    if (list) list.push(op);
    else skuOps.set(op.sku, [op]);
  }

  // Filter ops with twin references
  const opsWithTwin = ops.filter((op) => op.twin && op.twin.trim() !== '');
  const totalTwinRefs = opsWithTwin.length;

  for (const op of opsWithTwin) {
    // Skip if this operation was already paired as a counterpart
    if (pairedOps.has(op.id)) continue;

    const twinSku = op.twin!.trim();

    // Find best counterpart: prefer bidirectional AND not already paired
    const candidates = skuOps.get(twinSku) ?? [];
    const counterpart =
      candidates.find((c) => c.twin?.trim() === op.sku && !pairedOps.has(c.id)) ??
      candidates.find((c) => !pairedOps.has(c.id)) ?? // fallback to any unpaired (will fail rule 3)
      undefined;
    const anomaly = validatePair(op, counterpart);

    if (anomaly) {
      anomalies.push(anomaly);
      pairedOps.add(op.id);
      // Only mark counterpart if it references this op (bidirectional but failed).
      // If counterpart has a different twin target, leave it free for its own pairing.
      if (counterpart && counterpart.twin?.trim() === op.sku) {
        pairedOps.add(counterpart.id);
      }
    } else {
      // Valid pair — create TwinGroup
      twinGroups.push({
        opId1: op.id,
        opId2: counterpart!.id,
        sku1: op.sku,
        sku2: counterpart!.sku,
        machine: op.machine,
        tool: op.tool,
        pH: op.pH,
        operators: op.operators,
        lotEconomicDiffers: (op.lotEconomic ?? 0) !== (counterpart!.lotEconomic ?? 0),
        leadTimeDiffers: (op.ltDays ?? 0) !== (counterpart!.ltDays ?? 0),
      });
      pairedOps.add(op.id);
      pairedOps.add(counterpart!.id);
    }
  }

  // Build statistics by anomaly code
  const byCode: Partial<Record<TwinAnomalyCode, number>> = {};
  for (const a of anomalies) {
    byCode[a.code] = (byCode[a.code] ?? 0) + 1;
  }

  return {
    totalTwinRefs,
    validGroups: twinGroups.length,
    invalidRefs: anomalies.length,
    anomalies,
    byCode,
    twinGroups,
  };
}
