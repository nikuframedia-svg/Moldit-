import {
  AppstoreOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  InboxOutlined,
  ScheduleOutlined,
  SettingOutlined,
  ShoppingOutlined,
  SwapOutlined,
  TeamOutlined,
  ToolOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { Badge } from 'antd';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { TrustIndexBadge } from '@/components/Common/TrustIndexBadge';
import './Sidebar.css';

interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
}

interface NavModule {
  id: string;
  label: string;
  icon: React.ElementType;
  basePath: string;
  items: NavItem[];
  badgeCount?: number;
}

const NAV_MODULES: NavModule[] = [
  {
    id: 'console',
    label: 'Console',
    icon: DashboardOutlined,
    basePath: '/console',
    items: [{ label: 'Dia-a-dia', path: '/console', icon: DashboardOutlined }],
  },
  {
    id: 'plan',
    label: 'Plan',
    icon: ScheduleOutlined,
    basePath: '/plan',
    items: [
      { label: 'Gantt', path: '/plan', icon: ScheduleOutlined },
      { label: 'Replan', path: '/plan/replan', icon: SwapOutlined },
      { label: 'What If', path: '/plan/whatif', icon: ExperimentOutlined },
      { label: 'Dados', path: '/plan/data', icon: DatabaseOutlined },
    ],
  },
  {
    id: 'mrp',
    label: 'MRP',
    icon: InboxOutlined,
    basePath: '/mrp',
    items: [
      { label: 'Vista Geral', path: '/mrp', icon: InboxOutlined },
      { label: 'Encomendas', path: '/mrp/orders', icon: ShoppingOutlined },
      { label: 'CTP', path: '/mrp/ctp', icon: ClockCircleOutlined },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: SettingOutlined,
    basePath: '/settings',
    items: [
      { label: 'Geral', path: '/settings', icon: SettingOutlined },
      { label: 'Máquinas', path: '/settings/machines', icon: ToolOutlined },
      { label: 'Turnos', path: '/settings/shifts', icon: ClockCircleOutlined },
      { label: 'Setup Matrix', path: '/settings/setup-matrix', icon: AppstoreOutlined },
      { label: 'Operadores', path: '/settings/operators', icon: TeamOutlined },
      { label: 'Clientes', path: '/settings/customers', icon: UserSwitchOutlined },
      { label: 'Scheduling', path: '/settings/scheduling', icon: CloudServerOutlined },
    ],
  },
];

export function Sidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(() => {
    const active = NAV_MODULES.find((m) => location.pathname.startsWith(m.basePath));
    return new Set(active ? [active.id] : ['console']);
  });

  function isModuleActive(mod: NavModule): boolean {
    return location.pathname.startsWith(mod.basePath);
  }

  function isItemActive(path: string): boolean {
    if (path === '/console') return location.pathname === '/console';
    if (path === '/plan') return location.pathname === '/plan';
    if (path === '/mrp') return location.pathname === '/mrp';
    if (path === '/settings') return location.pathname === '/settings';
    return location.pathname.startsWith(path);
  }

  function toggleModule(id: string) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
      <div className="sidebar__logo">
        <Link to="/console" className="sidebar__logo-link">
          <span className="sidebar__logo-icon">PP1</span>
          {!collapsed && <span className="sidebar__logo-text">ProdPlan</span>}
        </Link>
      </div>

      <TrustIndexBadge collapsed={collapsed} />

      <nav className="sidebar__nav">
        {NAV_MODULES.map((mod) => {
          const Icon = mod.icon;
          const active = isModuleActive(mod);
          const expanded = expandedModules.has(mod.id);

          return (
            <div
              key={mod.id}
              className={`sidebar__module ${active ? 'sidebar__module--active' : ''}`}
            >
              <button
                type="button"
                className={`sidebar__module-header ${active ? 'sidebar__module-header--active' : ''}`}
                onClick={() => (collapsed ? setCollapsed(false) : toggleModule(mod.id))}
                title={collapsed ? mod.label : undefined}
              >
                {mod.id === 'console' ? (
                  <Badge count={mod.badgeCount} size="small" offset={[4, -4]}>
                    <Icon style={{ fontSize: 18 }} />
                  </Badge>
                ) : (
                  <Icon style={{ fontSize: 18 }} />
                )}
                {!collapsed && <span className="sidebar__module-label">{mod.label}</span>}
                {!collapsed && (
                  <ChevronDown
                    size={14}
                    className={`sidebar__chevron ${expanded ? 'sidebar__chevron--open' : ''}`}
                  />
                )}
              </button>

              {!collapsed && expanded && (
                <div className="sidebar__items">
                  {mod.items.map((item) => {
                    const ItemIcon = item.icon;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={`sidebar__item ${isItemActive(item.path) ? 'sidebar__item--active' : ''}`}
                      >
                        <ItemIcon style={{ fontSize: 14 }} />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar__footer">
        <button
          type="button"
          className="sidebar__collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
        <div className="sidebar__user">
          <div className="sidebar__avatar">MN</div>
          {!collapsed && (
            <div className="sidebar__user-info">
              <span className="sidebar__user-name">Martim Nicolau</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
