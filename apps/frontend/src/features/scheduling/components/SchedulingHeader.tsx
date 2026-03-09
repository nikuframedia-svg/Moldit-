import { Check, Zap } from 'lucide-react';
import type { ScheduleValidationReport } from '../../../lib/engine';
import { C } from '../../../lib/engine';
import { dot, Pill } from './atoms';

type Tab = { id: string; l: string };

const TABS: Tab[] = [
  { id: 'plan', l: 'Plan' },
  { id: 'gantt', l: 'Gantt' },
  { id: 'replan', l: 'Replan' },
  { id: 'whatif', l: 'What-If' },
];

export function SchedulingHeader({
  view,
  setView,
  downC,
  movesCount,
  autoMovesCount,
  blkOps,
  opsCount,
  machineCount,
  validation,
}: {
  view: string;
  setView: (v: string) => void;
  downC: number;
  movesCount: number;
  autoMovesCount: number;
  blkOps: number;
  opsCount: number;
  machineCount: number;
  validation: ScheduleValidationReport | null;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: `1px solid ${C.bd}`,
        padding: '0 20px',
      }}
    >
      <div style={{ display: 'flex', gap: 2 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            style={{
              padding: '8px 18px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              color: view === tab.id ? C.ac : C.t3,
              borderBottom: `2px solid ${view === tab.id ? C.ac : 'transparent'}`,
              fontFamily: 'inherit',
              letterSpacing: '.02em',
              transition: 'all .15s',
            }}
          >
            {tab.l}
            {tab.id === 'replan' && (movesCount > 0 || blkOps > 0) && (
              <TabDot color={blkOps > 0 ? C.rd : C.ac} />
            )}
            {tab.id === 'gantt' && validation && !validation.valid && <TabDot color={C.rd} />}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {downC > 0 && (
          <Pill color={C.rd} active>
            <span style={dot(C.rd, true)} />
            {downC} DOWN
          </Pill>
        )}
        {movesCount > 0 && (
          <Pill color={C.ac} active>
            <Check
              size={10}
              strokeWidth={2}
              style={{ display: 'inline', verticalAlign: 'middle' }}
            />{' '}
            {movesCount}
          </Pill>
        )}
        {autoMovesCount > 0 && (
          <Pill color={C.bl} active>
            <Zap
              size={10}
              strokeWidth={1.5}
              style={{ display: 'inline', verticalAlign: 'middle' }}
            />{' '}
            {autoMovesCount} auto
          </Pill>
        )}
        {blkOps > 0 && (
          <Pill color={C.rd} active>
            {blkOps} bloq
          </Pill>
        )}
        <Pill color={C.pp} active>
          {opsCount} ops
        </Pill>
        <Pill color={C.bl} active>
          {machineCount} máq
        </Pill>
      </div>
    </div>
  );
}

function TabDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 5,
        height: 5,
        borderRadius: '50%',
        background: color,
        marginLeft: 6,
      }}
    />
  );
}
