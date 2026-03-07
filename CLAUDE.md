# CLAUDE.md — ProdPlan PP1

> Production planning system for the Nikufra factory (Incompol group).
> Last verified: 2026-03-05

---

## 1. PROJECT OVERVIEW

**Product**: ProdPlan PP1 — Industrial production scheduling with constraint-based optimization
**Factory**: Nikufra (Incompol group)
**Domain**: Production planning (PLAN + SUPPLY). No OEE, QMS, MTN, Forecasting, or DPP modules.

### Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + TypeScript (strict) + Vite 5 + Zustand + React Router 7 + Axios + Zod + Recharts + Lucide React + date-fns |
| Backend | Python 3.13 + FastAPI + SQLAlchemy 2.0 + Alembic + PostgreSQL (JSONB) |
| Scheduling | **@prodplan/scheduling-engine** (standalone TypeScript module in `packages/scheduling-engine/`) — imported via `lib/engine.ts`. NikufraEngine.tsx is UI-only (~1,671 lines). No backend solver. |
| Testing | Vitest (FE) · pytest (BE) |

### Architecture Principles

- **Client-side scheduling** — All scheduling runs in the browser via INCOMPOL PLAN (imported through `lib/engine.ts`)
- **Single source of truth** — `lib/engine.ts` re-exports ALL 143 functions/types/constants from incompol-plan. No scheduling logic in the frontend itself.
- **Adapter Pattern** — `useDataSource()` hook → `MockDataSource` (fixture/ISOP upload)
- **Data persistence** — `useDataStore` (Zustand + localStorage) stores uploaded ISOP data
- **Module-level cache** — `useScheduleData` computes schedule once, shared across all pages
- **Deterministic** — Same input data = same schedule = same KPIs (PRNG: mulberry32)

---

## 2. COMPANION DOCUMENTS

### `claude-frontend.md` — OBRIGATÓRIO para todo o trabalho frontend

Fonte UNICA de verdade para: design system, CSS variables, component patterns, layout, tipografia, spacing, interaccao, proibicoes.

**CARREGAR SEMPRE** quando modificar qualquer ficheiro `.tsx`, `.css`, ou relacionado com UI.

### `claude-backend.md` — OBRIGATÓRIO para todo o trabalho backend

Fonte para: API endpoints, DB models.

**CARREGAR SEMPRE** quando modificar qualquer ficheiro `.py`.

### `claude-bdmestre.md` — OBRIGATÓRIO para dados/solver

Dados mestres Nikufra: 6 maquinas, 44 tools, ~64 SKUs, 14 clientes, routing completo, shifts X/Y, calendario, M.O., constraints.

### `claude-gantt.md` — OBRIGATÓRIO para scheduling/Gantt

Logica congelada do scheduling engine: constantes, algoritmos, 4 constraints, GanttView, pipeline de dados, regras de negocio validadas.

**CARREGAR SEMPRE** quando modificar `NikufraEngine.tsx`, `useScheduleData.ts`, ou logica de scheduling.

### `PP1_ANALISE_LOGICA_DADOS_v1.md` — Referencia para parsing ISOP

Semantica de dados ISOP, mapeamento de colunas, regras de derivacao.

### @prodplan/scheduling-engine — Modulo standalone de scheduling

Directorio: `packages/scheduling-engine/` (monorepo workspace)

Logica de scheduling extraida como modulo TypeScript puro. Governado pela **Especificacao Normativa de Logica** (fonte de verdade para todas as decisoes de scheduling). Todas as constraints sao HARD. Produz `FeasibilityReport` com inviabilidades formais.

**CARREGAR SEMPRE** quando modificar logica de scheduling, constraints, ou slot allocation.

---

## 3. DATA FLOW

```
User uploads ISOP XLSX (CarregarDados page)
  -> isopClientParser.ts parses Excel
     • Stock-A (Col N) IGNORADA, forcada a 0
     • Colunas de datas contem raw NP values (Net Position)
     • Cada celula NP negativa = 1 encomenda de |NP| pcs (ver 5.3)
  -> useDataStore (Zustand + localStorage) stores NikufraData
  -> useScheduleData hook reads from useDataStore (or fixture fallback)
    -> transformPlanState() -> convert to EngineData          [from lib/engine]
       • stk inicia a 0 (Stock-A ignorado)
       • modo raw_np: extractStockFromRawNP() → stock REAL dos valores NP
       • modo raw_np: rawNPtoOrderDemand() → encomenda-a-encomenda (logica correcta, ver 5.3)
       • modo raw_np: orderBased=true → bucketing por encomenda, sem lot economic
       • modo raw_np: cross-EDD twin merge → gemeas emparelham entre datas (ver 5.9.1)
    -> autoRouteOverflow() -> schedule + overflow to alt       [from lib/engine]
    -> capAnalysis() -> utilization per machine/day            [from lib/engine]
    -> scoreSchedule() -> KPIs (OTD, tardiness, cost)          [from lib/engine]
    -> validateSchedule() -> constraint violations             [from lib/engine]
  -> All pages consume via useScheduleData()
```

**All scheduling functions come from `lib/engine.ts` -> `@prodplan/scheduling-engine`.**

**NOTA**: No modo `raw_np` (default), o engine usa `rawNPtoOrderDemand()` que implementa a logica correcta do planeador: cada celula NP negativa = 1 encomenda de |NP| pcs, sem deltaizacao, sem lot economic, sem deduplicacao de valores repetidos. Pecas gemeas emparelham por ordem sequencial entre datas (cross-EDD). Ver seccoes 5.3 e 5.9.

**Fallback**: If no ISOP uploaded, loads `public/fixtures/nikufra/nikufra_data.json` (2,221 lines, 100% real factory data).

---

## 4. DIRECTORY STRUCTURE (verified 2026-03-04)

