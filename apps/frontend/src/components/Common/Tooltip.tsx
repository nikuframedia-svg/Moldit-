import './Tooltip.css';

interface TermProps {
  code: string;
  label?: string;
}

export function Term({ code, label }: TermProps) {
  return <span>{label || code}</span>;
}

interface TipProps {
  text: string;
  children: React.ReactNode;
}

export function Tip({ text, children }: TipProps) {
  return (
    <span className="term">
      {children}
      <span className="term__tooltip">
        <span className="term__tooltip-desc">{text}</span>
      </span>
    </span>
  );
}
