/**
 * OrdersPage — Orders by client with pegging tree.
 * Route: /mrp/orders
 */

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/Common/EmptyState';
import { SkeletonTable } from '@/components/Common/SkeletonLoader';
import { useScheduleData } from '@/hooks/useScheduleData';
import { C, computeMRP, computeMRPSkuView } from '@/lib/engine';
import { KCard } from '../components/KCard';
import { PeggingTree } from '../components/PeggingTree';
import { fmtQty, mono } from '../utils/mrp-helpers';
import type { ClientOrderGroup, OrderEntry } from '../utils/orders-compute';
import { computeOrderEntries, groupOrdersByClient } from '../utils/orders-compute';

const STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  done: { label: 'Concluída', color: C.ac, bg: `${C.ac}18` },
  'on-time': { label: 'On-time', color: C.ac, bg: `${C.ac}18` },
  'at-risk': { label: 'At-risk', color: C.yl, bg: `${C.yl}18` },
  late: { label: 'Late', color: C.rd, bg: `${C.rd}18` },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG['on-time'];
  return (
    <span
      style={{
        fontSize: 8,
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 3,
        background: cfg.bg,
        color: cfg.color,
      }}
    >
      {cfg.label}
    </span>
  );
}

function OTDBadge({ pct }: { pct: number }) {
  const color = pct >= 90 ? C.ac : pct >= 70 ? C.yl : C.rd;
  return <span style={{ ...mono, fontSize: 10, fontWeight: 700, color }}>{pct}%</span>;
}

function ClientAccordion({
  group,
  engine,
  blocks,
}: {
  group: ClientOrderGroup;
  engine: NonNullable<ReturnType<typeof useScheduleData>['engine']>;
  blocks: ReturnType<typeof useScheduleData>['blocks'];
}) {
  const [open, setOpen] = useState(false);
  const [selectedOp, setSelectedOp] = useState<string | null>(null);

  return (
    <div style={{ marginBottom: 4 }}>
      <div
        className="mrp__enc-client-row"
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {open ? <ChevronDown size={12} color={C.t3} /> : <ChevronRight size={12} color={C.t3} />}
          <span style={{ fontSize: 12, fontWeight: 600, color: C.t1 }}>{group.customerName}</span>
          <span style={{ fontSize: 9, color: C.t3, ...mono }}>{group.customerCode}</span>
        </span>
        <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: C.t2 }}>{group.totalOrders} encomendas</span>
          <OTDBadge pct={group.otdPercent} />
          {group.lateCount > 0 && (
            <span style={{ fontSize: 9, color: C.rd, fontWeight: 600 }}>
              {group.lateCount} late
            </span>
          )}
          {group.atRiskCount > 0 && (
            <span style={{ fontSize: 9, color: C.yl }}>{group.atRiskCount} at-risk</span>
          )}
        </span>
      </div>

      {open && (
        <OrderTable
          entries={group.entries}
          selectedOp={selectedOp}
          onSelectOp={(opId) => setSelectedOp(selectedOp === opId ? null : opId)}
          engine={engine}
          blocks={blocks}
        />
      )}
    </div>
  );
}

function OrderTable({
  entries,
  selectedOp,
  onSelectOp,
  engine,
  blocks,
}: {
  entries: OrderEntry[];
  selectedOp: string | null;
  onSelectOp: (opId: string) => void;
  engine: NonNullable<ReturnType<typeof useScheduleData>['engine']>;
  blocks: ReturnType<typeof useScheduleData>['blocks'];
}) {
  return (
    <table className="mrp__table" style={{ marginTop: 4, marginBottom: 8 }}>
      <thead>
        <tr>
          <th>SKU</th>
          <th style={{ textAlign: 'right' }}>Qtd</th>
          <th>Data Pedida</th>
          <th>Data Prevista</th>
          <th>Estado</th>
          <th style={{ textAlign: 'right' }}>Gap</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <OrderTableRow
            key={e.opId}
            entry={e}
            isSelected={selectedOp === e.opId}
            onSelect={() => onSelectOp(e.opId)}
            engine={engine}
            blocks={blocks}
          />
        ))}
      </tbody>
    </table>
  );
}