### Frontend (`apps/frontend/src/`)

```
App.tsx              -> 8 routes (see S6)
main.tsx             -> Entry point
index.css            -> All CSS variables (design tokens)

lib/
  engine.ts          -> Re-exports ALL from @prodplan/scheduling-engine (single import point)

adapters/
  MockDataSource.ts  -> Loads fixture/ISOP data, builds PlanState

components/
  Common/            -> Collapsible, EmptyState, ErrorBoundary,
                       HeatmapLegend, SkeletonLoader, StatusBadge, StatusBanner, Tooltip
  Layout/            -> Layout.tsx (main wrapper)
  Planning/          -> GanttChart.tsx, MiniGantt.tsx
  PulseStrip/        -> PulseStrip.tsx (KPI pulse indicator)
  FocusStrip/        -> FocusStrip.tsx (focus entity strip)
  ContextPanel/      -> ContextPanel.tsx (entity detail panel)
  Toast/             -> Toast.tsx
  TopBar/            -> TopBar.tsx (3-group navigation)

domain/
  types.ts           -> Backend API contract types (Plan, KPIPack, PlanEvent, etc.)
  nikufra-types.ts   -> NikufraData, PlanState, MasterISOPData
  isopClientParser.ts -> ISOP XLSX parser (509 lines)
  mrp/               -> mrp-types.ts (MRP type definitions)

features/
  planning/          -> NikufraEngine.tsx (~1,671 lines — UI only, scheduling from lib/engine)
  intelligence/      -> NikufraIntel.tsx + intel-compute.ts (1,091 lines) + intel-adapter.ts
  supply/            -> SupplyMonitor.tsx

hooks/
  useScheduleData.ts -> Core hook (schedule + KPIs, module-level cache, uses lib/engine)
  useDataSource.ts   -> IDataSource adapter selector

pages/
  Dashboard/         -> Dashboard.tsx (6 KPIs, heatmap, operator, backlogs)
  Fabrica/           -> Fabrica.tsx (6 machines, sparklines, heatmap)
  Risk/              -> Risk.tsx (unified risk map: capacity, stock, constraints)
  Pecas/             -> Pecas.tsx (SKU table, coverage %, filters)
  MRP/               -> MRP.tsx (8 tabs: Table, RCCP, Summary, Coverage, Actions, ROP/SS, CTP, What-If)
  Supply/            -> Supply.tsx (-> SupplyMonitor)
  Planning/          -> Planning.tsx (-> NikufraEngine)
  Intelligence/      -> Intelligence.tsx (-> NikufraIntel, 10 analytics tabs)
  Definicoes/        -> CarregarDados.tsx (ISOP upload, preview, apply)

stores/              -> 7 stores
  useAppStore.ts     -> IDataSource interface + app state
  useDataStore.ts    -> User-uploaded ISOP data + fixture merge (localStorage persistence)
  useSettingsStore.ts -> Engine settings (MO strategy, OEE, dispatch rules, thirdShift, etc.)
  useReplanStore.ts  -> Replan events, blockage zones
  usePlanVersionStore.ts -> Plan versions, diffs
  useToastStore.ts   -> Toast notifications
  useUIStore.ts      -> Shared UI state (focus strip, context panel)

utils/               -> uuid.ts, helpers.ts, eventTypeMapping.ts, utilColor.ts
```

### Backend (`apps/backend/src/`)

```
api/v1/              -> 7 endpoint files:
                       health, version, snapshots, plan, events, metrics, audit, nikufra

core/                -> Config, errors, exception_handler, logging, metrics, middleware

domain/
  models/            -> SQLAlchemy models: plan, snapshot, audit
  nikufra/           -> Nikufra-specific service, schemas, ingest_service
  ingest/            -> ISOP XLSX parser (isop_parser.py)
  snapshot/          -> Snapshot service, repository, hash computation
  plan/              -> Plan service (persistence only), repository
  audit/             -> Audit service and repository
  run_events/        -> Event processing: service, repository, models, event_applier (persistence only)

db/migrations/       -> 7 Alembic migrations
```

---

## 5. CORE DOMAIN CONCEPTS

### 5.1 NikufraData (Frontend input format)

The central data structure. Uses SHORT property names for compactness.

```typescript
interface NikufraData {
  dates: string[]           // ["02/02", "03/02", ...] -- 8 days
  days_label: string[]      // ["Seg", "Ter", ...]
  mo: { PG1: number[], PG2: number[] }  // MAN hours per day per area
  machines: Array<{ id: string, area: string, man: number[] }>  // 6 machines
  tools: Array<{
    id: string, m: string, alt: string,   // tool, primary machine, alt machine
    s: number, pH: number, op: number,     // setup hours, pcs/hour, operators
    skus: string[], nm: string[],          // SKUs and item names
    lt: number, stk: number               // lot economic, stock (Stock-A IGNORADO, forçado a 0; stock real vem dos NP em raw_np mode)
  }>
  operations: Array<{
    id: string, m: string, t: string,      // op id, machine, tool
    sku: string, nm: string,               // item SKU and name
    pH: number, atr: number,               // pcs/hour, backlog
    d: number[],                           // daily demand (8 values)
    s: number, op: number,                 // setup hours, operators
    cl?: string, clNm?: string,            // customer code/name
    pa?: string, wip?: number, qe?: number, // parent SKU, WIP, qtd_exp
    twin?: string                          // twin/peca gemea SKU (from ISOP col "Peca Gemea")
  }>
}
```

**SHORT -> LONG name mapping**: `m`=machine, `t`=tool, `s`=setup_hours, `pH`=pcs_per_hour, `op`=operators, `atr`=backlog, `d`=daily_qty, `stk`=stock, `lt`=lot_economic, `cl`=customer_code, `clNm`=customer_name, `pa`=parent_sku, `qe`=qtd_exp

