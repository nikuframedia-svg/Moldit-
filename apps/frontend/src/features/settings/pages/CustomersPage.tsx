/**
 * CustomersPage — Customer tiers and delay multipliers.
 * Route: /settings/customers
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/Common/EmptyState';
import { SkeletonTable } from '@/components/Common/SkeletonLoader';
import { useScheduleData } from '@/hooks/useScheduleData';

interface CustomerRow {
  code: string;
  name: string;
  tier: number;
  multiplier: number;
  sla: string;
  orderCount: number;
}

function defaultTier(name: string): { tier: number; multiplier: number } {
  const n = name.toLowerCase();
  if (n.includes('faurecia') || n.includes('forvia')) return { tier: 1, multiplier: 10 };
  if (n.includes('continental') || n.includes('bosch')) return { tier: 2, multiplier: 7 };
  if (!name || name === 'Sem cliente') return { tier: 5, multiplier: 1 };
  return { tier: 3, multiplier: 3 };
}

function multiplierColor(m: number): string {
  if (m >= 8) return 'var(--semantic-red)';
  if (m >= 3) return 'var(--semantic-amber)';
  return 'var(--accent)';
}

export function CustomersPage() {
  const { engine, loading, error } = useScheduleData();

  const initialCustomers = useMemo(() => {
    if (!engine) return [];
    const map = new Map<string, { name: string; count: number }>();
    for (const op of engine.ops) {
      const code = op.cl || '__none__';
      const existing = map.get(code);
      if (existing) {
        existing.count++;
      } else {
        map.set(code, { name: op.clNm || 'Sem cliente', count: 1 });
      }
    }
    const rows: CustomerRow[] = [];
    for (const [code, info] of map) {
      const dt = defaultTier(info.name);
      rows.push({
        code: code === '__none__' ? '-' : code,
        name: info.name,
        tier: dt.tier,
        multiplier: dt.multiplier,
        sla: '',
        orderCount: info.count,
      });
    }
    return rows.sort((a, b) => a.tier - b.tier);
  }, [engine]);

  const [customers, setCustomers] = useState<CustomerRow[]>(initialCustomers);

  const updateTier = (code: string, tier: number) => {
    setCustomers((prev) => prev.map((c) => (c.code === code ? { ...c, tier } : c)));
  };
  const updateMultiplier = (code: string, multiplier: number) => {
    setCustomers((prev) => prev.map((c) => (c.code === code ? { ...c, multiplier } : c)));
  };
  const updateSla = (code: string, sla: string) => {
    setCustomers((prev) => prev.map((c) => (c.code === code ? { ...c, sla } : c)));
  };

  if (loading)
    return (
      <div style={{ padding: 32 }}>
        <SkeletonTable rows={8} cols={5} />
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
        Clientes e Prioridades
      </h2>

      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        {customers.length} clientes · O multiplicador afecta o custo de atraso no ATCS
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="setup-matrix">
          <thead>
            <tr>
              <th className="setup-matrix__header">Código</th>
              <th className="setup-matrix__header">Nome</th>
              <th className="setup-matrix__header" style={{ textAlign: 'center' }}>
                Encomendas
              </th>
              <th className="setup-matrix__header" style={{ textAlign: 'center' }}>
                Tier
              </th>
              <th className="setup-matrix__header" style={{ textAlign: 'center' }}>
                Multiplicador
              </th>
              <th className="setup-matrix__header">SLA</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.code}>
                <td
                  className="setup-matrix__cell"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 500 }}
                >
                  {c.code}
                </td>
                <td
                  className="setup-matrix__cell"
                  style={{ fontSize: 11, color: 'var(--text-primary)' }}
                >
                  {c.name}
                </td>
                <td
                  className="setup-matrix__cell"
                  style={{ textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 10 }}
                >
                  {c.orderCount}
                </td>
                <td className="setup-matrix__cell" style={{ textAlign: 'center' }}>
                  <select
                    value={c.tier}
                    onChange={(e) => updateTier(c.code, Number(e.target.value))}
                    className="constraint-toggles__param-select"
                    style={{ fontSize: 10, width: 50, textAlign: 'center' }}
                  >
                    {[1, 2, 3, 4, 5].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="setup-matrix__cell" style={{ textAlign: 'center' }}>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={c.multiplier}
                    onChange={(e) =>
                      updateMultiplier(c.code, Math.max(1, Number(e.target.value) || 1))
                    }
                    style={{
                      width: 50,
                      textAlign: 'center',
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      color: multiplierColor(c.multiplier),
                      background: 'transparent',
                      border: '1px solid var(--border-default)',
                      borderRadius: 3,
                      padding: '2px 4px',
                    }}
                  />
                </td>
                <td className="setup-matrix__cell">
                  <input
                    type="text"
                    value={c.sla}
                    onChange={(e) => updateSla(c.code, e.target.value)}
                    placeholder="—"
                    style={{
                      fontSize: 10,
                      width: 100,
                      background: 'transparent',
                      border: '1px solid var(--border-default)',
                      borderRadius: 3,
                      padding: '2px 6px',
                      color: 'var(--text-primary)',
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
