/**
 * Heatmap utilization color bands.
 * Returns a background color for a given utilization ratio (0.0–1.0+).
 * Zero-utilization returns a subtle dark fill (not transparent) for visibility.
 */
export function utilColor(u: number): string {
  if (u <= 0) return 'rgba(255,255,255,0.03)';
  if (u < 0.3) return 'rgba(20,184,166,0.15)';
  if (u < 0.6) return 'rgba(20,184,166,0.25)';
  if (u < 0.85) return 'rgba(245,158,11,0.25)';
  if (u <= 1.0) return 'rgba(245,158,11,0.40)';
  return 'rgba(239,68,68,0.35)';
}
