/**
 * Shared utilities for the SetupTable component family.
 */

export function setupColor(min: number): string {
  if (min <= 0) return 'var(--bg-raised)';
  if (min < 30) return 'var(--accent)';
  if (min <= 60) return 'var(--semantic-amber)';
  return 'var(--semantic-red)';
}
