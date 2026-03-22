/**
 * ShiftProductionTable — Production vs Planned table for a shift.
 * Extracted from ShiftSummary to keep files under 300 LOC.
 */

import type { MachineState } from '@/components/Industrial/MachineStatusIndicator';
import { MachineStatusIndicator } from '@/components/Industrial/MachineStatusIndicator';

export interface MachineRow {
  machineId: string;
  planned: number;
  produced: number;
  delta: number;
  state: MachineState;
}

interface ShiftProductionTableProps {
  machineRows: MachineRow[];
}

export function ShiftProductionTable({ machineRows }: ShiftProductionTableProps) {
  return (
    <div className="shsm__section">
      <div className="shsm__section-title">Produção vs Planeado</div>
      <table className="shsm__table">
        <thead>
          <tr>
            <th>Máquina</th>
            <th>Planeado</th>
            <th>Produzido</th>
            <th>Delta</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {machineRows.map((r) => (
            <tr key={r.machineId}>
              <td>{r.machineId}</td>
              <td>{r.planned.toLocaleString()}</td>
              <td>{r.produced.toLocaleString()}</td>
              <td>
                <span
                  className={
                    r.delta > 0
                      ? 'shsm__delta--positive'
                      : r.delta < 0
                        ? 'shsm__delta--negative'
                        : 'shsm__delta--zero'
                  }
                >
                  {r.delta > 0 ? '+' : ''}
                  {r.delta.toLocaleString()}
                </span>
              </td>
              <td>
                <MachineStatusIndicator state={r.state} compact />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
