/**
 * FailureFormCard — Failure/breakdown registration form and active failures list.
 */
import { X } from 'lucide-react';
import { C } from '../../../../lib/engine';
import { Card, Pill, Tag } from '../atoms';
import type { FailureFormCardProps } from './types';

export function FailureFormCard({
  machines,
  tools,
  focusIds,
  failures,
  failureImpacts,
  showFailureForm,
  ffResType,
  ffResId,
  ffSev,
  ffCap,
  ffStartDay,
  ffEndDay,
  ffDesc,
  cascRunning,
  wdi,
  dates,
  dnames,
  setShowFailureForm,
  setFfResType,
  setFfResId,
  setFfSev,
  setFfCap,
  setFfStartDay,
  setFfEndDay,
  setFfDesc,
  addFailure,
  removeFailure,
  runCascadingReplan,
}: FailureFormCardProps) {
  const labelStyle = {
    fontSize: 9,
    color: C.t4,
    marginBottom: 3,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '.04em',
  };

  const selectStyle = {
    padding: '3px 4px',
    borderRadius: 4,
    border: `1px solid ${C.bd}`,
    background: C.s2,
    color: C.t1,
    fontSize: 10,
    fontFamily: 'inherit',
  } as const;

  return (
    <Card style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: failures.length > 0 || showFailureForm ? 10 : 0,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: C.t1 }}>
          Avarias / Indisponibilidades{' '}
          {failures.length > 0 && <Tag color={C.rd}>{failures.length}</Tag>}
        </div>
        <button
          onClick={() => setShowFailureForm(!showFailureForm)}
          style={{
            padding: '4px 10px',
            borderRadius: 4,
            border: `1px solid ${C.rd}33`,
            background: showFailureForm ? C.rdS : 'transparent',
            color: C.rd,
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {showFailureForm ? 'Cancelar' : '+ Registar Avaria'}
        </button>
      </div>

      {showFailureForm && (
        <div
          style={{
            padding: 12,
            background: C.bg,
            borderRadius: 6,
            border: `1px solid ${C.bd}`,
            marginBottom: 10,
          }}
        >
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}
          >
            <div>
              <div style={labelStyle}>Tipo</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['machine', 'tool'] as const).map((t) => (
                  <Pill
                    key={t}
                    active={ffResType === t}
                    color={C.bl}
                    onClick={() => {
                      setFfResType(t);
                      setFfResId('');
                    }}
                    size="sm"
                  >
                    {t === 'machine' ? 'Máquina' : 'Ferramenta'}
                  </Pill>
                ))}
              </div>
            </div>
            <div>
              <div style={labelStyle}>Recurso</div>
              <select
                value={ffResId}
                onChange={(e) => setFfResId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '4px 6px',
                  borderRadius: 4,
                  border: `1px solid ${C.bd}`,
                  background: C.s2,
                  color: C.t1,
                  fontSize: 10,
                  fontFamily: 'inherit',
                }}
              >
                <option value="">Selecionar...</option>
                {ffResType === 'machine'
                  ? machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id} ({m.area})
                      </option>
                    ))
                  : tools
                      .filter(
                        (t) =>
                          focusIds.includes(t.m) ||
                          (t.alt && t.alt !== '-' && focusIds.includes(t.alt)),
                      )
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.id}
                        </option>
                      ))}
              </select>
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: 10,
              marginBottom: 8,
            }}
          >
            <div>
              <div style={labelStyle}>Severidade</div>
              <div style={{ display: 'flex', gap: 3 }}>
                {(
                  [
                    ['total', C.rd],
                    ['partial', C.yl],
                    ['degraded', C.bl],
                  ] as const
                ).map(([s, c]) => (
                  <Pill
                    key={s}
                    active={ffSev === s}
                    color={c}
                    onClick={() => setFfSev(s)}
                    size="sm"
                  >
                    {s === 'total' ? 'Total' : s === 'partial' ? 'Parcial' : 'Degradada'}
                  </Pill>
                ))}
              </div>
            </div>
            {ffSev !== 'total' && (
              <div>
                <div style={labelStyle}>Capacidade restante</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number"
                    value={ffCap}
                    onChange={(e) => setFfCap(Math.max(0, Math.min(99, Number(e.target.value))))}
                    style={{
                      width: 50,
                      padding: '3px 6px',
                      borderRadius: 4,
                      border: `1px solid ${C.bd}`,
                      background: C.s2,
                      color: C.t1,
                      fontSize: 10,
                      fontFamily: "'JetBrains Mono',monospace",
                      textAlign: 'center',
                    }}
                  />
                  <span style={{ fontSize: 10, color: C.t3 }}>%</span>
                </div>
              </div>
            )}
            <div>
              <div style={labelStyle}>Período</div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <select
                  value={ffStartDay}
                  onChange={(e) => setFfStartDay(Number(e.target.value))}
                  style={selectStyle}
                >
                  {wdi.map((i) => (
                    <option key={i} value={i}>
                      {dnames[i]} {dates[i]}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 9, color: C.t4 }}>—</span>
                <select
                  value={ffEndDay}
                  onChange={(e) => setFfEndDay(Number(e.target.value))}
                  style={selectStyle}
                >
                  {wdi
                    .filter((i) => i >= ffStartDay)
                    .map((i) => (
                      <option key={i} value={i}>
                        {dnames[i]} {dates[i]}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={labelStyle}>Descrição</div>
            <input
              type="text"
              value={ffDesc}
              onChange={(e) => setFfDesc(e.target.value)}
              placeholder="Ex: Manutenção preventiva"
              style={{
                width: '100%',
                padding: '4px 8px',
                borderRadius: 4,
                border: `1px solid ${C.bd}`,
                background: C.s2,
                color: C.t1,
                fontSize: 10,
                fontFamily: 'inherit',
              }}
            />
          </div>
          <button
            onClick={addFailure}
            disabled={!ffResId}
            style={{
              padding: '6px 16px',
              borderRadius: 4,
              border: 'none',
              background: ffResId ? C.rd : C.s3,
              color: ffResId ? C.t1 : C.t4,
              fontSize: 10,
              fontWeight: 600,
              cursor: ffResId ? 'pointer' : 'default',
              fontFamily: 'inherit',
            }}
          >
            Registar
          </button>
        </div>
      )}

      {failures.map((f, fi) => {
        const imp = failureImpacts[fi];
        return (
          <div
            key={f.id}
            style={{
              padding: 10,
              background: C.rdS,
              borderRadius: 6,
              border: `1px solid ${C.rd}22`,
              marginBottom: 6,
              borderLeft: `3px solid ${C.rd}`,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: C.t1,
                    fontFamily: "'JetBrains Mono',monospace",
                  }}
                >
                  {f.resourceId}
                </span>
                <Tag color={f.severity === 'total' ? C.rd : f.severity === 'partial' ? C.yl : C.bl}>
                  {f.severity === 'total'
                    ? 'TOTAL'
                    : f.severity === 'partial'
                      ? `PARCIAL ${Math.round(f.capacityFactor * 100)}%`
                      : `DEGRADADA ${Math.round(f.capacityFactor * 100)}%`}
                </Tag>
                <span style={{ fontSize: 10, color: C.t3 }}>
                  {dnames[f.startDay]} {dates[f.startDay]}
                  {f.startDay !== f.endDay ? ` — ${dnames[f.endDay]} ${dates[f.endDay]}` : ''}
                </span>
              </div>
              <button
                onClick={() => removeFailure(f.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: C.t3,
                  cursor: 'pointer',
                  padding: '0 2px',
                }}
              >
                <X size={12} strokeWidth={2} />
              </button>
            </div>
            {f.description && (
              <div style={{ fontSize: 10, color: C.t3, marginBottom: 4 }}>{f.description}</div>
            )}
            {imp && imp.summary.totalBlocksAffected > 0 && (
              <div style={{ display: 'flex', gap: 10, fontSize: 10, color: C.t2 }}>
                <span>
                  <span style={{ fontWeight: 600, color: C.rd }}>
                    {imp.summary.totalBlocksAffected}
                  </span>{' '}
                  blocos afectados
                </span>
                <span>
                  <span style={{ fontWeight: 600, color: C.rd }}>
                    {imp.summary.totalQtyAtRisk.toLocaleString()}
                  </span>{' '}
                  pcs em risco
                </span>
                <span>{imp.summary.blocksWithAlternative} c/ alternativa</span>
                <span style={{ color: C.rd, fontWeight: 600 }}>
                  {imp.summary.blocksWithoutAlternative} s/ alternativa
                </span>
              </div>
            )}
            {imp && imp.summary.totalBlocksAffected === 0 && (
              <div style={{ fontSize: 10, color: C.ac }}>Sem impacto no schedule actual</div>
            )}
          </div>
        );
      })}

      {failures.length > 0 && (
        <button
          onClick={runCascadingReplan}
          disabled={cascRunning}
          data-testid="cascading-replan"
          style={{
            width: '100%',
            padding: 8,
            borderRadius: 6,
            border: 'none',
            background: cascRunning ? C.s3 : C.rd,
            color: cascRunning ? C.t3 : C.t1,
            fontSize: 11,
            fontWeight: 600,
            cursor: cascRunning ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            marginTop: 6,
          }}
        >
          {cascRunning ? 'A replanificar...' : `Replanificar com Avarias (${failures.length})`}
        </button>
      )}

      {failures.length === 0 && !showFailureForm && (
        <div style={{ fontSize: 10, color: C.t4, textAlign: 'center', padding: 8 }}>
          Sem avarias registadas
        </div>
      )}
    </Card>
  );
}