### 5.2 Scheduling Architecture

**NikufraEngine.tsx** (~1,671 lines) is UI-ONLY. It imports ALL scheduling logic from `lib/engine.ts`:

```typescript
// All scheduling comes from lib/engine.ts -> incompol-plan
import {
  S0, T1, S1, DAY_CAP,
  transformPlanState, autoRouteOverflow,
  capAnalysis, validateSchedule, auditCoverage,
  quickValidate, genDecisions, moveableOps,
  runOptimization, opsByDayFromWorkforce,
  computeSCAP, C, TC, tci,
} from '../../lib/engine'
```

**4 HARD Constraints** (per Normative Logic Specification -- all HARD, no soft mode):
1. **SetupCrew** -- Max 1 setup at a time across factory (HARD: tries alt shifts/days, then INFEASIBLE)
2. **ToolTimeline** -- No tool conflicts (same tool on 2 machines simultaneously) (HARD: defers start)
3. **CalcoTimeline** -- No calco code conflicts (HARD: defers start)
4. **OperatorPool** -- Per-shift operator capacity by area PG1/PG2 (ADVISORY: records but never blocks)

**Constants** (all from incompol-plan, all correct):
- S0 = 420 (shift X start: 07:00)
- T1 = 930 (shift Y start: 15:30)
- S1 = 1440 (day end: 24:00)
- DAY_CAP = 1020 (S1 - S0)
- DEFAULT_OEE = 0.66
- DEFAULT_SCAP = 673

**Shifts**: X (07:00-15:30), Y (15:30-24:00), Z (24:00-07:00, exceptional)

#### Setup Times por Ferramenta (59 tools — fixture `nikufra_data.json`)

A fixture serve como **Master Data**. Quando um ISOP diario e carregado sem coluna Tp.Setup, `mergeWithMasterData()` (em `useDataStore.ts`) enriquece automaticamente com estes valores.

| Setup (h) | Ferramentas |
|-----------|-------------|
| **0.50** | BFP112, BFP171, BFP172, BFP178, BFP179, BFP181, BFP183, BFP184, BFP186, BFP187, BFP188, BFP192, BFP195, BFP197, BFP202, BFP204, EBR001, HAN002, HAN004, LEC002, MIC009 |
| **1.00** | BFP079, BFP083, BFP091, BFP092, BFP096, BFP100, BFP101, BFP110, BFP125, BTL013, BWI003, JDE002, JTE001, JTE003, JTE004, JTE007, VUL031, VUL068, VUL115, VUL125, VUL127, VUL128, VUL146, VUL147, VUL173, VUL174, VUL192, VUL195, VUL199, VUL201, VUL203 |
| **1.25** | BFP080, BFP082, BFP114, BFP162, VUL038 |
| **1.50** | DYE025, VUL111 |

**Fontes**: 44 tools do ISOP Mestre (02/02/2026) com Tp.Setup real. 15 tools novos (BTL013, BWI003, JTE004, JTE007, VUL125-203) com setup=1.0h (default fabrica, sem dados ISOP).

**Fallback**: Tools completamente desconhecidos usam `defaultSetupHours` (0.75h) de `useSettingsStore.ts`.

#### Pecas Gemeas (Twin Parts)

A coluna "Peca Gemea" do ISOP identifica pares LH/RH que partilham ferramenta e maquina. Parseada por `isopClientParser.ts` → campo `twin` em `NikufraOperation`.

**8 pares validados** (ISOP 27/02, bidireccional, mesmo tool+machine):

| SKU A | SKU B | Tool | Machine |
|-------|-------|------|---------|
| 1064169X100 | 1064186X100 | BFP079 | PRM031 |
| 1403150X050 | 1413147X070 | BFP125 | PRM043 |
| 1768601X030 | 1768602X030 | BFP162 | PRM031 |
| 2100373X120.10 | 2185094X110.10 | BFP178 | PRM039 |
| 2513974X100 | 2785359X050 | BFP172 | PRM043 |
| 2689556X090 | 2689557X090 | BFP171 | PRM031 |
| 5246946X080 | 5246947X080 | BFP179 | PRM019 |
| VW2872957 | VW2872960 | BTL013 | PRM039 |

**Validacao**: `twin-validator.ts` (INCOMPOL PLAN) filtra automaticamente self-references, counterparts ausentes, e mismatches de tool/machine. Resultado em `twinValidationReport` no `EngineData`.

### 5.3 Interpretacao NP e Logica de Planeamento de Producao

> **REGRA FUNDAMENTAL**: Cada celula NP negativa nas colunas de datas do ISOP = **1 encomenda de |NP| pecas** com deadline nesse dia. Valores repetidos contam — se NP=-15600 aparece em 3 dias, sao 3 encomendas de 15600. Celulas vazias (null) NAO sao demand. O planeamento e feito **encomenda a encomenda**.

#### 5.3.1 Coluna Stock-A (Col N) — IGNORADA

Forcada a 0 em:
- `isopClientParser.ts` (parser: `stock: 0`)
- `MockDataSource.ts` (adapter: `stock: 0`)
- `transform-plan-state.ts` (engine: `stk: 0` inicial)

#### 5.3.2 Como Ler os Valores NP (CORRECTO)

Os valores NP nas colunas de datas do ISOP representam a **Net Position** (posicao liquida) do SKU:

