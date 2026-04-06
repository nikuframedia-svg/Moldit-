/** Centralized thresholds — Moldit mold production.
 *
 * Compliance: 0-1 fraction (0.95 = 95%).
 * Stress: 0-100 percentage.
 */
export const TH = {
  COMPLIANCE_GREEN: 0.95,
  COMPLIANCE_ORANGE: 0.80,
  STRESS_WARN: 70,
  STRESS_ORANGE: 85,
  STRESS_RED: 90,
} as const;
