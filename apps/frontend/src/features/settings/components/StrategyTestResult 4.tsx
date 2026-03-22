/**
 * StrategyTestResult — Displays the result of testing a multi-step strategy.
 */

import type { StrategyStep } from './StrategyStepEditor';

interface TestResultData {
  stepCounts: number[];
  total: number;
}

interface StrategyTestResultProps {
  result: TestResultData;
  steps: StrategyStep[];
}

export function StrategyTestResult({ result, steps }: StrategyTestResultProps) {
  const unassigned = result.total - result.stepCounts.reduce((s, v) => s + v, 0);

  return (
    <div
      style={{
        padding: 'var(--space-12)',
        background: 'var(--accent-bg)',
        border: '1px solid var(--accent-border)',
        borderRadius: 'var(--radius-xs)',
        fontSize: 'var(--text-sm)',
        color: 'var(--accent-light)',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>
        Resultado: {result.total} operações distribuídas
      </div>
      {result.stepCounts.map((count, i) => (
        <div key={steps[i]?.id ?? i} style={{ marginLeft: 8 }}>
          Passo {i + 1} ({steps[i]?.name}): <strong>{count}</strong> ops
        </div>
      ))}
      {unassigned > 0 && (
        <div style={{ marginLeft: 8, color: 'var(--semantic-warning)' }}>
          Nao atribuidas: {unassigned}
        </div>
      )}
    </div>
  );
}
