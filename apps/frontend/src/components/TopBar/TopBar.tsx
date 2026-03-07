import {
  Brain,
  Calendar,
  ClipboardList,
  Factory,
  LayoutDashboard,
  PackageSearch,
  Puzzle,
  Shield,
  Upload,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import './TopBar.css';

const NAV_GROUPS = [
  {
    label: 'Monitorizar',
    items: [
      { label: 'Comando', path: '/', icon: LayoutDashboard },
      { label: 'Fábrica', path: '/fabrica', icon: Factory },
      { label: 'Risco', path: '/risk', icon: Shield },
    ],
  },
  {
    label: 'Analisar',
    items: [
      { label: 'Peças', path: '/pecas', icon: Puzzle },
      { label: 'MRP', path: '/mrp', icon: ClipboardList },
      { label: 'Supply', path: '/supply', icon: PackageSearch },
    ],
  },
  {
    label: 'Agir',
    items: [
      { label: 'Planning', path: '/planning', icon: Calendar },
      { label: 'Intelligence', path: '/intelligence', icon: Brain },
    ],
  },
  {
    label: 'Definições',
    items: [{ label: 'Carregar Dados', path: '/definicoes/dados', icon: Upload }],
  },
];

function TopBar() {
  const location = useLocation();
  function isActive(path: string): boolean {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  }

  return (
    <header className="topbar">
      <div className="topbar__left">
        <Link to="/" className="topbar__logo">
          <span className="topbar__logo-icon">
            <span className="topbar__logo-label">PP1</span>
          </span>
          <span className="topbar__logo-text">ProdPlan</span>
        </Link>

        <nav className="topbar__nav">
          <div className="topbar__nav-pills">
            {NAV_GROUPS.map((group, gi) => (
              <div key={group.label} className="topbar__group">
                {gi > 0 && <div className="topbar__separator" />}
                <span className="topbar__group-label">{group.label}</span>
                <div className="topbar__group-pills">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={`topbar__pill ${isActive(item.path) ? 'topbar__pill--active' : ''}`}
                      >
                        <span className="topbar__pill-icon">
                          <Icon size={15} />
                        </span>
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>
      </div>

      <div className="topbar__right">
        <div className="topbar__user">
          <div className="topbar__avatar">MN</div>
          <div className="topbar__user-info">
            <span className="topbar__user-name">Martim Nicolau</span>
            <span className="topbar__user-email">martim@incompol.pt</span>
          </div>
        </div>
      </div>
    </header>
  );
}

export default TopBar;
