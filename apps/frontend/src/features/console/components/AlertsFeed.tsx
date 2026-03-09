/**
 * AlertsFeed — Top 10 ISA-18.2 alerts with EEMUA badge and inline Acknowledge.
 * Uses AlarmItem from Industrial/ and alert store from features/alerts.
 */

import { useMemo } from 'react';
import { Collapsible } from '@/components/Common/Collapsible';
import type { AlarmPriority } from '@/components/Industrial/AlarmItem';
import { AlarmItem } from '@/components/Industrial/AlarmItem';
import type { Alert, AlertPriority as ISAPriority } from '@/features/alerts';
import {
  classifyEEMUA,
  EEMUA_COLORS,
  EEMUA_LABELS,
  isFlashing,
  PRIORITY_COLORS,
  useActiveAlerts,
  useAlertStore,
} from '@/features/alerts';
import './AlertsFeed.css';

const PRIORITY_ORDER: Record<ISAPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function mapPriority(p: ISAPriority): AlarmPriority {
  return p.toLowerCase() as AlarmPriority;
}

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `ha ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `ha ${h}h`;
  return `ha ${Math.floor(h / 24)}d`;
}

export function AlertsFeed() {
  const activeAlerts = useActiveAlerts();
  const alarmsPerTenMin = useAlertStore((s) => s.alarmsPerTenMin);
  const acknowledge = useAlertStore((s) => s.acknowledge);

  const sorted = useMemo(() => {
    return [...activeAlerts]
      .sort((a, b) => {
        const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (pDiff !== 0) return pDiff;
        return new Date(b.activatedAt).getTime() - new Date(a.activatedAt).getTime();
      })
      .slice(0, 10);
  }, [activeAlerts]);

  const priorityCounts = useMemo(() => {
    const counts: Record<ISAPriority, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const a of activeAlerts) {
      counts[a.priority]++;
    }
    return counts;
  }, [activeAlerts]);

  const eemua = classifyEEMUA(alarmsPerTenMin);

  return (
    <div data-testid="alerts-feed">
      <Collapsible
        title="Alertas ISA-18.2"
        defaultOpen={sorted.length > 0}
        badge={activeAlerts.length > 0 ? `${activeAlerts.length}` : undefined}
      >
        {/* Header: priority counts + EEMUA badge */}
        <div className="afeed__header">
          <div className="afeed__counts">
            {(Object.keys(priorityCounts) as ISAPriority[]).map((p) => (
              <span key={p} className="afeed__count" style={{ color: PRIORITY_COLORS[p] }}>
                {p.charAt(0)}: {priorityCounts[p]}
              </span>
            ))}
          </div>
          <span
            className="afeed__eemua"
            style={{
              background: `${EEMUA_COLORS[eemua]}15`,
              color: EEMUA_COLORS[eemua],
            }}
          >
            {EEMUA_LABELS[eemua]}
          </span>
        </div>

        {sorted.length === 0 ? (
          <div className="afeed__empty">Sem alertas activos.</div>
        ) : (
          <div className="afeed__list">
            {sorted.map((alert: Alert) => (
              <div key={alert.id} className="afeed__item">
                <AlarmItem
                  priority={mapPriority(alert.priority)}
                  state={isFlashing(alert.state) ? 'flash' : 'solid'}
                  title={alert.cause}
                  detail={`${alert.consequence}${alert.correctiveAction ? ` — ${alert.correctiveAction}` : ''}`}
                  actions={
                    alert.state === 'UNACK_ACTIVE'
                      ? [{ label: 'Acknowledge', onClick: () => acknowledge(alert.id) }]
                      : undefined
                  }
                />
                <span className="afeed__time">{relativeTime(alert.activatedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Collapsible>
    </div>
  );
}