```
SKU: 1064169X100 | BFP079 @ PRM031 | pH=1681

Dia:  27/02  28/02  01/03  02/03  03/03  04/03  05/03  06/03  ...  10/03  ...  13/03
NP:   2751   2751   2751   2751   2751   2751  -15600 -15600  ... -10400  ... -18200

Leitura correcta:
- 2751 = tenho 2751 pecas em stock (positivo = stock disponivel)
- -15600 no dia 05/03 = ENCOMENDA de 15600 pcs, deadline 05/03
  • Stock (2751) absorve parte da demand, mas preciso PRODUZIR 15600 pcs (= |NP|)
  • No dia da deadline, as pecas TEM de estar prontas
  • Apos entrega: stock = 0
- -10400 no dia 10/03 = NOVA encomenda de 10400 pcs, deadline 10/03
  • Stock = 0 (entrega anterior zerou), produzir 10400 pcs
- -18200 no dia 13/03 = NOVA encomenda de 18200 pcs, deadline 13/03
```

#### 5.3.3 Regras de Extracao de Encomendas

1. **NP positivo ou zero** = stock disponivel, sem encomenda activa
2. **NP negativo** = encomenda de |NP| pecas, deadline nesse dia
3. **NP negativo repetido** = TAMBEM e encomenda (sem deduplicacao)
4. **NP null/vazio** = celula vazia no ISOP, NAO gera demand
5. **Cada encomenda e INDEPENDENTE** — apos entrega, stock = 0
6. **Producao necessaria = |NP|** (o NP ja desconta o stock existente)
7. **Procura total** = soma absoluta de TODAS as celulas NP negativas (699 celulas = 3,185,769 pcs no ISOP 27/02)

#### 5.3.4 Logica de Planeamento (como o planeador pensa)

```
Para cada operacao (SKU + maquina + tool):
  1. Percorrer colunas de datas sequencialmente
  2. Identificar cada encomenda (cada celula NP negativa)
  3. Para cada encomenda:
     - qty = |NP| pecas
     - deadline = dia em que o NP aparece negativo
     - taxa efectiva = pH × OEE (0.66)
     - tempo producao = qty / taxa_efectiva (horas)
  4. CADA encomenda e um bloco separado no Gantt
  5. Planear para tras: bloco deve TERMINAR antes da deadline
```

**Exemplo calculo**:
```
SKU: 1064169X100 | pH=1681 | OEE=0.66
Taxa efectiva = 1681 × 0.66 = 1109 pcs/hora
Encomenda: 15600 pcs, deadline 05/03
Tempo = 15600 / 1109 = 14.1 horas
Com DAY_CAP = 17h, precisa de ~1 dia de producao
```

#### 5.3.5 O Que NUNCA Fazer (erros frequentes)

> **PROIBIDO 1**: Somar todos os NP negativos de um SKU e dizer "a demand total e X"
> Cada encomenda e INDEPENDENTE. Produz-se encomenda a encomenda, cada uma com a sua deadline.

> **PROIBIDO 2**: Calcular deltas entre NP (ex: de +2751 para -15600, delta = 18351)
> A encomenda e |NP| = 15600, NAO o delta. O stock absorve, mas a producao necessaria = |NP|.

> **PROIBIDO 3**: Tratar NP como shortfall cumulativo e deltaizar
> NP NAO e um running total. Cada celula negativa = encomenda de |NP| pecas.

> **PROIBIDO 4**: Agrupar todas as encomendas de uma tool e calcular tempo total
> Cada encomenda tem a SUA deadline. Planeia-se caso a caso, nao em bloco.

> **PROIBIDO 5**: Usar lot economic para inflacionar quantidades de producao
> Produz-se EXACTAMENTE |NP| pecas. Lot economic e para bucketing do engine, nao para calcular producao real.

### 5.4 lib/engine.ts -- Single Import Point

Re-exports ALL 143 items from `@prodplan/scheduling-engine`. No scheduling logic in this file -- only re-exports plus 2 backwards-compat helpers:
- `opsByDayFromWorkforce()` -- converts `ZoneShiftDemand[]` to `OpDay[]` for legacy UI
- Legacy types: `AreaCaps`, `Decision`, `OpDay`, `ObjectiveProfile` (used by NikufraEngine UI)

### 5.5 MRP Engine

All MRP functions imported from `lib/engine.ts` (source: @prodplan/scheduling-engine):
- `computeMRP()` -- Tool netting with demand buckets, RCCP
- `computeROP()` -- Safety stock & reorder point (ABC/XYZ classification)
- `computeCTP()` -- Capable-to-Promise (order feasibility by date)
- `computeWhatIf()` -- Scenario mutations (demand/capacity changes)
- `computeActionMessages()` -- Stockout alerts, low coverage warnings
- `computeCoverageMatrix()` -- Coverage grid

MRP types defined in `domain/mrp/mrp-types.ts`.

### 5.6 Intelligence Engine (`features/intelligence/intel-compute.ts`, 1,091 lines)

10 analytics datasets:
1. Demand Heatmap -- Customer x day matrix
2. Capacity Horizon -- Machine utilization trend
3. Urgency Matrix -- SKU x deadline priority grid
4. Client Risk -- Customer risk assessment
5. Cross-Client SKU -- Multi-customer analysis
6. Bottleneck Cascade -- Constraint identification
7. Setup Crew Timeline -- Setup schedule analysis
8. Tool Grouping -- Tool assignment effects
9. Machine Network -- Routing topology graph
10. Explain Trace -- Scheduling decision explainability

### 5.7 Backend Domain Concepts

Active backend domains:
- **Snapshot** -- Immutable ISOP import. Lifecycle: `CREATED -> SEALED`. SHA-256 hash.
- **Plan** -- Persistence only (scheduling is client-side). Lifecycle: `CANDIDATE -> OFFICIAL`.
- **Event** -- Production disruptions (persistence only, scheduling reacts client-side)
- **Audit Log** -- Append-only, action tracking, correlation IDs
- **Nikufra** -- Data serving (combined ISOP + PP data)

### 5.8 @prodplan/scheduling-engine -- Standalone Scheduling Module

