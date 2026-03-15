// ═══════════════════════════════════════════════════════════
//  useThemeColors — Bridge hook replacing C constant
//
//  Maps the old `C.xxx` palette to CSS variables.
//  Usage: const colors = useThemeColors();
//         style={{ color: colors.t2 }}
//
//  Prefer CSS variables directly where possible:
//    className="..." with var(--text-secondary)
//  Use this hook only for inline styles that need JS values.
// ═══════════════════════════════════════════════════════════

const GLASS_COLORS = {
  // Backgrounds
  bg: 'var(--bg-void)',
  s1: 'var(--bg-surface-solid)',
  s2: 'var(--bg-base)',
  s3: 'var(--bg-raised)',

  // Borders
  bd: 'var(--border-default)',
  bh: 'var(--border-hover)',

  // Text
  t1: 'var(--text-primary)',
  t2: 'var(--text-secondary)',
  t3: 'var(--text-muted)',
  t4: 'var(--text-ghost)',

  // Accent
  ac: 'var(--accent)',
  acS: 'var(--accent-bg)',
  acM: 'var(--accent-border)',

  // Semantic
  rd: 'var(--semantic-red)',
  rdS: 'var(--semantic-red-bg)',
  rdM: 'rgba(248, 113, 113, 0.25)',
  yl: 'var(--semantic-amber)',
  ylS: 'var(--semantic-amber-bg)',
  bl: 'var(--semantic-blue)',
  blS: 'var(--semantic-blue-bg)',
  pp: 'var(--accent)',
  ppS: 'var(--accent-bg)',
  cy: 'var(--semantic-cyan)',
  w: 'var(--text-primary)',

  // Glass-specific
  glassBg: 'var(--glass-bg)',
  glassBorder: 'var(--glass-border)',

  // Semantic solid
  ok: 'var(--semantic-green)',
  okDim: 'var(--semantic-green-bg)',
  warn: 'var(--semantic-amber)',
  warnDim: 'var(--semantic-amber-bg)',
  crit: 'var(--semantic-red)',
  critDim: 'var(--semantic-red-bg)',
} as const;

export type ThemeColors = typeof GLASS_COLORS;

/** Returns glass theme color palette for use in inline styles */
export function useThemeColors(): ThemeColors {
  return GLASS_COLORS;
}
