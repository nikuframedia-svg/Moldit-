# claude-gantt.md — Logica Congelada do Scheduling Engine + Gantt

> **DOCUMENTO DE REFERENCIA OBRIGATORIO** para qualquer alteracao a `NikufraEngine.tsx`,
> `useScheduleData.ts`, ou logica de scheduling/Gantt.
>
> Ultima verificacao: 2026-03-02 | Build: 0 erros | Spec Normativa aplicada: todas constraints HARD + FeasibilityReport

---

## 1. FICHEIROS CRITICOS

| Ficheiro | Linhas | Papel |
|----------|--------|-------|
| `features/planning/NikufraEngine.tsx` | ~3386 | Scheduler + GanttView + Validator + Optimizer (UNICO driver) |
| `hooks/useScheduleData.ts` | 171 | Pipeline central (schedule + KPIs, cache module-level) |
| `adapters/MockDataSource.ts` | 189 | DataSource adapter (SHORT->LONG mapping) |
| `stores/useDataStore.ts` | ~291 | Daily ISOP persistence + merge com Master |
| `stores/useMasterDataStore.ts` | 75 | Master ISOP persistence (localStorage) |
| `domain/isopClientParser.ts` | ~793 | Parser ISOP XLSX |
| `domain/nikufra-types.ts` | ~330 | Tipos centrais |
| `domain/supplyPriority.ts` | 59 | MRP risk -> scheduler priority boost |

---

## 2. CONSTANTES (constants.ts — fonte de verdade)

```
S0   = 7 * 60    = 420    // 07:00 — inicio turno X
T1   = 15.5 * 60 = 930    // 15:30 — fim turno X / inicio turno Y
S1   = 24 * 60   = 1440   // 24:00 — fim turno Y
S2   = S1 + S0   = 1860   // 07:00 dia seguinte — fim 3o turno (excepcional)
OEE  = 0.66               // Overall Equipment Effectiveness
DAY_CAP = S1 - S0 = 1020  // minutos capacidade real (2 turnos)
SCAP = round(1020 * 0.66) = 673  // meta eficiencia OEE
TG_END = 16 * 60 = 960    // 16:00 — turno geral termina
```

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `S0` | 420 min | Inicio 1o turno (07:00) |
| `T1` | 930 min | Fronteira turnos X/Y (15:30) |
| `S1` | 1440 min | Fim 2o turno (24:00) |
| `S2` | 1860 min | Fim 3o turno excepcional (07:00 dia seguinte) |
| `TG_END` | 960 min | Turno geral termina (16:00) |
| `OEE` | 0.66 | Eficiencia global do equipamento |
| `DAY_CAP` | 1020 min | Capacidade disponivel por dia (2 turnos) |
| `SCAP` | 673 min | Meta ajustada ao OEE |

**KNOWN_FOCUS**: `Set(['PRM019', 'PRM020', 'PRM031', 'PRM039', 'PRM042', 'PRM043'])` — 6 prensas principais.

**PRNG**: `mulberry32(seed)` — gerador pseudo-aleatorio deterministico (seed fixa = 42). Garante reprodutibilidade no Monte Carlo.

**Cores**: `C` (13 tokens dark theme), `TC` (16 cores para ferramentas), `tci(tools, toolId)` indexa com modulo.

---

## 3. PIPELINE DE DADOS (fim-a-fim)

```
Utilizador faz upload de ISOP XLSX (pagina CarregarDados)
  -> isopClientParser.ts  parse Excel -> NikufraData (nomes SHORT)
  -> useDataStore.setNikufraData()
    -> resolveMasterSource()  [master uploaded > fixture > null]
    -> mergeFromMaster()      [enriquece: setup, alt, rates, operators, MO]
    -> guarda NikufraData enriquecido + raw + loadedAt (timestamp)

useScheduleData hook detecta mudanca em loadedAt
  -> invalida cache module-level (cacheVersion++)
  -> ds.getPlanState()
    -> MockDataSource le de useDataStore (ou fixture fallback)
    -> mapeia SHORT -> LONG -> PlanState
  -> transformPlanState(): PlanState LONG -> EngineData SHORT (interno)
  -> computeMRP() -> computeSupplyPriority() -> supplyBoosts Map
  -> autoRouteOverflow():
    -> scheduleBatch() [pass 1: EDD com user moves]
      -> Fase 1: delivery buckets por ferramenta por maquina
      -> Fase 2: scheduling com 4 constraints
    -> detectar overflow -> mover para alt machines (ate 3 iteracoes)
  -> capAnalysis(), scoreSchedule(), validateSchedule() [derivados via useMemo]
  -> todas as paginas consomem via useScheduleData()
```

---

## 4. TIPOS INTERNOS

