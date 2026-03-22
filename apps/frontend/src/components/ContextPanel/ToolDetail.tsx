/**
 * ToolDetail — Context panel content for a selected tool.
 */

import { AlertTriangle, ArrowRight } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScheduleData } from '../../hooks/useScheduleData';
import { useUIStore } from '../../stores/useUIStore';
import { Section, Stat } from './ContextPanelPrimitives';

export function ToolDetail({ toolId }: { toolId: string }) {
  const navigate = useNavigate();
  const setFocus = useUIStore((s) => s.actions.setFocus);
  const { engine, blocks } = useScheduleData();

  const tool = engine?.tools.find((t) => t.id === toolId);
  const toolOps = useMemo(() => engine?.ops.filter((o) => o.t === toolId) || [], [engine, toolId]);
  const toolBlocks = useMemo(() => blocks.filter((b) => b.toolId === toolId), [blocks, toolId]);
  const totalDemand = toolOps.reduce((s, o) => s + o.d.reduce((a, v) => a + v, 0), 0);
  const totalBacklog = toolOps.reduce((s, o) => s + o.atr, 0);

  if (!tool)
    return (
      <div style={{ padding: 16, fontSize: 12, color: 'var(--text-muted)' }}>
        Ferramenta nao encontrada.
      </div>
    );

  return (
    <>
      <Section title="Detalhe">
        <Stat label="Máquina Primária" value={tool.m} />
        <Stat label="Máquina Alternativa" value={tool.alt || 'Nenhuma'} />
        <Stat label="Rate" value={`${tool.pH} pcs/h`} />
        <Stat label="Setup" value={`${tool.sH}h`} />
        <Stat label="Operadores" value={String(tool.op)} />
        <Stat
          label="Stock"
          value={tool.stk.toLocaleString()}
          variant={tool.stk <= 0 ? 'red' : tool.stk < tool.lt ? 'amber' : undefined}
        />
        <Stat label="Lote Economico" value={tool.lt.toLocaleString()} />
        <Stat label="Demand Total" value={totalDemand.toLocaleString()} />
        {totalBacklog > 0 && (
          <Stat label="Backlog" value={totalBacklog.toLocaleString()} variant="amber" />
        )}
        <Stat label="Operações" value={String(toolOps.length)} />
        <Stat label="Blocos Agendados" value={String(toolBlocks.length)} />
      </Section>

      <Section title="Accoes Rapidas">
        <div className="ctx-panel__actions">
          <button
            className="ctx-panel__action-btn"
            onClick={() => {
              setFocus({ toolId });
              navigate('/mrp');
            }}
            data-testid="ctx-open-pecas"
          >
            <ArrowRight size={14} />
            Ver em Pecas
          </button>
          <button
            className="ctx-panel__action-btn"
            onClick={() => {
              setFocus({ toolId });
              navigate('/mrp');
            }}
            data-testid="ctx-open-supply"
          >
            <AlertTriangle size={14} />
            Verificar Supply
          </button>
        </div>
      </Section>
    </>
  );
}
