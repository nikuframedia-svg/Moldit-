# PP1 Frontend

Frontend do sistema PP1 (Planeamento / Sandbox / Sugestões / Copilot LLM)

## Stack Tecnológico

- **React 18.2+** com **TypeScript 5.0+**
- **Vite 5.0+** (build tool)
- **Zustand 4.4+** (state management)
- **Axios 1.6+** (HTTP client)
- **Zod 3.22+** (validação de schemas)
- **React Router** (navegação)

## Design

O design segue a referência visual do dashboard ProdPlan (Secção 6.3 do documento mestre):
- Tema dark
- Paleta: Teal, Verde, Laranja, Branco
- Layout em grid responsivo
- Cards modulares

## Setup

```bash
npm install
npm run dev
```

## Estrutura

```
frontend/
  src/
    components/     # Componentes reutilizáveis
      Cards/        # Cards modulares (Metric, Chart, Table, Timeline)
      Layout/       # Layout principal
      TopBar/       # Barra de navegação superior
    pages/          # Páginas/rotas
      Dashboard/    # Dashboard principal
      Activity/     # Audit Trail
      Manage/       # IMPROVE (PRs)
      Overview/     # Overview
      Planning/     # Sandbox/Scenarios
    domain/         # Tipos de domínio (a criar)
    contracts/      # Schemas/types (a criar)
    adapters/       # API/Mock adapters (a criar)
    application/    # Use-cases (a criar)
```

## Comandos

- `npm run dev` - Servidor de desenvolvimento
- `npm run build` - Build para produção
- `npm run test` - Executar testes
- `npm run lint` - Linting