### EngineData
```typescript
{
  machines: EMachine[]     // { id, area, focus }
  tools: ETool[]           // { id, m, alt, sH, pH, op, lt, stk, mp, nm, calco }
  ops: EOp[]               // { id, t, m, sku, nm, atr, d[] }
  dates: string[]           // ["02/02", "03/02", ...]
  dnames: string[]          // ["Seg", "Ter", ...]
  toolMap: Record<string, ETool>
  focusIds: string[]
  workdays: boolean[]       // true = dia util
  mo?: { PG1: number[]; PG2: number[] }
  nDays: number
  thirdShift?: boolean
}
```

### Block (unidade de producao agendada)
```typescript
{
  // Identidade
  opId, toolId, sku, nm, machineId, origM, dayIdx
  // Tempo (minutos desde meia-noite)
  startMin, endMin, setupS, setupE
  // Metricas
  qty, prodMin, setupMin, operators
  // Estado
  blocked, reason, moved, hasAlt, altM
  type: 'ok' | 'blocked' | 'overflow' | 'infeasible'
  shift: 'X' | 'Y' | 'Z'
  overflow?, overflowMin?, belowMinBatch?
  // Infeasibility (INCOMPOL PLAN normative spec)
  infeasibilityReason?, infeasibilityDetail?
  hasDataGap?, dataGapDetail?
  // Metadata
  mp, stk, lt, atr
}
```

### DispatchRule
`'EDD' | 'CR' | 'WSPT' | 'SPT'`

- **EDD** (default): Earliest Due Date ascendente
- **CR**: Critical Ratio `edd / max(prodMin/SCAP, 0.01)` ascendente
- **WSPT**: Weighted Shortest Processing Time `totalQty / max(prodMin, 1)` descendente
- **SPT**: Shortest Processing Time ascendente

---

## 5. transformPlanState() (linhas 132-183)

Converte `PlanState` (nomes LONG do backend) para `EngineData` (nomes SHORT internos).

**Mapeamento critico**:

| PlanState (LONG) | EngineData (SHORT) |
|---|---|
| `machine` | `m` |
| `alt_machine` | `alt` (default `'-'`) |
| `setup_hours` | `sH` |
| `pcs_per_hour` | `pH` |
| `operators` | `op` |
| `lot_economic_qty` | `lt` |
| `stock` | `stk` |
| `atraso` | `atr` |
| `daily_qty` | `d` |
| `calco_code` | `calco` |

**Acoes adicionais**:
- Pad arrays `d` para `nDays` (preenche com 0)
- Pad `dates`/`dnames` para `nDays` (preenche com `'--/--'`/`'--'`)
- Constroi `toolMap` (Record para lookup O(1))
- Deriva `workdays` de `workday_flags` ou infere de labels dia-da-semana
- Marca `focus` em maquinas presentes em `KNOWN_FOCUS`

---

## 6. AS 4 CONSTRAINTS (todas HARD — per Especificacao Normativa)

> **Principio**: Todas as constraints sao HARD. Nao existe modo "soft".
> HARD = tentar todas as alternativas (turno/dia/maquina). Se impossivel = declarar INFEASIBLE formalmente.
> Operacoes NUNCA desaparecem do Gantt — aparecem com `type: 'infeasible'` + relatorio.
> Dados desconhecidos (MO=99) NAO bloqueiam — agendam + registam DATA_MISSING.

### 6.1 SetupCrew (linhas 193-215)

**Regra**: Maximo 1 setup em simultaneo em TODA a fabrica. **HARD constraint.**

**Estrutura**: Array de `{ start, end, machineId }` (tempo absoluto no horizonte).

**findNextAvailable(earliest, duration, shiftEnd)**: Iteracao de colisao — se candidato sobrepoe slot existente, empurra para `slot.end`. Repete ate estabilizar. Retorna `-1` se nao cabe no turno.

**book(start, end, machineId)**: Regista slot.

### 6.2 CalcoTimeline (linhas 218-247)

**Regra**: Duas maquinas NAO podem usar o mesmo codigo calco em simultaneo. **HARD constraint.**

**Estrutura**: `Record<calcoCode, Array<{ start, end, machineId }>>`.

**Algoritmo**: Identico ao SetupCrew mas indexado por codigo calco.

### 6.3 ToolTimeline (linhas 251-298)

**Regra**: A mesma ferramenta fisica NAO pode estar em 2 maquinas em simultaneo (default: 1 instancia por ferramenta). **HARD constraint.**

**Estrutura**: `Record<toolId, Array<{ start, end, machineId }>>`.

**isAvailable(toolId, start, end, machineId, instances?)**: Conta machineIds em conflito (excluindo a maquina que pede). Retorna true se `conflicting.size < maxInstances`.

