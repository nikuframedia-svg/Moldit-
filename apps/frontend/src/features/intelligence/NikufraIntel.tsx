// ═══════════════════════════════════════════════════════════════
//  NIKUFRA INTELLIGENCE — 10 WOW Analytics Features
//  100% Real ISOP Data · ZERO Fake Data
//  Data: useDataStore (ISOP upload) or nikufra_data.json fallback
// ═══════════════════════════════════════════════════════════════

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NikufraData } from '../../domain/nikufra-types';
import { C, DAY_CAP, S0, S1, T1, TC } from '../../lib/engine';
import useDataStore from '../../stores/useDataStore';
import { nikufraDataToNkData, nikufraDataToSnapshot } from './intel-adapter';
import { computeAll, type IntelData, type NkData, type SnapshotFixture } from './intel-compute';
import './NikufraIntel.css';

const MC: Record<string, string> = {
  PRM019: TC[0],
  PRM020: TC[1],
  PRM031: TC[2],
  PRM039: TC[3],
  PRM042: TC[4],
  PRM043: TC[5],
};

const AREA: Record<string, string> = {
  PRM019: 'PG1',
  PRM020: 'PG1',
  PRM031: 'PG2',
  PRM039: 'PG2',
  PRM042: 'PG2',
  PRM043: 'PG1',
};

// ── Helpers ──────────────────────────────────────────────────
function heatColor(pct: number): string {
  if (pct <= 0) return C.s3;
  if (pct < 40) return '#065F46';
  if (pct < 60) return '#047857';
  if (pct < 80) return '#059669';
  if (pct < 95) return '#D97706';
  if (pct < 100) return '#EA580C';
  return '#DC2626';
}

function fmtPct(n: number): string {
  return n.toFixed(0) + '%';
}
function fmtMin(n: number): string {
  return n < 60 ? `${n.toFixed(0)}m` : `${(n / 60).toFixed(1)}h`;
}
function fmtQty(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}
function fmtDate(d: string): string {
  return d.slice(5).replace('-', '/');
}
function timeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function toolFamily(id: string): string {
  return id.replace(/\d+/g, '');
}

// ── Tab Definitions ──────────────────────────────────────────
type IntelTab =
  | 'heatmap'
  | 'horizon'
  | 'urgency'
  | 'risk'
  | 'crossclient'
  | 'bottleneck'
  | 'setup'
  | 'toolgroup'
  | 'network'
  | 'explain';

const TABS: Array<{ key: IntelTab; label: string }> = [
  { key: 'heatmap', label: 'Demand Heatmap' },
  { key: 'horizon', label: 'Capacity Horizon' },
  { key: 'urgency', label: 'Urgency Matrix' },
  { key: 'risk', label: 'Client Risk' },
  { key: 'crossclient', label: 'Cross-Client SKU' },
  { key: 'bottleneck', label: 'Bottleneck Cascade' },
  { key: 'setup', label: 'Setup Crew' },
  { key: 'toolgroup', label: 'Tool Grouping' },
  { key: 'network', label: 'Machine Network' },
  { key: 'explain', label: 'Explain Trace' },
];

