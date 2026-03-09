/**
 * AndonDrawer — Bottom drawer for registering machine downtime.
 * Phase 1: select category (2x2 grid). Phase 2: select estimated duration.
 * ISA-101: icon + color + text on every button.
 */

import { Drawer } from 'antd';
import { AlertOctagon, Clock, Package, Wrench } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { AndonCategory } from '@/stores/useAndonStore';
import { useAndonActions, useAndonDrawerMachine } from '@/stores/useAndonStore';
import { postMachineDown } from '../api/andonApi';
import './AndonDrawer.css';

type Phase = 'category' | 'duration';

interface CategoryOption {
  key: AndonCategory;
  label: string;
  color: string;
  icon: React.ReactNode;
}

const CATEGORIES: CategoryOption[] = [
  {
    key: 'avaria_mecanica',
    label: 'Avaria Mecanica / Electrica',
    color: 'var(--semantic-red)',
    icon: <Wrench size={28} />,
  },
  {
    key: 'setup_prolongado',
    label: 'Setup Prolongado',
    color: '#F97316',
    icon: <Clock size={28} />,
  },
  {
    key: 'falta_material',
    label: 'Falta de Material',
    color: 'var(--semantic-amber)',
    icon: <Package size={28} />,
  },
  {
    key: 'problema_qualidade',
    label: 'Problema de Qualidade',
    color: '#8B5CF6',
    icon: <AlertOctagon size={28} />,
  },
];

interface DurationOption {
  label: string;
  minutes: number | null;
}

const DURATIONS: DurationOption[] = [
  { label: '30 min', minutes: 30 },
  { label: '1 hora', minutes: 60 },
  { label: '2 horas', minutes: 120 },
  { label: 'Nao sei', minutes: null },
];

export function AndonDrawer() {
  const machineId = useAndonDrawerMachine();
  const { closeDrawer, registerDowntime } = useAndonActions();

  const [phase, setPhase] = useState<Phase>('category');
  const [selectedCategory, setSelectedCategory] = useState<AndonCategory | null>(null);

  const handleClose = useCallback(() => {
    closeDrawer();
    setPhase('category');
    setSelectedCategory(null);
  }, [closeDrawer]);

  const handleCategorySelect = useCallback((cat: AndonCategory) => {
    setSelectedCategory(cat);
    setPhase('duration');
  }, []);

  const handleDurationSelect = useCallback(
    async (minutes: number | null) => {
      if (!machineId || !selectedCategory) return;

      const result = await postMachineDown(machineId, selectedCategory, minutes);

      registerDowntime({
        machineId,
        category: selectedCategory,
        estimatedMin: minutes,
        startedAt: Date.now(),
        downEventId: result.event_id,
      });

      handleClose();
    },
    [machineId, selectedCategory, registerDowntime, handleClose],
  );

  return (
    <Drawer
      open={machineId != null}
      onClose={handleClose}
      placement="bottom"
      height="auto"
      title={
        machineId ? (
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {machineId} — Registar Paragem
          </span>
        ) : undefined
      }
      destroyOnClose
    >
      {phase === 'category' ? (
        <div className="andon-drawer__grid">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className="andon-drawer__cat-btn"
              style={{ borderColor: cat.color, color: cat.color }}
              onClick={() => handleCategorySelect(cat.key)}
              data-testid={`andon-cat-${cat.key}`}
            >
              {cat.icon}
              <span className="andon-drawer__cat-label">{cat.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="andon-drawer__duration">
          <p className="andon-drawer__prompt">Duracao estimada?</p>
          <div className="andon-drawer__duration-row">
            {DURATIONS.map((d) => (
              <button
                key={d.label}
                type="button"
                className="andon-drawer__dur-btn"
                onClick={() => handleDurationSelect(d.minutes)}
                data-testid={`andon-dur-${d.minutes ?? 'unknown'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="andon-drawer__back-btn"
            onClick={() => setPhase('category')}
          >
            ← Voltar
          </button>
        </div>
      )}
    </Drawer>
  );
}
