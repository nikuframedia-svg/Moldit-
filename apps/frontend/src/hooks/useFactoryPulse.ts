// ═══════════════════════════════════════════════════════════
//  useFactoryPulse — Factory headline from schedule + andon
//  Returns a single "pulse" object for the console header.
// ═══════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { formatTimeSince } from '@/utils/explicitText';
import { useScheduleData } from './useScheduleData';
import { useAndonDowntimes } from '@/stores/useAndonStore';

export interface UrgentItem {
  id: string;
  icon: 'machine' | 'delivery' | 'stock';
  text: string;
  semantic: 'critical' | 'warning';
}

export interface FactoryPulse {
  status: 'ok' | 'warning' | 'critical';
  headline: string;
  subline: string;
  urgentItems: UrgentItem[];
}

export function useFactoryPulse(): FactoryPulse | null {
  const { metrics, coverageAudit, validation, engine, loading } = useScheduleData();
  const downtimes = useAndonDowntimes();

  return useMemo(() => {
    if (loading || !engine) return null;

    const totalMachines = engine.machines.length;
    const downMachineIds = Object.keys(downtimes);
    const activeMachines = totalMachines - downMachineIds.length;
    const urgent: UrgentItem[] = [];

    // Machine downtimes
    for (const [mId, dt] of Object.entries(downtimes)) {
      const elapsed = formatTimeSince(dt.startedAt);
      urgent.push({
        id: `down-${mId}`,
        icon: 'machine',
        text: `${mId} parada ${elapsed}`,
        semantic: 'critical',
      });
    }

    // Late deliveries (tardiness > 0)
    const tardyCount = metrics ? Math.round(metrics.tardinessDays) : 0;
    if (tardyCount > 0) {
      urgent.push({
        id: 'tardy',
        icon: 'delivery',
        text: `${tardyCount} dia${tardyCount > 1 ? 's' : ''} de atraso acumulado em entregas`,
        semantic: 'critical',
      });
    }

    // Coverage gaps
    if (coverageAudit && !coverageAudit.isComplete) {
      const missing = coverageAudit.zeroCovered + coverageAudit.partiallyCovered;
      if (missing > 0) {
        urgent.push({
          id: 'coverage',
          icon: 'stock',
          text: `${missing} operacao${missing > 1 ? 'es' : ''} com cobertura incompleta`,
          semantic: missing > 5 ? 'critical' : 'warning',
        });
      }
    }

    // Violations
    const violCount = validation?.violations.length ?? 0;
    if (violCount > 0) {
      urgent.push({
        id: 'violations',
        icon: 'delivery',
        text: `${violCount} violacao${violCount > 1 ? 'es' : ''} de restricoes detectada${violCount > 1 ? 's' : ''}`,
        semantic: violCount > 3 ? 'critical' : 'warning',
      });
    }

    // Determine overall status
    const hasCritical = urgent.some((u) => u.semantic === 'critical');
    const hasWarning = urgent.some((u) => u.semantic === 'warning');
    const status: FactoryPulse['status'] = hasCritical
      ? 'critical'
      : hasWarning
        ? 'warning'
        : 'ok';

    // Build headline
    let headline: string;
    let subline: string;

    if (downMachineIds.length > 0) {
      const first = downMachineIds[0];
      const elapsed = formatTimeSince(downtimes[first].startedAt);
      headline =
        downMachineIds.length === 1
          ? `${first} parada ${elapsed}.`
          : `${downMachineIds.length} maquinas paradas.`;
      subline =
        urgent.length > 1
          ? `${urgent.length} problemas precisam da tua atencao.`
          : `Restantes ${activeMachines} prensas a funcionar normalmente.`;
    } else if (hasCritical) {
      headline = `${urgent.length} problema${urgent.length > 1 ? 's' : ''} precisa${urgent.length > 1 ? 'm' : ''} de atencao.`;
      subline = `${activeMachines} de ${totalMachines} prensas activas.`;
    } else if (hasWarning) {
      headline = `Atencao — ${urgent.length} item${urgent.length > 1 ? 'ns' : ''} a monitorizar.`;
      subline = `${activeMachines} de ${totalMachines} prensas activas. Maioria das entregas no prazo.`;
    } else {
      headline = 'Fabrica a funcionar normalmente.';
      const otdStr = metrics
        ? `${metrics.otdDelivery.toFixed(0)}% das entregas no prazo.`
        : '';
      subline = `${activeMachines} de ${totalMachines} prensas activas. ${otdStr}`;
    }

    return { status, headline, subline, urgentItems: urgent };
  }, [metrics, coverageAudit, validation, engine, loading, downtimes]);
}
