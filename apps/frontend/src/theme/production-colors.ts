// ═══════════════════════════════════════════════════════════
//  ISA-101 Production Color Palette
//
//  Based on ISA-101.01-2015: Human Machine Interfaces
//  for Process Automation Systems.
//
//  Usage: import { PRODUCTION_COLORS } from '@/theme/production-colors'
// ═══════════════════════════════════════════════════════════

/** ISA-101 equipment states */
export const EQUIPMENT_STATE = {
  /** Equipment running normally */
  running: '#22C55E',
  /** Equipment stopped (intentional) */
  stopped: '#9CA3AF',
  /** Transitioning between states */
  transition: '#F59E0B',
  /** Manual / local control */
  manual: '#3B82F6',
  /** Out of service */
  outOfService: '#6B7280',
  /** Planned maintenance (ISA-101 blue) */
  maintenance: '#3B82F6',
  /** Idle — no production assigned */
  idle: '#6B7280',
} as const;

/** ISA-101 alarm priorities */
export const ALARM_PRIORITY = {
  critical: '#DC2626',
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#3B82F6',
  info: '#6B7280',
} as const;

/** Gantt block status colors */
export const GANTT_STATUS = {
  ontime: '#22C55E',
  late: '#EF4444',
  atRisk: '#F59E0B',
  setup: '#8B5CF6',
  idle: '#E5E7EB',
  blocked: '#9CA3AF',
  overflow: '#DC2626',
  infeasible: '#991B1B',
} as const;

/** Background variants (lighter, for fills/highlights) */
export const GANTT_STATUS_BG = {
  ontime: 'rgba(34, 197, 94, 0.15)',
  late: 'rgba(239, 68, 68, 0.15)',
  atRisk: 'rgba(245, 158, 11, 0.15)',
  setup: 'rgba(139, 92, 246, 0.15)',
  idle: 'rgba(229, 231, 235, 0.08)',
  blocked: 'rgba(156, 163, 175, 0.15)',
  overflow: 'rgba(220, 38, 38, 0.15)',
  infeasible: 'rgba(153, 27, 27, 0.15)',
} as const;

/** ISA-101 surface / layout colors */
export const SURFACE = {
  /** Page background (ISA-101: light neutral) */
  background: '#F0F0F0',
  /** Card / panel background */
  card: '#FFFFFF',
  /** Raised element (popovers, dropdowns) */
  raised: '#FFFFFF',
  /** Header / table header */
  header: '#F1F5F9',
  /** Border: default */
  border: '#E2E8F0',
  /** Border: subtle (low contrast) */
  borderSubtle: '#F1F5F9',
} as const;

/** Text colors */
export const TEXT = {
  primary: '#000000',
  secondary: '#475569',
  muted: '#94A3B8',
  inverse: '#FFFFFF',
} as const;

/** Primary brand / action color */
export const PRIMARY = {
  base: '#818CF8',
  hover: '#6366F1',
  light: 'rgba(129, 140, 248, 0.12)',
  dark: '#4F46E5',
} as const;

/** Consolidated export */
export const PRODUCTION_COLORS = {
  equipment: EQUIPMENT_STATE,
  alarm: ALARM_PRIORITY,
  gantt: GANTT_STATUS,
  ganttBg: GANTT_STATUS_BG,
  surface: SURFACE,
  text: TEXT,
  primary: PRIMARY,
} as const;
