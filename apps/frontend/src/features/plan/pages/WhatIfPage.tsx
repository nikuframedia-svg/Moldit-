import { SchedulingPage } from '@/features/scheduling';
import { useUIStore } from '@/stores/useUIStore';

export function WhatIfPage() {
  const panelOpen = useUIStore((s) => s.contextPanelOpen);
  return (
    <div style={{ marginRight: panelOpen ? 360 : 0, transition: 'margin-right 0.25s ease' }}>
      <SchedulingPage initialView="whatif" />
    </div>
  );
}