**findNextAvailable**: Iterativo — se conflitos >= maxInst, empurra candidato para o end mais cedo de um slot em conflito.

### 6.4 OperatorPool (linhas 300-364)

**Regra**: Capacidade de operadores por turno, por area (PG1/PG2). Modelo Team + Pool. **HARD constraint com realocacao.**

**Estrutura**:
- `machPeak: Record<"di:shift:machineId", number>` — pico concorrente por maquina/turno
- `areaTotal: Record<"di:shift:area", number>` — soma dos picos por area/turno

**Modelo Team+Pool**:
- `getTeamCap(area, dayIdx)` — capacidade da equipa fixa
- `getTotalCap(area, dayIdx)` — equipa + pool (operadores emprestados)
- Pool usage e rastreado para penalizacao no score

**hasCapacity(di, shift, operators, area, machineId?)**: Verifica se adicionar `operators` excede `totalCap`. Para check por maquina: delta = `max(0, operators - currentMachPeak)` (so o pico mais alto conta).

**Excepcao**: Turno Z (3o turno) — check de operadores e IGNORADO (linha 724: `if (shift !== 'Z' && pool ...)`).

---

## 7. scheduleBatch() — O ALGORITMO PRINCIPAL (linhas 369-799)

### Fase 1: Construir Tool Groups por Maquina (linhas 392-601)

#### 7.1 Delivery Buckets (conceito chave)

Em vez de somar TODA a demand numa unica batch, a demand diaria e dividida em buckets dimensionados pelo lote economico, cada um com o seu proprio EDD.

**SkuB** (bucket de entrega): `opId, sku, nm, atr, totalQty, prodQty, prodMin, edd, operators, stk, lt, mp, blocked, reason, hasAlt, altM, moved, origM`.

**TGroup** (grupo de ferramenta para um EDD): `toolId, machineId, edd, setupMin, totalProdMin, skus[], tool`.

#### 7.2 Calculo de prodQty e prodMin

```
prodQty = lt > 0 ? ceil(accQty / lt) * lt : accQty   // arredonda para lote economico
prodMin = (prodQty / tool.pH) * 60                     // tempo de producao em minutos
```

#### 7.3 Processamento por operacao (linhas 442-498)

1. Skip se `totalQty <= 0` ou `tool.pH <= 0` (evita Infinity)
2. **Backlog** (`op.atr > 0`): cria SkuB com `edd=0` (imediato)
3. **Demand diaria**: split em delivery buckets:
   - `BUCKET_WINDOW = 5` dias uteis
   - Com lote economico (`lt > 0`): acumula ate `qty >= lt`, depois emite
   - Sem lote economico: janela temporal de 5 dias uteis
   - `edd = ultimo dia de demand no bucket`
   - Sempre emite no ultimo dia de demand
4. Flush de demand restante acumulada

#### 7.4 Ordenacao por regra de dispatch (linhas 512-544)

**Prioridade primaria**: `maxBoost(group)` — supply boost do MRP (3=stockout 1 dia, 2=stockout, 1=coverage<3d, 0=normal)

Depois, conforme regra:
- **EDD**: edd ascendente; desempate por prodMin descendente
- **CR**: critical ratio ascendente
- **WSPT**: totalQty/prodMin descendente
- **SPT**: prodMin ascendente; desempate por edd ascendente

#### 7.5 Tool Merging G1-G5 (linhas 546-601)

**G1-G3 (mesma ferramenta)**: `MAX_EDD_GAP = 5` dias. Para cada grupo, puxa para a frente grupos subsequentes com o mesmo `toolId` se gap de edd <= 5 dias. Evita setups redundantes.

**G5 (mesma MP)**: Apos merge de ferramentas, grupos que partilham o mesmo `tool.mp` (material partner — mesmo rolo/chapa) sao agrupados consecutivamente se gap de edd <= 5 dias. Reduz trocas de material.

**Nota**: G5 esta INACTIVO porque `tool.mp` e sempre `undefined` nos ISOP actuais. Activara quando dados MP forem fornecidos (FUTURO, §10 bdmestre obj.5).

**Ordenacao SKUs dentro do grupo** (linhas 592-600):
1. Backlog (`atr > 0`) primeiro
2. Stock zero com lote economico
3. totalQty descendente

**Ordem de maquinas** (linhas 603-614):
1. Urgencia do 1o grupo (via `groupComparator`)
2. Desempate: maquinas com ferramentas sem alternativa (nao podem ser rerouted) tem prioridade

### Fase 2: Scheduling por Maquina (linhas 616-799)

#### 7.6 Estado por maquina

```
cDay = wDays[0]           // dia corrente (1o dia util)
cMin = S0                  // cursor em minutos (inicio turno X)
lastTool = null            // ultima ferramenta (para evitar setup desnecessario)
dayEnd = thirdShift ? S2 : S1   // limite do dia
```

