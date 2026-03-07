import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import './Collapsible.css';

interface CollapsibleProps {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
}

export function Collapsible({ title, defaultOpen = true, badge, children }: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="collapsible" data-testid="collapsible">
      <button className="collapsible__header" onClick={() => setOpen((o) => !o)} type="button">
        <span className="collapsible__icon">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className="collapsible__title">{title}</span>
        {badge && <span className="collapsible__badge">{badge}</span>}
      </button>
      {open && <div className="collapsible__body">{children}</div>}
    </div>
  );
}
