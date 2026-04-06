/** MiniGantt — simplified Gantt for INICIO page.
 *
 * Shows all machines with colored bars. Clickable → navigates to MOLDES.
 */

import { useMemo } from "react";
import { T, moldeColor } from "../theme/tokens";
import { useDataStore } from "../stores/useDataStore";
import { useAppStore } from "../stores/useAppStore";

const REGIME_H = 16;
const BAR_H = 18;

export function MiniGantt() {
  const segmentos = useDataStore((s) => s.segmentos);
  const setPage = useAppStore((s) => s.setPage);

  const { machines, minDay, nDays } = useMemo(() => {
    if (!segmentos.length) return { machines: [], minDay: 0, nDays: 1 };
    const mSet = new Set<string>();
    let mn = Infinity, mx = -Infinity;
    for (const s of segmentos) {
      mSet.add(s.maquina_id);
      if (s.dia < mn) mn = s.dia;
      if (s.dia > mx) mx = s.dia;
    }
    return {
      machines: Array.from(mSet).sort(),
      minDay: mn,
      nDays: Math.max(1, mx - mn + 1),
    };
  }, [segmentos]);

  if (!segmentos.length) return null;

  const dayW = Math.max(20, Math.min(40, 600 / nDays));
  const labelW = 80;
  const totalW = labelW + nDays * dayW;
  const maxMachines = Math.min(machines.length, 15);
  const visibleMachines = machines.slice(0, maxMachines);

  return (
    <div
      style={{
        background: T.card,
        borderRadius: T.radiusSm,
        border: `1px solid ${T.border}`,
        overflow: "auto",
        maxHeight: maxMachines * (BAR_H + 4) + 30,
        cursor: "pointer",
      }}
      onClick={() => setPage("moldes")}
      title="Clicar para ver detalhe dos moldes"
    >
      <div style={{ position: "relative", width: totalW, minHeight: visibleMachines.length * (BAR_H + 4) + 4 }}>
        {visibleMachines.map((mid, row) => (
          <div
            key={mid}
            style={{
              position: "absolute",
              top: row * (BAR_H + 4) + 2,
              left: 0,
              height: BAR_H,
              display: "flex",
              alignItems: "center",
            }}
          >
            {/* Machine label */}
            <div
              style={{
                width: labelW,
                fontSize: 9,
                color: T.tertiary,
                textAlign: "right",
                paddingRight: 6,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: T.mono,
              }}
            >
              {mid}
            </div>
            {/* Segments on this machine */}
            {segmentos
              .filter((s) => s.maquina_id === mid)
              .map((seg, i) => {
                const left = labelW + (seg.dia - minDay) * dayW + ((seg.inicio_h - 7) / REGIME_H) * dayW;
                const width = Math.max(2, (seg.duracao_h / REGIME_H) * dayW);
                return (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left,
                      width,
                      height: BAR_H - 4,
                      top: 2,
                      borderRadius: 3,
                      background: moldeColor(seg.molde),
                      opacity: 0.8,
                    }}
                    title={`${seg.molde} — ${seg.op_id}`}
                  />
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
