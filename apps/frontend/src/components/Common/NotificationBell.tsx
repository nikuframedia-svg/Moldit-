/**
 * NotificationBell — Header bell icon with unacknowledged alert count badge.
 * Popover shows top 8 alerts sorted by priority → time.
 */

import { Popover } from 'antd';
import { Bell } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Alert, AlertPriority } from '../../features/alerts/alert-types';
import { PRIORITY_COLORS } from '../../features/alerts/alert-types';
import { useAlertStore, useUnackCount } from '../../features/alerts/useAlertStore';
import './NotificationBell.css';

const PRIORITY_ORDER: Record<AlertPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

const MAX_ITEMS = 8;

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function AlertRow({ alert, onAck }: { alert: Alert; onAck: (id: string) => void }) {
  const canAck = alert.state === 'UNACK_ACTIVE' || alert.state === 'RTN_UNACK';
  return (
    <div className="notification-bell__item">
      <span
        className="notification-bell__dot"
        style={{ background: PRIORITY_COLORS[alert.priority] }}
      />
      <span className="notification-bell__cause">{alert.cause}</span>
      <span className="notification-bell__time">{relativeTime(alert.activatedAt)}</span>
      {canAck && (
        <button
          type="button"
          className="notification-bell__ack-btn"
          onClick={() => onAck(alert.id)}
        >
          Ack
        </button>
      )}
    </div>
  );
}

function PopoverContent() {
  const alerts = useAlertStore((s) => s.alerts);
  const acknowledge = useAlertStore((s) => s.acknowledge);

  const sorted = useMemo(() => {
    return [...alerts]
      .filter((a) => a.state !== 'NORMAL')
      .sort((a, b) => {
        const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (pd !== 0) return pd;
        return new Date(b.activatedAt).getTime() - new Date(a.activatedAt).getTime();
      })
      .slice(0, MAX_ITEMS);
  }, [alerts]);

  if (sorted.length === 0) {
    return <div className="notification-bell__empty">Sem alertas activos.</div>;
  }

  return (
    <>
      <div className="notification-bell__list">
        {sorted.map((alert) => (
          <AlertRow key={alert.id} alert={alert} onAck={acknowledge} />
        ))}
      </div>
      <div className="notification-bell__footer">
        <Link to="/console">Ver todos</Link>
      </div>
    </>
  );
}

export function NotificationBell() {
  const unackCount = useUnackCount();
  const hasCritical = useAlertStore((s) =>
    s.alerts.some((a) => a.priority === 'CRITICAL' && a.state === 'UNACK_ACTIVE'),
  );

  return (
    <Popover content={<PopoverContent />} trigger="click" placement="bottomRight" title="Alertas">
      <div className="notification-bell">
        <button type="button" className="notification-bell__btn" aria-label="Alertas">
          <Bell size={18} />
        </button>
        {unackCount > 0 && (
          <span
            className={`notification-bell__badge${hasCritical ? ' notification-bell__badge--pulse' : ''}`}
          >
            {unackCount > 99 ? '99+' : unackCount}
          </span>
        )}
      </div>
    </Popover>
  );
}
