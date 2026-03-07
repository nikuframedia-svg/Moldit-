import type { ReactNode } from 'react';
import ContextPanel from '../ContextPanel/ContextPanel';
import FocusStrip from '../FocusStrip/FocusStrip';
import TopBar from '../TopBar/TopBar';
import './Layout.css';

interface LayoutProps {
  children: ReactNode;
}

function Layout({ children }: LayoutProps) {
  return (
    <div className="layout">
      <TopBar />
      <main className="layout-main">{children}</main>
      <FocusStrip />
      <ContextPanel />
    </div>
  );
}

export default Layout;