#### 7.7 Funcoes de navegacao

**advance()** (linha 650): Se `cMin >= dayEnd`, avanca para proximo dia util, reset `cMin = S0`. Retorna false se alem do horizonte.

**pushShift()** (linha 655): Empurra cursor para fronteira de turno seguinte:
- Se `cMin < T1` (turno X): `cMin = T1` (inicio Y)
- Se `cMin < S1` e 3o turno: `cMin = S1` (inicio Z)
- Senao: proximo dia util, `cMin = S0`

**curShEnd()** (linha 679): Fim do turno corrente: `cMin < T1 ? T1 : cMin < S1 ? S1 : dayEnd`

**curShift()** (linha 680): `'X'` se `cMin < T1`, `'Y'` se `cMin < S1`, `'Z'` senao

#### 7.8 Placement de SETUP (linhas 683-707)

**Condicao**: So se `grp.toolId !== lastTool` E `grp.setupMin > 0`.

**Algoritmo** (ate 6 tentativas):
1. Verifica se setup cabe no turno (`grp.setupMin > shEnd - cMin`). Se nao: `pushShift()`.
2. Pede slot ao **SetupCrew** (tempo absoluto). Se nao ha: `pushShift()`.
3. Verifica **ToolTimeline** (ferramenta nao pode estar noutra maquina). Se nao ha: `pushShift()`.
4. Se ToolTimeline devolve slot mais tarde: avanca cursor e retenta.
5. Sucesso: `book()` em SetupCrew e ToolTimeline. `setupS = cMin`, `setupE = cMin + grp.setupMin`.

**Se falha apos 6 tentativas**: todos os SKUs do grupo tornam-se overflow.

**REGRA CRITICA**: Setup e CONTIGUO — nao se pode dividir meio setup entre turnos. Se nao cabe, empurra inteiro para turno seguinte.

#### 7.9 Loop de PRODUCAO — Split Across Shifts (linhas 710-772)

**Esta e a logica central validada.**

```
rem = sk.prodMin        // minutos restantes
qRem = sk.prodQty       // pecas restantes
ppm = prodQty / prodMin // pecas por minuto (proporcional)

while (rem > 0) {
  advance()             // avanca dia se necessario
  avail = shEnd - cMin  // tempo disponivel no turno corrente

  // 1. Check operadores (skip turno Z)
  if (!pool.hasCapacity(...)) { cMin = shEnd; continue }

  // 2. Check calco (tempo absoluto)
  alloc = min(rem, avail)
  calcoSlot = calcoTL.findNextAvailable(...)
  if (pushed forward) recompute alloc

  // 3. Check tool uniqueness
  toolSlot = toolTL.findNextAvailable(...)
  if (pushed forward) recompute alloc

  // 4. Criar block
  bQty = rem <= alloc ? qRem : round(alloc * ppm)
  pool.book(...); calcoTL.book(...); toolTL.book(...)
  blocks.push({ startMin: cMin, endMin: cMin + alloc, shift, ... })

  // 5. Avancar
  rem -= alloc; qRem -= bQty; cMin += alloc
  // Se cMin >= shEnd, proximo loop: pushShift() -> turno seguinte
}
```

**RESULTADO**: Se uma operacao precisa de 500min e turno X tem 300min:
- Block 1: 300min no turno X (shift='X')
- Block 2: 200min no turno Y (shift='Y')
- Setup so conta uma vez (no primeiro block)
- **Duas barras separadas no Gantt** (nao sao fundidas porque shifts diferentes)

#### 7.10 Post-Merge de Blocks (linhas 776-799)

Combina blocks consecutivos para o mesmo `opId + toolId + machineId + dayIdx + shift` onde `prev.endMin === b.startMin` e ambos `type === 'ok'`. Funde `endMin`, `prodMin`, `qty`.

**IMPORTANTE**: Blocks com shifts DIFERENTES nao sao fundidos — ficam como barras separadas.

#### 7.11 Setup no primeiro SKU

```
setupMin: isFirst ? grp.setupMin : 0
setupS: isFirst ? setupS : null
setupE: isFirst ? setupE : null
```

So o primeiro SKU do grupo recebe a barra de setup. SKUs seguintes na mesma ferramenta nao tem setup.

---

## 8. scheduleAll() (linhas 802-811)

Entry point que delega directamente para `scheduleBatch()`. Wrapper para API consistente.

```typescript
function scheduleAll(...) {
  return scheduleBatch(...)
}
```

**Nota historica**: A funcao `scheduleDay` (legacy, DEC-0002, sem split entre turnos) foi REMOVIDA. `scheduleAll` chama APENAS `scheduleBatch`.

