# ProdPlan PP1 — Documento Completo do Sistema

> Sistema de planeamento de producao para a fabrica Nikufra (grupo Incompol).
> Gerado: 2026-03-02

---

## INDICE

1. [Visao Geral](#1-visao-geral)
2. [Arquitectura do Sistema](#2-arquitectura-do-sistema)
3. [Dados Mestres da Fabrica](#3-dados-mestres-da-fabrica)
4. [Fluxo de Dados Completo](#4-fluxo-de-dados-completo)
5. [Parser ISOP (Importacao de Dados)](#5-parser-isop-importacao-de-dados)
6. [Motor de Scheduling (NikufraEngine)](#6-motor-de-scheduling-nikufraengine)
7. [Motor MRP (Material Requirements Planning)](#7-motor-mrp)
8. [Motor de Intelligence (Analytics)](#8-motor-de-intelligence)
9. [Backend: Solver PLAN-MIN](#9-backend-solver-plan-min)
10. [Backend: Constraints (Restricoes)](#10-backend-constraints)
11. [Backend: Governance e PR Workflow](#11-backend-governance-e-pr-workflow)
12. [Paginas do Frontend (10 paginas)](#12-paginas-do-frontend)
13. [Stores e Gestao de Estado](#13-stores-e-gestao-de-estado)
14. [Sistema de Risco Unificado](#14-sistema-de-risco-unificado)
15. [Supply Chain e Prioridades](#15-supply-chain-e-prioridades)
16. [Optimizacao Monte Carlo](#16-optimizacao-monte-carlo)
17. [Scenario Lab (What-If)](#17-scenario-lab)
18. [Replan Workflow](#18-replan-workflow)
19. [API REST (Backend)](#19-api-rest-backend)
20. [Base de Dados](#20-base-de-dados)
21. [KPIs e Metricas](#21-kpis-e-metricas)
22. [Gantt Chart (Visualizacao)](#22-gantt-chart)
23. [Regras de Negocio](#23-regras-de-negocio)
24. [Stack Tecnologico](#24-stack-tecnologico)

---

## 1. VISAO GERAL

### O que e o ProdPlan PP1?

O ProdPlan PP1 e um sistema de planeamento de producao industrial para a fabrica Nikufra do grupo Incompol. O sistema recebe dados de encomendas (ficheiro ISOP Excel), processa-os atraves de um motor de scheduling com restricoes, e gera planos de producao optimizados para 6 maquinas de prensagem ao longo de um horizonte de 8 dias uteis.

### Problema que resolve

A fabrica Nikufra tem 6 prensas que produzem ~64 SKUs para 14 clientes, usando 44 ferramentas diferentes. O planeamento manual e complexo porque:

- Cada ferramenta so pode estar numa maquina de cada vez
- So ha 1 equipa de setup para toda a fabrica (max 1 setup simultaneo)
- Operacoes nao podem cruzar fronteiras de turno
- Operadores sao limitados por area (PG1/PG2) e por turno (X/Y)
- Algumas maquinas nao tem alternativas (PRM042 e critica)
- O mesmo SKU pode ter encomendas de multiplos clientes
- Stock, backlogs, e lotes economicos afectam a sequenciacao

### Modulos implementados

| Modulo | Estado | Descricao |
|--------|--------|-----------|
| **PLAN** | Activo | Scheduling, Gantt, KPIs, optimizacao, replan |
| **SUPPLY** | Activo | MRP Level 0, safety stock, ROP, accoes de supply |
| **Intelligence** | Activo | 10 dashboards analiticos |
| **Risk** | Activo | Mapa de risco unificado (capacidade, stock, restricoes) |
| **Scenarios** | Activo | Laboratorio de cenarios what-if |

### Modulos que NAO existem

OEE, QMS/Quality, MTN/Maintenance, Forecasting, DPP/Sustainability, Financial, Copilot com LLM.

---

## 2. ARQUITECTURA DO SISTEMA

### Visao de alto nivel

```
                    +-------------------+
                    |   Utilizador      |
                    |   (Browser)       |
                    +--------+----------+
                             |
                    +--------v----------+
                    |   React Frontend  |
                    |   (Vite + TS)     |
                    |                   |
                    | +---------------+ |
                    | | ISOP Parser   | |  <-- Upload XLSX
                    | +-------+-------+ |
                    |         |         |
                    | +-------v-------+ |
                    | | useDataStore  | |  <-- Zustand + localStorage
                    | +-------+-------+ |
                    |         |         |
                    | +-------v-------+ |
                    | |useScheduleData| |  <-- Hook central (cache module-level)
                    | +--+----+----+--+ |
                    |    |    |    |    |
                    | +--v-+ +v-+ +v--+|
                    | |Eng | |MRP| |Int||  <-- NikufraEngine, MRP, Intelligence
                    | +----+ +--+ +---+|
                    |         |         |
                    | +-------v-------+ |
                    | | 10 Paginas UI | |
                    | +---------------+ |
                    +-------------------+
                             |
                    +--------v----------+    (futuro / governance)
                    |  FastAPI Backend  |
                    |  (Python 3.11)    |
                    |                   |
                    | +---------------+ |
                    | | PLAN-MIN      | |  <-- Solver deterministico
                    | | Solver        | |
                    | +-------+-------+ |
                    |         |         |
                    | +-------v-------+ |
                    | | PostgreSQL    | |  <-- JSONB, audit, snapshots
                    | +---------------+ |
                    +-------------------+
```

### Principios arquitecturais

1. **Scheduling client-side** — O NikufraEngine corre no browser (2,955 linhas). O backend tem o solver PLAN-MIN mas o modo actual usa o motor frontend.

2. **Adapter Pattern** — O hook `useDataSource()` selecciona entre `MockDataSource` (dados locais) e `ApiClient` (backend). Actualmente usa MockDataSource.

3. **Dados 100% reais** — MANDATO ABSOLUTO: nenhum dado e fabricado. Tudo vem do ISOP real ou do fixture de dados mestres.

4. **Determinismo** — Mesmo input = mesmo schedule = mesmos KPIs. PRNG: mulberry32 com seed fixa (42).

5. **Cache module-level** — O `useScheduleData` calcula uma vez e partilha entre todas as paginas.

6. **Dark-only** — Interface exclusivamente dark theme, sem modo claro.

---

## 3. DADOS MESTRES DA FABRICA

### 3.1 Maquinas (6 prensas)

| Maquina | Area | N. Tools | Alternativas | Notas |
|---------|------|----------|-------------|-------|
| PRM019 | PG1 | 7 | PRM039, PRM043 | |
| PRM020 | PG1 | 3 | PRM039 | Baixa carga |
| PRM031 | PG2 | 7 | PRM039 | Alta carga (FAURECIA) |
| PRM039 | PG2 | 10 | PRM031, PRM043 | Maior variedade |
| PRM042 | PG2 | 6 | NENHUMA | CRITICA — sem alternativas |
| PRM043 | PG1 | 11 | PRM039, PRM031 | 3 tools sem alt |

**Areas**:
- **PG1**: PRM019, PRM020, PRM043 (3 maquinas)
- **PG2**: PRM031, PRM039, PRM042 (3 maquinas)

**PRM042 e a maquina mais critica**: se avariar, 6 tools e 11 SKUs ficam sem producao (sem alternativa).

### 3.2 Turnos

| Turno | Horario | Duracao |
|-------|---------|---------|
| X (manha) | 07:30 — 15:30 | 480 min |
| Y (tarde) | 15:30 — 24:00 | 510 min |
| OFF | 00:00 — 07:30 | Sem producao |
| Z (excepcional) | 00:00 — 07:30 | Activavel via flag |

- Timezone: Europe/Lisbon
- Capacidade diaria: 990 min (2 turnos)
- Meta OEE: 653 min (990 x 0.66)
- Operacoes NAO cruzam fronteiras de turno (15:30)

### 3.3 Ferramentas (44 tools)

Distribuidas por 6 maquinas:
- PRM019: 7 tools (BFP080, BFP082, BFP179, BFP181, BFP192, BFP197, VUL038)
- PRM020: 3 tools (MIC009, VUL031, VUL068)
- PRM031: 7 tools (BFP079, BFP083, BFP114, BFP162, BFP171, BFP183, BFP184)
- PRM039: 10 tools (BFP091, BFP092, BFP096, BFP100, BFP101, BFP110, BFP112, BFP178, BFP186, VUL127)
- PRM042: 6 tools (DYE025, EBR001, HAN004, JDE002, LEC002, VUL115) — TODAS sem alternativa
- PRM043: 11 tools (BFP125, BFP172, BFP187, BFP188, BFP195, BFP202, BFP204, HAN002, JTE001, JTE003, VUL111)

**Propriedades de cada tool**: setup time (0.5-1.5h), rate (120-3610 pcs/h), operadores (1 ou 2), lote economico, stock actual, SKUs produzidos.

**Relacao Tool -> SKU**: Uma tool pode produzir multiplos SKUs SEM setup adicional (18 tools produzem 2+ SKUs). Setup so quando MUDA de tool.

### 3.4 Operadores

14 tools requerem 2 operadores: BFP188, BFP195, EBR001, JDE002, LEC002, VUL038, VUL111, VUL115, VUL127.
Todos os outros requerem 1 operador.

Mao de obra por area por dia (valores reais do ISOP):

| Area | D0 | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
|------|----|----|----|----|----|----|----|----|
| PG1 | 2.6 | 0.4 | 4.1 | 2.0 | 0.3 | 2.5 | 0.1 | 3.2 |
| PG2 | 6.2 | 2.2 | 1.0 | 0.9 | 2.7 | 0.5 | 2.2 | 0.6 |

### 3.5 Clientes (14)

Principais: FAURECIA (210020), BOSCH-TERM (210099), FAUR-SIEGE (210204), JOAO DEUS (210112), E.L.M. (210194).

Mesmo SKU pode ter encomendas de multiplos clientes (ex: 1064169X100 tem encomendas de FAURECIA + FAUR-SIEGE + FAUREC.CZ = 31,200 pecas total).

**Regra**: Producao agrega por SKU. Entrega rastreia por cliente.

### 3.6 Horizonte temporal

- **Fixture**: 8 dias uteis (02/02 Seg a 11/02 Qua)
- **ISOP real**: Ate 35 datas (colunas Q-AY), parser extrai todas
- **Calendario completo**: 24 dias uteis, 14 nao-uteis (inclui feriado 17/02)

---

## 4. FLUXO DE DADOS COMPLETO

### 4.1 Pipeline fim-a-fim

```
1. UPLOAD
   Utilizador faz upload de ISOP XLSX (pagina Carregar Dados)
   OU sistema usa fixture nikufra_data.json (fallback automatico)

2. PARSING
   isopClientParser.ts:parseISOPFile()
     -> Encontra header row (scan linhas 0-15)
     -> Mapeia colunas por nome (auto-detect)
     -> Extrai datas e flags de dia util
     -> Parse cada linha de dados -> ParsedRow[]
     -> Agrupa por tool (SKUs compartilham tool)
     -> Calcula Trust Score (completude, qualidade, demand, consistencia)
     -> Output: NikufraData + LoadMeta

3. ENRIQUECIMENTO
   useDataStore.setNikufraData()
     -> resolveMasterSource() — carrega fixture como master
     -> mergeFromMaster() — enriquece daily com:
        - Setup times (se daily=0, usa master ou default 0.75h)
        - Maquinas alternativas (se daily vazio, usa master)
        - Rates (se daily=0, usa master)
        - Operadores (se daily=0, usa master)
        - M.O. (se daily vazio, usa master)
     -> Guarda NikufraData enriquecido + raw + timestamp em localStorage

4. SCHEDULING
   useScheduleData hook detecta mudanca em loadedAt (timestamp)
     -> Invalida cache (cacheVersion++)
     -> ds.getPlanState() via MockDataSource
        -> Mapeia SHORT -> LONG names (m->machine, t->tool, etc.)
     -> transformPlanState() — LONG -> SHORT interno (EngineData)
     -> computeMRP() — MRP Level 0
     -> computeSupplyPriority() — boost de prioridade para ops criticas
     -> autoRouteOverflow():
        -> scheduleBatch() [pass 1: EDD com user moves]
           -> Fase 1: delivery buckets por ferramenta por maquina
           -> Fase 2: scheduling com 4 constraints
        -> detectar overflow -> mover para alt machines (ate 3 iteracoes)
     -> Cache resultado

5. DERIVADOS (useMemo em cada pagina)
     -> capAnalysis() — utilizacao por maquina/dia
     -> scoreSchedule() — KPIs (OTD, tardiness, setups, etc.)
     -> validateSchedule() — violacoes de constraints
     -> auditCoverage() — auditoria de cobertura

6. CONSUMO
   Todas as 10 paginas consomem via useScheduleData()
   Cada pagina computa derivados especificos (ex: MRP tabs, Risk grid, etc.)
```

### 4.2 Formato NikufraData (estrutura central)

```typescript
interface NikufraData {
  dates: string[]           // ["02/02", "03/02", ...] — horizonte temporal
  days_label: string[]      // ["Seg", "Ter", ...] — nomes dos dias
  mo: {                     // Mao de obra por area
    PG1: number[]           //   capacidade diaria PG1
    PG2: number[]           //   capacidade diaria PG2
  }
  machines: Array<{
    id: string              // "PRM019"
    area: string            // "PG1" ou "PG2"
    man: number[]           // MAN minutos por dia (8 valores)
    status?: 'running'|'down'
  }>
  tools: Array<{
    id: string              // "BFP080"
    m: string               // maquina primaria
    alt: string             // maquina alternativa ('-' se nenhuma)
    s: number               // setup em horas
    pH: number              // pecas por hora
    op: number              // operadores (1 ou 2)
    skus: string[]          // SKUs produzidos
    nm: string[]            // nomes dos items
    lt: number              // lote economico
    stk: number             // stock actual
  }>
  operations: Array<{
    id: string              // "OP01"
    m: string               // maquina
    t: string               // tool
    sku: string             // SKU
    nm: string              // nome
    pH: number              // pecas/hora
    atr: number             // backlog (atraso)
    d: number[]             // demand diaria (8 valores)
    s: number               // setup horas
    op: number              // operadores
    cl?: string             // codigo cliente
    clNm?: string           // nome cliente
    pa?: string             // SKU pai (produto acabado)
  }>
  workday_flags?: boolean[] // true=dia util, false=fim-de-semana/feriado
}
```

### 4.3 Mapeamento de nomes SHORT -> LONG

O sistema usa nomes curtos internamente para compactacao:

| SHORT | LONG | Significado |
|-------|------|-------------|
| m | machine | Maquina |
| t | tool | Ferramenta |
| s / sH | setup_hours | Tempo de setup (horas) |
| pH | pcs_per_hour | Taxa de producao |
| op | operators | Operadores necessarios |
| alt | alt_machine | Maquina alternativa |
| d | daily_qty | Demand diaria (array) |
| atr | atraso / backlog | Atraso acumulado |
| lt | lot_economic_qty | Lote economico |
| stk | stock | Stock actual |
| nm | name | Nome do item |
| cl | customer_code | Codigo do cliente |
| clNm | customer_name | Nome do cliente |
| pa | parent_sku | SKU pai |
| qe | qtd_exp | Quantidade expedida |

---

## 5. PARSER ISOP (Importacao de Dados)

### 5.1 Fonte de dados

O ISOP (Informacao de Sistema de Operacoes de Producao) e um ficheiro Excel (.xlsx) gerado pelo ERP da Nikufra. Contem:

- **Sheet**: "Planilha1"
- **~81 linhas** de dados (rows 8-88)
- **Row 5**: Flags de dia util (1=util, 0=nao-util)
- **Row 7**: Headers das colunas
- **Colunas A-M**: Dados mestres (cliente, SKU, maquina, tool, setup, rate, etc.)
- **Colunas N-P**: Stock-A, WIP, ATRASO
- **Colunas Q-AY**: Quantidades por data (ate 35 datas)

### 5.2 Semantica das colunas de data

As colunas de data contem **NET_POSITION_AFTER_ALL_NEEDS_BY_DATE**:
- Valor **positivo** = stock disponivel apos necessidades do dia (nao precisa producao)
- Valor **negativo** = deficit — precisa producao
- Formula de conversao: `demand = max(0, -net_position)`

### 5.3 Processo de parsing (isopClientParser.ts, 737 linhas)

```
1. Ler workbook com SheetJS (suporta cellDates e cellStyles)
2. Encontrar sheet "Planilha1"
3. Auto-detectar header row (scan linhas 0-15 para "Referencia Artigo" + "Maquina")
4. Mapear colunas por nome (tolerante a acentos e variantes)
5. Detectar colunas de data (apos ultimo campo de texto)
6. Parse working day flags (row dedicada com 0/1 ou inferir de dia da semana)
7. Para cada linha de dados:
   - Extrair SKU, maquina, tool, setup, rate, operadores
   - Converter net_position -> demand: max(0, -value)
   - Detectar celulas vermelhas (maquina/tool inoperacional)
   - Detectar texto "inact/down/avaria" em colunas de estado
8. Agrupar tools (1 tool = N SKUs, tomar max stock/WIP)
9. Gerar operations (1 por linha ISOP)
10. Calcular Trust Score:
    - 40% completude (todos os campos presentes)
    - 30% qualidade (rate>0, setup>=0, operadores>=1)
    - 20% cobertura de demand (ops com pelo menos 1 dia de demand)
    - 10% consistencia (tools com maquina valida)
```

### 5.4 Enriquecimento com dados mestres

Apos o parsing, o `useDataStore` enriquece os dados com o fixture (nikufra_data.json):

```
Prioridade de merge: valor daily > valor master > DEFAULT (0.75h setup)

Para cada ferramenta:
  setup:       daily > 0 ? daily : master > 0 ? master : 0.75h
  alt_machine: daily != '-' ? daily : master
  rate:        daily > 0 ? daily : master
  operadores:  daily > 0 ? daily : master
  lote_econ:   daily > 0 ? daily : master

Para M.O.: se daily vazio (tudo zeros), usa master
```

### 5.5 Deteccao de estado inoperacional

O parser detecta maquinas/tools inoperacionais de 2 formas:
1. **Texto**: Coluna "Estado Maq"/"Estado Ferr" com regex `/inact|down|avaria|parad|inoper/`
2. **Cor**: Celulas com fundo vermelho (R>180, G<100, B<100) na coluna maquina/ferramenta

---

## 6. MOTOR DE SCHEDULING (NikufraEngine)

### 6.1 Visao geral

O NikufraEngine (`features/planning/NikufraEngine.tsx`, ~3,386 linhas) e o UNICO driver de scheduling do frontend. E um motor deterministico baseado em EDD (Earliest Due Date) com 4 constraints, shift-aware, com suporte a overflow para maquinas alternativas e optimizacao Monte Carlo.

### 6.2 Constantes

| Constante | Valor | Significado |
|-----------|-------|-------------|
| S0 | 450 min (07:30) | Inicio turno X |
| T1 | 930 min (15:30) | Fronteira turnos X/Y |
| S1 | 1440 min (24:00) | Fim turno Y |
| S2 | 1890 min (07:30+1) | Fim turno Z excepcional |
| OEE | 0.66 | Eficiencia global |
| DAY_CAP | 990 min | Capacidade 2 turnos |
| SCAP | 653 min | Meta ajustada OEE |

### 6.3 As 4 Constraints

#### Constraint 1: SetupCrew
- **Regra**: Maximo 1 setup simultaneo em TODA a fabrica
- **Capacidade**: 1 (recurso virtual SETUPCREW)
- **Implementacao**: Array de {start, end, machineId}. `findNextAvailable()` itera colisoes e empurra slot para apos ultimo conflito.

#### Constraint 2: CalcoTimeline
- **Regra**: Duas maquinas NAO podem usar o mesmo calco (die/molde) em simultaneo
- **Capacidade**: 1 por codigo calco
- **Implementacao**: Record indexado por calcoCode, algoritmo identico ao SetupCrew

#### Constraint 3: ToolTimeline
- **Regra**: Mesma ferramenta fisica NAO pode estar em 2 maquinas em simultaneo
- **Capacidade**: 1 instancia por ferramenta (default)
- **Implementacao**: Record indexado por toolId, conta machineIds em conflito

#### Constraint 4: OperatorPool
- **Regra**: Operadores por turno por area (PG1/PG2) nao excedem capacidade
- **Modelo**: Team + Pool (equipa fixa + operadores emprestados)
- **Implementacao**: Rastreia pico concorrente por maquina/turno e soma por area
- **Excepcao**: Turno Z ignora check de operadores

### 6.4 Algoritmo principal: scheduleBatch()

#### Fase 1: Construir Tool Groups por Maquina

1. **Delivery Buckets**: Em vez de somar TODA a demand, divide em buckets dimensionados pelo lote economico, cada um com EDD proprio.
   ```
   prodQty = ceil(accQty / lt) * lt    // arredonda para lote economico
   prodMin = (prodQty / pH) * 60       // tempo de producao em minutos
   ```

2. **Backlog** (atr > 0): Cria bucket com EDD=0 (prioridade imediata)

3. **Demand diaria**: Split em delivery buckets com janela de 5 dias uteis

4. **Ordenacao por regra de dispatch**:
   - Prioridade primaria: `supplyBoost` (3=stockout 1 dia, 2=stockout, 1=coverage<3d, 0=normal)
   - Depois: EDD ascendente (desempate por prodMin descendente)
   - Alternativas: CR (Critical Ratio), WSPT, SPT

5. **Tool Merging (G1-G5)**: Puxa para a frente grupos com mesma tool se gap de EDD <= 5 dias (evita setups redundantes)

#### Fase 2: Scheduling por Maquina

Para cada maquina, processa grupos de ferramentas em ordem:

```
cDay = primeiro dia util
cMin = S0 (inicio turno X)
lastTool = null

Para cada grupo de ferramenta:
  1. SETUP (se toolId != lastTool):
     - Verificar se cabe no turno
     - Pedir slot ao SetupCrew (max 6 tentativas)
     - Verificar ToolTimeline
     - Se falha: todos SKUs do grupo -> overflow
     - Setup e CONTIGUO (nao se pode dividir)

  2. PRODUCAO (para cada SKU do grupo):
     rem = prodMin
     while (rem > 0):
       - advance() se cMin >= dayEnd
       - avail = shEnd - cMin
       - Check operadores (skip turno Z)
       - Check calco (tempo absoluto)
       - Check tool uniqueness
       - Criar block: { startMin, endMin, qty, shift, ... }
       - rem -= alloc; cMin += alloc
```

**Split entre turnos**: Se operacao precisa 500min e turno X tem 300min:
- Block 1: 300min no turno X (shift='X')
- Block 2: 200min no turno Y (shift='Y')
- Setup so conta uma vez (no primeiro block)
- Duas barras separadas no Gantt

### 6.5 autoRouteOverflow()

Move iterativamente operacoes em overflow para maquinas alternativas.

```
MAX_ITER = 3        // maximo iteracoes
MAX_AUTO_MOVES = 16 // maximo movimentos automaticos
ALT_UTIL_THRESHOLD = 0.95  // alternativa deve ter < 95% utilizacao

1. Schedule greedy com user moves
2. Se zero overflow: retorna
3. Loop (ate 3x):
   - Calcular capAnalysis()
   - Encontrar blocks overflow com alternativas
   - Para cada: verificar utilizacao da alt
   - Re-agendar com user moves + auto moves
   - Se melhora: aceitar. Senao: undo e break.
```

### 6.6 validateSchedule()

4 verificacoes pos-schedule:

| Check | Severidade | Descricao |
|-------|-----------|-----------|
| Tool Uniqueness | critical | Mesma ferramenta em 2 maquinas |
| Setup Crew Overlaps | high | 2 setups simultaneos |
| Machine Overcapacity | high/medium | >DAY_CAP=high; >SCAP=medium |
| Deadline Misses | high/medium | produced < demand * 0.95 |

### 6.7 Tipos de output

**Block** (unidade de producao agendada):
```typescript
{
  opId, toolId, sku, nm, machineId, origM, dayIdx,
  startMin, endMin, setupS, setupE,
  qty, prodMin, setupMin, operators,
  blocked, reason, moved, hasAlt, altM,
  type: 'ok' | 'blocked' | 'overflow',
  shift: 'X' | 'Y' | 'Z'
}
```

---

## 7. MOTOR MRP

### 7.1 Visao geral

O MRP (Material Requirements Planning) Level 0 (`domain/mrp/mrp-engine.ts`, 708 linhas) computa necessidades de material, planos de ordens de producao, capacidade bruta (RCCP), e accoes de supply chain.

### 7.2 Funcoes principais

#### computeMRP(engine) -> MRPResult

Calculo completo de MRP:
1. Agrupa operacoes por tool
2. Para cada tool: netting de inventario
   - Gross requirement = soma demand diaria
   - Backlog deduzido do stock inicial
   - Dia a dia: projected = stock_anterior - demand
   - Se projected < 0: net requirement, lot sizing (lote economico)
   - Planned order release: max(0, dia - lead_time)
3. RCCP por maquina/dia: setup + producao = utilizacao %

#### computeROP(mrp, engine, serviceLevel) -> ROPSummary

Safety Stock e Reorder Point:
- Demand media e desvio padrao
- Safety Stock: SS = Z-score x sigma x sqrt(lead_time)
- ROP = demand x lead_time + SS
- Classificacao ABC (volume) e XYZ (variabilidade)

#### computeCTP(input, mrp, engine) -> CTPResult

Capable-to-Promise (viabilidade de encomenda):
- Input: tool, quantidade, dia alvo
- Output: viavel? dia mais cedo possivel? confianca?
- Logica: Calcula minutos necessarios, verifica RCCP para capacidade

#### computeWhatIf(engine, mutations, baseline) -> WhatIfResult

Cenarios MRP:
- Mutacoes: rush_order, demand_factor, machine_down
- Clona engine, aplica mutacoes, recomputa MRP
- Output: deltas por tool (stockout, coverage, planned qty)

#### computeActionMessages(mrp, engine) -> ActionMessagesSummary

Recomendacoes de supply:
- **launch_por**: Stockout — lancar ordem de producao
- **advance_prod**: Cobertura baixa — antecipar producao
- **transfer_tool**: Sobrecarga — mover tool para alt
- **no_alt_risk**: Fonte unica — alertar dependencia

Severidade: `score = tipo*30 + cobertura*25 + quantidade*25 + alt*20`
Mapeamento: >=70=critical, >=50=high, >=30=medium, <30=low

#### computeCoverageMatrix(mrp, engine) -> CoverageMatrixResult

Matriz visual Days-of-Supply por tool/dia:
- DOS = projected_stock / avg_daily_demand
- Bandas: red (<1), amber (1-3), green (3-7), blue (>=7)

---

## 8. MOTOR DE INTELLIGENCE

### 8.1 Visao geral

O motor de analytics (`features/intelligence/intel-compute.ts`, 1,091 linhas) calcula 10 datasets analiticos a partir dos dados reais do ISOP e do schedule. Todos os valores sao derivados — zero fabricacao.

### 8.2 Os 10 datasets

#### 1. Demand Heatmap
- **Grid**: 6 maquinas x dias uteis
- **Calculo**: Para cada SKU/dia, converte deficit em minutos de producao (qty/rate*60)
- **Output**: % utilizacao por maquina/dia com contagem de SKUs

#### 2. Client Delivery Risk
- **Grid**: Clientes x SKUs x status
- **Calculo**: Detecta primeiro dia de deficit por SKU/cliente, classifica: late (<=0d), tight (<=5d), ok (>5d)
- **Output**: Score de risco por cliente com contagem de SKUs em risco

#### 3. Bottleneck Cascade
- **Calculo**: Para cada maquina, identifica pico de utilizacao e overflow. Encontra paths de alivio (tools com alternativa -> minutos salvos)
- **Output**: Nodos ordenados por peak%, com caminhos de rebalanceamento

#### 4. Setup Crew Timeline
- **Calculo**: Simula scheduling global de setups (max 1 simultaneo) ao longo de 8 dias
- **Output**: SetupSlot[] com maquina, tool, dia, hora, turno

#### 5. Cross-Client SKU Aggregation
- **Calculo**: Agrupa por SKU, identifica os com 2+ clientes, soma demand por cliente
- **Output**: SKUs multi-cliente com breakdown de demand

#### 6. Tool Grouping Optimizer
- **Calculo**: Compara sequencia actual vs optimal (agrupada por familia), conta setups evitados
- **Output**: Minutos salvos por maquina com sequencia optimizada

#### 7. Machine Alternative Network
- **Grafo**: Nodos = maquinas, edges = tools com alternativa
- **Layout**: Force-directed (200 iteracoes de repulsao/atraccao)
- **Output**: Topologia de flexibilidade entre maquinas

#### 8. Capacity Horizon
- **Calculo**: Para cada data do calendario, soma minutos necessarios por maquina
- **Output**: Barras de capacidade com total por dia

#### 9. Urgency Matrix
- **Calculo**: Para cada SKU, dias ate deficit + magnitude + horas de recuperacao
- **Output**: Ranking de urgencia (o que agendar primeiro)

#### 10. Explain Trace
- **Calculo**: Para cada SKU com demand, 6 passos de explicacao:
  1. Qual tool? 2. Qual maquina primaria? 3. Alternativas? 4. Setup time OK? 5. Capacidade OK? 6. Operadores OK?
- **Output**: Cadeia de raciocinio para transparencia

---

## 9. BACKEND: SOLVER PLAN-MIN

### 9.1 Algoritmo

O PLAN-MIN (`backend/src/domain/solver/plan_min.py`, 1,037 linhas) e um solver deterministico heuristico:

```
solve_plan_min(snapshot, plan_params, calendar):
  1. derive_workorders(snapshot)     -> WorkOrders com quantidades e due dates
  2. assign_machines(workorders)     -> Maquina primaria ou alternativa
  3. sequence_by_edd(workorders)     -> Ordenar por due date (deterministico)
  4. generate_operations(sequenced)  -> Scheduling detalhado com constraints
  5. calculate_kpis(operations)      -> Tardiness, setup count, violacoes
  6. calculate_plan_hash(plan)       -> SHA-256 deterministico
```

### 9.2 Funcao objectivo

```
Z = 100 * tardiness
  + 10 * setup_count
  + 1  * setup_time
  + 10 * setup_balance_by_shift
  + 5  * churn
  + 50 * overtime
  + 5  * coil_fragmentation
```

Pesos configuraveis via `plan_params.objective_weights`.

### 9.3 KPIs do solver

```
tardiness_total_days    — Soma de dias de atraso (T_o = max(C_o - d_o, 0))
setup_count_total       — Numero total de setups
setup_balance_penalty   — max(shift_counts) - min(shift_counts)
overtime_hours          — Horas fora dos turnos
churn_ops_moved         — Operacoes movidas vs plano anterior
```

### 9.4 ExplainTrace

Cada plano inclui rastreio de decisoes:
- Por workorder: maquina seleccionada, alternativas consideradas, razao
- Por operacao: constraints activas, razoes de atraso
- Por objectivo: contribuicao de cada componente para custo total

---

## 10. BACKEND: CONSTRAINTS

### 10.1 SetupCrew (`setup_crew.py`, 152 linhas)

- **Recurso**: SETUPCREW (capacidade=1)
- **Regra**: So 1 setup simultaneo em TODAS as maquinas
- **Implementacao**: Timeline com intervalos reservados, `find_next_available_slot()` para encontrar primeiro slot livre dentro do turno

### 10.2 Operator Capacity (`operator_capacity.py`, 208 linhas)

- **Modelo**: Bucket por turno (v1)
- **Chave**: (data, shift_code, pool_code)
- **Regra**: Soma de operadores por turno nao excede pool da area
- **Fallback**: Se capacidade indefinida, assume infinito (modo prototipo)

### 10.3 Calco (`calco_constraints.py`, 102 linhas)

- **Capacidade**: 1 por calco
- **Regra**: Mesmo calco nao pode ser usado em 2 maquinas ao mesmo tempo
- **Implementacao**: Dict de timelines por calco_id

### 10.4 Material (`material_constraints.py`, 123 linhas)

- **Regra**: Producao requer materiais (consumo = taxa * qty)
- **Disponibilidade**: stock (lotes) + chegadas programadas
- **Blocking**: Se insuficiente, operacao marcada MATERIAL_HOLD

### 10.5 Tool Uniqueness (implementado inline no solver)

- **Capacidade**: 1 instancia por ferramenta
- **Regra**: Ferramenta fisica nao pode estar em 2 maquinas simultaneamente

---

## 11. BACKEND: GOVERNANCE E PR WORKFLOW

### 11.1 Lifecycle de PR

```
DRAFT -> OPEN -> APPROVED -> MERGED
                    |            |
                REJECTED    ROLLED_BACK
```

**Regras**:
1. Autor cria PR com baseline_plan_id + candidate_plan_id
2. Minimo 1 aprovador (SoD: aprovador != autor)
3. TrustIndex do snapshot deve atingir threshold
4. Merge promove plano de CANDIDATE para OFFICIAL
5. Todas transicoes sao auditadas

### 11.2 TrustIndex (Qualidade de Dados)

Formula: `trust = 0.30*completude + 0.25*qualidade + 0.20*linhagem + 0.15*freshness + 0.10*consistencia`

| Score | Status | Accao |
|-------|--------|-------|
| < 0.70 | QUARANTINE | Bloqueia commit, modo suggestion-only |
| 0.70-0.85 | SEMI_AUTO | Permite com aprovacao obrigatoria |
| >= 0.85 | AUTO_ELIGIBLE | Automacao total permitida |

### 11.3 Snapshots e Planos

- **Snapshot**: Import imutavel do ISOP. Lifecycle: CREATED -> SEALED. Hash SHA-256.
- **Plan**: Output do solver. Lifecycle: CANDIDATE -> OFFICIAL (via PR merge). Hash deterministico.
- **WorkOrder**: Derivado de snapshot demand. ID: sha256(sku:date)[:16]

### 11.4 Idempotency e Correlation

- Todos os requests mutantes requerem header `Idempotency-Key` (UUID v4)
- Todos os requests incluem `X-Correlation-ID` para tracing distribuido

### 11.5 Audit Log

- Append-only, 38 tipos de accao
- Campos: actor, action, entity_type, entity_id, before/after (JSONB), correlation_id
- Indexado por timestamp, actor, action, entity_type

---

## 12. PAGINAS DO FRONTEND (10 paginas)

### 12.1 Dashboard (`/`)

**Proposito**: Visao geral da producao e KPIs
- **PulseStrip**: Indicadores de estado em tempo real
- **Heatmap (Maquina x Dia)**: Grid de utilizacao colorido (% capacidade)
- **Operator Demand Strip**: Grafico de barras empilhadas PG1/PG2 por dia
- **Top Backlogs**: Top 10 operacoes com backlog pendente

### 12.2 Fabrica (`/fabrica`)

**Proposito**: Monitorizacao de maquinas e capacidade
- **Status Banner**: Alerta colorido para sobrecarga
- **Machine Cards**: 6 cards com sparklines, utilizacao %, pecas produzidas
- **Load Heatmap**: Matriz detalhada maquina x dia (minutos, setup, utilizacao)
- **Operator Demand Table**: PG1/PG2 demand vs capacidade por dia

### 12.3 Risco (`/risk`)

**Proposito**: Mapa de risco unificado em 3 dimensoes
- **Filter Pills**: Capacidade, Stock, Restricoes
- **Risk Grid (8 dias)**: Grelha com celulas coloridas (critical/high/medium/ok)
  - MAQUINAS: Risco de capacidade por maquina
  - STOCK: Risco de stockout por tool
  - RESTRICOES: Violacoes de constraints

### 12.4 Pecas (`/pecas`)

**Proposito**: Tracking de SKUs, inventario e cobertura
- **Summary Cards**: Total SKUs, demand 8 dias, stock total, backlog total
- **Filtros**: Maquina, "Apenas Backlog"
- **Tabela SKU**: Ordenavel por SKU, tool, maquina, backlog, demand, stock, cobertura %
- Cores: red=<95% cobertura, amber=com backlog

### 12.5 MRP (`/mrp`)

**Proposito**: Material Requirements Planning com 8 tabs
1. **Tabela MRP**: Netting por tool (GR, proj. avail., POR) por dia
2. **RCCP**: Heatmap de capacidade bruta (maquina x dia)
3. **Resumo**: KPI cards (tools, backlog, stockout, POR total, bottleneck)
4. **Cobertura**: Matriz de Days-of-Supply por tool/dia
5. **Accoes**: Recomendacoes de supply (lancar POR, antecipar, transferir)
6. **SS/ROP**: Safety stock, reorder point, classificacao ABC/XYZ
7. **CTP**: Capable-to-Promise (viabilidade de encomenda)
8. **What-If**: Cenarios MRP (rush order, demand change, machine down)

### 12.6 Supply (`/supply`)

**Proposito**: Monitorizacao de risco da cadeia de fornecimento
- **KPI Cards**: Em risco, stockouts, cobertura media, accoes criticas
- **Tabela expandivel**: Tool, produto, maquina, stock, cobertura, stockout, delivery
- **Mini charts SVG**: Projecao de stock com linhas ROP/SS
- **Accoes**: Cards com severidade, impacto, accao sugerida

Classificacao de risco:
- Critical: stockout <= 1 dia OU (stockout + sobrecarga)
- High: stockout detectado
- Medium: stock < ROP OU cobertura < 3 dias
- OK: sem riscos

### 12.7 Planning (`/planning`)

**Proposito**: Interface principal do motor de scheduling
- **NikufraEngine** completo: Gantt chart interactivo, replan, validacao, optimizacao
- **Gantt Chart**: Eixo temporal 08:00-24:00, barras de producao coloridas por tool, barras de setup hachuradas
- **OpDetailPanel**: Painel lateral com detalhes da operacao seleccionada
- **ValidationPanel**: Violacoes de constraints com accoes sugeridas

### 12.8 Cenarios (`/scenarios`)

**Proposito**: Laboratorio de cenarios what-if
- **VersionSidebar**: Historico de planos, gerar novos cenarios
- **KPICompare**: Comparacao lado-a-lado de KPIs
- **MiniGantt**: Gantt read-only com highlighting de diffs
- **Diff Summary**: Operacoes adicionadas/removidas/movidas

### 12.9 Intelligence (`/intelligence`)

**Proposito**: Analytics avancados de producao
- **10 tabs**: Demand Heatmap, Capacity Horizon, Urgency Matrix, Client Risk, Cross-Client SKU, Bottleneck Cascade, Setup Crew Timeline, Tool Grouping, Machine Network, Explain Trace

### 12.10 Carregar Dados (`/definicoes/dados`)

**Proposito**: Import de ISOP e configuracao do sistema
- **Upload ISOP**: Drag-and-drop ou file picker
- **Preview**: Resumo do parse (linhas, maquinas, tools, SKUs, trust score)
- **Seccao 1 — Turnos**: Horarios dos turnos, OEE
- **Seccao 2 — Regras**: Dispatch rule (EDD/CR/WSPT/SPT), bucket window, setup default
- **Seccao 3 — Perfil**: 4 perfis de optimizacao + 7 sliders de pesos
- **Seccao 4 — Operadores**: Estrategia de M.O. (nominal/ciclico/custom)
- **Seccao 5 — Overflow**: Thresholds para routing automatico
- **Seccao 6 — MRP/Supply**: Service level, thresholds ABC/XYZ

---

## 13. STORES E GESTAO DE ESTADO

### 13.1 Stores (Zustand)

| Store | Ficheiro | Persistencia | Proposito |
|-------|----------|-------------|-----------|
| useDataStore | stores/useDataStore.ts | localStorage | Dados ISOP uploaded + merge com fixture |
| useSettingsStore | stores/useSettingsStore.ts | localStorage | Configuracoes do engine (turnos, pesos, dispatch rule) |
| useReplanStore | stores/useReplanStore.ts | Memoria | Eventos de replan, zonas de bloqueio |
| usePlanVersionStore | stores/usePlanVersionStore.ts | Memoria | Versoes de plano, diffs |
| useScenarioLabStore | stores/useScenarioLabStore.ts | Memoria | Estado efemero do Scenario Lab |
| useToastStore | stores/useToastStore.ts | Memoria | Notificacoes toast |
| useUIStore | stores/useUIStore.ts | Memoria | UI partilhada (command palette, focus strip, context panel) |

### 13.2 useScheduleData (Hook central)

O hook `useScheduleData` e o ponto central de dados para todas as paginas:

```typescript
interface ScheduleData {
  engine: EngineData | null     // Dados transformados do ISOP
  blocks: Block[]               // Operacoes agendadas
  autoMoves: MoveAction[]       // Movimentos automaticos (overflow)
  cap: Record<string, DayLoad[]> // Utilizacao por maquina/dia
  metrics: OptResult | null     // KPIs (OTD, tardiness, setups, etc.)
  validation: ValidationReport  // Violacoes de constraints
  coverageAudit: CoverageAudit  // Auditoria de cobertura
  mrp: MRPResult | null         // Resultado MRP
  loading: boolean
  error: string | null
}
```

**Cache module-level**: Calcula uma vez, partilha entre todos os consumers. Invalida quando:
- ISOP muda (loadedAt timestamp)
- Settings mudam (settingsHash)
- Replan acontece (invalidateScheduleCache())

---

## 14. SISTEMA DE RISCO UNIFICADO

### 14.1 Tres dimensoes

O `riskGrid.ts` agrega 3 dimensoes de risco numa grelha de 8 dias:

#### Dimensao 1: Capacidade (Maquinas)
- 1 row por maquina (6 total)
- Utilizacao = (prodMin + setupMin) / DAY_CAP
- critical > 100%, high > 95%, medium > 85%, ok < 85%

#### Dimensao 2: Stock (Tools)
- 1 row por tool COM risco
- projected < 0: critical (stockout)
- 0 <= projected < SS: high
- SS <= projected < ROP: medium
- projected >= ROP: ok

#### Dimensao 3: Restricoes (Constraints)
- 1 row por maquina COM violacoes
- Map violacao.severity -> nivel de risco

### 14.2 Output

```typescript
interface RiskGridData {
  rows: RiskRow[]    // capacity + stock + constraint rows
  dates: string[]    // 8 datas
  summary: { criticalCount, highCount, mediumCount }
}
```

---

## 15. SUPPLY CHAIN E PRIORIDADES

### 15.1 Supply Priority (Feedback loop MRP -> Scheduler)

O `supplyPriority.ts` fecha o ciclo: MRP detecta risco -> boost de prioridade no scheduler.

| Boost | Condicao | Razao |
|-------|----------|-------|
| 3 (critical) | stockout <= 1 dia | "Rutura iminente" |
| 2 (high) | stockout > 1 dia | "Rutura prevista" |
| 1 (medium) | coverage < 3 dias E demand > 0 | "Cobertura baixa" |
| 0 (normal) | sem risco | - |

Usado como prioridade primaria no `groupComparator` do `scheduleBatch()`.

### 15.2 SupplyMonitor

Dashboard de supply com:
- Classificacao de risco por tool
- Accoes recomendadas com severidade
- Mini charts de projecao de stock
- Indicadores ROP/SS por tool

---

## 16. OPTIMIZACAO MONTE CARLO

### 16.1 Frontend: runOptimization()

O NikufraEngine inclui optimizacao Monte Carlo (`linhas 1788-1876`):

**3 Vizinhancas (round-robin)**:
1. **SwapTardiness**: Maquina com mais atraso -> move ops com alt para maquina alt
2. **SetupReduction**: Desfaz um move (agrupamento natural pode ser melhor)
3. **LoadBalance**: Par over/underloaded na mesma area -> move op

**Pipeline**:
1. Baseline: Schedule com zero moves
2. Heuristicas alternativas: Tenta 4 regras (EDD, CR, WSPT, SPT)
3. Auto-Replan: genDecisions() para replan automatico
4. Melhoria iterativa: N iteracoes em batches de 25 (non-blocking com setTimeout)
5. Output: Top-K resultados deduplicated

**3 Perfis de objectivo**:
- **Equilibrado**: tardiness=100, setup_count=10, overflow=50
- **Entregar a Tempo**: tardiness=200, overflow=80, setup_count=5
- **Minimizar Setups**: setup_count=50, setup_balance=40, tardiness=30

### 16.2 Backend: VectorizedOptimizer

Monte Carlo com tensor 3D numpy (`domain/planning/monte_carlo.py`, 311 linhas):

**Tensor**: `(N_Sims, N_Machines, N_Days)` — sem loops Python sobre simulacoes

**Funcao de custo**: `J(s) = a*OTD - b*Setups - g*sigma(Load)`

**Performance**: N_Sims=1000, N_Ops=50 -> <100ms

---

## 17. SCENARIO LAB

### 17.1 Conceito

O Scenario Lab permite comparar planos de producao e explorar cenarios what-if.

### 17.2 Frontend

- **VersionSidebar**: Historico de versoes de plano
- **KPICompare**: Comparacao lado-a-lado (OTD, tardiness, setups, etc.)
- **MiniGantt**: Gantt read-only com diff highlighting
- **Optimization**: Via runOptimization() com perfil seleccionado

### 17.3 Backend: Sandbox Service

```
create_scenario(baseline_plan_id, patch, name)
  -> Cria registo de cenario (imutavel, nao altera baseline)

run_scenario(scenario_id, baseline_plan_id)
  -> apply_patch(snapshot, plan_params, patch)
  -> solve_plan_min(snapshot_patched)
  -> calculate_diff(baseline, candidate)
  -> Store ScenarioDiff

get_diff(scenario_id)
  -> kpi_deltas, moved_operations, churn%
```

**Patch types**:
- Snapshot: updates de capacidade de recursos
- Plan params: pesos de objectivo, freeze windows, locks

---

## 18. REPLAN WORKFLOW

### 18.1 Fluxo de alto nivel

```
1. Evento ocorre (MachineDown, OperatorAbsent, etc.)
2. Utilizador adiciona evento via UI
3. Evento guardado em useReplanStore
4. "Simulate Impact":
   a. Eventos enviados ao backend (POST /events)
   b. Cenario criado (POST /scenarios)
   c. Solver corre no cenario
   d. Diff calculado (baseline vs candidate)
   e. Preview carregado no store
5. GanttChart mostra overlay de preview
6. "Apply Plan":
   a. PR criado (baseline -> candidate)
   b. PR aprovado + merged
7. Gantt actualiza com novo plano oficial
```

### 18.2 genDecisions() — Replan automatico

Gera decisoes de replan para operacoes bloqueadas:
- Tracker de capacidade acumulada
- Ordena ops bloqueadas por severidade: stock-zero + alto-backlog primeiro
- **Tool down**: decisao de blocked
- **Machine down sem alt**: decisao de blocked com info de stock buffer
- **Machine down com alt**: scoring de candidatos para rerouting

---

## 19. API REST (Backend)

### 19.1 Endpoints principais

Todos prefixados com `/v1/`.

#### Snapshots
| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | /snapshots/import | Importar XLSX, criar snapshot |
| POST | /snapshots/{id}/seal | Selar snapshot (imutavel) |
| GET | /snapshots | Listar snapshots |
| GET | /snapshots/{id} | Obter por ID |

#### Plans
| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | /plan/run | Correr solver (sincrono) |
| POST | /plan/{id}/commit | Promover CANDIDATE -> OFFICIAL |
| GET | /plans | Listar planos |
| GET | /plans/{id} | Obter por ID |

#### Plan Jobs (Async)
| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | /plan-jobs/run | Correr solver (assincrono) |
| GET | /plan-jobs/jobs/{id} | Estado do job |
| DELETE | /plan-jobs/jobs/{id} | Cancelar job |

#### Scenarios
| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | /scenarios | Criar cenario |
| POST | /scenarios/{id}/run | Correr cenario |
| GET | /scenarios/{id} | Obter com diff |

#### PRs (Governance)
| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | /prs | Criar PR |
| POST | /prs/{id}/approve | Aprovar |
| POST | /prs/{id}/merge | Merge (CANDIDATE -> OFFICIAL) |
| POST | /prs/{id}/reject | Rejeitar |
| POST | /prs/{id}/rollback | Rollback |

#### Suggestions
| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | /suggestions | Criar sugestao de cenario |
| POST | /suggestions/{id}/accept | Aceitar |
| GET | /suggestions/{id}/impact | Analise de impacto |

#### Events
| Metodo | Path | Descricao |
|--------|------|-----------|
| POST | /events | Criar evento (machine_down, urgent_order, etc.) |
| GET | /events | Listar eventos |

#### Audit
| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | /audit | Listar (filtros: entity_type, action, actor, datas) |
| GET | /audit/correlation/{id} | Por correlation ID |
| GET | /audit/stats | Estatisticas |

#### Outros
| Metodo | Path | Descricao |
|--------|------|-----------|
| GET | /health | Health check |
| GET | /version | Versao API |
| GET | /metrics | Metricas Prometheus |
| GET | /explain/{plan_id} | ExplainTrace do plano |
| POST | /copilot/query | Query natural language (stub) |
| GET | /learning/policy | Politica bandit (Thompson Sampling) |

---

## 20. BASE DE DADOS

### 20.1 Tabelas principais

#### snapshots
| Coluna | Tipo | Notas |
|--------|------|-------|
| snapshot_id | UUID PK | |
| tenant_id | UUID | Multi-tenant |
| snapshot_hash | VARCHAR(64) | SHA-256, unico |
| series_semantics | ENUM | DEMAND_QTY_BY_DATE, etc. |
| trust_index_overall | NUMERIC(3,2) | 0.00 a 1.00 |
| sealed_at | TIMESTAMP | NULL = nao selado |
| snapshot_json | JSONB | Snapshot completo |

#### plans
| Coluna | Tipo | Notas |
|--------|------|-------|
| plan_id | UUID PK | |
| snapshot_id | UUID FK | |
| plan_hash | VARCHAR(64) | Deterministico |
| status | ENUM | CANDIDATE, OFFICIAL |
| plan_params | JSONB | Parametros do solver |
| plan_json | JSONB | Plano completo |
| kpi_pack | JSONB | Resultados KPI |
| explain_trace | JSONB | Explicacoes |

#### prs
| Coluna | Tipo | Notas |
|--------|------|-------|
| pr_id | UUID PK | |
| status | ENUM | DRAFT/OPEN/APPROVED/MERGED/REJECTED/ROLLED_BACK |
| author | VARCHAR(255) | |
| baseline_plan_id | UUID FK | |
| candidate_plan_id | UUID FK | |

#### audit_log
| Coluna | Tipo | Notas |
|--------|------|-------|
| audit_id | UUID PK | |
| timestamp | TIMESTAMP | Indexado |
| actor | VARCHAR(255) | |
| action | VARCHAR(100) | 38 tipos |
| correlation_id | UUID | |
| entity_type | VARCHAR(50) | |
| before, after | JSONB | Snapshots de estado |

#### Outras tabelas
- scenarios, scenario_runs, scenario_diffs
- suggestions, impact_cases, impact_results
- learning_policies, impact_estimates
- integration_outbox (PENDING -> PROCESSING -> DELIVERED -> DLQ)
- operator_pools, materials, material_lots, material_arrivals
- calcos, calendars, shift_templates
- run_events

---

## 21. KPIs E METRICAS

### 21.1 KPIs do Schedule (scoreSchedule)

| KPI | Calculo | Meta |
|-----|---------|------|
| OTD (producao) | 100 - (totalDemand - produced) / totalDemand * 100 | 100% |
| OTD-Delivery | Cumulativo: on-time se cumProd >= cumDemand * 0.95 | 100% |
| Setup Count | Blocks com setupS != null | Minimizar |
| Setup Total Min | Soma (setupE - setupS) | Minimizar |
| Setup Balance | abs(setupsShiftX - setupsShiftY) | 0 |
| Tardiness | sum(overflowMin) / 1440 (dias) | 0 |
| Cap Utilization | Media de (prod + setup) / DAY_CAP | 60-85% |
| Peak Operators | Maximo por dia | <= pool |
| Churn | sum(abs(startMin - baseStartMin)) / 60 | Minimizar |

### 21.2 Formula de Score (minimizacao)

```
score = -(
  100.0 * tardinessDays
  + 10.0 * setupCount
  +  1.0 * setupMin
  + 30.0 * setupBalance
  +  5.0 * churnNorm
  + 50.0 * overflows
  +  5.0 * belowMinBatchCount
)
```

### 21.3 KPIs do MRP

| KPI | Descricao |
|-----|-----------|
| Tools with stockout | N. de tools com dia de stockout |
| Avg coverage (days) | Media de dias de cobertura |
| Total POR qty | Soma de planned order releases |
| Bottleneck machine | Maquina com peak utilizacao mais alta |
| Critical actions | Accoes de severidade critical |

---

## 22. GANTT CHART

### 22.1 Layout

- **Sidebar esquerda**: 100px — label maquina (id, area, ops count, % utilizacao)
- **Area principal**: Eixo temporal de 08:00 a 24:00
- **Pixels por minuto**: `ppm = 1.2 * zoom`
- **Largura total**: 990 * 1.2 = 1188px a zoom=1

### 22.2 Eixo temporal

- Horas de 8 a 24 como linhas verticais de grelha
- Turno X: fundo verde (0 a (T1-S0)*ppm)
- Turno Y: fundo azul
- Fronteira T1: linha tracejada amarela com label "T.Y"

### 22.3 Barras visuais

- **Setup**: Hatching diagonal, cantos arredondados esquerda, label "SET"
- **Producao**: Cor indexada pela ferramenta (16 cores), cantos arredondados direita
- **Selected**: Borda teal
- **Moved**: Borda teal

### 22.4 Posicionamento

| Propriedade | Calculo |
|-------------|---------|
| Y position | 5 + blockIndex * 22 (22px por block) |
| Row height | max(44, numBlocks * 22 + 10) |
| Setup X | left = (setupS - S0) * ppm |
| Production X | left = (startMin - S0) * ppm |

### 22.5 Interaccao

- **Click block**: Select/deselect (abre OpDetailPanel)
- **Hover block**: Tooltip (qty, tempo, start, end, pcs/H, setup, operadores)
- **Day pills**: Seleccionar dia (filtro)
- **Machine pills**: Filtrar por maquina
- **Zoom**: 0.6x, 1x, 1.5x, 2x

### 22.6 OpDetailPanel (320px)

- Detalhes de producao e setup
- Stock e backlog
- Mini barchart do schedule semanal
- Status da maquina com barra de utilizacao
- Botoes: mover para alt / undo replan

---

## 23. REGRAS DE NEGOCIO

### 23.1 Regras validadas pelo utilizador

| Regra | Estado |
|-------|--------|
| Net Position negativo = deficit | Confirmado |
| Split entre turnos | Confirmado — operacoes DIVIDEM entre X/Y |
| Setup persiste entre turnos | Confirmado — ferramenta fica montada |
| Setup contiguo | Confirmado — nao se divide meio setup |
| Lotes economicos | Confirmado — cumprir datas + minimizar setups |
| Gantt visual para splits | Confirmado — duas barras separadas por turno |
| 3o turno | Excepcional — activavel via flag, sem check operadores |

### 23.2 Regras de prioridade

1. **Cumprir datas de entrega** (tardiness = 0) — PRIORIDADE MAXIMA
2. **Minimizar setups totais** — custo operacional
3. **Max 1 setup simultaneo** — CONSTRAINT HARD
4. **Distribuir setups pelos 2 turnos** — balanceamento
5. **Consumir bobines completas** — eficiencia material (futuro)
6. **Considerar calcos partilhados** — setup reduzido (futuro)

### 23.3 Mandato de dados reais

**REGRA ABSOLUTA**: O projecto opera EXCLUSIVAMENTE com dados reais da fabrica Nikufra.

**Permitido**: ISOP real, fixture, dados calculados/derivados, input manual do utilizador
**PROIBIDO**: Inventar quantidades, hardcodar KPIs, gerar operacoes sinteticas, usar placeholders

### 23.4 Invariantes de validacao

Na importacao:
1. Toda tool tem maquina primaria
2. Todo SKU tem tool
3. Rate > 0 para toda tool activa
4. Setup >= 0
5. Operadores em {1, 2}

No scheduling:
1. setup_overlap_violations == 0
2. shift_crossing_violations == 0
3. Todas operacoes cabem no dia
4. Operadores <= pool por turno/area
5. Tardiness minimizado

---

## 24. STACK TECNOLOGICO

### 24.1 Frontend

| Componente | Tecnologia | Versao |
|-----------|-----------|--------|
| Framework | React | 18 |
| Linguagem | TypeScript (strict) | - |
| Build | Vite | 5 |
| State | Zustand | - |
| Routing | React Router | 7 |
| HTTP | Axios | - |
| Validation | Zod | - |
| Charts | Recharts | - |
| Icons | Lucide React | - |
| Dates | date-fns | - |
| Excel | SheetJS (xlsx) | - |
| Tests | Vitest + @testing-library/react | - |

### 24.2 Backend

| Componente | Tecnologia | Versao |
|-----------|-----------|--------|
| Framework | FastAPI | - |
| Linguagem | Python | 3.11 |
| ORM | SQLAlchemy | 2.0 |
| Migrations | Alembic | - |
| Database | PostgreSQL (JSONB) | - |
| Compute | numpy, scipy | - |
| Tests | pytest | - |
| Validation | Pydantic V2 | - |

### 24.3 Portas e execucao

```bash
# Frontend
cd frontend && npm run dev    # Vite dev server: port 5173
cd frontend && npm run build  # TypeScript check + production build
cd frontend && npm run test   # Vitest

# Backend
cd backend && python -m src.main  # FastAPI server
cd backend && pytest              # Tests
```

---

## ANEXO: Estrutura de directoria completa

### Frontend (`frontend/src/`)

```
App.tsx, main.tsx, index.css
adapters/          ApiClient.ts, MockDataSource.ts
components/
  Common/          ActionHint, Collapsible, EmptyState, ErrorBoundary,
                   HeatmapLegend, SkeletonLoader, StatusBadge, StatusBanner, Tooltip
  Layout/          Layout.tsx
  Planning/        GanttChart.tsx (852 lines), MiniGantt.tsx
  Scenarios/       VersionSidebar.tsx, KPICompare.tsx
  Toast/           Toast.tsx
  TopBar/          TopBar.tsx (4 grupos de navegacao)
domain/
  types.ts, nikufra-types.ts, isopClientParser.ts, nikufraTransform.ts,
  riskGrid.ts, snapshotHash.ts, planDiff.ts, demandDelta.ts, supplyPriority.ts
  diff/            computeDiffSummary.ts, types.ts
  mrp/             mrp-engine.ts (708 lines), mrp-types.ts (217 lines)
features/
  planning/        NikufraEngine.tsx (2,955 lines)
  intelligence/    NikufraIntel.tsx + intel-compute.ts (1,091 lines)
  supply/          SupplyMonitor.tsx
hooks/             useScheduleData.ts, useDataSource.ts, useAsyncState.ts
pages/             Dashboard, Fabrica, Risk, Pecas, MRP, Supply, Planning,
                   Scenarios, Intelligence, Definicoes/CarregarDados
stores/            useDataStore, useSettingsStore, useReplanStore,
                   usePlanVersionStore, useScenarioLabStore, useToastStore, useUIStore
utils/             uuid.ts, validation.ts, helpers.ts, glossary.ts
```

### Backend (`backend/src/`)

```
api/v1/            23 endpoint files
core/              Config, errors, exception_handler, logging, metrics, middleware
domain/
  models/          SQLAlchemy models
  solver/          PLAN-MIN + constraints (plan_min, setup_crew, operator_capacity,
                   calco_constraints, material_constraints, tool_uniqueness)
  planning/        NikufraScheduler, Monte Carlo optimizer, models
  ingest/          ISOP XLSX parser, PP PDF parser
  snapshot/        Snapshot service, repository, hash
  plan/            Plan service, repository, job service
  sandbox/         Scenario service, diff_calculator, patch_applier
  improve/         PR service and repository
  suggestions/     Suggestion service and repository
  audit/           Audit service and repository
  calendar/        Calendar service, models (shifts X/Y)
  capacity/        Operator pool capacity
  materials/       Material & calco service
  run_events/      Event processing
  dqa/             TrustIndex
  explain/         ExplainTrace builder
  learning/        Bandit policy (Thompson Sampling)
  copilot/         RAG + policy (stub)
  integration/     Outbox pattern
```

---

*Documento gerado automaticamente a partir da analise completa do codigo-fonte e documentacao do ProdPlan PP1.*