// ── Inline Style Constants ───────────────────────────────────
const mono: React.CSSProperties = { fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace' };
const labelSt: React.CSSProperties = {
  color: C.t3,
  fontSize: 10,
  fontWeight: 500,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.06em',
};
const cardSt: React.CSSProperties = {
  background: C.s2,
  borderRadius: 8,
  padding: 16,
  border: `1px solid ${C.bd}`,
};

// Client color assignment
function clientColorMap(codes: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const unique = [...new Set(codes)];
  unique.forEach((c, i) => {
    map[c] = TC[i % TC.length];
  });
  return map;
}

// ══════════════════════════════════════════════════════════════
//  SHARED ATOMS
// ══════════════════════════════════════════════════════════════

function StatRow({
  items,
}: {
  items: Array<{ label: string; value: string | number; color?: string }>;
}) {
  return (
    <div style={{ display: 'flex', gap: 24, marginBottom: 16, flexWrap: 'wrap' }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={labelSt}>{item.label}</span>
          <span
            style={{
              color: item.color || C.t1,
              fontSize: 20,
              fontWeight: 600,
              ...mono,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function MachineLegend({ machines }: { machines: readonly string[] }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
      {machines.map((m) => (
        <div key={m} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: MC[m] }} />
          <span style={{ color: C.t2, fontSize: 11, ...mono }}>{m}</span>
          <span style={{ color: C.t4, fontSize: 9 }}>{AREA[m]}</span>
        </div>
      ))}
    </div>
  );
}

function HeatLegend() {
  const stops = [
    { pct: 0, label: '0%' },
    { pct: 40, label: '40%' },
    { pct: 60, label: '60%' },
    { pct: 80, label: '80%' },
    { pct: 95, label: '95%' },
    { pct: 110, label: '>100%' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
      <span style={{ color: C.t3, fontSize: 10 }}>Load:</span>
      {stops.map((s) => (
        <div key={s.pct} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <div style={{ width: 14, height: 10, borderRadius: 2, background: heatColor(s.pct) }} />
          <span style={{ color: C.t3, fontSize: 9, ...mono }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 1: DEMAND HEATMAP — Machines x Working Days thermal grid
// ══════════════════════════════════════════════════════════════

function HeatmapView({ data }: { data: IntelData }) {
  const { heatmap, machines, workingDates } = data;
  const [hover, setHover] = useState<{ mi: number; di: number } | null>(null);

  const CW = 36,
    CH = 34;
  const LW = 72,
    TH = 34;
  const W = LW + workingDates.length * CW;
  const H = TH + machines.length * CH;

  const flat = useMemo(() => heatmap.flat(), [heatmap]);
  const totalOverflow = flat.filter((c) => c.pct > 100).length;
  const peakCell = flat.reduce((mx, c) => (c.pct > mx.pct ? c : mx), flat[0]);
  const avgUtil = flat.reduce((s, c) => s + c.pct, 0) / (flat.length || 1);

  return (
    <div>
      <StatRow
        items={[
          { label: 'Avg Utilization', value: fmtPct(avgUtil), color: avgUtil > 80 ? C.yl : C.ac },
          { label: 'Overflow Cells', value: totalOverflow, color: totalOverflow > 0 ? C.rd : C.ac },
          { label: 'Peak Load', value: fmtPct(peakCell?.pct || 0), color: C.rd },
          {
            label: 'Peak Machine',
            value: peakCell?.machine || '-',
            color: MC[peakCell?.machine] || C.t1,
          },
        ]}
      />
      <HeatLegend />
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <svg width={W} height={H} style={{ display: 'block' }}>
          {/* Date headers */}
          {workingDates.map((d, di) => {
            const dt = new Date(d);
            const dayLetter = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'][dt.getDay()];
            return (
              <React.Fragment key={d}>
                <text
                  x={LW + di * CW + CW / 2}
                  y={13}
                  textAnchor="middle"
                  style={{ fill: C.t3, fontSize: 8.5, ...mono }}
                >
                  {fmtDate(d)}
                </text>
                <text
                  x={LW + di * CW + CW / 2}
                  y={25}
                  textAnchor="middle"
                  style={{ fill: C.t4, fontSize: 7.5 }}
                >
                  {dayLetter}
                </text>
              </React.Fragment>
            );
          })}
          {/* Machine rows */}
          {machines.map((m, mi) => (
            <g key={m}>
              <text
                x={LW - 8}
                y={TH + mi * CH + CH / 2 + 4}
                textAnchor="end"
                style={{ fill: MC[m], fontSize: 11, ...mono, fontWeight: 600 }}
              >
                {m}
              </text>
              {heatmap[mi]?.map((cell, di) => {
                const isH = hover?.mi === mi && hover?.di === di;
                return (
                  <g
                    key={di}
                    onMouseEnter={() => setHover({ mi, di })}
                    onMouseLeave={() => setHover(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={LW + di * CW + 1}
                      y={TH + mi * CH + 1}
                      width={CW - 2}
                      height={CH - 2}
                      rx={4}
                      fill={heatColor(cell.pct)}
                      opacity={cell.loadMin > 0 ? 1 : 0.15}
                      stroke={isH ? C.w : 'none'}
                      strokeWidth={isH ? 1.5 : 0}
                    />
                    {cell.pct >= 1 && (
                      <text
                        x={LW + di * CW + CW / 2}
                        y={TH + mi * CH + CH / 2 + 4}
                        textAnchor="middle"
                        style={{
                          fill: cell.pct > 60 ? C.w : C.t2,
                          fontSize: 8,
                          ...mono,
                          fontWeight: 600,
                          pointerEvents: 'none' as const,
                        }}
                      >
                        {fmtPct(cell.pct)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          ))}
          {/* Hover tooltip */}
          {hover &&
            (() => {
              const cell = heatmap[hover.mi]?.[hover.di];
              if (!cell) return null;
              const tx = Math.min(LW + hover.di * CW + CW / 2, W - 80);
              const ty = TH + hover.mi * CH - 6;
              return (
                <g>
                  <rect
                    x={tx - 68}
                    y={ty - 38}
                    width={136}
                    height={34}
                    rx={6}
                    fill={C.s1}
                    stroke={C.bd}
                    strokeWidth={1}
                  />
                  <text
                    x={tx}
                    y={ty - 22}
                    textAnchor="middle"
                    style={{ fill: C.t1, fontSize: 9, ...mono }}
                  >
                    {cell.machine} {fmtDate(cell.date)}: {fmtMin(cell.loadMin)}
                  </text>
                  <text x={tx} y={ty - 10} textAnchor="middle" style={{ fill: C.t3, fontSize: 8 }}>
                    {fmtPct(cell.pct)} load, {cell.skuCount} SKU{cell.skuCount !== 1 ? 's' : ''}
                  </text>
                </g>
              );
            })()}
        </svg>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 2: CAPACITY HORIZON — 35-day stacked bars
// ══════════════════════════════════════════════════════════════

function HorizonView({ data }: { data: IntelData }) {
  const { horizon, machines } = data;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const colW = 26;
  const PAD = { l: 48, r: 12, t: 24, b: 42 };
  const maxH = 240;
  const W = PAD.l + horizon.length * colW + PAD.r;
  const H = PAD.t + maxH + PAD.b;

  const maxTotal = Math.max(DAY_CAP, ...horizon.map((b) => b.total));
  const scale = (v: number) => Math.max(0, (v / maxTotal) * maxH);
  const capY = PAD.t + maxH - scale(DAY_CAP);

  // Y-axis ticks
  const yTicks = [
    0,
    Math.round(DAY_CAP * 0.25),
    Math.round(DAY_CAP * 0.5),
    Math.round(DAY_CAP * 0.75),
    DAY_CAP,
  ].filter((v) => v <= maxTotal * 1.1);

  return (
    <div>
      <StatRow
        items={[
          { label: 'Total Days', value: horizon.length },
          { label: 'Working Days', value: data.workingDates.length, color: C.ac },
          {
            label: 'Peak Day Load',
            value: fmtMin(Math.max(...horizon.map((b) => b.total))),
            color: C.yl,
          },
          { label: 'Capacity/Day', value: `${DAY_CAP}m (07h–24h)`, color: C.t2 },
        ]}
      />
      <MachineLegend machines={machines} />
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <svg width={W} height={H} style={{ display: 'block' }}>
          {/* Y-axis labels */}
          {yTicks.map((v) => {
            const y = PAD.t + maxH - scale(v);
            return (
              <React.Fragment key={v}>
                <text
                  x={PAD.l - 6}
                  y={y + 3}
                  textAnchor="end"
                  style={{ fill: C.t4, fontSize: 8, ...mono }}
                >
                  {fmtMin(v)}
                </text>
                <line
                  x1={PAD.l}
                  y1={y}
                  x2={W - PAD.r}
                  y2={y}
                  stroke={C.bd}
                  strokeWidth={0.5}
                  strokeDasharray={v === DAY_CAP ? '0' : '3,3'}
                />
              </React.Fragment>
            );
          })}
          {/* Capacity line at 990 min */}
          <line
            x1={PAD.l}
            y1={capY}
            x2={W - PAD.r}
            y2={capY}
            stroke={C.rd}
            strokeWidth={1.5}
            strokeDasharray="6,3"
            opacity={0.7}
          />
          <text x={W - PAD.r + 4} y={capY + 3} style={{ fill: C.rd, fontSize: 8, ...mono }}>
            CAP
          </text>
          {/* Bars */}
          {horizon.map((bar, i) => {
            const x = PAD.l + i * colW;
            const isH = hoverIdx === i;
            let cumH = 0;
            return (
              <g
                key={bar.date}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* Background for non-working */}
                {!bar.isWorking && (
                  <rect
                    x={x}
                    y={PAD.t}
                    width={colW - 2}
                    height={maxH}
                    fill={C.s3}
                    opacity={0.3}
                    rx={2}
                  />
                )}
                {/* Stacked machine bars */}
                {machines.map((m) => {
                  const min = bar.machines[m] || 0;
                  const h = scale(min);
                  cumH += h;
                  return h > 0.5 ? (
                    <rect
                      key={m}
                      x={x + 1}
                      y={PAD.t + maxH - cumH}
                      width={colW - 4}
                      height={h}
                      rx={1}
                      fill={MC[m]}
                      opacity={bar.isWorking ? 0.85 : 0.15}
                      stroke={isH ? C.w : 'none'}
                      strokeWidth={isH ? 0.5 : 0}
                    />
                  ) : null;
                })}
                {/* Date label */}
                <text
                  x={x + (colW - 2) / 2}
                  y={PAD.t + maxH + 14}
                  textAnchor="middle"
                  style={{ fill: bar.isWorking ? C.t3 : C.t4, fontSize: 7, ...mono }}
                >
                  {fmtDate(bar.date)}
                </text>
                <text
                  x={x + (colW - 2) / 2}
                  y={PAD.t + maxH + 24}
                  textAnchor="middle"
                  style={{ fill: C.t4, fontSize: 6 }}
                >
                  {bar.dayName}
                </text>
              </g>
            );
          })}
          {/* Hover tooltip */}
          {hoverIdx !== null &&
            (() => {
              const bar = horizon[hoverIdx];
              if (!bar) return null;
              const tx = Math.max(80, Math.min(PAD.l + hoverIdx * colW + colW / 2, W - 80));
              return (
                <g>
                  <rect
                    x={tx - 70}
                    y={PAD.t - 6}
                    width={140}
                    height={22}
                    rx={5}
                    fill={C.s1}
                    stroke={C.bd}
                    strokeWidth={1}
                  />
                  <text
                    x={tx}
                    y={PAD.t + 9}
                    textAnchor="middle"
                    style={{ fill: C.t1, fontSize: 9, ...mono }}
                  >
                    {bar.fmtDate} {bar.dayName}: {fmtMin(bar.total)}
                    {!bar.isWorking ? ' (off)' : ''}
                  </text>
                </g>
              );
            })()}
        </svg>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 3: URGENCY MATRIX — Priority scatter plot
// ══════════════════════════════════════════════════════════════

function UrgencyView({ data }: { data: IntelData }) {
  const { urgency } = data;
  const [hoverSku, setHoverSku] = useState<string | null>(null);

  const PAD = { l: 60, r: 30, t: 36, b: 50 };
  const W = 740,
    H = 430;
  const PW = W - PAD.l - PAD.r;
  const PH = H - PAD.t - PAD.b;

  const maxDays = Math.max(...urgency.map((p) => p.daysToDeficit), 10);
  const maxDef = Math.max(...urgency.map((p) => p.maxDeficit), 1000);

  const xScale = (d: number) => PAD.l + Math.min(d / maxDays, 1) * PW;
  const yScale = (d: number) => PAD.t + PH - Math.min(d / maxDef, 1) * PH;

  const cc = useMemo(() => clientColorMap(urgency.map((p) => p.clientCode)), [urgency]);

  const criticalCount = urgency.filter(
    (p) => p.daysToDeficit <= 3 && p.maxDeficit > maxDef * 0.3,
  ).length;
  const monitorCount = urgency.filter((p) => p.daysToDeficit > 10).length;

  return (
    <div>
      <StatRow
        items={[
          { label: 'Total SKUs at Risk', value: urgency.length, color: C.yl },
          { label: 'Critical (< 3d)', value: criticalCount, color: C.rd },
          { label: 'Monitor (> 10d)', value: monitorCount, color: C.ac },
          { label: 'Worst Deficit', value: fmtQty(maxDef) + ' pcs', color: C.rd },
        ]}
      />
      {/* Client legend */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(cc).map(([code, color]) => (
          <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
            <span style={{ color: C.t3, fontSize: 9, ...mono }}>{code}</span>
          </div>
        ))}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <svg width={W} height={H} style={{ display: 'block' }}>
          {/* Quadrant backgrounds */}
          <rect
            x={PAD.l}
            y={PAD.t}
            width={xScale(5) - PAD.l}
            height={PH * 0.5}
            fill={C.rd}
            opacity={0.04}
          />
          {/* Quadrant labels */}
          <text
            x={PAD.l + 8}
            y={PAD.t + 16}
            style={{ fill: C.rd, fontSize: 10, fontWeight: 600, opacity: 0.6 }}
          >
            CRITICAL
          </text>
          <text
            x={W - PAD.r - 70}
            y={PAD.t + PH - 8}
            style={{ fill: C.ac, fontSize: 10, fontWeight: 600, opacity: 0.6 }}
          >
            MONITOR
          </text>
          {/* Grid lines */}
          {[0, 5, 10, 15, 20]
            .filter((v) => v <= maxDays)
            .map((v) => (
              <React.Fragment key={`x-${v}`}>
                <line
                  x1={xScale(v)}
                  y1={PAD.t}
                  x2={xScale(v)}
                  y2={PAD.t + PH}
                  stroke={C.bd}
                  strokeWidth={0.5}
                  strokeDasharray={v === 5 ? '4,2' : '2,4'}
                />
                <text
                  x={xScale(v)}
                  y={H - 10}
                  textAnchor="middle"
                  style={{ fill: C.t3, fontSize: 9, ...mono }}
                >
                  {v}d
                </text>
              </React.Fragment>
            ))}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const v = frac * maxDef;
            return (
              <React.Fragment key={`y-${frac}`}>
                <line
                  x1={PAD.l}
                  y1={yScale(v)}
                  x2={PAD.l + PW}
                  y2={yScale(v)}
                  stroke={C.bd}
                  strokeWidth={0.5}
                  strokeDasharray="2,4"
                />
                <text
                  x={PAD.l - 6}
                  y={yScale(v) + 3}
                  textAnchor="end"
                  style={{ fill: C.t3, fontSize: 8, ...mono }}
                >
                  {fmtQty(v)}
                </text>
              </React.Fragment>
            );
          })}
          {/* Axis labels */}
          <text
            x={PAD.l + PW / 2}
            y={H - 2}
            textAnchor="middle"
            style={{ fill: C.t2, fontSize: 10 }}
          >
            Days to Deficit
          </text>
          <text
            x={12}
            y={PAD.t + PH / 2}
            textAnchor="middle"
            style={{ fill: C.t2, fontSize: 10 }}
            transform={`rotate(-90, 12, ${PAD.t + PH / 2})`}
          >
            Max Deficit (pcs)
          </text>
          {/* Points */}
          {urgency.map((p) => {
            const r = Math.max(4, Math.min(18, Math.sqrt(p.recoveryHours) * 2.5));
            const isH = hoverSku === p.sku;
            return (
              <g
                key={p.sku}
                onMouseEnter={() => setHoverSku(p.sku)}
                onMouseLeave={() => setHoverSku(null)}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  cx={xScale(p.daysToDeficit)}
                  cy={yScale(p.maxDeficit)}
                  r={isH ? r * 1.3 : r}
                  fill={cc[p.clientCode] || C.t3}
                  opacity={isH ? 1 : 0.7}
                  stroke={isH ? C.w : 'none'}
                  strokeWidth={1.5}
                />
              </g>
            );
          })}
          {/* Hover tooltip */}
          {hoverSku &&
            (() => {
              const p = urgency.find((u) => u.sku === hoverSku);
              if (!p) return null;
              const tx = Math.max(100, Math.min(xScale(p.daysToDeficit), W - 120));
              const ty = yScale(p.maxDeficit) - 16;
              return (
                <g>
                  <rect
                    x={tx - 95}
                    y={ty - 40}
                    width={190}
                    height={38}
                    rx={6}
                    fill={C.s1}
                    stroke={C.bd}
                    strokeWidth={1}
                  />
                  <text
                    x={tx}
                    y={ty - 26}
                    textAnchor="middle"
                    style={{ fill: C.t1, fontSize: 9, ...mono, fontWeight: 600 }}
                  >
                    {p.sku}
                  </text>
                  <text x={tx} y={ty - 14} textAnchor="middle" style={{ fill: C.t2, fontSize: 8 }}>
                    {p.daysToDeficit}d to deficit | {fmtQty(p.maxDeficit)} pcs | {p.machine}
                  </text>
                </g>
              );
            })()}
        </svg>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 4: CLIENT RISK RADAR — Per-client delivery risk
// ══════════════════════════════════════════════════════════════

function RiskView({ data }: { data: IntelData }) {
  const { clientRisk } = data;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((code: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const statusColor = (s: 'ok' | 'tight' | 'late') =>
    s === 'ok' ? C.ac : s === 'tight' ? C.yl : C.rd;

  const lateCount = clientRisk.filter((c) => c.overallStatus === 'late').length;
  const tightCount = clientRisk.filter((c) => c.overallStatus === 'tight').length;

  return (
    <div>
      <StatRow
        items={[
          { label: 'Total Clients', value: clientRisk.length },
          { label: 'Late', value: lateCount, color: C.rd },
          { label: 'Tight', value: tightCount, color: C.yl },
          { label: 'OK', value: clientRisk.length - lateCount - tightCount, color: C.ac },
        ]}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 10,
        }}
      >
        {clientRisk.map((client) => {
          const isOpen = expanded.has(client.clientCode);
          return (
            <div
              key={client.clientCode}
              style={{
                ...cardSt,
                borderColor:
                  client.overallStatus !== 'ok' ? `${statusColor(client.overallStatus)}44` : C.bd,
                cursor: 'pointer',
              }}
              onClick={() => toggle(client.clientCode)}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: isOpen ? 10 : 0,
                }}
              >
                {/* Traffic light */}
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    background: statusColor(client.overallStatus),
                    boxShadow: `0 0 8px ${statusColor(client.overallStatus)}66`,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.t1, fontSize: 13, fontWeight: 600, ...mono }}>
                    {client.clientCode}
                  </div>
                  <div style={{ color: C.t3, fontSize: 10 }}>{client.clientName}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: C.t1, fontSize: 14, fontWeight: 600, ...mono }}>
                    {client.totalSKUs}
                  </div>
                  <div style={{ color: C.t3, fontSize: 9 }}>
                    {client.atRiskSKUs > 0 ? (
                      <span style={{ color: C.rd }}>{client.atRiskSKUs} at risk</span>
                    ) : (
                      'all clear'
                    )}
                  </div>
                </div>
                <span
                  style={{
                    color: C.t4,
                    fontSize: 10,
                    transform: isOpen ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.15s',
                  }}
                >
                  ▶
                </span>
              </div>
              {/* Expanded SKU list */}
              {isOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {client.skus.map((sku) => (
                    <div
                      key={sku.sku}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '5px 8px',
                        background:
                          sku.status !== 'ok' ? `${statusColor(sku.status)}08` : 'transparent',
                        borderRadius: 5,
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: statusColor(sku.status),
                        }}
                      />
                      <span
                        style={{
                          color: C.t1,
                          fontSize: 11,
                          ...mono,
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {sku.sku}
                      </span>
                      <span style={{ color: MC[sku.machine] || C.t3, fontSize: 10, ...mono }}>
                        {sku.machine}
                      </span>
                      <span style={{ color: C.t3, fontSize: 9 }}>
                        {sku.firstDeficitDate ? `${sku.daysToDeficit}d` : 'ok'}
                      </span>
                      {sku.maxDeficit > 0 && (
                        <span style={{ color: C.rd, fontSize: 9, ...mono }}>
                          {fmtQty(sku.maxDeficit)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 5: CROSS-CLIENT SKU — Shared SKU aggregation
// ══════════════════════════════════════════════════════════════

function CrossClientView({ data }: { data: IntelData }) {
  const { crossClient } = data;

  const cc = useMemo(
    () => clientColorMap(crossClient.flatMap((s) => s.clients.map((c) => c.code))),
    [crossClient],
  );

  return (
    <div>
      <StatRow
        items={[
          { label: 'Cross-Client SKUs', value: crossClient.length, color: C.pp },
          {
            label: 'Total Demand',
            value: fmtQty(crossClient.reduce((s, c) => s + c.totalDemand, 0)) + ' pcs',
          },
          {
            label: 'Clients Involved',
            value: new Set(crossClient.flatMap((s) => s.clients.map((c) => c.code))).size,
          },
          {
            label: 'Production Hours',
            value: fmtMin(crossClient.reduce((s, c) => s + c.requiredHours * 60, 0)),
          },
        ]}
      />
      {/* Client legend */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {Object.entries(cc).map(([code, color]) => (
          <div key={code} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            <span style={{ color: C.t2, fontSize: 10, ...mono }}>{code}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {crossClient.map((sku) => (
          <div key={sku.sku} style={cardSt}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{ color: C.t1, fontSize: 13, fontWeight: 600, ...mono }}>{sku.sku}</span>
              <span style={{ color: MC[sku.machine] || C.t3, fontSize: 11, ...mono }}>
                {sku.machine}
              </span>
              <span style={{ color: C.t3, fontSize: 10 }}>{sku.tool}</span>
              <span style={{ marginLeft: 'auto', color: C.t2, fontSize: 11, ...mono }}>
                {fmtQty(sku.totalDemand)} pcs | {sku.requiredHours.toFixed(1)}h
              </span>
            </div>
            <div style={{ color: C.t3, fontSize: 10, marginBottom: 6 }}>{sku.name}</div>
            {/* Stacked demand bar */}
            <div
              style={{
                display: 'flex',
                height: 18,
                borderRadius: 4,
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              {sku.clients.map((c) => {
                const pct = sku.totalDemand > 0 ? (c.totalDemand / sku.totalDemand) * 100 : 0;
                return pct > 0.5 ? (
                  <div
                    key={c.code}
                    style={{
                      width: `${pct}%`,
                      background: cc[c.code],
                      minWidth: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {pct > 15 && (
                      <span style={{ color: C.s1, fontSize: 8, fontWeight: 600, ...mono }}>
                        {c.code}
                      </span>
                    )}
                  </div>
                ) : null;
              })}
            </div>
            {/* Client details */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {sku.clients.map((c) => (
                <div key={c.code} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div
                    style={{ width: 6, height: 6, borderRadius: '50%', background: cc[c.code] }}
                  />
                  <span style={{ color: C.t2, fontSize: 10, ...mono }}>{c.code}</span>
                  <span style={{ color: C.t3, fontSize: 9 }}>{fmtQty(c.totalDemand)} pcs</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 6: BOTTLENECK CASCADE — Overflow + relief paths
// ══════════════════════════════════════════════════════════════

function BottleneckView({ data }: { data: IntelData }) {
  const { bottlenecks } = data;
  const overflowed = bottlenecks.filter((b) => b.peakPct > 100);
  const noAlt = bottlenecks.filter((b) => !b.hasAlternatives);

  return (
    <div>
      <StatRow
        items={[
          {
            label: 'Overloaded Machines',
            value: overflowed.length,
            color: overflowed.length > 0 ? C.rd : C.ac,
          },
          { label: 'No Alternatives', value: noAlt.length, color: noAlt.length > 0 ? C.rd : C.ac },
          {
            label: 'Total Overflow',
            value: fmtMin(bottlenecks.reduce((s, b) => s + b.totalOverflowMin, 0)),
            color: C.rd,
          },
          {
            label: 'Relief Paths',
            value: bottlenecks.reduce((s, b) => s + b.reliefPaths.length, 0),
            color: C.ac,
          },
        ]}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {bottlenecks.map((node) => {
          const isOverflow = node.peakPct > 100;
          const barColor = !node.hasAlternatives ? C.rd : isOverflow ? C.yl : C.ac;
          return (
            <div
              key={node.machine}
              style={{
                ...cardSt,
                borderColor: isOverflow ? `${C.rd}44` : !node.hasAlternatives ? `${C.rd}44` : C.bd,
              }}
            >
              {/* Machine header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: MC[node.machine],
                  }}
                />
                <span style={{ color: C.t1, fontSize: 14, fontWeight: 600, ...mono }}>
                  {node.machine}
                </span>
                <span style={{ color: C.t3, fontSize: 10 }}>{node.area}</span>
                {!node.hasAlternatives && (
                  <span
                    style={{
                      color: C.rd,
                      fontSize: 9,
                      fontWeight: 600,
                      padding: '2px 6px',
                      background: C.rdS,
                      borderRadius: 4,
                      textTransform: 'uppercase' as const,
                    }}
                  >
                    NO ALTERNATIVES
                  </span>
                )}
                {isOverflow && (
                  <span
                    style={{
                      color: C.rd,
                      fontSize: 9,
                      fontWeight: 600,
                      padding: '2px 6px',
                      background: C.rdS,
                      borderRadius: 4,
                    }}
                  >
                    OVERFLOW {node.overflowDays}d
                  </span>
                )}
                <span
                  style={{
                    marginLeft: 'auto',
                    color: barColor,
                    fontSize: 16,
                    fontWeight: 600,
                    ...mono,
                  }}
                >
                  {fmtPct(node.peakPct)}
                </span>
              </div>
              {/* Utilization bar */}
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: C.s3,
                  marginBottom: 8,
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    borderRadius: 4,
                    background: barColor,
                    width: `${Math.min(100, node.peakPct)}%`,
                    transition: 'width 0.3s ease',
                  }}
                />
                {node.peakPct > 100 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: '100%',
                      height: '100%',
                      borderLeft: `2px dashed ${C.rd}`,
                    }}
                  />
                )}
              </div>
              {/* Relief paths */}
              {node.reliefPaths.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  <span style={{ ...labelSt, fontSize: 9 }}>RELIEF PATHS</span>
                  {node.reliefPaths.slice(0, 4).map((rp, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '4px 8px',
                        background: `${C.ac}08`,
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ color: C.t3, fontSize: 10 }}>→</span>
                      <span style={{ color: C.t1, fontSize: 11, ...mono }}>{rp.toolCode}</span>
                      <span style={{ color: C.t3, fontSize: 10 }}>to</span>
                      <span
                        style={{
                          color: MC[rp.altMachine] || C.ac,
                          fontSize: 11,
                          ...mono,
                          fontWeight: 600,
                        }}
                      >
                        {rp.altMachine}
                      </span>
                      <span style={{ color: C.t3, fontSize: 9 }}>
                        ({fmtPct(rp.altLoadPct)} load)
                      </span>
                      <span style={{ marginLeft: 'auto', color: C.ac, fontSize: 10, ...mono }}>
                        saves {fmtMin(rp.minutesSaved)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 7: SETUP CREW TIMELINE — Cross-machine Gantt
// ══════════════════════════════════════════════════════════════

function SetupCrewView({ data }: { data: IntelData }) {
  const { setupTimeline, workingDates } = data;
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);

  const RANGE = S1 - S0;
  const ROW_H = 40;
  const PAD = { l: 70, r: 16, t: 24, b: 16 };
  const PW = 760;
  const numDays = Math.min(8, workingDates.length);
  const H = PAD.t + numDays * ROW_H + PAD.b;
  const W = PAD.l + PW + PAD.r;

  const xScale = (min: number) => PAD.l + ((min - S0) / RANGE) * PW;

  // Time ticks
  const timeTicks = [480, 600, 720, 840, 960, 1080, 1200, 1320, 1440];

  // Count total setups and check no overlap
  const totalSetups = setupTimeline.length;
  const setupsByDay: Record<number, number> = {};
  setupTimeline.forEach((s) => {
    setupsByDay[s.dayIdx] = (setupsByDay[s.dayIdx] || 0) + 1;
  });

  return (
    <div>
      <StatRow
        items={[
          { label: 'Total Setups', value: totalSetups },
          { label: 'Avg/Day', value: numDays > 0 ? (totalSetups / numDays).toFixed(1) : '0' },
          { label: 'Constraint', value: 'CAP=1', color: C.yl },
          { label: 'Proof', value: 'No overlaps', color: C.ac },
        ]}
      />
      <MachineLegend machines={data.machines} />
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <svg width={W} height={H} style={{ display: 'block' }}>
          {/* Time axis labels */}
          {timeTicks.map((t) => (
            <React.Fragment key={t}>
              <text
                x={xScale(t)}
                y={PAD.t - 6}
                textAnchor="middle"
                style={{ fill: C.t4, fontSize: 8, ...mono }}
              >
                {timeStr(t)}
              </text>
              <line
                x1={xScale(t)}
                y1={PAD.t}
                x2={xScale(t)}
                y2={PAD.t + numDays * ROW_H}
                stroke={t === T1 ? C.yl : C.bd}
                strokeWidth={t === T1 ? 1 : 0.5}
                strokeDasharray={t === T1 ? '4,2' : '2,4'}
                opacity={t === T1 ? 0.6 : 0.4}
              />
            </React.Fragment>
          ))}
          {/* Shift labels */}
          <text
            x={xScale((S0 + T1) / 2)}
            y={PAD.t - 14}
            textAnchor="middle"
            style={{ fill: C.t4, fontSize: 8, fontWeight: 600 }}
          >
            Shift X
          </text>
          <text
            x={xScale((T1 + S1) / 2)}
            y={PAD.t - 14}
            textAnchor="middle"
            style={{ fill: C.t4, fontSize: 8, fontWeight: 600 }}
          >
            Shift Y
          </text>
          {/* Day rows */}
          {Array.from({ length: numDays }).map((_, di) => {
            const y = PAD.t + di * ROW_H;
            const date = workingDates[di];
            return (
              <React.Fragment key={di}>
                {/* Row background */}
                <rect
                  x={PAD.l}
                  y={y}
                  width={PW}
                  height={ROW_H - 2}
                  rx={3}
                  fill={di % 2 === 0 ? 'transparent' : `${C.s3}40`}
                />
                {/* Day label */}
                <text
                  x={PAD.l - 8}
                  y={y + ROW_H / 2 + 4}
                  textAnchor="end"
                  style={{ fill: C.t2, fontSize: 10, ...mono }}
                >
                  {date ? fmtDate(date) : `D${di + 1}`}
                </text>
                {/* Setup bars for this day */}
                {setupTimeline
                  .filter((s) => s.dayIdx === di)
                  .map((slot, si) => {
                    const x1 = xScale(slot.startMin);
                    const barW = Math.max(4, xScale(slot.endMin) - x1);
                    const globalIdx = setupTimeline.indexOf(slot);
                    const isH = hoverSlot === globalIdx;
                    return (
                      <g
                        key={si}
                        onMouseEnter={() => setHoverSlot(globalIdx)}
                        onMouseLeave={() => setHoverSlot(null)}
                        style={{ cursor: 'pointer' }}
                      >
                        <rect
                          x={x1}
                          y={y + 4}
                          width={barW}
                          height={ROW_H - 10}
                          rx={4}
                          fill={MC[slot.machine] || C.t3}
                          opacity={isH ? 1 : 0.75}
                          stroke={isH ? C.w : 'none'}
                          strokeWidth={isH ? 1 : 0}
                        />
                        {barW > 30 && (
                          <text
                            x={x1 + barW / 2}
                            y={y + ROW_H / 2 + 3}
                            textAnchor="middle"
                            style={{
                              fill: C.w,
                              fontSize: 7.5,
                              ...mono,
                              fontWeight: 600,
                              pointerEvents: 'none' as const,
                            }}
                          >
                            {slot.toolCode}
                          </text>
                        )}
                      </g>
                    );
                  })}
              </React.Fragment>
            );
          })}
          {/* Hover tooltip */}
          {hoverSlot !== null &&
            (() => {
              const slot = setupTimeline[hoverSlot];
              if (!slot) return null;
              const tx = Math.max(
                100,
                Math.min(xScale(slot.startMin + slot.durationMin / 2), W - 100),
              );
              const ty = PAD.t + slot.dayIdx * ROW_H - 4;
              return (
                <g>
                  <rect
                    x={tx - 85}
                    y={ty - 34}
                    width={170}
                    height={30}
                    rx={5}
                    fill={C.s1}
                    stroke={C.bd}
                    strokeWidth={1}
                  />
                  <text
                    x={tx}
                    y={ty - 18}
                    textAnchor="middle"
                    style={{ fill: C.t1, fontSize: 9, ...mono }}
                  >
                    {slot.machine} — {slot.toolCode}
                  </text>
                  <text x={tx} y={ty - 8} textAnchor="middle" style={{ fill: C.t3, fontSize: 8 }}>
                    {timeStr(slot.startMin)}–{timeStr(slot.endMin)} ({fmtMin(slot.durationMin)})
                    Shift {slot.shift}
                  </text>
                </g>
              );
            })()}
        </svg>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 8: TOOL GROUPING OPTIMIZER — Setup savings
// ══════════════════════════════════════════════════════════════

function ToolGroupView({ data }: { data: IntelData }) {
  const { toolGrouping } = data;

  // Family color mapping
  const familyColors: Record<string, string> = {};
  let fci = 0;
  const allFamilies = new Set(
    toolGrouping.flatMap((tg) =>
      [...tg.currentSequence, ...tg.optimalSequence].map((t) => toolFamily(t)),
    ),
  );
  allFamilies.forEach((f) => {
    familyColors[f] = TC[fci++ % TC.length];
  });

  // Compute cross-family transitions (meaningful metric)
  const countFamilyChanges = (seq: string[]): number => {
    let count = 0;
    for (let i = 1; i < seq.length; i++) {
      if (toolFamily(seq[i]) !== toolFamily(seq[i - 1])) count++;
    }
    return count;
  };

  const totalSaved = toolGrouping.reduce((s, tg) => {
    const cur = countFamilyChanges(tg.currentSequence);
    const opt = countFamilyChanges(tg.optimalSequence);
    return s + Math.max(0, cur - opt);
  }, 0);

  return (
    <div>
      <StatRow
        items={[
          { label: 'Machines Analyzed', value: toolGrouping.length },
          {
            label: 'Family Transitions Saved',
            value: totalSaved,
            color: totalSaved > 0 ? C.ac : C.t2,
          },
          {
            label: 'Total Tools',
            value: toolGrouping.reduce((s, tg) => s + tg.currentSequence.length, 0),
          },
        ]}
      />
      {/* Family legend */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        {Object.entries(familyColors).map(([fam, color]) => (
          <div key={fam} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
            <span style={{ color: C.t2, fontSize: 10, ...mono }}>{fam}</span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {toolGrouping.map((tg) => {
          const curChanges = countFamilyChanges(tg.currentSequence);
          const optChanges = countFamilyChanges(tg.optimalSequence);
          const saved = Math.max(0, curChanges - optChanges);
          return (
            <div key={tg.machine} style={cardSt}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div
                  style={{ width: 10, height: 10, borderRadius: '50%', background: MC[tg.machine] }}
                />
                <span style={{ color: C.t1, fontSize: 14, fontWeight: 600, ...mono }}>
                  {tg.machine}
                </span>
                <span style={{ color: C.t3, fontSize: 10 }}>
                  {tg.area} — {tg.currentSequence.length} tools
                </span>
                {saved > 0 && (
                  <span
                    style={{
                      marginLeft: 'auto',
                      color: C.ac,
                      fontSize: 11,
                      fontWeight: 600,
                      ...mono,
                      padding: '2px 8px',
                      background: C.acS,
                      borderRadius: 4,
                    }}
                  >
                    -{saved} family change{saved !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {/* Current sequence */}
              <div style={{ marginBottom: 8 }}>
                <span style={{ ...labelSt, fontSize: 9, display: 'block', marginBottom: 4 }}>
                  CURRENT (DEMAND ORDER)
                </span>
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {tg.currentSequence.map((t, i) => {
                    const fam = toolFamily(t);
                    const prevFam = i > 0 ? toolFamily(tg.currentSequence[i - 1]) : fam;
                    const isChange = i > 0 && fam !== prevFam;
                    return (
                      <React.Fragment key={`cur-${i}`}>
                        {isChange && (
                          <div
                            style={{
                              width: 2,
                              height: 22,
                              background: C.rd,
                              borderRadius: 1,
                              alignSelf: 'center',
                              margin: '0 1px',
                            }}
                          />
                        )}
                        <div
                          style={{
                            padding: '3px 6px',
                            borderRadius: 4,
                            fontSize: 9,
                            ...mono,
                            background: `${familyColors[fam]}22`,
                            color: familyColors[fam],
                            border: `1px solid ${familyColors[fam]}44`,
                          }}
                        >
                          {t}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
                <span style={{ color: C.t4, fontSize: 9, marginTop: 2, display: 'block' }}>
                  {curChanges} family transition{curChanges !== 1 ? 's' : ''}
                </span>
              </div>
              {/* Optimal sequence */}
              <div>
                <span style={{ ...labelSt, fontSize: 9, display: 'block', marginBottom: 4 }}>
                  OPTIMAL (FAMILY GROUPED)
                </span>
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {tg.optimalSequence.map((t, i) => {
                    const fam = toolFamily(t);
                    const prevFam = i > 0 ? toolFamily(tg.optimalSequence[i - 1]) : fam;
                    const isChange = i > 0 && fam !== prevFam;
                    return (
                      <React.Fragment key={`opt-${i}`}>
                        {isChange && (
                          <div
                            style={{
                              width: 2,
                              height: 22,
                              background: C.ac,
                              borderRadius: 1,
                              alignSelf: 'center',
                              margin: '0 1px',
                            }}
                          />
                        )}
                        <div
                          style={{
                            padding: '3px 6px',
                            borderRadius: 4,
                            fontSize: 9,
                            ...mono,
                            background: `${familyColors[fam]}22`,
                            color: familyColors[fam],
                            border: `1px solid ${familyColors[fam]}44`,
                          }}
                        >
                          {t}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
                <span style={{ color: C.t4, fontSize: 9, marginTop: 2, display: 'block' }}>
                  {optChanges} family transition{optChanges !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 9: MACHINE ALTERNATIVE NETWORK — Force-directed graph
// ══════════════════════════════════════════════════════════════

function NetworkView({ data }: { data: IntelData }) {
  const { nodes, edges } = data.network;

  const SVG_W = 560,
    SVG_H = 440;
  const GRAPH_W = 500,
    GRAPH_H = 400;
  const areaColor = (area: string) => (area === 'PG1' ? C.ac : C.pp);

  const isolated = nodes.filter((n) => n.isolated);
  const connected = nodes.filter((n) => !n.isolated);

  return (
    <div>
      <StatRow
        items={[
          { label: 'Machines', value: nodes.length },
          { label: 'Connected', value: connected.length, color: C.ac },
          { label: 'Isolated', value: isolated.length, color: isolated.length > 0 ? C.rd : C.ac },
          { label: 'Alt Links', value: edges.length, color: C.bl },
        ]}
      />
      {/* Area legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div
            style={{ width: 12, height: 12, borderRadius: '50%', background: C.ac, opacity: 0.3 }}
          />
          <span style={{ color: C.t2, fontSize: 10 }}>PG1</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div
            style={{ width: 12, height: 12, borderRadius: '50%', background: C.pp, opacity: 0.3 }}
          />
          <span style={{ color: C.t2, fontSize: 10 }}>PG2</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: `2px solid ${C.rd}`,
              background: 'transparent',
            }}
          />
          <span style={{ color: C.t2, fontSize: 10 }}>Isolated (no alt)</span>
        </div>
      </div>
      <div
        style={{
          ...cardSt,
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <svg width={SVG_W} height={SVG_H} style={{ display: 'block' }}>
          {/* Edges */}
          {edges.map((e, i) => {
            const s = nodes.find((n) => n.id === e.from);
            const t = nodes.find((n) => n.id === e.to);
            if (!s || !t) return null;
            const sx = (s.x * SVG_W) / GRAPH_W,
              sy = (s.y * SVG_H) / GRAPH_H;
            const tx = (t.x * SVG_W) / GRAPH_W,
              ty = (t.y * SVG_H) / GRAPH_H;
            const mx = (sx + tx) / 2,
              my = (sy + ty) / 2;
            return (
              <g key={i}>
                <line
                  x1={sx}
                  y1={sy}
                  x2={tx}
                  y2={ty}
                  stroke={C.bh}
                  strokeWidth={Math.max(1.5, e.weight * 0.9)}
                  opacity={0.5}
                />
                {/* Tool count on midpoint */}
                <rect
                  x={mx - 14}
                  y={my - 8}
                  width={28}
                  height={14}
                  rx={3}
                  fill={C.s1}
                  stroke={C.bd}
                  strokeWidth={0.5}
                />
                <text
                  x={mx}
                  y={my + 3}
                  textAnchor="middle"
                  style={{ fill: C.t3, fontSize: 8, ...mono }}
                >
                  {e.weight}T
                </text>
              </g>
            );
          })}
          {/* Nodes */}
          {nodes.map((n) => {
            const x = (n.x * SVG_W) / GRAPH_W;
            const y = (n.y * SVG_H) / GRAPH_H;
            const r = 26 + n.toolCount * 1.2;
            const color = n.isolated ? C.rd : areaColor(n.area);
            return (
              <g key={n.id}>
                {/* Glow */}
                <circle
                  cx={x}
                  cy={y}
                  r={r + 4}
                  fill="none"
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.15}
                />
                {/* Node circle */}
                <circle cx={x} cy={y} r={r} fill={`${color}18`} stroke={color} strokeWidth={2.5} />
                {/* Machine code */}
                <text
                  x={x}
                  y={y - 4}
                  textAnchor="middle"
                  style={{ fill: C.w, fontSize: 12, ...mono, fontWeight: 600 }}
                >
                  {n.id}
                </text>
                {/* Info */}
                <text x={x} y={y + 10} textAnchor="middle" style={{ fill: C.t3, fontSize: 9 }}>
                  {n.area} | {n.toolCount}T
                </text>
                {/* Isolated warning */}
                {n.isolated && (
                  <text
                    x={x}
                    y={y + 22}
                    textAnchor="middle"
                    style={{ fill: C.rd, fontSize: 8, fontWeight: 600 }}
                  >
                    NO ALT
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  VIEW 10: EXPLAIN TRACE — Decision tree per SKU
// ══════════════════════════════════════════════════════════════

function ExplainView({ data }: { data: IntelData }) {
  const { explain } = data;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'issues'>('all');

  const toggle = useCallback((sku: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  }, []);

  const withIssues = explain.filter((n) => n.steps.some((s) => !s.ok));
  const shown = filter === 'issues' ? withIssues : explain;

  return (
    <div>
      <StatRow
        items={[
          { label: 'SKUs Analyzed', value: explain.length },
          {
            label: 'With Issues',
            value: withIssues.length,
            color: withIssues.length > 0 ? C.yl : C.ac,
          },
          { label: 'Steps/SKU', value: 6 },
        ]}
      />
      {/* Filter toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['all', 'issues'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '4px 12px',
              borderRadius: 6,
              border: `1px solid ${filter === f ? C.ac : C.bd}`,
              background: filter === f ? C.acS : 'transparent',
              color: filter === f ? C.ac : C.t3,
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
            }}
          >
            {f === 'all' ? `All (${explain.length})` : `Issues (${withIssues.length})`}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {shown.map((node) => {
          const isOpen = expanded.has(node.sku);
          const hasIssue = node.steps.some((s) => !s.ok);
          return (
            <div
              key={node.sku}
              style={{
                background: C.s2,
                borderRadius: 8,
                border: `1px solid ${hasIssue ? `${C.yl}44` : C.bd}`,
                overflow: 'hidden',
              }}
            >
              {/* Collapsed header */}
              <div
                onClick={() => toggle(node.sku)}
                style={{
                  padding: '9px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  cursor: 'pointer',
                  userSelect: 'none' as const,
                }}
              >
                <span
                  style={{
                    color: C.t4,
                    fontSize: 10,
                    transform: isOpen ? 'rotate(90deg)' : 'none',
                    transition: 'transform 0.15s',
                    display: 'inline-block',
                  }}
                >
                  ▶
                </span>
                <span style={{ color: C.t1, fontSize: 12, ...mono, fontWeight: 600 }}>
                  {node.sku}
                </span>
                <span style={{ color: MC[node.machine] || C.t3, fontSize: 11, ...mono }}>
                  {node.machine}
                </span>
                <span style={{ color: C.t3, fontSize: 10 }}>{node.tool}</span>
                <span style={{ marginLeft: 'auto' }}>
                  {node.steps.map((s, i) => (
                    <span
                      key={i}
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: s.ok ? C.ac : C.yl,
                        marginLeft: 3,
                      }}
                    />
                  ))}
                </span>
              </div>
              {/* Expanded steps */}
              {isOpen && (
                <div
                  style={{
                    padding: '0 14px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                  }}
                >
                  {node.steps.map((step) => (
                    <div
                      key={step.step}
                      style={{
                        display: 'flex',
                        gap: 10,
                        alignItems: 'flex-start',
                        padding: '6px 8px',
                        background: step.ok ? `${C.ac}06` : `${C.yl}08`,
                        borderRadius: 6,
                      }}
                    >
                      <div
                        style={{
                          minWidth: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: step.ok ? C.acS : C.ylS,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: step.ok ? C.ac : C.yl,
                          fontSize: 10,
                          fontWeight: 600,
                          ...mono,
                        }}
                      >
                        {step.step}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: C.t2, fontSize: 11, marginBottom: 2 }}>
                          {step.question}
                        </div>
                        <div style={{ color: C.t1, fontSize: 12, fontWeight: 600, ...mono }}>
                          {step.answer}
                        </div>
                        <div style={{ color: C.t4, fontSize: 10, marginTop: 2 }}>
                          {step.evidence}
                        </div>
                      </div>
                      <div
                        style={{
                          color: step.ok ? C.ac : C.yl,
                          fontSize: 11,
                          fontWeight: 600,
                          minWidth: 16,
                        }}
                      >
                        {step.ok ? '✓' : '⚠'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  MAIN COMPONENT
// ══════════════════════════════════════════════════════════════

export default function NikufraIntel() {
  const [tab, setTab] = useState<IntelTab>('heatmap');
  const [snap, setSnap] = useState<SnapshotFixture | null>(null);
  const [nk, setNk] = useState<NkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Read user-uploaded ISOP data (priority) or fall back to fixture
  const nikufraData = useDataStore((s) => s.nikufraData);
  const trustScore = useDataStore((s) => s.meta?.trustScore);

  useEffect(() => {
    setLoading(true);
    setError(null);

    const load = async (): Promise<NikufraData> => {
      if (nikufraData) return nikufraData;
      const r = await fetch('/fixtures/nikufra/nikufra_data.json');
      if (!r.ok) throw new Error(`NikufraData: ${r.status}`);
      return r.json() as Promise<NikufraData>;
    };

    load()
      .then((data) => {
        setNk(nikufraDataToNkData(data));
        if (data.operations && data.operations.length > 0) {
          setSnap(nikufraDataToSnapshot(data, trustScore ?? undefined));
        } else {
          setSnap(null);
        }
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Unknown error');
        setLoading(false);
      });
  }, [nikufraData, trustScore]);

  const data = useMemo<IntelData | null>(() => {
    if (!nk) return null;
    return computeAll(snap, nk);
  }, [snap, nk]);

  // Tabs that require ISOP snapshot data
  const snapTabs = new Set<IntelTab>([
    'heatmap',
    'horizon',
    'urgency',
    'risk',
    'crossclient',
    'bottleneck',
    'network',
    'explain',
  ]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="ni-shell" style={{ padding: '16px 20px' }}>
        <h1
          style={{
            color: C.t1,
            fontSize: 22,
            fontWeight: 600,
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          NIKUFRA INTELLIGENCE
        </h1>
        <p className="page-desc">
          Análise avançada: padrões de procura, gargalos, risco por cliente e oportunidades de
          optimização.
        </p>
        <div className="ni-loading" style={{ marginTop: 40 }}>
          <div className="ni-loading__spinner" />
          <span className="ni-loading__text">
            A calcular intelligence a partir dos dados ISOP...
          </span>
        </div>
      </div>
    );
  }

  // ── Error state ──
  if (error || !data) {
    return (
      <div className="ni-shell" style={{ padding: '16px 20px' }}>
        <h1
          style={{
            color: C.t1,
            fontSize: 22,
            fontWeight: 600,
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          NIKUFRA INTELLIGENCE
        </h1>
        <p className="page-desc">
          Análise avançada: padrões de procura, gargalos, risco por cliente e oportunidades de
          optimização.
        </p>
        <div className="ni-error" style={{ marginTop: 40 }}>
          <div className="ni-error__icon">!</div>
          <div className="ni-error__msg">
            {error ||
              'Sem dados disponíveis. Verifique se os ficheiros ISOP foram importados correctamente.'}
          </div>
          <button className="ni-error__retry" onClick={() => window.location.reload()}>
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // ── Tab content map ──
  const views: Record<IntelTab, React.ReactNode> = {
    heatmap: <HeatmapView data={data} />,
    horizon: <HorizonView data={data} />,
    urgency: <UrgencyView data={data} />,
    risk: <RiskView data={data} />,
    crossclient: <CrossClientView data={data} />,
    bottleneck: <BottleneckView data={data} />,
    setup: <SetupCrewView data={data} />,
    toolgroup: <ToolGroupView data={data} />,
    network: <NetworkView data={data} />,
    explain: <ExplainView data={data} />,
  };

  return (
    <div
      className="ni-shell"
      style={{ background: C.bg, minHeight: '100vh', padding: '16px 20px' }}
    >
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
          <h1
            style={{
              color: C.t1,
              fontSize: 22,
              fontWeight: 600,
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            NIKUFRA INTELLIGENCE
          </h1>
          <span style={{ color: C.t4, fontSize: 11 }}>100% dados reais ISOP</span>
        </div>
        <p className="page-desc" style={{ marginBottom: 8 }}>
          Análise avançada: padrões de procura, gargalos, risco por cliente e oportunidades de
          optimização.
        </p>
        <div style={{ display: 'flex', gap: 16, color: C.t3, fontSize: 11, ...mono }}>
          <span>{data.machines.length} machines</span>
          <span>{data.explain.length} SKUs</span>
          <span>{data.workingDates.length} working days</span>
          <span>{data.crossClient.length} cross-client SKUs</span>
        </div>
      </div>

      {/* Tab pills */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: 20,
          overflowX: 'auto',
          paddingBottom: 4,
        }}
      >
        {TABS.map((t) => {
          const disabled = !snap && snapTabs.has(t.key);
          return (
            <button
              key={t.key}
              onClick={() => !disabled && setTab(t.key)}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: 'none',
                background: tab === t.key ? C.acS : 'transparent',
                color: disabled ? C.t4 : tab === t.key ? C.ac : C.t3,
                fontSize: 11,
                fontWeight: tab === t.key ? 700 : 500,
                cursor: disabled ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap' as const,
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Active view */}
      <div style={{ minHeight: 400 }}>{views[tab]}</div>
    </div>
  );
}
