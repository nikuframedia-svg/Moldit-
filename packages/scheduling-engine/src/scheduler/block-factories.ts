// =====================================================================
//  INCOMPOL PLAN -- Block Factories
//  Factory functions for creating blocked, overflow, and infeasible blocks.
//  Extracted from slot-allocator.ts
// =====================================================================

import { S0 } from '../constants.js';
import type { Block } from '../types/blocks.js';
import type { InfeasibilityReason } from '../types/infeasibility.js';
import type { SkuBucket, ToolGroup } from './demand-grouper.js';

export function mkBlocked(sk: SkuBucket, grp: ToolGroup, di: number, reason: string): Block {
  return {
    opId: sk.opId,
    toolId: grp.toolId,
    sku: sk.sku,
    nm: sk.nm,
    machineId: grp.machineId,
    origM: sk.origM,
    dayIdx: di,
    eddDay: sk.edd,
    qty: 0,
    prodMin: 0,
    setupMin: 0,
    operators: sk.operators,
    blocked: true,
    reason,
    moved: sk.moved,
    hasAlt: sk.hasAlt,
    altM: sk.altM,
    mp: sk.mp,
    stk: sk.stk,
    lt: sk.lt,
    atr: sk.atr,
    startMin: S0,
    endMin: S0,
    setupS: null,
    setupE: null,
    type: 'blocked',
    shift: 'X',
  };
}

export function mkOverflow(sk: SkuBucket, grp: ToolGroup, di: number, ofMin: number): Block {
  return {
    opId: sk.opId,
    toolId: grp.toolId,
    sku: sk.sku,
    nm: sk.nm,
    machineId: grp.machineId,
    origM: sk.origM,
    dayIdx: di,
    eddDay: sk.edd,
    qty: 0,
    prodMin: sk.prodMin,
    setupMin: 0,
    operators: sk.operators,
    blocked: false,
    reason: null,
    moved: sk.moved,
    hasAlt: sk.hasAlt,
    altM: sk.altM,
    mp: sk.mp,
    stk: sk.stk,
    lt: sk.lt,
    atr: sk.atr,
    startMin: S0,
    endMin: S0,
    setupS: null,
    setupE: null,
    type: 'overflow',
    shift: 'X',
    overflow: true,
    overflowMin: ofMin,
  };
}

export function mkInfeasible(
  sk: SkuBucket,
  grp: ToolGroup,
  di: number,
  reason: InfeasibilityReason,
  detail: string,
): Block {
  return {
    opId: sk.opId,
    toolId: grp.toolId,
    sku: sk.sku,
    nm: sk.nm,
    machineId: grp.machineId,
    origM: sk.origM,
    dayIdx: di,
    eddDay: sk.edd,
    qty: 0,
    prodMin: sk.prodMin,
    setupMin: 0,
    operators: sk.operators,
    blocked: false,
    reason: null,
    moved: sk.moved,
    hasAlt: sk.hasAlt,
    altM: sk.altM,
    mp: sk.mp,
    stk: sk.stk,
    lt: sk.lt,
    atr: sk.atr,
    startMin: S0,
    endMin: S0,
    setupS: null,
    setupE: null,
    type: 'infeasible',
    shift: 'X',
    infeasibilityReason: reason,
    infeasibilityDetail: detail,
  };
}
