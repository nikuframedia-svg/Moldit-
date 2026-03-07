// ═══════════════════════════════════════════════════════════
//  ISA-18.2 Alert Types
//
//  Follows ISA-18.2 (Management of Alarm Systems) and
//  EEMUA 191 (Alarm Systems: A Guide to Design, Management
//  and Procurement) guidelines.
// ═══════════════════════════════════════════════════════════

// ── ISA-18.2 Alarm States ──

export type AlarmState =
  | 'UNACK_ACTIVE' // Unacknowledged + condition active (flash)
  | 'ACK_ACTIVE' // Acknowledged + condition still active (solid)
  | 'RTN_UNACK' // Returned to normal + unacknowledged (flash)
  | 'NORMAL' // Normal state (alarm cleared)
  | 'SHELVED' // Temporarily suppressed with timer
  | 'SUPPRESSED'; // Suppressed with reason

// ── ISA-18.2 Priorities ──

export type AlertPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export const PRIORITY_COLORS: Record<AlertPriority, string> = {
  CRITICAL: '#FF0000',
  HIGH: '#FF8C00',
  MEDIUM: '#FFD700',
  LOW: '#00BFFF',
};

export const PRIORITY_BG: Record<AlertPriority, string> = {
  CRITICAL: 'rgba(255, 0, 0, 0.12)',
  HIGH: 'rgba(255, 140, 0, 0.12)',
  MEDIUM: 'rgba(255, 215, 0, 0.12)',
  LOW: 'rgba(0, 191, 255, 0.12)',
};

export const PRIORITY_LABELS: Record<AlertPriority, string> = {
  CRITICAL: 'Critico',
  HIGH: 'Alto',
  MEDIUM: 'Medio',
  LOW: 'Baixo',
};

export const PRIORITY_RESPONSE: Record<AlertPriority, string> = {
  CRITICAL: 'Accao < 15 min',
  HIGH: 'Accao < 1 hora',
  MEDIUM: 'Accao no turno',
  LOW: 'Proximo ciclo',
};

// ── EEMUA 191 Performance Bands ──

export type EEMUABand = 'ROBUST' | 'STABLE' | 'REACTIVE' | 'OVERLOADED';

export const EEMUA_COLORS: Record<EEMUABand, string> = {
  ROBUST: '#22C55E',
  STABLE: '#3B82F6',
  REACTIVE: '#F59E0B',
  OVERLOADED: '#EF4444',
};

export const EEMUA_LABELS: Record<EEMUABand, string> = {
  ROBUST: 'Robusto',
  STABLE: 'Estavel',
  REACTIVE: 'Reactivo',
  OVERLOADED: 'Sobrecarregado',
};

/** EEMUA 191 thresholds: alarms per 10 minutes per operator */
export const EEMUA_THRESHOLDS: Record<EEMUABand, { max: number }> = {
  ROBUST: { max: 1 },
  STABLE: { max: 2 },
  REACTIVE: { max: 5 },
  OVERLOADED: { max: Infinity },
};

// ── Alarm Entity ──

export interface Alert {
  id: string;
  state: AlarmState;
  priority: AlertPriority;
  /** Source machine or system */
  source: string;
  /** What happened */
  cause: string;
  /** What will happen if not addressed */
  consequence: string;
  /** What the operator should do */
  correctiveAction: string;
  /** Timestamp of alarm activation */
  activatedAt: string;
  /** Timestamp of acknowledgement (if any) */
  acknowledgedAt?: string;
  /** Shelve expiry ISO timestamp */
  shelveExpiresAt?: string;
  /** Shelve justification */
  shelveReason?: string;
  /** Suppression reason */
  suppressionReason?: string;
  /** Related operation/block ID */
  relatedOpId?: string;
}

// ── Helpers ──

export function classifyEEMUA(alarmsPerTenMin: number): EEMUABand {
  if (alarmsPerTenMin <= EEMUA_THRESHOLDS.ROBUST.max) return 'ROBUST';
  if (alarmsPerTenMin <= EEMUA_THRESHOLDS.STABLE.max) return 'STABLE';
  if (alarmsPerTenMin <= EEMUA_THRESHOLDS.REACTIVE.max) return 'REACTIVE';
  return 'OVERLOADED';
}

export function isFlashing(state: AlarmState): boolean {
  return state === 'UNACK_ACTIVE' || state === 'RTN_UNACK';
}

export function isActive(state: AlarmState): boolean {
  return state === 'UNACK_ACTIVE' || state === 'ACK_ACTIVE';
}

export function isStanding(alert: Alert): boolean {
  return alert.state === 'UNACK_ACTIVE' || alert.state === 'ACK_ACTIVE';
}