---

## 9. autoRouteOverflow() (linhas 824-908)

**Proposito**: Mover iterativamente operacoes em overflow para maquinas alternativas.

**Constantes**:
- `MAX_ITER = 3` — maximo iteracoes
- `MAX_AUTO_MOVES = 16` — maximo movimentos automaticos
- `ALT_UTIL_THRESHOLD = 0.95` — alternativa deve ter < 95% utilizacao

**Algoritmo**:
1. **Pass 1**: Schedule greedy com user moves. Se zero overflow: retorna.
2. **Loop iterativo** (ate 3x):
   - Calcular `capAnalysis()`
   - Encontrar blocks overflow com alternativas, ordenados por maior overflow
   - Para cada block overflow:
     - Verificar utilizacao total da maquina alt no horizonte: `altUsed / (wDays * SCAP) < 0.95`
     - Verificar capacidade restante: `wDays * SCAP - altUsed >= 30min`
     - Adicionar a `autoMoves`
   - Re-agendar com user moves + auto moves
   - Se `newOverflow < totalOverflow`: aceitar. Senao: undo e break.
   - Se zero overflow: break.

**Output**: `{ blocks: Block[], autoMoves: MoveAction[] }`

---

## 10. validateSchedule() (linhas 931-1074)

**4 Verificacoes post-schedule**:

| Check | Severidade | Descricao |
|-------|-----------|-----------|
| Tool Uniqueness | `critical` | Mesma ferramenta em 2 maquinas em simultaneo |
| Setup Crew Overlaps | `high` | 2 setups em simultaneo (maquinas diferentes) |
| Machine Overcapacity | `high`/`medium` | > DAY_CAP = high; > SCAP = medium (warning eficiencia) |
| Deadline Misses | `high`/`medium` | produced < demand * 0.95; high se < 50%, medium senao |

**`valid` flag**: True se zero violacoes `critical` ou `high`.

**quickValidate()** (linhas 1077-1141): Versao leve (<2ms) para feedback em tempo real. Mesmo 3 checks (sem deadline miss). Retorna `{ criticalCount, highCount, warnings[] }`.

---

## 11. capAnalysis() (linhas 1153-1181)

**Output**: `Record<machineId, DayLoad[]>` onde `DayLoad = { prod, setup, ops, pcs, blk }`.

Para cada block:
- Blocked: incrementa `blk`
- OK: `prod += endMin - startMin`, `setup += setupE - setupS`, `ops++`, `pcs += qty`

---

## 12. scoreSchedule() (linhas 1417-1526)

### KPIs calculados

| KPI | Calculo |
|-----|---------|
| OTD (producao) | `100 - (totalDemand - produced) / totalDemand * 100` [0-100] |
| OTD-Delivery | Cumulativo por dia: on-time se `cumProd >= cumDemand * 0.95` |
| Setup Count | Blocks com `setupS != null` |
| Setup Total Min | Soma `setupE - setupS` |
| Setup Balance | `abs(setupsShiftX - setupsShiftY)` |
| Churn | `sum(abs(startMin - baseStartMin))` / 60 (vs baseline) |
| Tardiness | `sum(overflowMin) / 1440` (dias) |
| Cap Utilization | Media e variancia de `(prod + setup) / DAY_CAP` |
| Peak Operators | Maximo por dia |
| Over-Operators | Excedente alem de area caps |

### Formula de Score (minimizacao)

```
score = -(
  100.0 * tardinessDays        // penalidade por atraso
  + 10.0 * setupCount          // penalidade por numero de setups
  +  1.0 * setupMin            // penalidade por tempo total de setup
  + 30.0 * setupBalance        // penalidade por desbalanceamento X/Y
  +  5.0 * churnNorm           // penalidade por instabilidade do plano
  + 50.0 * overflows           // penalidade por operacoes nao agendadas
  +  5.0 * belowMinBatchCount  // penalidade por lotes abaixo do economico
)
```

### Objective Profiles

| Perfil | Foco | Pesos chave |
|--------|------|-------------|
| **Equilibrado** | Balance geral | tardiness=100, setup_count=10, overflow=50 |
| **Entregar a Tempo** | OTD maximo | tardiness=200, overflow=80, setup_count=5 |
| **Minimizar Setups** | Menos setups | setup_count=50, setup_balance=40, tardiness=30 |

---

## 13. twoOptResequence() (linhas 1675-1750)

**Proposito**: Pos-processamento para reduzir setups trocando pares adjacentes de blocks.

**Algoritmo**:
1. Agrupar blocks por `machineId_dayIdx`
2. Para cada grupo com 2+ blocks:
   - Trocar pares adjacentes iterativamente
   - Contar setups (mudancas de ferramenta) apos troca
   - Se menos setups: aceitar troca, repetir
   - Ate convergencia (sem melhoria)
