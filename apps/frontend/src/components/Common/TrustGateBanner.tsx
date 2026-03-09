/**
 * TrustGateBanner — Warning banner when TrustIndex gate is low.
 * Shown at top of main content area.
 */

import { useDataStore } from '@/stores/useDataStore';
import './TrustIndexBadge.css';

export function TrustGateBanner() {
  const trustScore = useDataStore((s) => s.meta?.trustScore);

  if (trustScore == null || trustScore >= 0.7) return null;

  if (trustScore < 0.5) {
    return (
      <div className="ti-gate-banner ti-gate-banner--manual" data-testid="trust-gate-banner">
        Dados com baixa confianca. Automacao limitada.
      </div>
    );
  }

  return (
    <div className="ti-gate-banner ti-gate-banner--suggestion" data-testid="trust-gate-banner">
      Sugestoes do scheduler podem nao ser fiaveis.
    </div>
  );
}
