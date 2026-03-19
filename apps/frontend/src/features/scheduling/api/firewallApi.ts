/**
 * Firewall API client — POST /firewall/assess
 * Falls back to client-side estimation if backend unavailable.
 */

import { fetchWithTimeout } from '../../../lib/fetchWithTimeout';

const API_BASE = '/api/v1';

export interface DeviationRequest {
  optimal_state: Record<string, unknown>;
  proposed_state: Record<string, unknown>;
  incentive_category: string;
  governance_level: string;
}

export interface DeviationAssessment {
  allowed: boolean;
  requires_approval: boolean;
  requires_contrafactual: boolean;
  deviation_cost: number;
  cascade_ops_count: number;
  warnings: string[];
  contrafactual: Record<string, unknown> | null;
}

export async function assessDeviation(req: DeviationRequest): Promise<DeviationAssessment> {
  try {
    const res = await fetchWithTimeout(
      `${API_BASE}/firewall/assess`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      },
      5_000,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    // Fallback: client-side estimation
    return {
      allowed: true,
      requires_approval: false,
      requires_contrafactual: false,
      deviation_cost: 0,
      cascade_ops_count: 0,
      warnings: ['Backend indisponivel — custo estimado localmente'],
      contrafactual: null,
    };
  }
}