3. Recalcular `startMin/endMin/setupS/setupE` para a nova ordem

---

## 14. Monte Carlo — runOptimization() (linhas 1788-1876)

### 3 Vizinhancas (round-robin)

| Vizinhanca | Estrategia |
|-----------|-----------|
| **SwapTardiness** | Maquina com mais atraso -> move ops com alt para maquina alt |
| **SetupReduction** | Desfaz um move nao-forcado (agrupamento natural pode ser melhor) |
| **LoadBalance** | Par over/underloaded na mesma area (gap >= 0.15) -> move op |

### Pipeline de Optimizacao

1. **Baseline**: Schedule com zero moves, dispatch rule seleccionada
2. **Heuristicas alternativas**: Tenta 4 regras (EDD, CR, WSPT, SPT). Guarda as que batem baseline.
3. **Auto-Replan**: `genDecisions()` para replan automatico. Aplica todos como moves.
4. **Melhoria iterativa**: N iteracoes de `improveIteration()` em batches de 25. `setTimeout(go, 0)` para non-blocking.
5. **Output**: Top-K resultados deduplicated por assinatura de moves.

---

## 15. genDecisions() — Replan Automatico (linhas 1202-1366)

**Proposito**: Gerar decisoes de replan para operacoes bloqueadas.

**Logica principal**:
- Tracker de capacidade acumulada para moves propostos
- Ordena ops bloqueadas por severidade: stock-zero + alto-backlog primeiro
- **Tool down**: decisao de blocked
- **Machine down sem alt**: decisao de blocked com info de stock buffer
- **Machine down com alt**: scoring de candidatos:
  - `score = peak * 100 + overDays * 50 + setupMin * 0.1 - (sharedMP ? 30 : 0)`
  - Actualiza capacidade com move proposto
  - Gera trace de raciocinio (XAI)
- Tambem gera warnings para lotes abaixo do economico

---

## 16. GANTT VIEW — Rendering (linhas 2132-2305)

### Layout

- **Sidebar esquerda**: 100px largura — label maquina (id, area, ops count, % utilizacao)
- **Area principal**: Eixo temporal de 08:00 a 24:00
- **Pixels por minuto**: `ppm = 1.2 * zoom`. Largura total: `990 * 1.2 = 1188px` a zoom=1

### Eixo temporal

- Horas de 8 a 24 como linhas verticais de grelha
- **Turno X**: fundo verde `(0 a (T1-S0)*ppm)`
- **Turno Y**: fundo azul
- **Fronteira T1**: linha tracejada amarela com label "T.Y"

### Working Day Indices

```typescript
wdi = workdays.map((w, i) => w ? i : -1).filter(i >= 0)
```

- So dias uteis sao mostrados como pills seleccionaveis
- Badges com contagem de violacoes por dia
- Pills de filtro por maquina
- Zoom: 0.6x, 1x, 1.5x, 2x

### Posicionamento de Blocks

| Propriedade | Calculo |
|-------------|---------|
| Y position | `5 + blockIndex * 22` (22px por block, 5px margem top) |
| Row height | `max(44, numBlocks * 22 + 10)` |
| Setup X | `left = (setupS - S0) * ppm` |
| Setup width | `max((setupE - setupS) * ppm, 4)` |
| Production X | `left = (startMin - S0) * ppm` |
| Production width | `max((endMin - startMin) * ppm, 12)` |

### Barras visuais

- **Setup**: Hatching diagonal. Cantos arredondados esquerda. Label "SET".
- **Producao**: Cor indexada pela ferramenta (`tci()`). Cantos arredondados direita se segue setup.
- **Selected**: Borda teal
- **Moved**: Borda teal

### Interacao

- **Click block**: Select/deselect (abre OpDetailPanel sidebar)
- **Hover block**: Tooltip com qty, tempo, start, end, pcs/H, setup, operators, maquina
- **Barra de utilizacao**: Fundo de cada row de maquina

### OpDetailPanel (linhas 1922-2062)

Painel lateral (320px) com:
- Detalhes de producao e setup
- Stock e backlog
- Mini barchart do schedule semanal
- Status da maquina com barra de utilizacao
- Botoes de accao (mover para alt / undo replan)

### ValidationPanel (linhas 2065-2130)

Painel colapsavel acima do Gantt:
- Contagem de violacoes com badges de severidade
- Expande para mostrar violacoes individuais ordenadas por severidade
- Suggested fixes com botoes de accao

---

## 17. useScheduleData Hook (linhas 42-171)

### Cache Module-Level

```typescript
let cached: { engine, blocks, autoMoves, mrp } | null = null
let cachePromise: Promise<void> | null = null
let cachedDataVersion: string | null = null
let cacheVersion = 0
```

