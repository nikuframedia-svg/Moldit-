/**
 * MachineStatusGrid — 5 machine status cards showing current state, SKU, and next op.
 * ISA-101: NEVER only color — always color + icon + text.
 */

import { useMemo } from 'react';
import type { MachineState } from '@/components/Industrial/MachineStatusIndicator';
import { MachineStatusIndicator } from '@/components/Industrial/MachineStatusIndicator';
import { ProgressBar } from '@/components/Industrial/ProgressBar';
import type { MachineLoad } from '@/hooks/useDayData';
import type { Block, EngineData } from '@/lib/engine';
import { fmtMin, S0 } from '@/lib/engine';
import './MachineStatusGrid.css';

interface MachineStatusGridProps {
  engine: EngineData;
  blocks: Block[];
  machineLoads: MachineLoad[];
}

interface MachineStatus {
  machineId: string;
  state: MachineState;
  currentBlock: Block | null;
  nextBlock: Block | null;
  utilization: number;
}

function deriveMachineStatuses(
  engine: EngineData,
  blocks: Block[],
  machineLoads: MachineLoad[],
): MachineStatus[] {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todayStr = now.toISOString().slice(0, 10);

  return engine.machines.map((m) => {
    const ml = machineLoads.find((x) => x.machineId === m.id);
    const mBlocks = ml?.blocks ?? blocks.filter((b) => b.machineId === m.id);
    const utilization = ml?.utilization ?? 0;

    // Only check "now" if viewing today and within factory hours
    const isLive = engine.dates[0] === todayStr && nowMin >= S0;

    let currentBlock: Block | null = null;
    let nextBlock: Block | null = null;
    let state: MachineState = 'stopped';

    if (isLive) {
      currentBlock = mBlocks.find((b) => b.startMin <= nowMin && b.endMin > nowMin) ?? null;
      nextBlock = mBlocks.find((b) => b.startMin > nowMin) ?? null;

      if (currentBlock) {
        // Check if currently in setup phase
        if (
          currentBlock.setupS != null &&
          currentBlock.setupE != null &&
          nowMin >= currentBlock.setupS &&
          nowMin < currentBlock.setupE
        ) {
          state = 'transition';
        } else {
          state = 'running';
        }
      }
    } else {
      // Not live — show first and second blocks
      currentBlock = mBlocks[0] ?? null;
      nextBlock = mBlocks[1] ?? null;
      if (mBlocks.length > 0) state = 'running';
    }

    return { machineId: m.id, state, currentBlock, nextBlock, utilization };
  });
}

export function MachineStatusGrid({ engine, blocks, machineLoads }: MachineStatusGridProps) {
  const statuses = useMemo(
    () => deriveMachineStatuses(engine, blocks, machineLoads),
    [engine, blocks, machineLoads],
  );

  return (
    <div className="msg" data-testid="machine-status-grid">
      {statuses.map((s) => (
        <div key={s.machineId} className="msg__card" data-testid={`msg-card-${s.machineId}`}>
          <div className="msg__header">
            <span className="msg__machine-id">{s.machineId}</span>
            <MachineStatusIndicator state={s.state} compact />
          </div>

          <div className="msg__current">
            {s.currentBlock ? (
              <>
                <span className="msg__sku">{s.currentBlock.sku}</span>
                <span className="msg__detail">
                  {s.currentBlock.toolId} · {s.currentBlock.qty.toLocaleString()} pcs
                </span>
                <span className="msg__time">
                  {fmtMin(s.currentBlock.startMin)}–{fmtMin(s.currentBlock.endMin)}
                </span>
              </>
            ) : (
              <span className="msg__idle">Sem producao</span>
            )}
          </div>

          {s.nextBlock && (
            <div className="msg__next">
              <span className="msg__next-label">Proximo</span>
              <span className="msg__next-sku">
                {s.nextBlock.sku} · {fmtMin(s.nextBlock.startMin)}
              </span>
            </div>
          )}

          <div className="msg__util">
            <ProgressBar value={Math.round(s.utilization * 100)} size="sm" />
          </div>
        </div>
      ))}
    </div>
  );
}