function OrderTableRow({
  entry: e,
  isSelected,
  onSelect,
  engine,
  blocks,
}: {
  entry: OrderEntry;
  isSelected: boolean;
  onSelect: () => void;
  engine: NonNullable<ReturnType<typeof useScheduleData>['engine']>;
  blocks: ReturnType<typeof useScheduleData>['blocks'];
}) {
  return (
    <>
      <tr
        style={{ cursor: 'pointer' }}
        onClick={onSelect}
        className={e.status === 'late' ? 'mrp__row--stockout' : ''}
      >
        <td>
          <span style={{ ...mono, fontSize: 10, fontWeight: 600, color: C.t1 }}>{e.sku}</span>
          {e.isTwin && <span style={{ fontSize: 8, color: C.yl, marginLeft: 4 }}>Twin</span>}
        </td>
        <td style={{ textAlign: 'right', ...mono, fontSize: 10, color: C.t1 }}>
          {fmtQty(e.orderQty)}
        </td>
        <td style={{ ...mono, fontSize: 10, color: C.t2 }}>{e.deadline ?? '-'}</td>
        <td style={{ ...mono, fontSize: 10, color: e.gapDays > 0 ? C.rd : C.t2 }}>
          {e.scheduledEndDate ?? '-'}
        </td>
        <td>
          <StatusBadge status={e.status} />
        </td>
        <td
          style={{
            textAlign: 'right',
            ...mono,
            fontSize: 10,
            fontWeight: 600,
            color: e.gapDays > 0 ? C.rd : e.gapDays < 0 ? C.ac : C.t3,
          }}
        >
          {e.gapDays !== 0 ? `${e.gapDays > 0 ? '+' : ''}${e.gapDays}d` : '-'}
        </td>
      </tr>
      {isSelected && (
        <tr className="mrp__detail-row">
          <td colSpan={6}>
            <PeggingTree entry={e} engine={engine} blocks={blocks} />
          </td>
        </tr>
      )}
    </>
  );
}

export function OrdersPage() {
  const { engine, blocks, loading, error } = useScheduleData();
  const [search, setSearch] = useState('');

  const mrp = useMemo(() => (engine ? computeMRP(engine) : null), [engine]);
  const skuView = useMemo(() => (mrp ? computeMRPSkuView(mrp) : null), [mrp]);

  const allEntries = useMemo(() => {
    if (!engine || !mrp || !skuView) return [];
    return computeOrderEntries(engine, mrp, skuView, blocks);
  }, [engine, mrp, skuView, blocks]);

  const filtered = useMemo(() => {
    if (!search) return allEntries;
    const q = search.toLowerCase();
    return allEntries.filter(
      (e) =>
        e.sku.toLowerCase().includes(q) ||
        e.skuName.toLowerCase().includes(q) ||
        e.customerName?.toLowerCase().includes(q),
    );
  }, [allEntries, search]);

  const clientGroups = useMemo(() => groupOrdersByClient(filtered), [filtered]);

  if (loading)
    return (
      <div style={{ padding: 24 }}>
        <SkeletonTable rows={8} cols={6} />
      </div>
    );
  if (error || !engine || !mrp || !skuView) {
    return (
      <div style={{ padding: 24 }}>
        <Link to="/mrp" style={{ fontSize: 11, color: C.ac, textDecoration: 'none' }}>
          ← MRP
        </Link>
        <EmptyState icon="error" title="Sem dados" description={error || 'Importe ISOP.'} />
      </div>
    );
  }

  const totalOTD =
    allEntries.length > 0
      ? Math.round(
          (allEntries.filter((e) => e.status === 'on-time' || e.status === 'done').length /
            allEntries.length) *
            100,
        )
      : 100;
  const lateCount = allEntries.filter((e) => e.status === 'late').length;
  const atRiskCount = allEntries.filter((e) => e.status === 'at-risk').length;

  return (
    <div style={{ padding: '16px 24px', maxWidth: 1100 }}>
      <Link
        to="/mrp"
        style={{
          fontSize: 11,
          color: C.ac,
          textDecoration: 'none',
          marginBottom: 12,
          display: 'inline-block',
        }}
      >
        ← MRP
      </Link>
      <h1 style={{ fontSize: 18, fontWeight: 600, color: C.t1, margin: '0 0 4px' }}>
        Encomendas por Cliente
      </h1>

      <div className="mrp__kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KCard label="Total" value={String(allEntries.length)} sub="encomendas" color={C.t1} />
        <KCard
          label="OTD"
          value={`${totalOTD}%`}
          sub="on-time delivery"
          color={totalOTD >= 90 ? C.ac : totalOTD >= 70 ? C.yl : C.rd}
        />
        <KCard
          label="Late"
          value={String(lateCount)}
          sub="atrasadas"
          color={lateCount > 0 ? C.rd : C.ac}
        />
        <KCard
          label="At-Risk"
          value={String(atRiskCount)}
          sub="em risco"
          color={atRiskCount > 0 ? C.yl : C.ac}
        />
      </div>

      <div className="mrp__filters">
        <input
          className="mrp__filter-input"
          type="text"
          placeholder="Procurar SKU/produto/cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ fontSize: 10, color: C.t3, marginLeft: 'auto' }}>
          {filtered.length} de {allEntries.length} encomendas · {clientGroups.length} clientes
        </span>
      </div>

      <div className="mrp__card">
        {clientGroups.map((group) => (
          <ClientAccordion key={group.customerCode} group={group} engine={engine} blocks={blocks} />
        ))}
        {clientGroups.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: C.t3, fontSize: 12 }}>
            Nenhuma encomenda encontrada
          </div>
        )}
      </div>
    </div>
  );
}
