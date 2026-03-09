/**
 * OptimalRoutingCard — Optimization results, GA/SA controls, routing display.
 */

import { Sparkles, Star, Zap } from 'lucide-react';
import React from 'react';
import { C } from '../../../../lib/engine';
import { Card, Pill, toolColor } from '../atoms';
import type { OptimalRoutingCardProps } from './types';

export function OptimalRoutingCard({
  tools,
  optRunning,
  optResults,
  optProgress,
  optN,
  optProfile,
  optMoveable,
  saRunning,
  saProgress,
  setOptN,
  setOptProfile,
  setOptResults,
  runOpt,
  runSA,
  cancelSA,
  applyOptResult,
  profiles,
}: OptimalRoutingCardProps) {
  return (
    <Card style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: C.t1 }}>
          <Sparkles
            size={12}
            strokeWidth={1.5}
            style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4, color: C.pp }}
          />
          Optimização{' '}
          <span style={{ fontSize: 10, color: C.t4, fontWeight: 400 }}>
            {optMoveable.length} ops movíveis
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          marginBottom: 10,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 9,
              color: C.t4,
              marginBottom: 2,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.04em',
            }}
          >
            Perfil
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {profiles.map((p) => (
              <Pill
                key={p.id}
                active={optProfile === p.id}
                color={C.pp}
                onClick={() => {
                  setOptProfile(p.id);
                  setOptResults([]);
                }}
                size="sm"
              >
                {p.label}
              </Pill>
            ))}
          </div>
        </div>
        <div>
          <div
            style={{
              fontSize: 9,
              color: C.t4,
              marginBottom: 2,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '.04em',
            }}
          >
            Iterações
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {[100, 200, 500].map((n) => (
              <Pill
                key={n}
                active={optN === n}
                color={C.bl}
                onClick={() => {
                  setOptN(n);
                  setOptResults([]);
                }}
                size="sm"
              >
                {n}
              </Pill>
            ))}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={runOpt}
          disabled={optRunning}
          data-testid="run-optimization"
          style={{
            padding: '8px 20px',
            borderRadius: 6,
            border: 'none',
            background: optRunning ? C.s3 : C.pp,
            color: optRunning ? C.t3 : C.t1,
            fontSize: 11,
            fontWeight: 600,
            cursor: optRunning ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Sparkles
            size={11}
            strokeWidth={1.5}
            style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }}
          />
          {optRunning ? `A optimizar... ${Math.round(optProgress * 100)}%` : 'Otimizar'}
        </button>
        <button
          onClick={saRunning ? cancelSA : runSA}
          disabled={optRunning}
          data-testid="run-sa"
          style={{
            padding: '8px 20px',
            borderRadius: 6,
            border: 'none',
            background: saRunning ? C.s3 : '#1a6b3a',
            color: saRunning ? C.t3 : C.t1,
            fontSize: 11,
            fontWeight: 600,
            cursor: optRunning ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Zap
            size={11}
            strokeWidth={1.5}
            style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }}
          />
          {saRunning
            ? `SA ${saProgress != null ? `${saProgress}%` : '...'} (cancelar)`
            : 'SA Otimizar'}
        </button>
      </div>

      {/* SA Progress Bar */}
      {saRunning && saProgress != null && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ height: 4, borderRadius: 2, background: C.s3, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${saProgress}%`,
                background: '#1a6b3a',
                borderRadius: 2,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 10, color: C.t3, marginTop: 2 }}>
            Simulated Annealing em execucao (Web Worker) — {saProgress}%
          </div>
        </div>
      )}

      {/* Moveable ops summary */}
      {optMoveable.length > 0 && !optResults.length && (
        <div style={{ maxHeight: 120, overflowY: 'auto', marginBottom: 6 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '70px 60px 50px 50px 1fr',
              gap: '2px 8px',
              fontSize: 10,
            }}
          >
            <div style={{ color: C.t4, fontSize: 9, fontWeight: 600 }}>Ferramenta</div>
            <div style={{ color: C.t4, fontSize: 9, fontWeight: 600 }}>Prim.</div>
            <div style={{ color: C.t4, fontSize: 9, fontWeight: 600 }}>Alt.</div>
            <div style={{ color: C.t4, fontSize: 9, fontWeight: 600 }}>Pcs</div>
            <div style={{ color: C.t4, fontSize: 9, fontWeight: 600 }}>Horas</div>
            {optMoveable.slice(0, 12).map((mo) => (
              <React.Fragment key={mo.opId}>
                <div
                  style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    color: toolColor(tools, mo.toolId),
                    fontWeight: 600,
                  }}
                >
                  {mo.toolId}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", color: C.t2 }}>
                  {mo.primaryM}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", color: C.ac }}>
                  {mo.altM}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", color: C.t1 }}>
                  {mo.totalPcs.toLocaleString()}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono',monospace", color: C.t3 }}>
                  {mo.hrs.toFixed(1)}h
                </div>
              </React.Fragment>
            ))}
          </div>
          {optMoveable.length > 12 && (
            <div style={{ fontSize: 9, color: C.t4, textAlign: 'center', marginTop: 4 }}>
              +{optMoveable.length - 12} mais
            </div>
          )}
        </div>
      )}

      {/* Optimization results */}
      {optResults.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {optResults.slice(0, 5).map((r, ri) => (
            <div
              key={ri}
              style={{
                padding: 10,
                borderRadius: 6,
                background: ri === 0 ? `${C.pp}08` : C.bg,
                border: `1px solid ${ri === 0 ? C.pp + '33' : C.bd}`,
                borderLeft: `3px solid ${ri === 0 ? C.pp : C.t4}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {ri === 0 && <Star size={12} strokeWidth={1.5} style={{ color: C.pp }} />}
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: ri === 0 ? C.pp : C.t1,
                      fontFamily: "'JetBrains Mono',monospace",
                    }}
                  >
                    #{ri + 1}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
                  <span style={{ color: C.t3 }}>
                    OTD{' '}
                    <span
                      style={{
                        fontWeight: 600,
                        color: r.otd >= 95 ? C.ac : C.rd,
                        fontFamily: "'JetBrains Mono',monospace",
                      }}
                    >
                      {r.otd.toFixed(1)}%
                    </span>
                  </span>
                  <span style={{ color: C.t3 }}>
                    Setups{' '}
                    <span
                      style={{
                        fontWeight: 600,
                        color: C.t1,
                        fontFamily: "'JetBrains Mono',monospace",
                      }}
                    >
                      {r.setupCount}
                    </span>
                  </span>
                  <span style={{ color: C.t3 }}>
                    Tard.{' '}
                    <span
                      style={{
                        fontWeight: 600,
                        color: r.tardinessDays > 0 ? C.yl : C.ac,
                        fontFamily: "'JetBrains Mono',monospace",
                      }}
                    >
                      {r.tardinessDays.toFixed(1)}d
                    </span>
                  </span>
                  <span style={{ color: C.t3 }}>
                    Moves{' '}
                    <span
                      style={{
                        fontWeight: 600,
                        color: C.bl,
                        fontFamily: "'JetBrains Mono',monospace",
                      }}
                    >
                      {r.moves.length}
                    </span>
                  </span>
                </div>
                {r.label && <span style={{ fontSize: 9, color: C.t4 }}>{r.label}</span>}
              </div>
              <button
                onClick={() => applyOptResult(r)}
                data-testid={`apply-opt-${ri}`}
                style={{
                  padding: '4px 12px',
                  borderRadius: 4,
                  border: 'none',
                  background: ri === 0 ? C.pp : C.s3,
                  color: C.t1,
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Aplicar
              </button>
            </div>
          ))}
        </div>
      )}

      {optMoveable.length === 0 && (
        <div style={{ fontSize: 10, color: C.t4, textAlign: 'center', padding: 8 }}>
          Sem operações movíveis (todas as ferramentas numa só máquina)
        </div>
      )}
    </Card>
  );
}
