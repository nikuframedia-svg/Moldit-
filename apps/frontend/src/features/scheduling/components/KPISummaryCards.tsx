import { useMemo } from 'react';
import type { Block, CoverageAuditResult, EngineData } from '../../../lib/engine';
import { C, T1 } from '../../../lib/engine';
import type { FeasibilitySummary } from '../hooks/useScheduleValidation';
import { Card, Metric } from './atoms';

/** Twin-aware qty: sum outputs[] for co-production, b.qty for regular */
const bQty = (b: Block) =>
  b.isTwinProduction && b.outputs ? b.outputs.reduce((s, o) => s + o.qty, 0) : b.qty;

export function KPISummaryCards({
  blocks,
  data,
  audit,
}: {
  blocks: Block[];
  data: EngineData;
  audit: CoverageAuditResult | null;
}) {
  const wdi = useMemo(
    () =>
      data.workdays.map((w: boolean, i: number) => (w ? i : -1)).filter((i): i is number => i >= 0),
    [data.workdays],
  );

  const ok = blocks.filter((b) => b.type !== 'blocked');
  const tPcs = ok.reduce((a, b) => a + bQty(b), 0);
  const tProd = ok.reduce((a, b) => a + (b.endMin - b.startMin), 0);
  const tSetup = ok
    .filter((b) => b.setupS != null)
    .reduce((a, b) => a + ((b.setupE || 0) - (b.setupS || 0)), 0);
  const blkN = new Set(blocks.filter((b) => b.type === 'blocked').map((b) => b.opId)).size;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 8 }}>
      {[
        {
          l: 'Cobertura',
          v: audit ? `${audit.globalCoveragePct.toFixed(1)}%` : '—',
          s: audit
            ? `${audit.rows.length} ops (${audit.rows.filter((r) => r.totalDemand > 0).length} c/ demand)`
            : '',
          c: audit?.isComplete ? C.ac : C.rd,
        },
        { l: 'Peças', v: `${(tPcs / 1000).toFixed(0)}K`, s: `${wdi.length} dias úteis`, c: C.ac },
        {
          l: 'Produção',
          v: `${(tProd / 60).toFixed(0)}h`,
          s: `${Math.round(tProd)}min`,
          c: C.ac,
        },
        {
          l: 'Setup',
          v: `${(tSetup / 60).toFixed(1)}h`,
          s: `${ok.filter((b) => b.setupS != null).length} setups`,
          c: C.pp,
        },
        {
          l: 'Balance',
          v: (() => {
            const sX = ok.filter((b) => b.setupS != null && b.setupS < T1).length;
            const sY = ok.filter((b) => b.setupS != null && b.setupS >= T1).length;
            return `${sX}/${sY}`;
          })(),
          s: 'T.X/T.Y',
          c: (() => {
            const sX = ok.filter((b) => b.setupS != null && b.setupS < T1).length;
            const sY = ok.filter((b) => b.setupS != null && b.setupS >= T1).length;
            return Math.abs(sX - sY) > 3 ? C.yl : C.ac;
          })(),
        },
        {
          l: 'Bloqueadas',
          v: blkN,
          s: blkN > 0 ? 'ações pendentes' : '—',
          c: blkN > 0 ? C.rd : C.ac,
        },
      ].map((k, i) => (
        <Card key={i}>
          <Metric label={k.l} value={k.v} sub={k.s} color={k.c} />
        </Card>
      ))}
    </div>
  );
}

export function CoverageBar({ audit }: { audit: CoverageAuditResult }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.t1, marginBottom: 8 }}>
        Cobertura — Detalhe
      </div>
      {/* Segmented bar */}
      <div
        style={{
          display: 'flex',
          height: 20,
          borderRadius: 6,
          overflow: 'hidden',
          marginBottom: 8,
          background: C.s1,
        }}
      >
        {audit.fullyCovered > 0 && (
          <div
            style={{
              width: `${(audit.fullyCovered / audit.rows.length) * 100}%`,
              background: C.ac,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 8, color: C.t1, fontWeight: 600 }}>{audit.fullyCovered}</span>
          </div>
        )}
        {audit.partiallyCovered > 0 && (
          <div
            style={{
              width: `${(audit.partiallyCovered / audit.rows.length) * 100}%`,
              background: C.yl,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 8, color: C.bg, fontWeight: 600 }}>
              {audit.partiallyCovered}
            </span>
          </div>
        )}
        {audit.zeroCovered > 0 && (
          <div
            style={{
              width: `${(audit.zeroCovered / audit.rows.length) * 100}%`,
              background: C.rd,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: 8, color: C.t1, fontWeight: 600 }}>{audit.zeroCovered}</span>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 12, fontSize: 9, color: C.t3 }}>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              background: C.ac,
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          {audit.fullyCovered} completas
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              background: C.yl,
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          {audit.partiallyCovered} parciais
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 2,
              background: C.rd,
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          {audit.zeroCovered} sem cobertura
        </span>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: C.t2, fontFamily: 'monospace' }}>
        {audit.totalDemand.toLocaleString()} demand · {audit.totalProduced.toLocaleString()}{' '}
        produzidas · {Math.round(audit.globalCoveragePct)}% cobertura
      </div>
    </Card>
  );
}

export function FeasibilityScore({ feasibility }: { feasibility: FeasibilitySummary }) {
  return (
    <Card style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background:
              feasibility.score >= 0.95 ? C.acS : feasibility.score >= 0.8 ? C.ylS : C.rdS,
            border: `2px solid ${feasibility.score >= 0.95 ? C.ac : feasibility.score >= 0.8 ? C.yl : C.rd}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              fontSize: 16,
              fontWeight: 700,
              fontFamily: 'monospace',
              color: feasibility.score >= 0.95 ? C.ac : feasibility.score >= 0.8 ? C.yl : C.rd,
            }}
          >
            {(feasibility.score * 100).toFixed(0)}%
          </span>
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.t1 }}>Viabilidade</div>
          <div style={{ fontSize: 10, color: C.t3 }}>
            {feasibility.feasibleOps}/{feasibility.totalOps} operações viáveis
          </div>
          {feasibility.infeasibleOps > 0 && (
            <div style={{ fontSize: 10, color: C.rd, fontWeight: 500 }}>
              {feasibility.infeasibleOps} inviáveis
            </div>
          )}
        </div>
      </div>
      {!feasibility.deadlineFeasible && (
        <div
          style={{
            padding: '5px 10px',
            borderRadius: 4,
            background: C.rdS,
            border: `1px solid ${C.rd}33`,
            fontSize: 10,
            color: C.rd,
            fontWeight: 500,
          }}
        >
          Deadline comprometida — operações em falta
        </div>
      )}
    </Card>
  );
}
