/**
 * StockKPIPanel — KPI cards for stock dashboard.
 */

import { C } from '@/lib/engine';
import { KCard } from '../components/KCard';
import { fmtQty } from '../utils/mrp-helpers';
import type { StockKPIs } from '../utils/stock-compute';

interface StockKPIPanelProps {
  kpis: StockKPIs;
  totalSkus: number;
}

export function StockKPIPanel({ kpis, totalSkus }: StockKPIPanelProps) {
  return (
    <div className="mrp__kpis" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
      <KCard
        label="Stockout"
        value={String(kpis.stockoutCount)}
        sub={`de ${totalSkus} SKUs`}
        color={kpis.stockoutCount > 0 ? C.rd : C.ac}
      />
      <KCard
        label="Em Risco"
        value={String(kpis.riskCount)}
        sub="cobertura < 15d"
        color={kpis.riskCount > 0 ? C.yl : C.ac}
      />
      <KCard
        label="Stock Total"
        value={fmtQty(kpis.totalStock)}
        sub="peças em armazém"
        color={C.t1}
      />
      <KCard
        label="Cobertura Média"
        value={`${Math.round(kpis.avgCoverage)}d`}
        sub="dias de stock"
        color={kpis.avgCoverage < 15 ? C.yl : C.ac}
      />
    </div>
  );
}