**Location**: `packages/scheduling-engine/` (monorepo workspace)
**Purpose**: Production scheduling logic as a standalone TypeScript module. Pure functions, no React, no side effects.
**Build**: `pnpm --filter @prodplan/scheduling-engine build` . `pnpm --filter @prodplan/scheduling-engine test` (Vitest, 702 tests)

**Governed by**: Normative Logic Specification (source of truth for all scheduling decisions).

#### Key Principles

1. **All constraints are HARD** -- no soft mode. Hard = try all alternatives, if impossible = declare INFEASIBLE formally.
2. **Operations NEVER disappear** -- if a constraint prevents scheduling, the operation appears with `type: 'infeasible'` + formal report.
3. **No data invention** -- missing setup time = 0 (not 0.75h). Missing MO = schedule anyway + `DATA_MISSING` in report.
4. **FeasibilityReport** -- every scheduling run produces one: `totalOps`, `feasibleOps`, `infeasibleOps`, `entries[]`, `byReason`, `feasibilityScore`.
5. **DecisionRegistry** -- 28 decision types for full explainability.
6. **Demand multi-client** -- same SKU for different clients = separate operations (not merged).

#### Infeasibility Reasons (11 total)

`SETUP_CREW_EXHAUSTED`, `OPERATOR_CAPACITY`, `TOOL_CONFLICT`, `CALCO_CONFLICT`, `DEADLINE_VIOLATION`, `MACHINE_DOWN`, `CAPACITY_OVERFLOW`, `DATA_MISSING`, `MACHINE_PARTIAL_DOWN`, `TOOL_DOWN_TEMPORAL`, `SHIPPING_CUTOFF_VIOLATION`

#### Pipeline NP → Demand → Bucketing → EDD (ENGINE — modo `raw_np`)

O engine usa **`rawNPtoOrderDemand()`** no modo `raw_np` (default). Esta funcao implementa a logica correcta do planeador:

```
rawNPtoOrderDemand(rawNP, atr)     // NP → order-based daily demand
  1. Cada celula NP negativa (explicita) = encomenda de |NP| pcs nesse dia
  2. NP negativo repetido = TAMBEM encomenda (sem deduplicacao)
  3. NP >= 0 = stock OK, sem demand
  4. null/undefined = celula vazia, sem demand (NAO faz forward-fill)
  5. atr > 0: subtrai da 1a encomenda (grouper adiciona atr como EDD=0)

groupDemandIntoBuckets(ops, ..., orderBased=true)
  • Cada dia com demand > 0 = bucket separado (1 encomenda = 1 bucket)
  • Sem lot economic rounding (skipLotEconomic=true)
  • atr > 0: bucket urgente com EDD=0
  • EDD = dia da encomenda
  • Guard: demand conservation check (throw se SUM(buckets) != SUM(demand))
  • Twin merge: mergeTwinBuckets() com cross-EDD pairing (ver 5.9)
```

> **NOTA**: Os modos `daily` e `cumulative_np` ainda usam `rawNPtoDailyDemand()` (deltaizacao).
> O modo `raw_np` e o default em `useSettingsStore.ts` e o unico que implementa a logica correcta.
> `EngineData.orderBased = true` quando `demandSemantics = 'raw_np'`.

**Ficheiros de teste relevantes**:
- `tests/demand-pipeline.test.ts` — 37 testes de invariantes da pipeline completa
- `tests/deltaize-demand.test.ts` — testes de `rawNPtoDailyDemand`, `rawNPtoOrderDemand`, `deltaizeCumulativeNP`, `extractStockFromRawNP`
- `tests/demand-grouper.test.ts` — testes de `groupDemandIntoBuckets` + invariantes
- `tests/twin-coproduction.test.ts` — 21 testes de co-producao (incluindo cross-EDD)
- `apps/frontend/src/tests/unit/factoryPlannerAnalysis.test.ts` — analise encomenda-a-encomenda com logica correcta

### 5.9 Pecas Gemeas (Twin Co-Production)

Pecas gemeas sao dois SKUs que a maquina produz **em simultaneo** na mesma ferramenta. Cada lado da ferramenta produz a quantidade que o SKU precisa — **NAO e 1:1**.

**Exemplo**: A precisa de 500, B precisa de 300
- Maquina corre tempo baseado em max(500, 300) = 500
- Lado A produz 500 (o que precisa)
- Lado B produz 300 (o que precisa)
- Sem excesso, sem stock extra

**Regras**:
- Tempo maquina = max(demand_A, demand_B) / pH * 60 / OEE
- Output A = demand_A (exacto)
- Output B = demand_B (exacto)
- 1 setup, 1 corrida, operadores reservados 1x
- MRP grossReq = max(A, B) por dia (capacidade, nao output)
- Validacao: mesma maquina, tool, pH, operadores (`twin-validator.ts`)

#### 5.9.1 Cross-EDD Co-Production (emparelhamento entre datas)

A maquina faz SEMPRE as duas pecas ao mesmo tempo. A 1a encomenda de qualquer uma das gemeas desencadeia co-producao para ambas. O emparelhamento e por **ordem sequencial** (1a com 1a, 2a com 2a), NAO por data.

```
Exemplo:
  Peca A: encomenda dia 1 (100 pcs), encomenda dia 5 (200 pcs)
  Peca B: encomenda dia 3 (150 pcs), encomenda dia 7 (300 pcs)

  Corrida 1: A(dia 1) + B(dia 3) → EDD = min(1,3) = 1
    Tempo = max(100, 150) / pH / OEE
    A produz 100, B produz 150

  Corrida 2: A(dia 5) + B(dia 7) → EDD = min(5,7) = 5
    Tempo = max(200, 300) / pH / OEE
    A produz 200, B produz 300
```

