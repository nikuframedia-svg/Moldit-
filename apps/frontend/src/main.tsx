import '@fontsource-variable/inter';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './index.css';
import { useAppStore } from './stores/useAppStore';

// Inicializar data source no arranque
useAppStore.getState().actions.initializeDataSource();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
