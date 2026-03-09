/**
 * SetupMatrixPage — Setup time matrix editor per machine.
 * Route: /settings/setup-matrix
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/Common/EmptyState';
import { SkeletonTable } from '@/components/Common/SkeletonLoader';
import { useScheduleData } from '@/hooks/useScheduleData';
import { SetupMatrixEditor } from '../components/SetupMatrixEditor';

export function SetupMatrixPage() {
  const { engine, loading, error } = useScheduleData();
  const [machineFilter, setMachineFilter] = useState('');

  const machines = useMemo(() => (engine ? engine.machines.map((m) => m.id) : []), [engine]);
  const filteredTools = useMemo(() => {
    if (!engine) return [];
    if (!machineFilter) return engine.tools;
    return engine.tools.filter((t) => t.m === machineFilter);
  }, [engine, machineFilter]);

  if (loading)
    return (
      <div style={{ padding: 32 }}>
        <SkeletonTable rows={8} cols={8} />
      </div>
    );
  if (error || !engine) {
    return (
      <div style={{ padding: 32 }}>
        <Link
          to="/settings"
          style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}
        >
          ← Settings
        </Link>
        <EmptyState icon="error" title="Sem dados" description={error || 'Importe ISOP.'} />
      </div>
    );
  }

  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Link to="/settings" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
        ← Settings
      </Link>
      <h2
        style={{
          color: 'var(--text-primary)',
          fontSize: 'var(--text-h3)',
          fontWeight: 600,
          margin: 0,
        }}
      >
        Matriz de Setup
      </h2>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Filtrar por máquina:</label>
        <select
          className="constraint-toggles__param-select"
          value={machineFilter}
          onChange={(e) => setMachineFilter(e.target.value)}
          style={{ fontSize: 11 }}
        >
          <option value="">Todas ({engine.tools.length} ferramentas)</option>
          {machines.map((m) => (
            <option key={m} value={m}>
              {m} ({engine.tools.filter((t) => t.m === m).length} ferramentas)
            </option>
          ))}
        </select>
      </div>

      <SetupMatrixEditor key={machineFilter} tools={filteredTools} />
    </div>
  );
}
