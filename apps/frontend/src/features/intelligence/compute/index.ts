// compute/index.ts — Barrel re-export + computeAll orchestrator

// Feature 3: Bottleneck Cascade
export type { BottleneckNode, ReliefPath } from './bottleneck';
export { computeBottleneckCascade } from './bottleneck';
// Feature 8: Capacity Horizon
export type { CapacityBar } from './capacity-horizon';
export { computeCapacityHorizon } from './capacity-horizon';
// Feature 2: Client Risk
export type { ClientRisk, ClientRiskSku } from './client-risk';
export { computeClientRisk } from './client-risk';
// Constants
export { CUSTOMER_BY_ITEM_RANGE, getCustomerForItem, MACHINE_AREA, MACHINES } from './constants';
// Feature 5: Cross-Client
export type { CrossClientSku } from './cross-client';
export { computeCrossClientAggregation } from './cross-client';
// Date context
export {
  ALL_DATES,
  buildDateContext,
  dayName,
  fmtDate,
  IS_WORKING,
  WORKING_DATES,
  workingDaysBetween,
} from './date-context';
// Feature 10: Explain Trace
export type { ExplainNode, ExplainStep } from './explain-trace';
export { computeExplainTrace } from './explain-trace';
// Feature 1: Demand Heatmap
export type { HeatmapCell } from './heatmap';
export { computeDemandHeatmap } from './heatmap';
// Index builders
export type { RoutingIndex } from './index-builders';
export {
  buildRoutingIndex,
  buildSeriesByItemId,
  buildSeriesBySkuDate,
  buildToolIndex,
} from './index-builders';
// Feature 7: Machine Network
export type { NetworkEdge, NetworkNode } from './machine-network';
export { computeMachineNetwork } from './machine-network';
// Feature 4: Setup Crew Timeline
export type { SetupSlot } from './setup-timeline';
export { computeSetupCrewTimeline } from './setup-timeline';
// Feature 6: Tool Grouping
export type { ToolGroupResult } from './tool-grouping';
export { computeToolGrouping } from './tool-grouping';
// Types
export type {
  DateContext,
  NkData,
  NkMachine,
  NkTool,
  SnapshotCustomer,
  SnapshotFixture,
  SnapshotItem,
  SnapshotResource,
  SnapshotRouting,
  SnapshotRoutingOp,
  SnapshotSeriesEntry,
  SnapshotTool,
} from './types';
// Feature 9: Urgency Matrix
export type { UrgencyPoint } from './urgency-matrix';
export { computeUrgencyMatrix } from './urgency-matrix';

// ─── Master Compute ───────────────────────────────────────────────────

import type { BottleneckNode } from './bottleneck';
import { computeBottleneckCascade } from './bottleneck';
import type { CapacityBar } from './capacity-horizon';
import { computeCapacityHorizon } from './capacity-horizon';
import type { ClientRisk } from './client-risk';
import { computeClientRisk } from './client-risk';
import { MACHINES } from './constants';
import type { CrossClientSku } from './cross-client';
import { computeCrossClientAggregation } from './cross-client';
import { buildDateContext } from './date-context';
import type { ExplainNode } from './explain-trace';
import { computeExplainTrace } from './explain-trace';
import type { HeatmapCell } from './heatmap';
import { computeDemandHeatmap } from './heatmap';
import type { NetworkEdge, NetworkNode } from './machine-network';
import { computeMachineNetwork } from './machine-network';
import type { SetupSlot } from './setup-timeline';
import { computeSetupCrewTimeline } from './setup-timeline';
import type { ToolGroupResult } from './tool-grouping';
import { computeToolGrouping } from './tool-grouping';
import type { NkData, SnapshotFixture } from './types';
import type { UrgencyPoint } from './urgency-matrix';
import { computeUrgencyMatrix } from './urgency-matrix';

export interface IntelData {
  heatmap: HeatmapCell[][];
  clientRisk: ClientRisk[];
  bottlenecks: BottleneckNode[];
  setupTimeline: SetupSlot[];
  crossClient: CrossClientSku[];
  toolGrouping: ToolGroupResult[];
  network: { nodes: NetworkNode[]; edges: NetworkEdge[] };
  horizon: CapacityBar[];
  urgency: UrgencyPoint[];
  explain: ExplainNode[];
  machines: typeof MACHINES;
  workingDates: string[];
}

export function computeAll(snap: SnapshotFixture | null, nk: NkData): IntelData {
  const ctx = buildDateContext(nk);
  const setupTimeline = computeSetupCrewTimeline(nk, ctx);
  const toolGrouping = computeToolGrouping(nk);

  if (!snap) {
    return {
      heatmap: [],
      clientRisk: [],
      bottlenecks: [],
      setupTimeline,
      crossClient: [],
      toolGrouping,
      network: { nodes: [], edges: [] },
      horizon: [],
      urgency: [],
      explain: [],
      machines: MACHINES,
      workingDates: [...ctx.workingDates],
    };
  }

  const heatmap = computeDemandHeatmap(snap, nk, ctx);
  const horizon = computeCapacityHorizon(snap, nk, ctx);
  const urgency = computeUrgencyMatrix(snap, nk, ctx);
  const crossClient = computeCrossClientAggregation(snap, nk);
  const clientRisk = computeClientRisk(snap, nk, ctx);
  const bottlenecks = computeBottleneckCascade(heatmap, snap, nk);
  const network = computeMachineNetwork(nk, heatmap, ctx);
  const explain = computeExplainTrace(snap, nk, heatmap);

  return {
    heatmap,
    clientRisk,
    bottlenecks,
    setupTimeline,
    crossClient,
    toolGrouping,
    network,
    horizon,
    urgency,
    explain,
    machines: MACHINES,
    workingDates: [...ctx.workingDates],
  };
}
