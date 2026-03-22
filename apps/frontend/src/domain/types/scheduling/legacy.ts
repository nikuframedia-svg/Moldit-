/**
 * Legacy types used only by the web app (not part of scheduling-core).
 * Moved from engine.ts to keep it as a pure barrel.
 */

import type { MoveAction } from './blocks.js';

export interface Decision {
  id: string;
  opId: string;
  type: 'replan' | 'blocked';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  desc: string;
  reasoning: string[];
  impact: Record<string, unknown> | null;
  action: MoveAction | null;
}

export interface AreaCaps {
  PG1: number;
  PG2: number;
}

export interface OpDay {
  pg1: number;
  pg2: number;
  total: number;
}

export interface ObjectiveProfile {
  id: string;
  label: string;
  weights: Record<string, number>;
}
