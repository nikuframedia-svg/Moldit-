// Configuração da aplicação

export const config = {
  // Modo: 'mock' | 'api'
  mode: (import.meta.env.VITE_APP_MODE as 'mock' | 'api') || 'api',

  // API base URL (quando em modo 'api')
  apiBaseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',

  // Timeouts
  apiTimeout: 30000,
};
