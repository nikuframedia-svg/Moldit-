/**
 * Decision Ledger API client.
 * Falls back to localStorage if backend unavailable.
 */

const API_BASE = '/api/v1';
const LOCAL_KEY = 'pp1-ledger-fallback';

export interface LedgerEntryCreate {
  tenant_id: string;
  user_id: string;
  decision_type: string;
  optimal_state: Record<string, unknown>;
  proposed_state: Record<string, unknown>;
  deviation_cost: number;
  incentive_category: string;
  declared_reason: string;
  governance_level: string;
  contrafactual?: Record<string, unknown> | null;
}

export interface LedgerEntryResponse extends LedgerEntryCreate {
  id: string;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export async function createLedgerEntry(data: LedgerEntryCreate): Promise<LedgerEntryResponse> {
  try {
    const res = await fetch(`${API_BASE}/ledger/entries`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    // Fallback: store locally
    const entry: LedgerEntryResponse = {
      ...data,
      id: crypto.randomUUID(),
      approved_by: null,
      approved_at: null,
      created_at: new Date().toISOString(),
    };
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as LedgerEntryResponse[];
    stored.push(entry);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(stored.slice(-100)));
    return entry;
  }
}

export async function listLedgerEntries(): Promise<LedgerEntryResponse[]> {
  try {
    const res = await fetch(`${API_BASE}/ledger/entries`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as LedgerEntryResponse[];
  }
}
