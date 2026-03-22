/**
 * ContextPanel — Right-side inspector panel.
 *
 * Updates reactively when a machine or tool is selected.
 * 3 collapsible sections: Entity Detail, Related Problems, Quick Actions.
 * Close with Esc or X button.
 */

import { Cpu, Wrench, X } from 'lucide-react';
import { useEffect } from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { MachineDetail } from './MachineDetail';
import { ToolDetail } from './ToolDetail';
import './ContextPanel.css';

// ── Main ContextPanel ──────────────────────────────────────
export function ContextPanel() {
  const isOpen = useUIStore((s) => s.contextPanelOpen);
  const entity = useUIStore((s) => s.contextEntity);
  const close = useUIStore((s) => s.actions.closeContextPanel);

  // Close on Esc
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, close]);

  if (!isOpen || !entity) return null;

  const isMachine = entity.type === 'machine';
  const isTool = entity.type === 'tool';

  return (
    <div className="ctx-panel__backdrop" data-testid="context-panel">
      <div className="ctx-panel__header">
        <span className={`ctx-panel__header-icon ctx-panel__header-icon--${entity.type}`}>
          {isMachine ? <Cpu size={14} /> : <Wrench size={14} />}
        </span>
        <div className="ctx-panel__header-body">
          <div className="ctx-panel__header-title">{entity.id}</div>
          <div className="ctx-panel__header-sub">
            {isMachine ? 'Máquina' : isTool ? 'Ferramenta' : entity.type}
          </div>
        </div>
        <button
          type="button"
          className="ctx-panel__close"
          onClick={close}
          data-testid="ctx-panel-close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="ctx-panel__body">
        {isMachine && <MachineDetail machineId={entity.id} />}
        {isTool && <ToolDetail toolId={entity.id} />}
      </div>
    </div>
  );
}