**Regras de emparelhamento** (`mergeTwinBuckets()` em `demand-grouper.ts`):
1. Recolher TODOS os buckets de cada gemea ATRAVES de todos os ToolGroups (nao so do mesmo EDD)
2. Ordenar cada gemea por EDD (crescente)
3. Emparelhar sequencialmente: 1a-1a, 2a-2a, etc.
4. EDD do par merged = min(A.edd, B.edd) — a data mais cedo puxa a producao
5. Se uma gemea tem mais encomendas que a outra, as extras produzem sozinhas (solo)
6. ToolGroups vazios (todos os buckets movidos) sao eliminados

#### 5.9.2 O Que NUNCA Fazer com Pecas Gemeas

> **PROIBIDO 1**: Dizer que twins produzem quantidades iguais (1:1)
> Cada SKU recebe exactamente o que precisa. Se A=500 e B=300, A produz 500 e B produz 300.

> **PROIBIDO 2**: Dizer que excesso vai para stock
> Nao ha excesso. Cada lado da ferramenta produz a quantidade exacta da sua encomenda.

> **PROIBIDO 3**: Somar demands para tempo de maquina
> Tempo = max(A, B), NAO sum(A, B). A maquina corre pelo tempo do lado que precisa de mais.

> **PROIBIDO 4**: So juntar gemeas que tem encomenda no mesmo dia
> A co-producao funciona ENTRE datas. A 1a encomenda de qualquer gemea puxa a producao da outra. Emparelha-se por ordem sequencial, nao por data.

> **PROIBIDO 5**: Esperar que ambas as gemeas tenham encomenda para produzir
> Se A tem encomenda e B nao tem nenhuma, A produz sozinha. Mas se B tem encomenda noutro dia, emparelha-se com a de A.

> **PROIBIDO 6**: Emparelhar gemeas por indice dentro do mesmo ToolGroup
> O emparelhamento e GLOBAL (todos os ToolGroups), ordenado por EDD. Nunca emparelhar pela posicao na lista dentro de um unico grupo.

**Ficheiros relevantes**:
- `src/transform/twin-validator.ts` — Validacao de pares (7 regras, 8 codigos anomalia)
- `src/scheduler/demand-grouper.ts` — `mergeTwinBuckets()` (cross-EDD merge + tempo = max)
- `src/scheduler/slot-allocator.ts` — Block outputs com qty individual por SKU
- `src/utils/block-production.ts` — Helpers twin-aware para atribuicao de producao
- `src/types/twin.ts` — TwinGroup, TwinValidationReport
- `tests/twin-coproduction.test.ts` — 21 testes de co-producao (incluindo 5 cross-EDD)

---

## 6. ROUTES (from App.tsx, 8 routes)

```
/                    -> Dashboard (6 KPIs, load heatmap, operator allocation, backlogs)
/fabrica             -> Fabrica (6 machine cards, sparklines, heatmap, operator demand)
/risk                -> Risk (unified risk map: capacity, stock, constraints -- 8-day grid)
/pecas               -> Pecas (SKU table, coverage %, sorting, filtering)
/mrp                 -> MRP (8 tabs: Table, RCCP, Summary, Coverage, Actions, ROP/SS, CTP, What-If)
/supply              -> Supply (risk classification, ROP projection, action messages)
/planning            -> Planning (NikufraEngine: Gantt, replan, validation, what-if)
/intelligence        -> Intelligence (10 analytics tabs)
/definicoes/dados    -> Carregar Dados (ISOP upload, parse, preview, apply)
```

### Navigation structure (TopBar, 3 groups + settings):

| Group | Pages |
|-------|-------|
| **Monitorizar** | Dashboard, Fabrica, Risco |
| **Analisar** | Pecas, MRP, Supply |
| **Agir** | Planning, Intelligence |
| **Definicoes** | Carregar Dados |

---

## 7. RULES

### DOs

- Use CSS custom properties from `index.css` -- **see `claude-frontend.md` for complete list**
- Use `var(--font-mono)` for IDs, hashes, codes, technical values
- Use null-safe date formatting (check for null/undefined before `new Date()`)
- Handle loading, error, and empty states for all data fetches
- Write CSS in separate `.css` files (BEM naming: `.component__element--modifier`)
- Provide `data-testid` attributes on interactive elements
- Use TypeScript strict mode -- no `any` type, use `unknown` and narrow
- Use REAL production data from ISOP / `claude-bdmestre.md` -- never invent data
- Import scheduling logic ONLY from `lib/engine.ts` (never directly from `@prodplan/scheduling-engine`)
- Import stores from `stores/` (useAppStore, useDataStore, useSettingsStore, useReplanStore, usePlanVersionStore, useToastStore, useUIStore)

### DON'Ts

- NEVER use light-mode colors -- dark-only theme
- NEVER hardcode z-index -- use `--z-*` variables
- NEVER use `!important`
- NEVER use `any` type -- use `unknown` and narrow
- NEVER use `new Date(undefined)` -- always null-check first
- NEVER fabricate, invent, or hardcode production data
- NEVER write scheduling logic in the frontend -- it belongs in @prodplan/scheduling-engine
- NEVER dizer que stock vem da coluna Stock-A (Col N) -- Stock-A e IGNORADA, forcada a 0. Stock REAL vem dos valores NP nas colunas de datas via `extractStockFromRawNP()`
- NEVER usar `process.env` ou `console` em codigo do scheduling-engine -- e modulo TypeScript puro sem Node/DOM types
- NEVER ignorar NP negativos repetidos -- cada celula NP negativa e uma encomenda, repetida ou nao (ver 5.3)
- NEVER calcular deltas entre NP values (ex: de +2751 para -15600 = 18351) -- producao = |NP|, nao delta (ver ERRO 5)
- NEVER apresentar producao como bloco unico por tool no Gantt -- cada encomenda = 1 bloco separado com deadline (ver ERRO 6)
- NEVER usar quantidades inflacionadas pelo lot economic para calcular tempo de producao -- tempo = |NP| / (pH × OEE) (ver ERRO 7)
- NEVER dizer que pecas gemeas produzem quantidades iguais (1:1) -- cada SKU recebe exactamente o que precisa (ver 5.9)
- NEVER somar demands de gemeas para tempo de maquina -- tempo = max(A, B), NAO sum(A, B) (ver 5.9)
- NEVER so juntar gemeas que tem encomenda no mesmo dia -- co-producao funciona ENTRE datas, emparelhamento por ordem sequencial (ver 5.9.1)
- NEVER emparelhar gemeas por indice dentro do mesmo ToolGroup -- emparelhamento e GLOBAL, ordenado por EDD (ver 5.9.1)
- **For ALL frontend-specific rules**: see `claude-frontend.md` seccao 12 (48 proibicoes absolutas)

