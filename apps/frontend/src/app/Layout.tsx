import { MoonOutlined, SearchOutlined, SunOutlined } from '@ant-design/icons';
import { Breadcrumb, Input, Switch } from 'antd';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { NotificationBell } from '../components/Common/NotificationBell';
import { TrustGateBanner } from '../components/Common/TrustGateBanner';
import { ContextPanel } from '../components/ContextPanel/ContextPanel';
import { FocusStrip } from '../components/FocusStrip/FocusStrip';
import { useStockAlertGenerator } from '../features/alerts/useStockAlertGenerator';
import { useTheme, useUIActions } from '../stores/useUIStore';
import { Sidebar } from './Sidebar';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

const ROUTE_LABELS: Record<string, string> = {
  console: 'Console',
  plan: 'Plan',
  mrp: 'MRP',
  settings: 'Settings',
  replan: 'Replan',
  whatif: 'What If',
  data: 'Dados',
  orders: 'Encomendas',
  ctp: 'CTP',
  machines: 'Máquinas',
  shifts: 'Turnos',
  'setup-matrix': 'Setup Matrix',
  operators: 'Operadores',
  customers: 'Clientes',
  scheduling: 'Scheduling',
  rules: 'Regras',
  formulas: 'Fórmulas',
  definitions: 'Definições',
};

function AppHeader() {
  useStockAlertGenerator();
  const theme = useTheme();
  const { toggleTheme } = useUIActions();
  const location = useLocation();

  const segments = location.pathname.split('/').filter(Boolean);
  const breadcrumbItems = [
    { title: <Link to="/">Home</Link> },
    ...segments.map((seg, i) => {
      const path = `/${segments.slice(0, i + 1).join('/')}`;
      const label = ROUTE_LABELS[seg] ?? seg;
      const isLast = i === segments.length - 1;
      return {
        title: isLast ? label : <Link to={path}>{label}</Link>,
      };
    }),
  ];

  return (
    <header className="app-header">
      <Breadcrumb items={breadcrumbItems} />
      <div className="app-header__actions">
        <NotificationBell />
        <Input
          prefix={<SearchOutlined />}
          placeholder="Pesquisar..."
          className="app-header__search"
          allowClear
          size="small"
        />
        <Switch
          checkedChildren={<MoonOutlined />}
          unCheckedChildren={<SunOutlined />}
          checked={theme === 'dark'}
          onChange={toggleTheme}
          title={theme === 'light' ? 'Mudar para dark mode' : 'Mudar para light mode'}
        />
      </div>
    </header>
  );
}

export function AppLayout({ children }: LayoutProps) {
  return (
    <div className="app-layout">
      <Sidebar />
      <main className="app-layout__main">
        <AppHeader />
        <TrustGateBanner />
        <div className="app-layout__content">{children}</div>
      </main>
      <FocusStrip />
      <ContextPanel />
    </div>
  );
}
