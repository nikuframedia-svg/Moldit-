import './StatusBanner.css';

interface StatusBannerProps {
  variant: 'ok' | 'warning' | 'critical';
  message: string;
  details?: string;
}

export function StatusBanner({ variant, message, details }: StatusBannerProps) {
  return (
    <div className={`status-banner status-banner--${variant}`} data-testid="status-banner">
      <span className="status-banner__message">{message}</span>
      {details && <span className="status-banner__details">{details}</span>}
    </div>
  );
}