---

## 8. MANDATO: DADOS 100% REAIS

> **REGRA ABSOLUTA**: Este projecto opera EXCLUSIVAMENTE com dados reais da fabrica Nikufra.
> Qualquer dado que nao venha directamente do ISOP, do `claude-bdmestre.md`, ou de input manual
> verificado pelo utilizador e PROIBIDO.

### Permitido:
- Dados extraidos do ISOP Nikufra.xlsx (parsing real)
- Dados documentados em `claude-bdmestre.md`
- Dados calculados/derivados pelo engine a partir de dados reais
- Dados inseridos manualmente pelo utilizador via UI
- Calendario real (shifts X/Y, feriados, dias uteis)

### PROIBIDO:
- Inventar quantidades de producao, demand, stock, ou backlog
- Hardcodar KPIs (ex: `otd_rate: 0.85`, `balance_score: 0.7`)
- Gerar operacoes sinteticas para "preencher" tools sem dados no ISOP
- Usar valores placeholder "para o UI nao ficar vazio"
- Criar fixtures com dados fabricados

### Fonte unica de verdade:
| Dado | Fonte |
|------|-------|
| Routing (maquina->tool->SKU) | `claude-bdmestre.md` S3 |
| Setup times, rates, operadores | `claude-bdmestre.md` S3 |
| Encomendas/demand | **NP negativos nas colunas de datas** do ISOP. Cada celula NP negativa = 1 encomenda de \|NP\| pcs, repetidos contam (ver 5.3). |
| Stock | **NP positivos nas colunas de datas** do ISOP. Coluna Stock-A (Col N) IGNORADA, forcada a 0. |
| WIP, backlog | ISOP Nikufra.xlsx (cols O-P) |
| Calendario/shifts | `claude-bdmestre.md` S4 |
| M.O. por area | `claude-bdmestre.md` S5 |
| KPIs | Calculados pelo engine (@prodplan/scheduling-engine) |
| Schedule | Gerado pelo engine (@prodplan/scheduling-engine) |

---

## 9. BUILD & RUN

```bash
# Monorepo (from project root)
pnpm install                                              # Install all workspace dependencies
pnpm turbo run build                                      # Build all (scheduling-engine → frontend)
pnpm turbo run test                                       # Run all tests

# Scheduling Engine
pnpm --filter @prodplan/scheduling-engine build            # TypeScript → dist/
pnpm --filter @prodplan/scheduling-engine test             # 702 Vitest tests

# Frontend
pnpm --filter pp1-frontend dev                             # Vite dev server (port 5173)
pnpm --filter pp1-frontend build                           # TypeScript check + production build
pnpm --filter pp1-frontend test                            # Run Vitest

# Backend
cd apps/backend
pip install -r requirements.txt
python -m src.main                                         # Start FastAPI server
pytest                                                     # Run tests
```

---

## 10. ERROS CRITICOS — NUNCA REPETIR

> **Erros cometidos pelo Claude e corrigidos pelo utilizador. Documentados para NUNCA serem repetidos.**

### ERRO 1: Origem do Stock (2026-03-04)

**O que o Claude disse (ERRADO)**: "O stock vem da coluna Stock-A (Col N) do ISOP Excel."

**A VERDADE**: O stock vem dos **valores NP (Net Position) nas colunas de datas** do ISOP, via `extractStockFromRawNP()`. A coluna Stock-A (Col N) e **IGNORADA** e forcada a 0 em todo o sistema.

**Porque estava errado**: Nao verificou o `demandSemantics: 'raw_np'` (default em `useSettingsStore.ts`) nem o codigo de `transform-plan-state.ts` que sobrescreve stk com valores derivados do NP.

**Regra**: Antes de afirmar a origem de qualquer dado, verificar SEMPRE o `transform-plan-state.ts` e o `useSettingsStore.ts` para confirmar o modo de processamento activo.

### ERRO 2: process.env em modulo TypeScript puro (2026-03-04)

**O que o Claude fez (ERRADO)**: Usou `process.env.NODE_ENV` e `console.warn` num guard runtime em `demand-grouper.ts` (INCOMPOL PLAN).

**Porque estava errado**: O INCOMPOL PLAN e um modulo TypeScript puro sem `@types/node` nem DOM types. `process` e `console` nao existem no scope.

**Regra**: No INCOMPOL PLAN, guards runtime devem usar `throw new Error()` (que funciona em qualquer runtime). NUNCA usar `process.env`, `console.*`, `window.*`, ou qualquer API Node/Browser.

### ERRO 3: Pecas Gemeas 1:1 (2026-03-04)

**O que o codigo fazia (ERRADO)**: Ambos os outputs recebiam `qty = max(A, B)`. Se A=500 e B=300, ambos recebiam 500. Excesso de B (200) ia para stock.

**A VERDADE**: Cada SKU recebe exactamente o que precisa. A=500, B=300. Tempo de maquina baseado no max (500), mas cada lado produz a sua quantidade.

**Regra**: Twin outputs TEM quantidades diferentes. Nunca assumir 1:1. Ver seccao 5.9.

