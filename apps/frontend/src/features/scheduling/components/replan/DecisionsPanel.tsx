/**
 * DecisionsPanel — Metrics summary, decision cards, and capacity impact.
 */
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronRight, Undo2 } from 'lucide-react';
import type { Block, DayLoad, EngineData, MoveAction, OptResult } from '../../../../lib/engine';
import { C, DAY_CAP } from '../../../../lib/engine';
import { gridDensityVars } from '../../../../utils/gridDensity';
import { Card, dot, Metric, Pill, Tag, toolColor } from '../atoms';
import type { ReplanProposal } from './types';

export interface DecisionsPanelProps {
  data: EngineData;
  blocks: Block[];
  cap: Record<string, DayLoad[]>;
  mSt: Record<string, string>;
  moves: MoveAction[];
  undoMove: (opId: string) => void;
  applyMove: (opId: string, toM: string) => void;
  decs: ReplanProposal[];
  xai: string | null;
  setXai: (id: string | null) => void;
  neMetrics: (OptResult & { blocks: Block[] }) | null;
}

export function DecisionsPanel({
  data,
  blocks,
  cap,
  mSt,
  moves,
  undoMove,
  applyMove,
  decs,
  xai,
  setXai,
  neMetrics,
}: DecisionsPanelProps) {
  const { machines, ops, dates, dnames, toolMap: TM, tools } = data;
  const rp = decs.filter((d) => d.type === 'replan');
  const blk = decs.filter((d) => d.type === 'blocked');
  const lP = blk.reduce((a, d) => a + ((d.impact?.pcsLost as number) || 0), 0);
  const otd = neMetrics ? neMetrics.otdDelivery.toFixed(1) : '—';
  const sC = (s: string) => ({ critical: C.rd, high: C.yl, medium: C.bl, low: C.ac })[s] || C.t3;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
        {[
          { l: 'OTD', v: `${otd}%`, c: parseFloat(otd) < 95 ? C.rd : C.ac },
          {
            l: 'Decisões',
            v: decs.length,
            s: `${rp.length} replaneáveis`,
            c: decs.length > 0 ? C.yl : C.ac,
          },
          { l: 'Aplicadas', v: moves.length, c: moves.length > 0 ? C.ac : C.t3 },
          { l: 'Bloqueadas', v: blk.length, c: blk.length > 0 ? C.rd : C.ac },
          {
            l: 'Perdidas',
            v: lP > 0 ? `${(lP / 1000).toFixed(0)}K` : '0',
            c: lP > 0 ? C.rd : C.ac,
          },
        ].map((k, i) => (
          <Card key={i}>
            <Metric label={k.l} value={k.v} sub={k.s} color={k.c} />
          </Card>
        ))}
      </div>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12, alignItems: 'start' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {moves.length > 0 && (
            <Card style={{ padding: 12, background: C.acS, borderColor: C.ac + '22' }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.ac, marginBottom: 4 }}>
                Aplicadas ({moves.length})
              </div>
              {moves.map((mv) => {
                const op = ops.find((o) => o.id === mv.opId);
                return (
                  <div
                    key={mv.opId}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: toolColor(tools, op?.t || ''),
                        fontFamily: 'monospace',
                      }}
                    >
                      {op?.t}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: C.rd,
                        textDecoration: 'line-through',
                        fontFamily: 'monospace',
                      }}
                    >
                      {TM[op?.t || '']?.m}
                    </span>
                    <span style={{ color: C.ac, display: 'inline-flex', alignItems: 'center' }}>
                      <ArrowRight size={12} strokeWidth={1.5} />
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: C.ac,
                        fontFamily: 'monospace',
                        fontWeight: 600,
                      }}
                    >
                      {mv.toM}
                    </span>
                    <span style={{ flex: 1, fontSize: 9, color: C.t3 }}>{op?.nm}</span>
                    <Pill color={C.rd} active onClick={() => undoMove(mv.opId)} size="sm">
                      <Undo2 size={9} strokeWidth={1.5} />
                    </Pill>
                  </div>
                );
              })}
            </Card>
          )}

          {decs.length === 0 && moves.length === 0 && (
            <Card style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.t3 }}>Sem ações pendentes</div>
              <div style={{ fontSize: 10, color: C.t4, marginTop: 4 }}>
                Marca máquinas/ferramentas DOWN para ativar
              </div>
            </Card>
          )}

          {decs.map((d) => {
            const imp = d.impact as Record<string, unknown> | null;
            const dLoad = imp?.dLoad as
              | Array<{ day: number; current: number; added: number; total: number; util: number }>
              | undefined;
            return (
              <Card key={d.id} style={{ padding: 14, borderLeft: `3px solid ${sC(d.severity)}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Tag color={sC(d.severity)}>{d.severity}</Tag>
                  <Tag color={d.type === 'replan' ? C.ac : C.rd}>
                    {d.type === 'replan' ? 'REPLAN' : 'BLOQUEADA'}
                  </Tag>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.t1 }}>{d.title}</span>
                </div>
                <div style={{ fontSize: 10, color: C.t3, marginBottom: 6 }}>{d.desc}</div>

                {d.type === 'replan' && imp && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    {(
                      [
                        { l: 'De', v: imp.fromM, c: C.rd },
                        { l: 'Para', v: imp.toM, c: C.ac },
                        { l: 'Setup', v: `+${imp.setupMin}m`, c: C.pp },
                        {
                          l: 'Peças',
                          v:
                            (imp.pcs as number) > 999
                              ? `${((imp.pcs as number) / 1000).toFixed(1)}K`
                              : imp.pcs,
                          c: C.t1,
                        },
                        { l: 'Horas', v: `${imp.hrs}h` },
                        {
                          l: 'Pico',
                          v: `${imp.destPeak}%`,
                          c: parseInt(imp.destPeak as string) > 85 ? C.yl : C.ac,
                        },
                      ] as Array<{ l: string; v: unknown; c?: string }>
                    ).map((m, i) => (
                      <div
                        key={i}
                        style={{ background: C.bg, borderRadius: 6, padding: '4px 8px' }}
                      >
                        <div style={{ fontSize: 8, color: C.t4 }}>{m.l}</div>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: m.c || C.t1,
                            fontFamily: 'monospace',
                          }}
                        >
                          {String(m.v)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!!imp?.stockRisk && (
                  <div
                    style={{
                      fontSize: 10,
                      color: C.yl,
                      fontWeight: 600,
                      marginBottom: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                  >
                    <AlertTriangle size={10} strokeWidth={1.5} /> STOCK ZERO — OTD em risco
                  </div>
                )}
                {!!imp?.sharedMP && (
                  <div style={{ fontSize: 10, color: C.cy, marginBottom: 4 }}>
                    MP partilhada — oportunidade agrupar
                  </div>
                )}

                {d.type === 'replan' && dLoad && (
                  <div style={{ display: 'flex', gap: 2, marginBottom: 6 }}>
                    {dLoad
                      .filter((dl) => dl.total > 0 || dl.added > 0)
                      .slice(0, 6)
                      .map((dl) => (
                        <div key={dl.day} style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ fontSize: 8, color: C.t4 }}>{dnames[dl.day]}</div>
                          <div
                            style={{
                              height: 24,
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'flex-end',
                              background: C.bg,
                              borderRadius: 3,
                              overflow: 'hidden',
                            }}
                          >
                            <div
                              style={{
                                height: `${Math.min((dl.current / DAY_CAP) * 100, 100)}%`,
                                background: C.bl + '44',
                                minHeight: dl.current > 0 ? 1 : 0,
                              }}
                            />
                            {dl.added > 0 && (
                              <div
                                style={{
                                  height: `${Math.min((dl.added / DAY_CAP) * 100, 50)}%`,
                                  background: C.ac,
                                  minHeight: 1,
                                }}
                              />
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: 8,
                              color: dl.util > 1 ? C.rd : C.ac,
                              fontWeight: 600,
                            }}
                          >
                            {(dl.util * 100).toFixed(0)}%
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <button
                    onClick={() => setXai(xai === d.id ? null : d.id)}
                    style={{
                      padding: '3px 10px',
                      borderRadius: 6,
                      border: `1px solid ${C.pp}33`,
                      background: xai === d.id ? C.ppS : 'transparent',
                      color: C.pp,
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {xai === d.id ? (
                      <ChevronDown
                        size={10}
                        strokeWidth={1.5}
                        style={{ display: 'inline', verticalAlign: 'middle' }}
                      />
                    ) : (
                      <ChevronRight
                        size={10}
                        strokeWidth={1.5}
                        style={{ display: 'inline', verticalAlign: 'middle' }}
                      />
                    )}{' '}
                    Raciocínio ({d.reasoning.length})
                  </button>
                  {d.type === 'replan' && d.action && (
                    <Pill
                      color={C.ac}
                      active
                      onClick={() => applyMove(d.action!.opId, d.action!.toM)}
                    >
                      <Check
                        size={10}
                        strokeWidth={2}
                        style={{ display: 'inline', verticalAlign: 'middle' }}
                      />{' '}
                      Aplicar{' '}
                      <ArrowRight
                        size={10}
                        strokeWidth={1.5}
                        style={{ display: 'inline', verticalAlign: 'middle' }}
                      />{' '}
                      {d.action.toM}
                    </Pill>
                  )}
                  {d.type === 'blocked' && <Tag color={C.rd}>MANUAL</Tag>}
                </div>
                {xai === d.id && (
                  <div style={{ marginTop: 8, padding: 10, background: C.bg, borderRadius: 6 }}>
                    {d.reasoning.map((r, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 6,
                          padding: '3px 0',
                          borderBottom: i < d.reasoning.length - 1 ? `1px solid ${C.bd}` : 'none',
                        }}
                      >
                        <span style={{ fontSize: 10, color: C.pp, fontWeight: 600, minWidth: 16 }}>
                          {i + 1}.
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            color: r.startsWith('\u2192')
                              ? C.ac
                              : r.startsWith('\u26A0')
                                ? C.yl
                                : r.startsWith('\u2713')
                                  ? C.ac
                                  : C.t2,
                            lineHeight: 1.5,
                          }}
                        >
                          {r}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.t1 }}>Impacto Capacidade</div>
          {machines
            .filter((m) => {
              const d = mSt[m.id] === 'down';
              const h = blocks.some(
                (b) => (b.moved && b.machineId === m.id) || (b.moved && b.origM === m.id),
              );
              return d || h;
            })
            .slice(0, 6)
            .map((mc) => {
              const isD = mSt[mc.id] === 'down';
              const mc_c = cap[mc.id];
              return (
                <Card key={mc.id} style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                    <span style={dot(isD ? C.rd : C.ac, isD)} />
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: isD ? C.rd : C.t1,
                        fontFamily: 'monospace',
                      }}
                    >
                      {mc.id}
                    </span>
                    <Tag color={isD ? C.rd : C.ac}>{isD ? 'OFF' : 'ON'}</Tag>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${data.nDays},1fr)`,
                      gap: 2,
                      ...gridDensityVars(data.nDays),
                    }}
                  >
                    {dates.map((_, di) => {
                      const dc = mc_c?.[di] || { prod: 0, setup: 0 };
                      const tot = dc.prod + dc.setup;
                      const u = tot / DAY_CAP;
                      return (
                        <div key={di} style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: 8, color: C.t4 }}>{dnames[di]}</div>
                          <div
                            style={{
                              height: 32,
                              display: 'flex',
                              flexDirection: 'column',
                              justifyContent: 'flex-end',
                              background: C.bg,
                              borderRadius: 3,
                              overflow: 'hidden',
                            }}
                          >
                            {dc.setup > 0 && (
                              <div
                                style={{
                                  height: `${Math.min((dc.setup / DAY_CAP) * 100, 30)}%`,
                                  background: C.pp + '66',
                                  minHeight: 1,
                                }}
                              />
                            )}
                            {dc.prod > 0 && (
                              <div
                                style={{
                                  height: `${Math.min((dc.prod / DAY_CAP) * 100, 100)}%`,
                                  background: isD ? C.rd + '44' : u > 1 ? C.rd + '66' : C.ac + '66',
                                  minHeight: 1,
                                }}
                              />
                            )}
                          </div>
                          {tot > 0 && (
                            <div
                              style={{ fontSize: 8, color: u > 1 ? C.rd : C.ac, fontWeight: 600 }}
                            >
                              {(u * 100).toFixed(0)}%
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          {Object.values(mSt).every((s) => s !== 'down') && moves.length === 0 && (
            <Card style={{ padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: C.t4 }}>Marca DOWN para ver impacto</div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
