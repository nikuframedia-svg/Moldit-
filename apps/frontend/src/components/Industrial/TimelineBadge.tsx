import { AlertTriangleIcon, CheckIcon, PauseIcon, PlayIcon, WrenchIcon } from 'lucide-react';
import '../../theme/base-components.css';

export type TimelineEventType = 'production' | 'setup' | 'pause' | 'breakdown' | 'decision';

export interface TimelineBadgeProps {
  type: TimelineEventType;
  label: string;
  time?: string;
  isLast?: boolean;
}

const EVENT_CONFIG: Record<
  TimelineEventType,
  { icon: React.ElementType; color: string; bg: string }
> = {
  production: {
    icon: PlayIcon,
    color: 'var(--semantic-green)',
    bg: 'var(--semantic-green-bg)',
  },
  setup: {
    icon: WrenchIcon,
    color: 'var(--semantic-blue)',
    bg: 'var(--semantic-blue-bg)',
  },
  pause: {
    icon: PauseIcon,
    color: 'var(--semantic-amber)',
    bg: 'var(--semantic-amber-bg)',
  },
  breakdown: {
    icon: AlertTriangleIcon,
    color: 'var(--semantic-red)',
    bg: 'var(--semantic-red-bg)',
  },
  decision: {
    icon: CheckIcon,
    color: 'var(--accent)',
    bg: 'var(--accent-bg)',
  },
};

export function TimelineBadge({ type, label, time, isLast }: TimelineBadgeProps) {
  const config = EVENT_CONFIG[type];
  const Icon = config.icon;

  return (
    <div className="timeline-badge" data-testid={`timeline-badge-${type}`}>
      <div
        className="timeline-badge__circle"
        style={{ background: config.bg, color: config.color }}
      >
        <Icon size={14} />
        {!isLast && <div className="timeline-badge__line" />}
      </div>
      <div className="timeline-badge__body">
        <span className="timeline-badge__label">{label}</span>
        {time && <span className="timeline-badge__time">{time}</span>}
      </div>
    </div>
  );
}
