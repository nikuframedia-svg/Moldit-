# Análise Técnica Completa - INCOMPOL PP1

> **Sistema de Planeamento de Produção (PP1)**
> **Projecto:** INCOMPOL
> **Data de Análise:** Fevereiro 2026
> **Stack:** React 18 + TypeScript 5 + Vite + Zustand

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Arquitectura](#2-arquitectura)
3. [Stack Tecnológica](#3-stack-tecnológica)
4. [Estrutura do Projecto](#4-estrutura-do-projecto)
5. [Páginas (15 Total)](#5-páginas-15-total)
6. [Componentes (18 Total)](#6-componentes-18-total)
7. [Gestão de Estado](#7-gestão-de-estado)
8. [Hooks Customizados](#8-hooks-customizados)
9. [Application Layer](#9-application-layer)
10. [Domain Layer](#10-domain-layer)
11. [Adapters (API e Mock)](#11-adapters-api-e-mock)
12. [Design System](#12-design-system)
13. [Sistema de Segurança](#13-sistema-de-segurança)
14. [Testes](#14-testes)
15. [Configuração](#15-configuração)
16. [Rotas](#16-rotas)
17. [Fixtures](#17-fixtures)
18. [Padrões e Convenções](#18-padrões-e-convenções)
19. [Métricas do Projecto](#19-métricas-do-projecto)

---

## 1. Visão Geral

### 1.1 Propósito

O **INCOMPOL PP1** é um sistema avançado de planeamento de produção (APS - Advanced Planning System) que oferece:

- **Gestão de Snapshots** - Importação e validação de dados mestres
- **Planeamento de Produção** - Criação e optimização de planos
- **Cenários What-If** - Simulação de alterações e análise de impacto
- **Workflow de PRs** - Sistema de aprovação com Separation of Duties
- **Sugestões de Melhoria** - Recomendações baseadas em análise de dados
- **Audit Trail** - Rastreabilidade completa de todas as operações
- **Gestão de Segurança** - Controlo de acessos baseado em roles

### 1.2 Utilizadores e Roles

| Role | Permissões | Acções Principais |
|------|------------|-------------------|
| **VIEWER** | Leitura | Visualizar dashboards, planos, relatórios |
| **PLANNER** | Leitura + Edição | Criar planos, cenários, PRs |
| **APPROVER** | Leitura + Aprovação | Aprovar PRs, fazer merge, selar snapshots |
| **ADMIN** | Todas (ALL) | Gestão de utilizadores, configurações |

### 1.3 Conformidade com Contratos API

O sistema segue os contratos C-00 a C-15:
- **C-00** - ErrorModel, Correlation IDs, Idempotency-Key
- **C-01** - Snapshot ingestion & semantics
- **C-04** - Plan execution & job management
- **C-06** - Scenario diffing
- **C-07** - PR workflow
- **C-08** - Suggestions & impact tracking
- **C-14** - Authorization & SoD rules
- **C-15** - Correlation ID propagation

---

## 2. Arquitectura

### 2.1 Clean Architecture

O projecto segue princípios de Clean Architecture com camadas bem definidas:

```
┌─────────────────────────────────────────────────────────────┐
│                      PAGES (15 páginas)                      │
│   Dashboard │ Planning │ PRs │ Scenarios │ Suggestions      │
├─────────────────────────────────────────────────────────────┤
│                  APPLICATION LAYER (Use Cases)               │
│   usePlanActions │ usePRActions │ useScenarioActions │ ...  │
├─────────────────────────────────────────────────────────────┤
│                    HOOKS (Data Fetching)                     │
│   usePlans │ useSnapshots │ usePRs │ useAuditLog │ ...      │
├─────────────────────────────────────────────────────────────┤
│                    DOMAIN LAYER (Types)                      │
│   Snapshot │ Plan │ PR │ Scenario │ Suggestion │ KPIs       │
├─────────────────────────────────────────────────────────────┤
│                   ADAPTERS (API & Mock)                      │
│         ApiClient │ MockDataSource │ IDataSource            │
├─────────────────────────────────────────────────────────────┤
│                   STORE (Zustand)                            │
│         useAppStore (dataSource, currentUser, state)        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Fluxo de Dados

```
User Action → Page → Application Hook → Data Hook → Adapter → API/Mock
                                                        ↓
UI Update ← Page ← State Update ← Response Processing ←─┘
```

### 2.3 Dual-Mode Data Source

O sistema suporta dois modos de operação:
- **Mock Mode** (`VITE_APP_MODE=mock`) - Usa fixtures locais para desenvolvimento
- **API Mode** (`VITE_APP_MODE=api`) - Liga ao backend real

---

## 3. Stack Tecnológica

### 3.1 Core

| Tecnologia | Versão | Propósito |
|------------|--------|-----------|
| **React** | 18.2+ | UI Framework |
| **TypeScript** | 5.2+ | Type Safety |
| **Vite** | 5.0.8 | Build Tool & Dev Server |

### 3.2 State & Data

| Biblioteca | Versão | Propósito |
|------------|--------|-----------|
| **Zustand** | 4.4.7 | Estado global |
| **Axios** | 1.6.7 | HTTP Client |
| **Zod** | 3.22.4 | Validação de schemas |

### 3.3 Routing & Utils

| Biblioteca | Versão | Propósito |
|------------|--------|-----------|
| **React Router DOM** | 7.13.0 | Routing |
| **date-fns** | 3.0.6 | Manipulação de datas |

### 3.4 Testing

| Biblioteca | Versão | Propósito |
|------------|--------|-----------|
| **Vitest** | 1.0.4 | Test Runner |
| **@testing-library/react** | - | Component Testing |
| **@testing-library/jest-dom** | - | DOM Assertions |

### 3.5 Linting

| Biblioteca | Versão |
|------------|--------|
| **ESLint** | 8.55.0 |
| **TypeScript ESLint** | - |

---

## 4. Estrutura do Projecto

```
frontend/
├── src/
│   ├── pages/                    # 15 páginas de rota
│   │   ├── Dashboard/            # Landing page principal
│   │   ├── Activity/             # Audit trail viewer
│   │   ├── Overview/             # KPI overview
│   │   ├── Planning/             # Hub de planeamento (5 tabs)
│   │   ├── Manage/               # Hub de gestão
│   │   │   ├── Capacity.tsx      # Capacidade de operadores
│   │   │   ├── Calendars.tsx     # Configuração de calendários
│   │   │   └── Materials.tsx     # Master data de materiais
│   │   ├── Snapshots/            # Lista e detalhe de snapshots
│   │   ├── Plans/                # Lista e detalhe de planos
│   │   ├── Scenarios/            # Lista e detalhe de cenários
│   │   ├── PRs/                  # Lista, detalhe e criação de PRs
│   │   ├── Suggestions/          # Lista e detalhe de sugestões
│   │   └── Security/             # Gestão de autorizações
│   │
│   ├── components/               # 18 componentes reutilizáveis
│   │   ├── Layout/               # Layout principal
│   │   ├── TopBar/               # Navegação
│   │   ├── Cards/                # MetricCard, ChartCard, TableCard, TimelineCard
│   │   ├── Planning/             # PlanCard, ScenarioCard, GanttChart, JobsTable
│   │   ├── Common/               # HashDisplay, StatusBadge
│   │   ├── AuditTrail/           # AuditTrailViewer
│   │   ├── ExplainTrace/         # Visualização de explicabilidade
│   │   ├── ParetoChart/          # Gráfico Pareto
│   │   ├── ReplanTrigger/        # Trigger de replaneamento
│   │   ├── TrustIndex/           # Display de Trust Index
│   │   └── SnapshotImport/       # Modal de importação
│   │
│   ├── application/              # Use-case hooks (business logic)
│   │   ├── audit/                # useAuditTrail
│   │   ├── plan/                 # usePlanActions, usePlannerCockpit
│   │   ├── scenario/             # useScenarioActions
│   │   ├── security/             # useAuthorization, useSecurityActions
│   │   ├── snapshot/             # useSnapshotActions
│   │   └── improve/              # usePRActions, useSuggestionActions
│   │
│   ├── hooks/                    # Custom hooks (data fetching)
│   │   ├── useDataSource/        # Acesso ao dataSource global
│   │   ├── useAsyncState/        # Estado assíncrono genérico
│   │   ├── usePlans/             # Fetch de planos
│   │   ├── useSnapshots/         # Fetch de snapshots
│   │   ├── useScenarios/         # Fetch de cenários
│   │   ├── usePRs/               # Fetch de PRs
│   │   ├── useSuggestions/       # Fetch de sugestões
│   │   ├── useAuditLog/          # Fetch de audit trail
│   │   ├── usePlannerCockpit/    # Cálculo de métricas
│   │   └── useSandbox/           # Estado de sandbox
│   │
│   ├── domain/                   # Domain models & calculations
│   │   ├── types.ts              # Tipos core (50+ interfaces)
│   │   ├── kpi/                  # Cálculos de KPIs
│   │   │   ├── computeLoad.ts
│   │   │   ├── computeSetups.ts
│   │   │   ├── computeTardiness.ts
│   │   │   └── computeChurn.ts
│   │   └── diff/                 # Comparação de planos
│   │       └── computeDiffSummary.ts
│   │
│   ├── adapters/                 # Data source implementations
│   │   ├── ApiClient.ts          # REST client (axios)
│   │   └── MockDataSource.ts     # Fixture-based mock
│   │
│   ├── store/                    # Zustand store
│   │   └── useAppStore.ts
│   │
│   ├── types/                    # Shared types
│   │   └── asyncState.ts
│   │
│   ├── utils/                    # Utilities
│   │   ├── helpers.ts            # Formatação
│   │   ├── validation.ts         # Zod schemas
│   │   └── uuid.ts               # UUID generation
│   │
│   ├── tests/                    # Test suites
│   │   ├── setup.ts
│   │   ├── contract/             # Contract validation
│   │   ├── a11y/                 # Accessibility
│   │   └── regression/           # Regression tests
│   │
│   ├── App.tsx                   # Router setup
│   ├── main.tsx                  # Entry point
│   ├── config.ts                 # Environment config
│   └── index.css                 # Global styles
│
├── public/fixtures/              # Test fixtures (17 ficheiros)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

---

## 5. Páginas (15 Total)

### 5.1 Dashboard

**Rota:** `/`
**Ficheiro:** `pages/Dashboard/Dashboard.tsx`

A landing page principal que mostra:
- KPIs em tempo real (OTD, Tardiness, Setups)
- Widgets de Plans, PRs, Suggestions, Activity
- Botão de importação de Snapshot
- Resumo de estado do sistema

**Hooks utilizados:**
- `usePlansList`, `usePRsList`, `useSuggestionsList`
- `useSnapshotsList`, `useAuditTrail`, `usePlannerCockpit`

---

### 5.2 Activity

**Rota:** `/activity`
**Ficheiro:** `pages/Activity/Activity.tsx`

Visualizador de audit trail:
- Lista de todas as actividades do sistema
- Filtragem por entidade e tipo
- Tracking de correlation IDs
- Timeline de eventos

---

### 5.3 Overview

**Rota:** `/overview`
**Ficheiro:** `pages/Overview/Overview.tsx`

Overview de KPIs:
- Métricas agregadas de todos os planos
- Análise de tendências
- Comparações entre períodos

---

### 5.4 Planning

**Rota:** `/planning`
**Ficheiro:** `pages/Planning/Planning.tsx`

Hub de planeamento com 5 tabs:

| Tab | Conteúdo |
|-----|----------|
| **plans** | Cards de planos com sorting/filtering |
| **scenarios** | Cenários what-if |
| **comparison** | Comparação side-by-side de planos |
| **gantt** | Visualização Gantt |
| **jobs** | Fila de jobs assíncronos |

**Funcionalidades:**
- Criação de novos planos
- Execução de cenários
- Comparação de KPIs
- Monitorização de jobs

---

### 5.5 Manage (Hub)

**Rota:** `/manage`

Hub de gestão com sub-páginas:

#### 5.5.1 Capacity
**Rota:** `/manage/capacity`
- Gestão de pools de operadores
- Configuração de capacidade por recurso

#### 5.5.2 Calendars
**Rota:** `/manage/calendars`
- Configuração de calendários de trabalho
- Definição de turnos e feriados

#### 5.5.3 Materials
**Rota:** `/manage/materials`
- Master data de materiais
- Gestão de bobines e setup matrix

---

### 5.6 Snapshots

**Rotas:** `/snapshots`, `/snapshots/:id`

**SnapshotsList:**
- Browse de todos os snapshots
- Display de Trust Index
- Modal de importação

**SnapshotDetail:**
- Visualização de master data completo
- Detalhes de Trust Index
- Comparação com outros snapshots

---

### 5.7 Plans

**Rotas:** `/plans`, `/plans/:id`

**PlansList:**
- Filtros por status (CANDIDATE/OFFICIAL)
- Sorting (recent, OTD, tardiness)
- Toggle cards/table view

**PlanDetail:**
- Detalhes completos de operações
- Breakdown de KPIs
- Visualização ExplainTrace
- Links para PRs/scenarios relacionados

---

### 5.8 Scenarios

**Rotas:** `/scenarios`, `/scenarios/:id`

**ScenariosList:**
- Criação de novos cenários
- Execução de análises what-if

**ScenarioDetail:**
- Visualização de diff
- Display de KPI deltas
- Interface de movimentação de operações

---

### 5.9 PRs

**Rotas:** `/prs`, `/prs/new`, `/prs/:id`

**PRsList:**
- Filtros por status (DRAFT, OPEN, APPROVED, MERGED, REJECTED, ROLLED_BACK)

**PRCreate:**
- Link de scenario a baseline/candidate plans
- Selecção de autor

**PRDetail:**
- Visualização de workflow de aprovação
- Checks de SoD (Separation of Duties)
- Botões Merge/Rollback/Approve (role-based)

---

### 5.10 Suggestions

**Rotas:** `/suggestions`, `/suggestions/:id`

**SuggestionsList:**
- Filtros por status
- Métricas de impacto

**SuggestionDetail:**
- Análise de impact case
- Botões Accept/Reject
- Tracking de impact result

---

### 5.11 Security

**Rota:** `/security`
**Ficheiro:** `pages/Security/Security.tsx`

Gestão de autorizações e ACL:
- Gestão de roles de utilizadores
- Matriz de permissões
- Configuração de regras SoD

---

## 6. Componentes (18 Total)

### 6.1 Layout & Navegação

| Componente | Propósito |
|------------|-----------|
| **Layout.tsx** | Wrapper principal com TopBar + área de conteúdo |
| **TopBar.tsx** | Header de navegação com menu e info de utilizador |

### 6.2 Card Components

| Componente | Propósito |
|------------|-----------|
| **MetricCard** | Display de KPI com trend indicator |
| **ChartCard** | Container para gráficos com título/subtítulo |
| **TableCard** | Wrapper para tabelas |
| **TimelineCard** | Visualização de timeline/actividade |

### 6.3 Planning Components

| Componente | Propósito |
|------------|-----------|
| **PlanCard** | Card de resumo de plano com KPIs e preview de carga |
| **ScenarioCard** | Card de resumo de cenário |
| **GanttChart** | Visualização Gantt de timeline de operações |
| **JobsTable** | Tabela de fila de jobs |

### 6.4 Common Components

| Componente | Propósito |
|------------|-----------|
| **StatusBadge** | Badge de status (CANDIDATE, OFFICIAL, DRAFT, etc.) |
| **HashDisplay** | Display truncado de SHA-256 |

### 6.5 Specialized Components

| Componente | Propósito |
|------------|-----------|
| **AuditTrailViewer** | Viewer de log de actividades com filtragem |
| **ExplainTrace** | Visualização de explicabilidade de operações |
| **ParetoChart** | Gráfico de análise Pareto |
| **TrustIndex** | Gauge/display de Trust Index |
| **ReplanTrigger** | Painel de trigger de replaneamento |
| **SnapshotImportModal** | Modal de upload para importação de snapshots |

---

## 7. Gestão de Estado

### 7.1 Zustand Store

**Ficheiro:** `src/store/useAppStore.ts`

```typescript
interface AppState {
  // Data source (mock ou API)
  dataSource: IDataSource

  // UI State
  isLoading: boolean
  error: string | null

  // Utilizador actual
  currentUser: {
    id: string
    name: string
    role: 'VIEWER' | 'PLANNER' | 'APPROVER' | 'ADMIN'
  }

  // Actions
  setLoading(loading: boolean): void
  setError(error: string | null): void
  initializeDataSource(): void
  setCurrentUser(user): void
}
```

### 7.2 Data Source Abstraction

Interface unificada `IDataSource` implementada por:
- **ApiClient** - Para produção (REST API)
- **MockDataSource** - Para desenvolvimento (fixtures)

A troca é feita via `config.mode`:
```typescript
const config = {
  mode: import.meta.env.VITE_APP_MODE || 'mock', // 'mock' | 'api'
  apiBaseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
}
```

---

## 8. Hooks Customizados

### 8.1 Data Fetching Hooks

| Hook | Propósito |
|------|-----------|
| `useDataSource()` | Acesso ao dataSource global |
| `useAsyncState<T>()` | Máquina de estado assíncrono genérica |
| `usePlans(snapshotId?)` | Fetch de lista/detalhe de planos |
| `useSnapshots()` | Fetch de lista/detalhe de snapshots |
| `useScenarios()` | Fetch de cenários |
| `usePRs()` | Fetch de PRs |
| `useSuggestions()` | Fetch de sugestões |
| `useAuditLog(filters?)` | Fetch de audit trail |
| `usePlannerCockpit(plan)` | Cálculo de KPIs |
| `useSandbox()` | Estado de sandbox/simulação |

### 8.2 Async State Pattern

```typescript
const [state, execute, reset] = useAsyncState<T>(initialData)

// state:
{
  status: 'idle' | 'loading' | 'success' | 'error'
  data?: T
  error?: ErrorModel
  duration_ms?: number
}

// execute: (asyncFn) => Promise<void>
// reset: () => void
```

---

## 9. Application Layer

### 9.1 Use Case Hooks

Organizados por domínio em `src/application/`:

#### Plan Management
```typescript
// usePlanActions()
{
  isLoading, error,
  commitPlan(planId),
  runPlanAsync(snapshotId, params),
  cancelJob(jobId),
  calculateKPIDelta(baseline, candidate)
}

// usePlannerCockpit()
{
  otdRate, tardiness, setupCount, machineLoad
}
```

#### Snapshot Management
```typescript
// useSnapshotActions()
{
  isLoading, error,
  sealSnapshot(id),
  importSnapshot(data),
  validateSnapshot(data),
  compareSnapshots(id1, id2)
}
```

#### Scenario Management
```typescript
// useScenarioActions()
{
  isLoading, error,
  createScenario(baselinePlanId),
  runScenario(id),
  moveOperations(scenarioId, operations)
}
```

#### PR Workflow
```typescript
// usePRActions()
{
  isLoading, error,
  createPR(data),
  approvePR(id, comment),
  mergePR(id),
  rollbackPR(id),
  canApprovePR(pr),  // SoD check
  canMergePR(pr)
}
```

#### Suggestions
```typescript
// useSuggestionActions()
{
  isLoading, error,
  acceptSuggestion(id),
  rejectSuggestion(id),
  getImpact(id)
}
```

#### Security
```typescript
// useAuthorization()
{
  currentUser,
  hasPermission(permission),
  effectivePermissions
}

// useSecurityActions()
{
  updateUserRole(userId, role),
  updatePermissions(userId, permissions)
}
```

---

## 10. Domain Layer

### 10.1 Core Types (`domain/types.ts`)

#### Snapshot & Master Data
```typescript
interface Snapshot {
  snapshot_id: string
  source: Source
  semantics: Semantics
  master_data: MasterData
  work_orders: WorkOrder[]
  calendars: Calendar[]
  trust_index?: TrustIndex
  created_at: string
  sealed_at?: string
}

interface MasterData {
  customers: Customer[]
  items: Item[]
  resources: Resource[]
  tools: Tool[]
  materials: Material[]
  operators: Operator[]
  skills: Skill[]
}
```

#### Plan & Operations
```typescript
interface Plan {
  plan_id: string
  snapshot_id: string
  status: 'CANDIDATE' | 'OFFICIAL'
  params: PlanParams
  operations: PlanOperation[]
  kpi_pack: KPIPack
  explain_trace?: ExplainTrace[]
  created_at: string
  committed_at?: string
}

interface PlanOperation {
  operation_id: string
  workorder_id: string
  item_sku: string
  resource_code: string
  start_time: string
  end_time: string
  quantity: number
  duration_s: number
  is_setup: boolean
}
```

#### PR & Approval
```typescript
interface PR {
  pr_id: string
  scenario_id: string
  baseline_plan_id: string
  candidate_plan_id: string
  status: 'DRAFT' | 'OPEN' | 'APPROVED' | 'MERGED' | 'REJECTED' | 'ROLLED_BACK'
  author_id: string
  approvals: Approval[]
  created_at: string
  merged_at?: string
}

interface Approval {
  approver_id: string
  decision: 'APPROVE' | 'REJECT'
  comment?: string
  timestamp: string
}
```

#### Suggestion
```typescript
interface Suggestion {
  suggestion_id: string
  type: SuggestionType  // 8 tipos
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED'
  impact_case: ImpactCase
  impact_result?: ImpactResult
  created_at: string
}

type SuggestionType =
  | 'ROUTE_CHANGE'
  | 'BATCH_MERGE'
  | 'SCHEDULE_SHIFT'
  | 'RESOURCE_SWAP'
  | 'PRIORITY_CHANGE'
  | 'SPLIT_ORDER'
  | 'COMBINE_SETUPS'
  | 'CAPACITY_ADJUSTMENT'
```

### 10.2 KPI Calculations (`domain/kpi/`)

```typescript
// computeLoadByMachineDayShift(plan)
// Returns: LoadByMachineDayShift[]
{
  resource_code: string
  date: string
  shift: 'morning' | 'afternoon' | 'night'
  duration_s: number
  operations_count: number
}

// computeSetupCountByShift(plan)
// Returns: SetupCountByShift
Record<string, Record<'morning' | 'afternoon' | 'night', number>>

// computeTardinessByOrder(plan)
// Returns: TardinessByOrder[]
{
  workorder_id: string
  due_date: string
  completion_time: string
  tardiness_days: number
}

// computeChurn(plan, baselinePlan?)
// Returns: Churn
{
  operations_moved: number
  operations_added: number
  operations_removed: number
  total_churn: number
}
```

### 10.3 Diff Calculations (`domain/diff/`)

```typescript
// computeDiffSummary(baseline, scenario)
// Returns: DiffSummary
{
  baseline: BaselineMetrics
  scenario: ScenarioMetrics
  delta: DeltaMetrics
}

interface DeltaMetrics {
  otd_delta: number
  tardiness_delta: number
  setup_count_delta: number
  makespan_delta: number
}
```

---

## 11. Adapters (API e Mock)

### 11.1 ApiClient

**Ficheiro:** `src/adapters/ApiClient.ts`

Cliente REST baseado em Axios com:
- Correlation ID tracking (C-15 compliant)
- Idempotency-Key headers para operações mutantes
- Gestão de Correlation ID via interceptors
- Normalização de erros para ErrorModel

**Métodos disponíveis:**

| Categoria | Métodos |
|-----------|---------|
| **Snapshots** | `listSnapshots`, `getSnapshot`, `importSnapshot`, `sealSnapshot` |
| **Plans** | `listPlans`, `getPlan`, `runPlan`, `commitPlan` |
| **Scenarios** | `getScenarioDiff`, `createScenario`, `runScenario` |
| **PRs** | `listPRs`, `getPR`, `createPR`, `approvePR`, `mergePR`, `rollbackPR` |
| **Suggestions** | `listSuggestions`, `getSuggestion`, `acceptSuggestion`, `getSuggestionImpact` |
| **Jobs** | `runPlanAsync`, `getPlanJob`, `cancelPlanJob` |
| **Config** | `listCalendars`, `getCalendar`, `listOperatorPools`, `setOperatorPoolCapacity` |
| **Materials** | `listMaterials`, `createMaterial` |
| **Events** | `listEvents` |

### 11.2 MockDataSource

**Ficheiro:** `src/adapters/MockDataSource.ts`

Implementação mock baseada em fixtures:
- Lazy-load de fixtures de `/public/fixtures/`
- Persistência in-memory usando Maps
- Audit trail tracking com `addAuditEntry()`
- Implementações fallback para métodos opcionais

### 11.3 ErrorModel

```typescript
interface ErrorModel {
  code: string              // ERR_NETWORK_TIMEOUT, ERR_HTTP_400, etc.
  message: string           // Mensagem legível
  correlation_id?: string   // ID de tracking
  details?: Record<string, unknown>
}
```

---

## 12. Design System

### 12.1 Paleta de Cores

```css
/* Backgrounds */
--bg-primary: #0f1419           /* Background escuro */
--bg-secondary: #1a1f2e         /* Secondary */
--bg-card: #1e2534              /* Cards */
--bg-hover: #252b3a             /* Hover */

/* Primary Colors */
--color-teal: #14b8a6           /* Primary: Teal */
--color-teal-light: #2dd4bf
--color-teal-dark: #0d9488
--color-green: #10b981          /* Success */
--color-orange: #f97316         /* Warning */

/* Text */
--color-text-primary: #ffffff
--color-text-secondary: #94a3b8
--color-text-muted: #64748b

/* States */
--color-success: #10b981
--color-error: #ef4444
--color-warning: #f59e0b
--color-info: #3b82f6
```

### 12.2 Spacing

```css
--spacing-xs: 0.25rem    /* 4px */
--spacing-sm: 0.5rem     /* 8px */
--spacing-md: 1rem       /* 16px */
--spacing-lg: 1.5rem     /* 24px */
--spacing-xl: 2rem       /* 32px */
--spacing-2xl: 3rem      /* 48px */
```

### 12.3 Border Radius

```css
--radius-sm: 0.375rem    /* 6px */
--radius-md: 0.5rem      /* 8px */
--radius-lg: 0.75rem     /* 12px */
--radius-xl: 1rem        /* 16px */
```

### 12.4 Shadows

```css
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05)
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1)
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1)
```

---

## 13. Sistema de Segurança

### 13.1 Role-Based Access Control (RBAC)

| Role | Permissões |
|------|------------|
| **VIEWER** | `READ_PLANS`, `READ_SNAPSHOTS`, `READ_PRS` |
| **PLANNER** | VIEWER + `CREATE_PLAN`, `CREATE_SCENARIO`, `CREATE_PR` |
| **APPROVER** | PLANNER + `APPROVE_PR`, `MERGE_PR`, `SEAL_SNAPSHOT` |
| **ADMIN** | `ALL` (todas as permissões) |

### 13.2 Separation of Duties (SoD)

Regras implementadas:
- O autor de um PR não pode aprovar o próprio PR
- `PR_CREATE` e `PR_APPROVE` são permissões distintas
- Validação feita em `usePRActions.canApprovePR()`

### 13.3 Correlation ID Tracking

- UUID gerado por request no ApiClient
- Passado via header `X-Correlation-ID`
- Usado para audit trail e tracking de erros

---

## 14. Testes

### 14.1 Setup

**Ficheiro:** `src/tests/setup.ts`
- Jest-dom matchers extended para Vitest
- Mock de fetch para fixtures
- Cleanup automático após cada teste

### 14.2 Tipos de Testes

| Tipo | Localização | Propósito |
|------|-------------|-----------|
| **Contract** | `tests/contract/` | Validação de schemas de fixtures |
| **A11y** | `tests/a11y/` | Acessibilidade |
| **Regression** | `tests/regression/` | Workflows de features |

### 14.3 Comandos

```bash
npm test              # Watch mode
npm test -- --run     # Single run
npm run validate:contracts
```

---

## 15. Configuração

### 15.1 vite.config.ts

```typescript
{
  plugins: [react()],
  resolve: {
    alias: { '@': './src' }
  },
  server: {
    port: 5173,
    open: true
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/tests/setup.ts'
  }
}
```

### 15.2 tsconfig.json

```typescript
{
  compilerOptions: {
    target: 'ES2020',
    lib: ['ES2020', 'DOM', 'DOM.Iterable'],
    module: 'ESNext',
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    paths: { '@/*': ['./src/*'] },
    types: ['node', 'vitest/globals']
  }
}
```

### 15.3 Environment Variables

| Variável | Default | Propósito |
|----------|---------|-----------|
| `VITE_APP_MODE` | `mock` | Modo de data source |
| `VITE_API_BASE_URL` | `http://localhost:8000` | URL da API |
| `VITE_VALIDATE_FIXTURES` | - | Activar validação runtime |

---

## 16. Rotas

```
/                     → Dashboard
/activity             → Activity
/overview             → Overview
/planning             → Planning (tabs: plans, scenarios, comparison, gantt, jobs)

/manage               → Manage (hub)
  /manage/capacity    → Capacity
  /manage/calendars   → Calendars
  /manage/materials   → Materials

/snapshots            → SnapshotsList
/snapshots/:id        → SnapshotDetail

/plans                → PlansList
/plans/:id            → PlanDetail

/scenarios            → ScenariosList
/scenarios/:id        → ScenarioDetail

/prs                  → PRsList
/prs/new              → PRCreate
/prs/:id              → PRDetail

/suggestions          → SuggestionsList
/suggestions/:id      → SuggestionDetail

/security             → Security
```

---

## 17. Fixtures

**Localização:** `/public/fixtures/`

| Categoria | Ficheiros |
|-----------|-----------|
| **Snapshots** | `snapshot/isop_snapshot_v1.json` |
| **Plans** | `plan/plan_v1.json`, `plan_v2.json` |
| **Scenarios** | `scenarios/scenario_diff_v1.json`, `scenario_list.json` |
| **PRs** | `pr/pr_v1.json` |
| **Suggestions** | `suggestions/suggestion_v1.json` |
| **Audit** | `audit_log/audit_log_v1.json` |
| **Config** | `calendars/`, `materials/`, `capacity/` |
| **Jobs** | `jobs/jobs_list.json` |
| **Golden** | `golden/snapshot_small.json`, `snapshot_medium.json` |

---

## 18. Padrões e Convenções

### 18.1 Estrutura de Componentes

```
ComponentName/
├── ComponentName.tsx
├── ComponentName.css
└── index.ts (barrel export)
```

### 18.2 Naming Conventions

| Tipo | Pattern | Exemplo |
|------|---------|---------|
| Pages | PascalCase | `Dashboard.tsx` |
| Components | PascalCase | `MetricCard.tsx` |
| Hooks | camelCase com `use` | `usePlanActions.ts` |
| Types | PascalCase | `PlanOperation` |
| Utils | camelCase | `formatDate()` |

### 18.3 Import Pattern

```typescript
// External
import { useState, useCallback } from 'react'

// Internal - absolute
import { useDataSource } from '@/hooks/useDataSource'
import type { Plan } from '@/domain/types'

// Relative
import './Component.css'
```

### 18.4 Use Case Hook Pattern

```typescript
export function use<Entity>Actions() {
  const dataSource = useDataSource()
  const [state, setState] = useState({ isLoading: false, error: null })

  const action = useCallback(async (...args) => {
    setState({ isLoading: true, error: null })
    try {
      const result = await dataSource.method(...args)
      setState({ isLoading: false, error: null })
      return result
    } catch (error) {
      setState({ isLoading: false, error: error.message })
      return null
    }
  }, [dataSource])

  return { ...state, action }
}
```

---

## 19. Métricas do Projecto

| Métrica | Valor |
|---------|-------|
| **Total de Linhas** | ~12.000+ linhas TypeScript/TSX |
| **Páginas** | 15 |
| **Componentes** | 18 |
| **Hooks** | 10+ |
| **Application Hooks** | 8 |
| **Types/Interfaces** | 50+ |
| **Fixtures** | 17 ficheiros |
| **CSS Files** | 37 |

---

## Conclusão

O **INCOMPOL PP1** é uma aplicação frontend **robusta e bem arquitectada** que segue:

- **Clean Architecture** com separação clara de responsabilidades
- **TypeScript strict** com type safety completo
- **API Contract Compliance** (C-00 a C-15)
- **Role-Based Security** com Separation of Duties
- **Dual-Mode Data Source** para desenvolvimento flexível
- **Comprehensive Testing** com contract, a11y, e regression tests
- **Professional Dark Theme** com design system consistente
- **Audit Trail** para rastreabilidade completa

O sistema está preparado para produção com todas as funcionalidades core implementadas e testadas.

---

> **Documento gerado:** Fevereiro 2026
> **Projecto:** INCOMPOL PP1
> **Stack:** React 18 + TypeScript 5 + Vite + Zustand
