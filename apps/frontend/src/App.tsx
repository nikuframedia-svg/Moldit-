import { lazy, Suspense } from 'react';
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import ErrorBoundary from './components/Common/ErrorBoundary';
import { SkeletonCard } from './components/Common/SkeletonLoader';
import Layout from './components/Layout/Layout';
import ToastContainer from './components/Toast/Toast';

const ComandoDiario = lazy(() => import('./pages/ComandoDiario/ComandoDiario'));
const Dashboard = lazy(() => import('./pages/Dashboard/Dashboard'));
const Fabrica = lazy(() => import('./pages/Fabrica/Fabrica'));
const Pecas = lazy(() => import('./pages/Pecas/Pecas'));
const MRP = lazy(() => import('./pages/MRP/MRP'));
const Supply = lazy(() => import('./pages/Supply/Supply'));
const Planning = lazy(() => import('./pages/Planning/Planning'));
const Intelligence = lazy(() => import('./pages/Intelligence/Intelligence'));
const CarregarDados = lazy(() => import('./pages/Definicoes/CarregarDados'));
const Risk = lazy(() => import('./pages/Risk/Risk'));

function App() {
  return (
    <Router>
      <Layout>
        <ErrorBoundary>
          <Suspense fallback={<SkeletonCard lines={5} />}>
            <Routes>
              <Route path="/" element={<ComandoDiario />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/fabrica" element={<Fabrica />} />
              <Route path="/pecas" element={<Pecas />} />
              <Route path="/mrp" element={<MRP />} />
              <Route path="/supply" element={<Supply />} />
              <Route path="/planning" element={<Planning />} />
              <Route path="/intelligence" element={<Intelligence />} />
              <Route path="/risk" element={<Risk />} />
              <Route path="/definicoes/dados" element={<CarregarDados />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
      <ToastContainer />
    </Router>
  );
}

export default App;
