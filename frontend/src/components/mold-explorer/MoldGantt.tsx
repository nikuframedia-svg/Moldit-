import { useMemo, useRef } from "react";
import { T } from "../../theme/tokens";
import { useMoldExplorerStore } from "../../stores/useMoldExplorerStore";
import { GanttBar } from "./GanttBar";
import { GhostBar } from "./GhostBar";
import { GanttArrow } from "./GanttArrow";

const DAY_W = 120;
const LANE_H = 48;
const HEADER_H = 24;
const LABEL_W = 110;
const REGIME_H = 16; // default hours per day for bar width

export function MoldGantt() {
  const explorerData = useMoldExplorerStore((s) => s.explorerData);
  const selectedOpId = useMoldExplorerStore((s) => s.selectedOpId);
  const selectOp = useMoldExplorerStore((s) => s.selectOp);
  const containerRef = useRef<HTMLDivElement>(null);

  // Group operations by machine
  const { machines, minDay, maxDay } = useMemo(() => {
    if (!explorerData) return { machines: [] as string[], minDay: 0, maxDay: 7 };
    const mSet = new Set<string>();
    let mn = Infinity;
    let mx = 0;
    for (const op of explorerData.operacoes) {
      mSet.add(op.maquina);
      mn = Math.min(mn, op.dia);
      mx = Math.max(mx, op.dia);
    }
    for (const g of explorerData.fantasmas) {
      if (mSet.has(g.maquina)) {
        mn = Math.min(mn, g.dia);
        mx = Math.max(mx, g.dia);
      }
    }
    if (mn === Infinity) mn = 0;
    return { machines: [...mSet].sort(), minDay: mn, maxDay: mx };
  }, [explorerData]);

  const days = useMemo(() => {
    return Array.from({ length: maxDay - minDay + 1 }, (_, i) => minDay + i);
  }, [minDay, maxDay]);

  // Position helpers
  const machineY = useMemo(() => {
    const map: Record<string, number> = {};
    machines.forEach((m, i) => {
      map[m] = HEADER_H + i * LANE_H;
    });
    return map;
  }, [machines]);

  const toX = (dia: number, hora: number) => {
    return LABEL_W + (dia - minDay) * DAY_W + ((hora - 7) / REGIME_H) * DAY_W;
  };

  // Map op positions for arrows
  const opPositions = useMemo(() => {
    if (!explorerData) return {} as Record<number, { x: number; y: number; right: number }>;
    const pos: Record<number, { x: number; y: number; right: number }> = {};
    for (const op of explorerData.operacoes) {
      const x = toX(op.dia, op.inicio_h);
      const w = ((op.work_h + op.setup_h) / REGIME_H) * DAY_W;
      const y = (machineY[op.maquina] ?? 0) + LANE_H / 2;
      pos[op.op_id] = { x, y, right: x + Math.max(w, 16) };
    }
    return pos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explorerData, machineY, minDay]);

  if (!explorerData || !explorerData.operacoes.length) {
    return (
      <div style={{ padding: 16, color: T.tertiary, fontSize: 12 }}>
        Seleciona um molde para ver o Gantt.
      </div>
    );
  }

  const totalW = LABEL_W + days.length * DAY_W;
  const totalH = HEADER_H + machines.length * LANE_H;

  return (
    <div
      ref={containerRef}
      data-testid="explorer-gantt"
      style={{
        overflow: "auto",
        maxHeight: 400,
        border: `0.5px solid ${T.border}`,
        borderRadius: 8,
        background: T.card,
        position: "relative",
      }}
    >
      <div style={{ position: "relative", width: totalW, height: totalH }}>
        {/* Day headers */}
        {days.map((d) => (
          <div
            key={d}
            style={{
              position: "absolute",
              left: LABEL_W + (d - minDay) * DAY_W,
              top: 0,
              width: DAY_W,
              height: HEADER_H,
              textAlign: "center",
              fontSize: 10,
              fontFamily: "ui-monospace, monospace",
              color: T.secondary,
              borderBottom: `1px solid ${T.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            D{d}
          </div>
        ))}

        {/* Machine labels */}
        {machines.map((mid) => (
          <div
            key={mid}
            style={{
              position: "absolute",
              left: 0,
              top: machineY[mid],
              width: LABEL_W,
              height: LANE_H,
              display: "flex",
              alignItems: "center",
              padding: "0 8px",
              fontSize: 11,
              fontFamily: "ui-monospace, monospace",
              fontWeight: 600,
              color: T.primary,
              borderRight: `1px solid ${T.border}`,
              borderBottom: `1px solid ${T.border}`,
              background: T.card,
              zIndex: 2,
            }}
          >
            {mid}
          </div>
        ))}

        {/* Grid lines */}
        {machines.map((mid) =>
          days.map((d) => (
            <div
              key={`${mid}-${d}`}
              style={{
                position: "absolute",
                left: LABEL_W + (d - minDay) * DAY_W,
                top: machineY[mid],
                width: DAY_W,
                height: LANE_H,
                borderBottom: `1px solid ${T.border}`,
                borderRight: `0.5px solid rgba(255,255,255,0.03)`,
              }}
            />
          )),
        )}

        {/* Ghost bars */}
        {explorerData.fantasmas
          .filter((g) => machines.includes(g.maquina))
          .map((g, i) => {
            const x = toX(g.dia, g.inicio_h);
            const w = ((g.fim_h - g.inicio_h) / REGIME_H) * DAY_W;
            const y = machineY[g.maquina];
            return (
              <div key={`ghost-${i}`} style={{ position: "absolute", left: 0, top: y }}>
                <GhostBar ghost={g} left={x} width={w} />
              </div>
            );
          })}

        {/* Operation bars */}
        {explorerData.operacoes.map((op) => {
          const x = toX(op.dia, op.inicio_h);
          const w = ((op.work_h + op.setup_h) / REGIME_H) * DAY_W;
          const y = machineY[op.maquina];
          return (
            <div key={op.op_id} style={{ position: "absolute", left: 0, top: y + 12 }}>
              <GanttBar
                op={op}
                left={x}
                width={w}
                selected={op.op_id === selectedOpId}
                onClick={() => selectOp(op.op_id)}
              />
            </div>
          );
        })}

        {/* Dependency arrows (SVG overlay) */}
        <svg
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: totalW,
            height: totalH,
            pointerEvents: "none",
          }}
        >
          {explorerData.dependencias.map((dep) => {
            const from = opPositions[dep.de];
            const to = opPositions[dep.para];
            if (!from || !to) return null;
            return (
              <GanttArrow
                key={`${dep.de}-${dep.para}`}
                x1={from.right}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                critical={dep.no_critico}
                hasSlack={!dep.no_critico}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
