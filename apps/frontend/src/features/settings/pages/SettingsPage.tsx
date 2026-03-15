import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { FeatureErrorBoundary } from '@/components/Common/FeatureErrorBoundary';
import {
  BookOpen,
  Building2,
  Calculator,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  GitBranch,
  Grid3x3,
  Layers,
  Shield,
  Sliders,
  UserCog,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface SettingsCard {
  title: string;
  description: string;
  icon: LucideIcon;
  path: string;
  basic?: boolean;
}

const SETTINGS_CARDS: SettingsCard[] = [
  {
    title: 'Máquinas',
    description: 'Configuração de prensas e capacidades',
    icon: Wrench,
    path: '/settings/machines',
    basic: true,
  },
  {
    title: 'Turnos',
    description: 'Horários e turnos de produção',
    icon: Clock,
    path: '/settings/shifts',
    basic: true,
  },
  {
    title: 'Setup Matrix',
    description: 'Tempos de setup entre ferramentas',
    icon: Grid3x3,
    path: '/settings/setup-matrix',
    basic: true,
  },
  {
    title: 'Operadores',
    description: 'Equipas e competências',
    icon: UserCog,
    path: '/settings/operators',
    basic: true,
  },
  {
    title: 'Clientes',
    description: 'Gestão de clientes e prioridades',
    icon: Building2,
    path: '/settings/customers',
    basic: true,
  },
  {
    title: 'Scheduling',
    description: 'Pesos, políticas e constraints',
    icon: Sliders,
    path: '/settings/scheduling',
    basic: true,
  },
  {
    title: 'Regras SE/ENTÃO',
    description: 'Regras condicionais de prioridade (L2)',
    icon: GitBranch,
    path: '/settings/rules',
  },
  {
    title: 'Fórmulas',
    description: 'Fórmulas custom de scoring (L3)',
    icon: Calculator,
    path: '/settings/formulas',
  },
  {
    title: 'Definições',
    description: 'Definições de conceitos da fábrica (L4)',
    icon: BookOpen,
    path: '/settings/definitions',
  },
  {
    title: 'Workflows',
    description: 'Governance e aprovações (L5)',
    icon: Shield,
    path: '/settings/workflows',
  },
  {
    title: 'Estratégias',
    description: 'Estratégias multi-passo (L6)',
    icon: Layers,
    path: '/settings/strategy',
  },
];

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: 16,
};

const cardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: 20,
  background: 'var(--bg-card)',
  borderRadius: 8,
  border: '1px solid var(--border-default)',
  textDecoration: 'none',
  transition: 'border-color 0.15s, background 0.15s',
};

const cardHoverHandlers = (e: React.MouseEvent<HTMLAnchorElement>) => {
  const el = e.currentTarget;
  el.style.borderColor = 'var(--accent)';
  el.style.background = 'var(--bg-raised)';
};

const cardLeaveHandlers = (e: React.MouseEvent<HTMLAnchorElement>) => {
  const el = e.currentTarget;
  el.style.borderColor = 'var(--border-default)';
  el.style.background = 'var(--bg-card)';
};

const BASIC_CARDS = SETTINGS_CARDS.filter((c) => c.basic);
const ADVANCED_CARDS = SETTINGS_CARDS.filter((c) => !c.basic);

function SettingsCardGrid({ cards }: { cards: SettingsCard[] }) {
  return (
    <div style={gridStyle}>
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Link
            key={card.path}
            to={card.path}
            style={cardStyle}
            onMouseEnter={cardHoverHandlers}
            onMouseLeave={cardLeaveHandlers}
          >
            <Icon size={24} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  fontSize: 'var(--text-body)',
                }}
              >
                {card.title}
              </div>
              <div
                style={{
                  color: 'var(--text-muted)',
                  fontSize: 'var(--text-small)',
                  marginTop: 4,
                }}
              >
                {card.description}
              </div>
            </div>
            <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          </Link>
        );
      })}
    </div>
  );
}

export function SettingsPage() {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <FeatureErrorBoundary module="Settings">
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ color: 'var(--text-primary)', fontSize: 'var(--text-h3)', fontWeight: 600 }}>
        Configurações
      </h2>

      <SettingsCardGrid cards={BASIC_CARDS} />

      <button
        onClick={() => setShowAdvanced((p) => !p)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '10px 20px',
          borderRadius: 8,
          border: '1px solid var(--border-default)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          fontSize: 13,
          cursor: 'pointer',
          fontFamily: 'inherit',
          transition: 'border-color 0.15s',
        }}
      >
        {showAdvanced ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        {showAdvanced
          ? 'Ocultar configurações avançadas'
          : `Configurações avançadas (${ADVANCED_CARDS.length})`}
      </button>

      {showAdvanced && <SettingsCardGrid cards={ADVANCED_CARDS} />}
    </div>
    </FeatureErrorBoundary>
  );
}