**Invalidacao**: Quando `dataVersion (= useDataStore.loadedAt)` muda, ou via `invalidateScheduleCache()`.

### Pipeline de Computacao

1. Se cache hit: usar directamente
2. Se promise em voo: `.then()` para usar resultado quando pronto
3. Senao:
   - `ds.getPlanState()` -> `transformPlanState()` -> EngineData
   - Construir `machineStatus` e `toolStatus` dos ISOP "Estado"
   - Validar arrays MO antes de usar
   - `computeMRP(data)` -> `computeSupplyPriority(data, mrp)` -> supplyBoosts
   - `autoRouteOverflow(ops, mSt, tSt, [], machines, TM, workdays, dayAreaCaps, 'EDD', supplyBoosts, thirdShift)`
   - Guardar em cache

4. Derivados (useMemo):
   - `cap = capAnalysis(blocks, machines)`
   - `metrics = scoreSchedule(blocks, ops, mSt, areaCaps, machines, TM)` — com defaults MO (PG1=4, PG2=4 se faltam)
   - `validation = validateSchedule(blocks, machines, TM, ops, thirdShift)`

### supplyBoosts

`computeSupplyPriority(engine, mrp)` -> `Map<opId, { boost: 0|1|2|3, reason }>`:
- 3 = stockout <= 1 dia
- 2 = stockout > 1 dia
- 1 = coverage < 3 dias
- 0 = normal

Usado como prioridade primaria no `groupComparator` de `scheduleBatch`.

---

## 18. MockDataSource — Mapeamento SHORT->LONG

### Prioridade de dados

1. `useDataStore.getState().nikufraData` (ISOP uploaded pelo utilizador)
2. `/fixtures/nikufra/nikufra_data.json` (cached apos 1o load)

### getPlanState() Mapping

| NikufraData (SHORT) | PlanState (LONG) |
|---|---|
| `machine.id` | `id` |
| `machine.area` | `area` (cast para 'PG1' \| 'PG2') |
| `machine.man` | `man_minutes` |
| `tool.id` | `id` |
| `tool.m` | `machine` |
| `tool.alt` | `alt_machine` |
| `tool.s` | `setup_hours` |
| `tool.pH` | `pcs_per_hour` |
| `tool.op` | `operators` |
| `tool.skus` | `skus` |
| `tool.nm` | `names` |
| `tool.lt` | `lot_economic_qty` |
| `tool.stk` | `stock` |
| `op.id` | `id` |
| `op.m` | `machine` |
| `op.t` | `tool` |
| `op.sku` | `sku` |
| `op.nm` | `name` |
| `op.pH` | `pcs_per_hour` |
| `op.atr` | `atraso` |
| `op.d` | `daily_qty` |
| `op.s` | `setup_hours` |
| `op.op` | `operators` |
| `op.cl` | `customer_code` |
| `op.clNm` | `customer_name` |
| `op.pa` | `parent_sku` |
| `op.wip` | `wip` |
| `op.qe` | `qtd_exp` |
| `op.ltDays` | `lead_time_days` |

Tambem mapeia `machine.status` e `tool.status` (de colunas "Estado" do ISOP).

---

## 19. useDataStore Merge — Master->Daily Enrichment

### mergeFromMaster() (linhas 51-122)

**Prioridade de merge**: `valor daily > valor master > DEFAULT_SETUP_HOURS (0.75h = 45min)`

Para cada ferramenta diaria:
```
newS   = tool.s > 0 ? tool.s : mst.s > 0 ? mst.s : 0.75
newAlt = tool.alt != '-' && tool.alt != '' ? tool.alt : mst.alt
newPH  = tool.pH > 0 ? tool.pH : mst.pH
newOp  = tool.op > 0 ? tool.op : mst.op
newLt  = tool.lt > 0 ? tool.lt : mst.lt
```

Se ferramenta NAO existe no master: aplica `DEFAULT_SETUP_HOURS` se `s <= 0`.

Para operacoes: propaga valores enriquecidos da ferramenta.

**MO merge**: Se MO do daily esta vazio (tudo zeros) e master tem MO, usa master.

### resolveMasterSource() (linhas 128-157)

Cadeia de prioridade:
1. `useMasterDataStore.masterData` — Master ISOP uploaded ('master-uploaded')
2. `/fixtures/nikufra/nikufra_data.json` — extraccao de tools/machines como master ('master-fixture')
3. `null` — sem dados master

### Toast Notifications

