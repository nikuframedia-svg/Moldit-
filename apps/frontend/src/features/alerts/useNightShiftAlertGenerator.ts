/**
 * useNightShiftAlertGenerator — Generates ISA-18.2 alert when the scheduling
 * engine recommends activating a third shift (Z: 00:00-07:00) because two
 * shifts are insufficient. Runs globally (mounted in Layout).
 */

import { useEffect, useRef } from 'react';
import { useScheduleData } from '../../hooks/useScheduleData';
import { useSettingsStore } from '../../stores/useSettingsStore';
import type { Alert } from './alert-types';
import { useAlertStore } from './useAlertStore';

const ALERT_ID = 'night-shift-recommended';

function buildNightShiftAlert(): Alert {
  return {
    id: ALERT_ID,
    state: 'UNACK_ACTIVE',
    priority: 'HIGH',
    source: 'SYSTEM',
    cause: '2 turnos insuficientes — turno noite recomendado',
    consequence: 'Encomendas em risco de atraso sem capacidade adicional',
    correctiveAction: 'Activar turno noite em Definicoes > Turnos',
    activatedAt: new Date().toISOString(),
  };
}

/**
 * Watches scheduling feasibility for THIRD_SHIFT remediation proposals.
 * Adds/removes a single ISA-18.2 HIGH alert accordingly.
 */
export function useNightShiftAlertGenerator(): void {
  const { thirdShiftRecommended } = useScheduleData();
  const thirdShiftDefault = useSettingsStore((s) => s.thirdShiftDefault);
  const addAlert = useAlertStore((s) => s.addAlert);
  const removeAlert = useAlertStore((s) => s.removeAlert);
  const alerts = useAlertStore((s) => s.alerts);
  const prevActiveRef = useRef(false);

  useEffect(() => {
    const shouldShow = thirdShiftRecommended && !thirdShiftDefault;
    const exists = alerts.some((a) => a.id === ALERT_ID);

    if (shouldShow && !exists) {
      addAlert(buildNightShiftAlert());
    } else if (!shouldShow && exists && prevActiveRef.current) {
      removeAlert(ALERT_ID);
    }

    prevActiveRef.current = shouldShow;
  }, [thirdShiftRecommended, thirdShiftDefault, addAlert, removeAlert, alerts]);
}
