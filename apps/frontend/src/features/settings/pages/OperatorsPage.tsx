/**
 * OperatorsPage — Operator skill matrix per machine.
 * Route: /settings/operators
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/Common/EmptyState';
import { SkeletonTable } from '@/components/Common/SkeletonLoader';
import { useScheduleData } from '@/hooks/useScheduleData';
import { DEFAULT_WORKFORCE_CONFIG } from '@/lib/engine';
import type { OperatorEntry } from '../components/OperatorSkillMatrix';
import { OperatorSkillMatrix } from '../components/OperatorSkillMatrix';

export function OperatorsPage() {
  const { engine, loading, error } = useScheduleData();

  const { operators, machines } = useMemo(() => {
    if (!engine) return { operators: [], machines: [] };
    const machineIds = engine.machines.map((m) => m.id);
    const ops: OperatorEntry[] = [];
    let idx = 1;
    for (const [group, windows] of Object.entries(DEFAULT_WORKFORCE_CONFIG.laborGroups)) {
      const maxCap = Math.max(...windows.map((w) => w.capacity));
      for (let i = 0; i < maxCap; i++) {
        ops.push({ id: `op-${idx}`, name: `Operador ${idx}`, group });
        idx++;
      }
    }
    return { operators: ops, machines: machineIds };
  }, [engine]);

  if (loading)
    return (
      <div style={{ padding: 32 }}>
        <SkeletonTable rows={6} cols={5} />
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
        Operadores e Competências
      </h2>

      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        {operators.length} operadores · {machines.length} máquinas · Click para alterar nível de
        competência
      </div>

      <OperatorSkillMatrix operators={operators} machines={machines} />
    </div>
  );
}