### ERRO 4: Somar todos os NP de um SKU como "demand total" (2026-03-05)

**O que o Claude fez (ERRADO)**: Somou todos os valores `op.d` (raw NP) para obter "demand total" de 4.1M pecas. Isto incluia valores POSITIVOS (que sao stock, nao demand) e tratava cada NP negativo como contribuicao para um total cumulativo.

**A VERDADE**: Cada celula NP negativa = encomenda de |NP| pecas (repetidos contam). Valores positivos sao stock, nao demand. Procura total = soma absoluta de TODAS as celulas negativas (699 celulas = 3,185,769 pcs no ISOP 27/02).

**Porque estava errado**: O Claude tratou os valores NP como se fossem quantidades de demand diaria (como numa folha de planeamento MRP classica). Na realidade, o NP e a posicao liquida — quando negativo indica uma encomenda, quando positivo indica stock.

**Regra**: Procura total = soma(|NP|) para todas as celulas NP negativas. NUNCA incluir valores positivos. NUNCA ignorar NP negativos repetidos. Ver seccao 5.3.

### ERRO 5: Calcular deltas entre NP como demand (2026-03-05)

**O que o Claude fez (ERRADO)**: Quando NP ia de +2751 para -15600, calculou delta = 18351 como "quantidade a produzir". Quando NP ia de -15600 para -10400, calculou 0 (shortfall diminuiu) ou outro delta.

**A VERDADE**: A encomenda e de |NP| = 15600 pecas. O stock de 2751 absorve parte, mas a producao necessaria = 15600 (o |NP| ja e liquido). O delta nao tem significado de producao. Quando NP muda para -10400, e uma NOVA encomenda de 10400 pecas (stock = 0 apos entrega anterior).

**Porque estava errado**: Aplicou logica de "shortfall cumulativo" (modelo do engine `rawNPtoDailyDemand`) em vez da logica do planeador. O NP NAO e um running total que se deltaiza — cada valor negativo e uma posicao liquida que representa directamente uma encomenda.

**Regra**: Producao necessaria = |NP| (valor absoluto), NAO delta entre NP consecutivos. Ver seccao 5.3.

### ERRO 6: Agrupar toda a producao de uma tool num unico bloco (2026-03-05)

**O que o Claude fez (ERRADO)**: Somou todas as encomendas de uma tool (ex: BFP079 = 641,252 pcs total) e calculou um unico bloco de 578h no Gantt. Depois disse "PRM031 precisa de 40 dias" como se fosse um bloco continuo.

**A VERDADE**: Cada encomenda e um bloco SEPARADO no Gantt. BFP079 nao e um bloco de 578h — sao ~34 encomendas individuais (12 de OP01, 12 de OP02, 10 de OP87/88), cada uma com o seu deadline. O planeamento e feito encomenda a encomenda, nao tool a tool.

**Porque estava errado**: Pensou em termos de "capacidade total necessaria por maquina" em vez de "scheduling de encomendas individuais com deadlines". A pergunta correcta NAO e "quantos dias preciso no total" mas sim "para cada encomenda, consigo terminar antes da deadline?"

**Regra**: NUNCA apresentar producao como bloco unico por tool. Cada encomenda = 1 bloco no Gantt com a sua deadline. Planeamento = encomenda a encomenda. Ver seccao 5.3.4.

### ERRO 7: Usar lot economic para inflacionar producao (2026-03-05)

**O que o Claude fez (ERRADO)**: Usou a logica de lot economic do engine (`ceil(accQty / lt) * lt`) que inflaciona producao em ~58.5%. Exemplo: BFP079 com lt=36400, demand real ~13300 → arredondado para 36400 (2.73x a mais). Depois usou estes numeros inflacionados para dizer que PRM042 precisava de 134 dias.

**A VERDADE**: O planeador produz EXACTAMENTE |NP| pecas por encomenda. Nao ha arredondamento ao lote economico para efeitos de calculo de tempo. O lot economic serve para bucketing interno do engine, mas o tempo real de producao e baseado na quantidade exacta da encomenda.

**Porque estava errado**: Usou numeros de output do engine (que incluem lot economic inflation) como se fossem demand real. O engine soma demand em buckets e arredonda ao lote, produzindo significativamente mais do que o necessario. O planeador calcula tempo com base na encomenda exacta.

**Regra**: Calcular tempo SEMPRE com `|NP| / (pH × OEE)`. NUNCA usar quantidades inflacionadas pelo lot economic para estimar capacidade. Ver seccao 5.3.4.

---

## 11. WHAT DOES NOT EXIST

For clarity, the following are **NOT implemented** and should not be referenced:

### Frontend pages that do NOT exist:
- No Snapshots, Plans, PRs, Suggestions, Scenarios pages
- No Operations Center, Financial, Forecast, Maintenance, Security, Analytics, Copilot pages

### Stores that do NOT exist:
- No `useOEEStore`, `useScenarioLabStore`, `useMasterDataStore`

### Backend domains that do NOT exist:
- No solver/ (scheduling is client-side only)
- No planning/ domain (deleted -- was backend scheduler)
- No calendar/ domain (deleted -- orphaned, never configured)
- No capacity/ domain (deleted -- orphaned, no frontend)
- No materials/ domain (deleted -- orphaned, no frontend)
- No plan_jobs/ (deleted -- async jobs for dead solver)
- No copilot, learning, suggestions, explain, improve, sandbox, integration/outbox, dqa domains

### Modules that do NOT exist:
- No OEE (no shop-floor execution data)
- No QMS/Quality (no inspection data)
- No MTN/Maintenance (no maintenance orders)
- No Forecasting (demand is imported, not predicted)
- No DPP/PASS/Sustainability (no carbon/LCA data)
- No PR workflow (governance removed)
- No Scenario Lab (page removed)