- **Sucesso**: "Enriquecido com {source}: {parts}."
- **Unknown tools**: "{N} ferramenta(s) sem dados Mestre (setup=45min, sem maq. alt.): ..."
- **Zero rate ops**: "{N} operacao(oes) com rate=0 — serao ignoradas pelo scheduler."
- **Sem master**: "Sem dados Mestre — a usar defaults (setup 45min, sem maq. alternativa)."

---

## 20. REGRAS DE NEGOCIO VALIDADAS (pelo utilizador)

| Regra | Estado | Detalhe |
|-------|--------|---------|
| Net Position: negativo = deficit | Confirmado | `-500 = produzir 500, +200 = stock OK` |
| Split entre turnos | Confirmado | Operacoes DIVIDEM entre X/Y (`while(rem>0)`) |
| Setup persiste entre turnos | Confirmado | Ferramenta fica montada, nao precisa de novo setup |
| Setup contiguo | Confirmado | Nao se pode dividir meio setup |
| Lotes economicos | Confirmado | Cumprir datas + minimizar setups |
| Limite setups por turno | Sem limite rigido | Preferencia soft (via setup_balance no score) |
| Gantt visual para splits | Confirmado | Duas barras separadas (uma por turno) |
| MP/Rolos completos | FUTURO | Dados nao existem nos ISOP. Campo `mp` sempre undefined. G5 inactivo. |
| 3o turno | Excepcional | Activavel via flag. Shift Z: 00:00-07:30, sem check operadores |

---

## 21. EXPORTS — API Publica (linha 3384-3385)

### Funcoes exportadas

```
mulberry32, scheduleAll, scoreSchedule, runOptimization,
createSetupCrew, createCalcoTimeline, createToolTimeline,
setupCountByShift, autoRouteOverflow, sumOverflow,
validateSchedule, quickValidate, capAnalysis, opDemand,
transformPlanState, tci,
C, TC, S0, T1, S1, OEE, DAY_CAP, SCAP,
KNOWN_FOCUS, OBJECTIVE_PROFILES
```

### Tipos exportados

```
Block, EOp, ETool, EMachine, EngineData, OptResult,
AreaCaps, DayAreaCaps, MoveAction, Decision,
Violation, ValidationReport, QuickValidateResult,
DayLoad, OpDay, DispatchRule, ObjectiveProfile
```

---

## 22. FUNCOES REMOVIDAS

| Funcao | Razao | Data |
|--------|-------|------|
| `scheduleDay` | Dead code. DEC-0002 hard-coded (empurrava ops inteiras para turno seguinte em vez de dividir). `scheduleAll` chama `scheduleBatch` directamente. | 2026-03-01 |

---

## 23. INCOMPOL PLAN — Modulo Standalone Extraido

**Directorio**: `/Users/martimnicolau/Documents/INCOMPOL PLAN/`
**Build**: `npm run build` (TypeScript strict) · `npm run test` (Vitest, 111 tests, 0 falhas)

Logica de scheduling extraida do NikufraEngine como modulo TypeScript puro (sem React, sem side effects).
Governado pela **Especificacao Normativa de Logica** — fonte de verdade para todas as decisoes de scheduling.

### Principios da Spec Normativa

1. **Todas as constraints HARD** — conceito "soft" eliminado. Hard = tentar alternativas, se impossivel = INFEASIBLE formal.
2. **Operacoes nunca desaparecem** — `type: 'infeasible'` + InfeasibilityEntry no relatorio.
3. **Sem invencao de dados** — setup desconhecido = 0 (nao 0.75h). MO desconhecida = agenda + DATA_MISSING.
4. **FeasibilityReport** — cada scheduling run produz: totalOps, feasibleOps, infeasibleOps, entries[], byReason, feasibilityScore.
5. **DecisionRegistry** — fonte unica de explainability. Tipos: DATA_MISSING, INFEASIBILITY_DECLARED, DEADLINE_CONSTRAINT, OPERATOR_REALLOCATION, etc.

### Tipos de Inviabilidade

| Razao | Quando |
|-------|--------|
| SETUP_CREW_EXHAUSTED | Sem slot setup em nenhum turno/dia |
| OPERATOR_CAPACITY | MO insuficiente apos realocacao |
| TOOL_CONFLICT | Tool ocupada em todas as janelas |
| CALCO_CONFLICT | Calco ocupado em todas as janelas |
| DEADLINE_VIOLATION | Impossivel cumprir Prz.Fabrico |
| MACHINE_DOWN | Maquina parada, sem alternativa |
| CAPACITY_OVERFLOW | Capacidade total esgotada |
| DATA_MISSING | Dados essenciais em falta |

### Block Type Actualizado

```typescript
type: 'ok' | 'blocked' | 'overflow' | 'infeasible'
// Novos campos:
infeasibilityReason?: InfeasibilityReason
infeasibilityDetail?: string
hasDataGap?: boolean
dataGapDetail?: string
```
