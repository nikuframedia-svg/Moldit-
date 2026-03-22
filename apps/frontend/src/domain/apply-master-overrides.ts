/**
 * applyMasterOverrides — Apply manual overrides (highest priority layer) onto NikufraData.
 *
 * Priority: Override manual > ISOP upload > Fixture fallback
 * Pure function — no store dependency.
 */

import type { MachineOverride, ToolOverride } from '../stores/useMasterDataStore';
import type { NikufraData } from './nikufra-types';

export function applyMasterOverrides(
  data: NikufraData,
  toolOverrides: Record<string, ToolOverride>,
  machineOverrides: Record<string, MachineOverride>,
): NikufraData {
  const hasToolOv = Object.keys(toolOverrides).length > 0;
  const hasMachineOv = Object.keys(machineOverrides).length > 0;
  if (!hasToolOv && !hasMachineOv) return data;

  const mergedTools = hasToolOv
    ? data.tools.map((tool) => {
        const ov = toolOverrides[tool.id];
        if (!ov) return tool;
        return {
          ...tool,
          ...(ov.m !== undefined && { m: ov.m }),
          ...(ov.alt !== undefined && { alt: ov.alt }),
          ...(ov.s !== undefined && { s: ov.s }),
          ...(ov.pH !== undefined && { pH: ov.pH }),
          ...(ov.op !== undefined && { op: ov.op }),
        };
      })
    : data.tools;

  // Propagate tool overrides to operations
  const mergedOps = hasToolOv
    ? data.operations.map((op) => {
        const ov = toolOverrides[op.t];
        if (!ov) return op;
        return {
          ...op,
          ...(ov.pH !== undefined && { pH: ov.pH }),
          ...(ov.s !== undefined && { s: ov.s }),
          ...(ov.op !== undefined && { op: ov.op }),
          ...(ov.m !== undefined && { m: ov.m }),
        };
      })
    : data.operations;

  const mergedMachines = hasMachineOv
    ? data.machines.map((machine) => {
        const ov = machineOverrides[machine.id];
        if (!ov) return machine;
        return {
          ...machine,
          ...(ov.area !== undefined && { area: ov.area }),
          ...(ov.status !== undefined && { status: ov.status }),
        };
      })
    : data.machines;

  return { ...data, tools: mergedTools, operations: mergedOps, machines: mergedMachines };
}
