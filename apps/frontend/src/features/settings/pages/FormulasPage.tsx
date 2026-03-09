/**
 * FormulasPage — Custom formula editor for priority scoring, deviation cost, etc.
 * Route: /settings/formulas
 */

import { Parser } from 'expr-eval';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/Common/EmptyState';
import { SkeletonTable } from '@/components/Common/SkeletonLoader';
import { useScheduleData } from '@/hooks/useScheduleData';
import type { FormulaConfig } from '../components/FormulaEditor';
import { FormulaEditor } from '../components/FormulaEditor';

function defaultTierFromName(name: string): number {
  const n = name.toLowerCase();
  if (n.includes('faurecia') || n.includes('forvia')) return 1;
  if (n.includes('continental') || n.includes('bosch')) return 2;
  if (!name || name === 'Sem cliente') return 5;
  return 3;
}

const DEFAULT_FORMULAS: FormulaConfig[] = [
  {
    id: 'priorityScoring',
    label: 'Priority Scoring',
    description: 'Cálculo de prioridade de cada job no dispatch ATCS',
    expression: '(clientTier * 10 + demandTotal / piecesPerHour) / (slack + 1)',
    variables: ['slack', 'setup', 'clientTier', 'demandTotal', 'piecesPerHour', 'stock', 'wip'],
    version: 1,
    versions: [],
  },
  {
    id: 'deviationCost',
    label: 'Custo de Desvio',
    description: 'Cálculo do custo de cada desvio no Decision Firewall',
    expression: 'deviationHours * multiplier * (6 - clientTier)',
    variables: ['deviationHours', 'clientTier', 'multiplier', 'originalPriority'],
    version: 1,
    versions: [],
  },
  {
    id: 'nightShiftTrigger',
    label: 'Trigger Turno Noite',
    description: 'Condição para sinalizar necessidade de turno noite',
    expression: 'load2Shifts / (capacity2Shifts + 1) * 100',
    variables: ['load2Shifts', 'capacity2Shifts', 'pendingOrders', 'avgSlack'],
    version: 1,
    versions: [],
  },
  {
    id: 'robustnessScore',
    label: 'Score de Robustez',
    description: 'Avaliação de robustez do plano (0-100)',
    expression: 'otdScore * 50 + (10 - cascadeRisk) * 3 + bufferHours / 10',
    variables: ['otdScore', 'cascadeRisk', 'bufferHours', 'violations'],
    version: 1,
    versions: [],
  },
];

function computePreview(
  formula: FormulaConfig,
  ops: Array<{ t: string; clNm?: string; d: number[]; stk?: number; wip?: number }>,
  toolMap: Record<string, { sH: number; pH: number }>,
  nDays: number,
): number[] {
  try {
    const parser = new Parser();
    const expr = parser.parse(formula.expression);
    return ops.map((op) => {
      const tool = toolMap[op.t];
      const totalDemand = op.d.reduce((s, v) => s + Math.max(v, 0), 0);
      const ph = tool?.pH ?? 100;
      const vars: Record<string, number> = {
        slack: Math.max(0, nDays * 17 - totalDemand / (ph * 0.66)),
        setup: tool?.sH ?? 1,
        clientTier: defaultTierFromName(op.clNm || ''),
        demandTotal: totalDemand,
        piecesPerHour: ph,
        stock: op.stk ?? 0,
        wip: op.wip ?? 0,
        deviationHours: 0,
        multiplier: 3,
        originalPriority: 50,
        load2Shifts: totalDemand / (ph * 0.66),
        capacity2Shifts: nDays * 17,
        pendingOrders: 1,
        avgSlack: nDays * 8,
        otdScore: 0.95,
        cascadeRisk: 2,
        bufferHours: nDays * 4,
        violations: 0,
      };
      try {
        return expr.evaluate(vars);
      } catch {
        return 0;
      }
    });
  } catch {
    return [];
  }
}

export function FormulasPage() {
  const { engine, loading, error } = useScheduleData();
  const [formulas, setFormulas] = useState<FormulaConfig[]>(DEFAULT_FORMULAS);

  const previews = useMemo(() => {
    if (!engine) return {};
    const result: Record<string, number[]> = {};
    for (const f of formulas) {
      result[f.id] = computePreview(f, engine.ops, engine.toolMap, engine.nDays);
    }
    return result;
  }, [engine, formulas]);

  const updateFormula = (updated: FormulaConfig) => {
    setFormulas((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
  };

  if (loading)
    return (
      <div style={{ padding: 32 }}>
        <SkeletonTable rows={4} cols={3} />
      </div>
    );
  if (error || !engine) {
    return (
      <div style={{ padding: 32 }}>
        <Link
          to="/settings"
          style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}
        >
          ← Settings
        </Link>
        <EmptyState icon="error" title="Sem dados" description={error || 'Importe ISOP.'} />
      </div>
    );
  }

  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Link to="/settings" style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
        ← Settings
      </Link>
      <h2
        style={{
          color: 'var(--text-primary)',
          fontSize: 'var(--text-h3)',
          fontWeight: 600,
          margin: 0,
        }}
      >
        Fórmulas Custom (L3)
      </h2>
      <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
        Expressões configuráveis avaliadas com expr-eval. Variáveis derivadas dos dados ISOP.
      </div>

      {formulas.map((f) => (
        <FormulaEditor
          key={f.id}
          formula={f}
          onChange={updateFormula}
          previewData={previews[f.id] ?? null}
        />
      ))}
    </div>
  );
}
