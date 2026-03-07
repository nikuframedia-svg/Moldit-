# INCOMPOL PLAN — Documento Completo da Lógica do Software

## Versão V3 corrigida (Auditoria V1+V2) — 30 erros corrigidos, 21 secções, 65 ficheiros

---

## 1. VISÃO GERAL DA ARQUITECTURA

O INCOMPOL PLAN é um **motor de planeamento de produção** puro em TypeScript para a fábrica Nikufra. Não tem interface gráfica — é uma biblioteca de funções puras sem efeitos colaterais (sem React, sem browser APIs).

O sistema resolve o seguinte problema: **dado um conjunto de máquinas, ferramentas, operações com procura diária, restrições de operadores e estado de falhas, determinar a sequência óptima de produção minuto-a-minuto para cada máquina, respeitando TODAS as restrições como HARD constraints.**

### Princípio fundamental: "Nunca inventar dados"

Quando falta informação (ex: MO desconhecido), o sistema **não assume valores** — agenda na mesma mas marca o bloco com `hasDataGap=true` e regista uma decisão `DATA_MISSING`. Nenhuma operação desaparece silenciosamente do Gantt.

---

## 2. CONSTANTES DE PRODUÇÃO E AS SUAS RELAÇÕES CAUSAIS

Ficheiro: `src/constants.ts`

### 2.1 Limites Temporais dos Turnos

```
S0 = 420 min (07:00)    → Início do turno X
T1 = 930 min (15:30)    → Mudança X→Y
S1 = 1440 min (24:00)   → Fim do turno Y / Fim dos 2 turnos
S2 = 1860 min (07:00+1) → Fim do turno Z (3.º turno excepcional)
```

**Causalidade:** Estes valores definem os **limites físicos** dentro dos quais o slot allocator pode alocar produção. Quando `cMin < T1`, estamos no turno X; quando `T1 <= cMin < S1`, estamos no turno Y; quando `S1 <= cMin < S2` (se 3.º turno activo), estamos no turno Z.

O slot allocator usa `curShEnd()` que retorna T1, S1 ou S2 conforme a posição do cursor — isto determina quantos minutos restam no turno actual.

### 2.2 Capacidade da Máquina

```
DAY_CAP = S1 - S0 = 1440 - 420 = 1020 minutos
```

**DAY_CAP é o tempo físico disponível numa máquina por dia (2 turnos).** A máquina tem SEMPRE 1020 minutos disponíveis por dia. Este valor NUNCA é reduzido pelo OEE.

Quando o 3.º turno está activo: `eDayCap = S2 - S0 = 1860 - 420 = 1440 minutos`.

**Onde é usado:**
- `slot-allocator.ts`: `rawAvail = shEnd - cMin` — tempo físico real, não ajustado por OEE
- `load-leveler.ts`: `util = usedMin / DAY_CAP` — utilização calculada contra 1020 min
- `score-schedule.ts`: `u = (dc.prod + dc.setup) / DAY_CAP` — KPI de utilização
- `validate-schedule.ts`: comparação `totalMin > eDayCap` para detecção de sobre-capacidade

### 2.3 OEE — COMO REALMENTE FUNCIONA NO SISTEMA

```
DEFAULT_OEE = 0.66
```

**O OEE NÃO REDUZ O TEMPO DISPONÍVEL DA MÁQUINA.** O OEE influencia APENAS o tempo de produção de cada peça — inflaciona o `prodMin` no demand-grouper.

**Cadeia causal exacta do OEE:**

1. Cada ferramenta pode ter o seu próprio `tool.oee` (opcional). Se não tiver, usa-se `DEFAULT_OEE = 0.66`.
2. No `demand-grouper.ts` (linha 84-85):
   ```
   const effectiveOee = tool.oee ?? oee    // oee = DEFAULT_OEE
   const prodMin = (prodQty / tool.pH) * 60 / effectiveOee
   ```
3. **Interpretação:** Se a ferramenta produz 100 pç/h (`tool.pH = 100`) e precisamos de 1000 peças:
   - Tempo teórico = `(1000/100) * 60 = 600 min`
   - Tempo real com OEE = `600 / 0.66 = 909 min`
   - O OEE faz cada peça "custar" mais minutos de produção
4. No slot allocator, estes 909 min são consumidos contra os 1020 min físicos reais da máquina
5. A máquina NÃO fica com "673 min disponíveis" — tem 1020 min, mas a produção é mais lenta

**Confirmação no código** (`validate-schedule.ts`, linha 137-138):
> "OEE is already baked into production times (prodMin inflated by 1/OEE), so DAY_CAP is the only relevant threshold."

### 2.4 SCAP — Para que serve realmente

```
DEFAULT_SCAP = Math.round(DAY_CAP * DEFAULT_OEE) = Math.round(1020 * 0.66) = 673
```

**O SCAP é uma heurística usada APENAS no MRP e na regra de dispatch CR.** Nunca é usado no slot allocator para determinar tempo disponível.

**Onde o SCAP é usado:**
1. **MRP Lead Time** (`mrp-engine.ts`, linha 149):
   ```
   leadDays = Math.max(1, Math.ceil((setupMin + prodMinPerLot) / scap))
   ```
   Estima quantos dias de calendário são necessários para produzir um lote.

2. **RCCP Available Capacity** (`mrp-engine.ts`, linha 87):
   ```
   const avail = capacityOverrides?.[m.id]?.[d] ?? cfg.scap
   ```
   Capacidade disponível para o rough-cut capacity plan.

3. **CR Dispatch Rule** (`dispatch-rules.ts`, linha 57):
   ```
   const crA = a.edd <= 0 ? 0 : a.edd / Math.max(a.totalProdMin / scap, 0.01)
   ```
   Critical Ratio: `tempo restante / tempo de processamento` (normalizado pelo SCAP).

### 2.5 Parâmetros de Scheduling

| Constante | Valor | Onde é Usado | Efeito Causal |
|---|---|---|---|
| `BUCKET_WINDOW` | 5 dias | demand-grouper | Se `tool.lt = 0` (sem lote económico), agrupa procura em janelas de 5 dias úteis |
| `MAX_EDD_GAP` | 5 dias | dispatch-rules | Distância máxima de EDD entre buckets do mesmo tool para permitir merge (evitar setups redundantes) |
| `MAX_AUTO_MOVES` | 50 | auto-route-overflow | Limite de movimentos automáticos de overflow por corrida |
| `MAX_OVERFLOW_ITER` | 3 | auto-route-overflow | Iterações máximas do algoritmo greedy de overflow |
| `ALT_UTIL_THRESHOLD` | 0.95 | auto-route-overflow | Máquina alternativa só aceita overflow se utilização < 95% |
| `OTD_TOLERANCE` | 1.0 | score-schedule | Tolerância de entrega: 1.0 = deadline é hard constraint |
| `LEVEL_LOW_THRESHOLD` | 0.50 | load-leveler | Dia "leve" se utilização < 50% |
| `LEVEL_HIGH_THRESHOLD` | 0.85 | load-leveler | Dia "pesado" se utilização > 85% |
| `LEVEL_LOOKAHEAD` | 15 dias | load-leveler | Quantos dias úteis para trás procurar dias leves |
| `SPLIT_MIN_FRACTION` | 0.30 | auto-replan (split) | Fracção mínima da operação para aceitar split (30%) |
| `SPLIT_MIN_DEFICIT` | 60 min | auto-replan (split) | Déficit mínimo em minutos para justificar split |
| `MAX_ADVANCE_DAYS` | Infinity | auto-replan (advance) | Limite de antecipação: sem limite (Infinity) |
| `ADVANCE_UTIL_THRESHOLD` | 0.95 | auto-replan (advance) | Só antecipa se dia-destino tem utilização < 95% |
| `DEFAULT_OVERTIME_MAX_PER_MACHINE` | 450 min | auto-replan (overtime) | Máximo de horas extra por máquina por dia (7h30) |
| `DEFAULT_OVERTIME_MAX_TOTAL` | 2700 min | auto-replan (overtime) | Máximo de horas extra total por dia (45h) |
| `DEFAULT_MO_CAPACITY` | 99 | operator-pool | Valor sentinela: se MO >= 99, dados são desconhecidos → flag DATA_MISSING |

### 2.6 Máquinas de Foco

```
KNOWN_FOCUS = { 'PRM019', 'PRM020', 'PRM031', 'PRM039', 'PRM042', 'PRM043' }
```

As 6 prensas principais da fábrica Nikufra.

---

## 3. TIPOS DE DADOS — O MODELO DO DOMÍNIO

### 3.1 Dados de Entrada (NikufraData → `types/core.ts`)

**NikufraMachine:**
- `id`: Identificador da máquina (ex: "PRM019")
- `area`: Área de produção (legacy — o modelo actual usa zonas: BIG_PRESSES, MEDIUM_PRESSES)
- **Causalidade:** A zona (derivada do `machineId` via `WorkforceConfig`) determina qual pool de operadores é consultado. PRM019 está na zona BIG_PRESSES.

**NikufraTool:**
- `id`: Identificador da ferramenta (ex: "BWI003")
- `m`: Máquina primária onde a ferramenta opera
- `alt`: Máquina alternativa (ou "-" se não existe)
- `s` (sH): Horas de setup (ex: 1.5h)
- `pH`: Peças por hora (taxa de produção)
- `op`: Operadores necessários (1 ou 2)
- `lt`: Lote económico (quantidade mínima)
- `stk`: Stock actual da ferramenta
- `skus`: Array de SKUs produzidos por esta ferramenta
- `nm`: Nomes dos SKUs
- `mp`: Material Part (código de matéria-prima)
- `oee`: OEE específico da ferramenta (opcional)
- `calco`: Código do calço (recurso partilhado)

**Cadeia causal das variáveis da ferramenta:**
- `pH` → Determina `prodMin` no demand-grouper: `prodMin = (qty / pH) * 60 / oee`. Uma `pH` mais alta = menos minutos por peça = mais capacidade livre.
- `sH` → Convertido em `setupMin = sH * 60`. O setup é agendado pelo SetupCrew (max 1 em simultâneo). Setup de 2h ocupa 120 min do turno.
- `op` → Quantos operadores a ferramenta necessita. Se `op = 2`, consome 2 slots do OperatorPool quando em produção.
- `lt` → Define o lote económico. Se `lt = 500` e precisamos de 300 peças, produzimos 500 (arredondamento para cima). Se `lt = 0`, produzimos exactamente o necessário.
- `alt` → Máquina alternativa. Permite ao auto-route-overflow mover operações se a máquina primária não tem capacidade.
- `mp` → Material Part. O dispatch-rules agrupa ferramentas com o mesmo MP consecutivamente para reduzir trocas de material.
- `calco` → Calço. Recurso partilhado entre ferramentas — só um calço pode estar em uso de cada vez (CalcoTimeline HARD constraint).
- `oee` → Se definido, sobrepõe o DEFAULT_OEE para esta ferramenta específica. Afecta directamente o prodMin.
- `stk` → Stock actual. Usado no MRP para netting: `projected = stk - backlog - grossReq`.

**NikufraOperation (EOp):**
- `id`: Identificador da operação
- `t`: Tool ID (ferramenta que produz)
- `m`: Máquina atribuída
- `sku`: Código do SKU
- `nm`: Nome do SKU
- `d[]`: Array de procura diária (índice = dia, valor = quantidade necessária). **IMPORTANTE:** Estes valores NÃO são procura directa quando vêm do ISOP — são NP (Necessidades de Produção) acumulados. Positivo = sobra stock, Negativo = falta acumulada. O software transforma-os em procura diária via pipeline de 3 passos em `transformPlanState()`: (1) `deltaizeCumulativeNP()` — converte cumulativo em delta dia-a-dia, (2) filtra valores negativos (que representam faltas), (3) normaliza. No modo `raw_np`, stock inicial vem dos valores NP positivos (não da coluna STOCK-A).
- `atr`: Atraso (backlog) — procura por cumprir de períodos anteriores
- `ltDays`: Lead time em dias úteis (Prazo de Fabrico)
- `stk`: Stock ao nível do SKU (opcional)
- `wip`: Work-in-progress (opcional, usado no stock inicial do MRP: `projected = stk + wip - backlog`)

**Cadeia causal das variáveis da operação:**
- `d[]` → A procura diária (após transformação do NP) alimenta TUDO: demand-grouper agrupa em buckets, o EDD é derivado do último dia com procura positiva, o MRP calcula necessidades brutas.
- `atr` → Backlog torna-se um bucket urgente com EDD=0 (prioridade máxima). No MRP: `projected = stk - atr`.
- `ltDays` → Usado pelo backward-scheduler. Se `ltDays = 5`, a produção não pode começar antes de 5 dias úteis antes do delivery date. Protege contra antecipação excessiva.

**NikufraData (estrutura completa de entrada):**
- `machines[]`: Lista de máquinas
- `tools[]`: Lista de ferramentas
- `operations[]`: Lista de operações com procura
- `dates[]`: Labels de datas do horizonte
- `days_label[]`: Nomes dos dias (Seg, Ter, etc.)
- `mo`: Operadores disponíveis por turno (legacy). No modelo actual, a capacidade vem da `WorkforceConfig` por zona/turno.
- `thirdShift`: boolean — 3.º turno activo?

---

## 4. O PIPELINE DE SCHEDULING — 13 PASSOS

A função principal é `scheduleAll()` em `src/scheduler/scheduler.ts`. É uma função pura que recebe `ScheduleAllInput` e retorna `ScheduleAllResult`.

### Passo 1: Shipping Deadlines (`computeShippingDeadlines`) — CORRE PRIMEIRO

**Ficheiro:** `src/scheduler/shipping-cutoff.ts`

**O que faz:** Quando o novo pipeline está activo (`shippingCutoff`), calcula os deadlines de expedição para cada operação. Também computa o conteúdo de trabalho (`computeWorkContent`) e a evolução do déficit (`computeDeficitEvolution`).

**Sub-passos (todos executados em Step 1):**
1. `computeShippingDeadlines(ops, workdays, nDays, shippingCutoff, registry)` — deadlines de shipping
2. `computeWorkContent(ops, toolMap, registry)` — conteúdo de trabalho por operação
3. `computeDeficitEvolution(ops, toolMap, nDays)` — evolução do déficit ao longo do horizonte

**Causalidade:** Os deadlines calculados aqui alimentam o scoring de operações (Passo 2b) e o enforcement de deadlines (Passo 7.5). Decisão `SHIPPING_CUTOFF` registada no registry.

### Passo 1b: Backward Scheduling (`computeEarliestStarts`) — SEMPRE corre

**Ficheiro:** `src/scheduler/backward-scheduler.ts`

**O que faz:** Para cada operação com `ltDays > 0`, calcula o dia mais cedo em que a produção PODE começar, contando para trás a partir da data de entrega. Quando o novo pipeline está activo, é informacional (o shipping deadline tem prioridade).

**Algoritmo:**
1. Construir lista de índices de dias úteis (workDayIndices)
2. Para cada operação com ltDays > 0:
   - Encontrar o ÚLTIMO dia com procura positiva (= delivery date)
   - Encontrar a posição desse dia na lista de dias úteis
   - Contar para trás `ltDays` dias úteis
   - Resultado: `earliestDayIdx` — dia mais cedo para iniciar produção

**Exemplo:**
- Operação com ltDays=5, última procura no dia 12
- Dias úteis antes do dia 12: [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12] (saltando fins-de-semana)
- 5 dias úteis antes = dia 7
- earliestDayIdx = 7

**Causalidade:** O `earliestDayIdx` é passado como metadados nos SkuBuckets e usado pelo load-leveler como restrição: blocos não podem ser movidos para antes de `earliestDayIdx`. Também registado no DecisionRegistry como decisão `BACKWARD_SCHEDULE`.

### Passo 2b: Scoring de Operações (`scoreOperations`) — quando scoring activo

**Ficheiro:** `src/scheduler/production-scorer.ts`

**O que faz:** Quando o sistema de scoring está activo, calcula uma pontuação composta para cada operação baseada no conteúdo de trabalho, evolução do déficit e deadlines de shipping. Esta pontuação é usada no Passo 3 para ordenar os grupos (substituindo as dispatch rules legacy).

**Causalidade:** O scoring alimenta `sortGroupsByScore()` no Passo 3, que substitui as dispatch rules (EDD/CR/WSPT/SPT) por uma ordenação determinística baseada em custo.

### Passo 2: Agrupamento da Procura (`groupDemandIntoBuckets`)

**Ficheiro:** `src/scheduler/demand-grouper.ts`

**O que faz:** Transforma a procura diária plana de cada operação em "buckets" estruturados, agrupados por ferramenta e máquina.

**Estrutura de saída:** `Record<machineId, ToolGroup[]>`

Cada `ToolGroup` contém:
- `toolId`, `machineId`
- `edd`: Earliest Due Date (último dia de procura no bucket)
- `setupMin`: Tempo de setup em minutos (`tool.sH * 60`)
- `totalProdMin`: Soma dos prodMin de todos os SKUs
- `skus[]`: Array de SkuBuckets

Cada `SkuBucket` contém:
- `prodQty`: Quantidade a produzir (arredondada ao lote económico)
- `prodMin`: Tempo de produção em minutos (AQUI ENTRA O OEE)
- `edd`: Due date
- `blocked`/`reason`: Se a ferramenta ou máquina está down

**Algoritmo detalhado:**

1. **Para cada operação:**
   - Determinar máquina efectiva (se há MoveAction, usar `toM`; senão, usar `op.m`)
   - Verificar estado: ferramenta down? máquina down?
     - Com temporal failures: só bloqueia se `isFullyDown()` para TODO o horizonte
     - Sem temporal failures: consulta mapa binário `mSt`/`tSt`
   - Se `op.atr > 0`: criar bucket urgente com EDD=0

2. **Splitting em buckets:**
   - **Com lote económico (`lt > 0`):** Acumular procura diária até `accQty >= lt`, depois emitir bucket
   - **Sem lote económico (`lt = 0`):** Acumular procura por janelas de `BUCKET_WINDOW` (5) dias úteis
   - O EDD de cada bucket = ÚLTIMO dia com procura no bucket (não o primeiro)
   - Sempre emitir o último bucket se sobra procura acumulada

3. **Cálculo do prodMin (ONDE O OEE ENTRA):**
   ```
   prodQty = lt > 0 ? Math.ceil(accQty / lt) * lt : accQty
   effectiveOee = tool.oee ?? DEFAULT_OEE
   prodMin = (prodQty / tool.pH) * 60 / effectiveOee
   ```

   **Interpretação causal:**
   - `accQty` = procura acumulada bruta
   - `prodQty` = quantidade ajustada ao lote económico (sempre >= accQty)
   - `tool.pH` = peças por hora da ferramenta
   - `(prodQty / tool.pH) * 60` = minutos teóricos (100% eficiência)
   - `/ effectiveOee` = minutos reais (inflacionados pelo OEE)
   - Se OEE = 0.66, os minutos reais são 1.52x os teóricos

4. **Agrupamento em ToolGroups:**
   - Cada ToolGroup = 1 ferramenta + 1 EDD bucket numa máquina
   - Se dois SKUs usam a mesma ferramenta e caem no mesmo bucket de EDD, ficam no mesmo ToolGroup
   - O `totalProdMin` do grupo = soma dos prodMin dos SKUs

### Passo 3: Ordenação e Merge de Grupos (`sortAndMergeGroups`)

**Ficheiro:** `src/scheduler/dispatch-rules.ts`

**O que faz:** Para cada máquina, ordena os ToolGroups pela regra de dispatch escolhida e depois aplica merges para reduzir setups redundantes.

**Sub-passos:**

**3a. Sort pela Dispatch Rule:**

Supply Boost tem SEMPRE prioridade primária. Se um opId tem boost > 0, é agendado primeiro (boost maior = primeiro).

Depois do boost, aplica-se a regra:

- **EDD (Earliest Due Date):** EDD menor primeiro. Desempate: maior produção primeiro.
  ```
  a.edd !== b.edd ? a.edd - b.edd : b.totalProdMin - a.totalProdMin
  ```

- **CR (Critical Ratio):** `(tempo restante) / (tempo de processamento)`. Menor CR = mais urgente.
  ```
  cr = edd / max(totalProdMin / scap, 0.01)
  ```
  NOTA: aqui o SCAP é usado como divisor para normalizar o tempo de processamento em "dias equivalentes".

- **WSPT (Weighted Shortest Processing Time):** `totalQty / totalProdMin` descendente. Maximiza output por minuto.

- **SPT (Shortest Processing Time):** `totalProdMin` ascendente. Minimiza tempo médio de espera.

**3b. Tool Merge (`mergeConsecutiveTools`):**

Após o sort, pode acontecer: Tool-A-bucket1 → Tool-B → Tool-A-bucket2, causando 2 setups para Tool-A. O merge puxa Tool-A-bucket2 para junto de bucket1, MAS SÓ se o gap de EDD <= `MAX_EDD_GAP` (5 dias), para não atrasar entregas intermédias.

**3c. Material Part Merge (`mergeMaterialParts`):**

Agrupa ferramentas com o mesmo código `mp` (Material Part) consecutivamente. Reduz trocas de material (mesma bobina/chapa serve várias ferramentas). Mesma restrição de EDD gap.

**3d. Sort SKUs dentro dos grupos (`sortSkusWithinGroups`):**

Dentro de cada ToolGroup, os SKUs são ordenados:
1. Backlog (`atr > 0`) primeiro
2. Stock zero com lote económico primeiro
3. Maior quantidade primeiro (desempate)

### Passo 4: Ordenação das Máquinas (`orderMachinesByUrgency`)

**O que faz:** Determina em que ordem as máquinas são processadas pelo slot allocator.

**Algoritmo:**
- Máquinas com o grupo mais urgente (pelo comparador de dispatch) vão primeiro
- Desempate: máquinas com ferramentas sem alternativa (`hasAlt = false`) têm prioridade, porque não podem ser reroteadas

**Causalidade:** Isto é crucial porque o SetupCrew e o ToolTimeline são recursos GLOBAIS. Agendar PRM042 primeiro (que tem 6 ferramentas sem alternativa) garante que estas ferramentas críticas conseguem slots antes de máquinas com mais flexibilidade.

### Passo 5: Alocação por Slots (`scheduleMachines`) — O CORAÇÃO DO SISTEMA

**Ficheiro:** `src/scheduler/slot-allocator.ts`

**O que faz:** Percorre cada máquina (na ordem do Passo 4), e para cada ToolGroup, aloca minuto-a-minuto os turnos, respeitando as 3 restrições HARD + 1 SOFT (operadores).

**4 tipos de bloco possíveis:**
- `'ok'` — produção agendada com sucesso
- `'blocked'` — máquina ou ferramenta indisponível (down)
- `'overflow'` — capacidade insuficiente no horizonte
- `'infeasible'` — violação de hard constraint ou deadline miss

**Estruturas de constraint:**
- `setupCrew` = `createSetupCrew()` — recurso global, max 1 setup em simultâneo (HARD)
- `toolTL` = `createToolTimeline()` — cada ferramenta só pode estar numa máquina de cada vez (HARD)
- `calcoTL` = `createCalcoTimeline()` — cada calço só pode estar numa máquina de cada vez (HARD)
- `pool` = `createOperatorPool(workforceConfig)` — operadores por zona/turno (SOFT — apenas aviso)

**Cursor de tempo:**
O slot allocator mantém um cursor `(cDay, cMin)` por máquina que avança monotonicamente. `advance()` verifica se o cursor passou do fim do dia e salta para o próximo dia útil. `pushShift()` avança para o próximo turno ou dia.

**Fluxo para cada ToolGroup:**

**A) Setup (se ferramenta muda):**

Se `grp.toolId !== lastTool` e `grp.setupMin > 0`:

1. Tenta até 12 combinações de turno/dia para encontrar slot
2. Para cada tentativa:
   - Verifica se há tempo suficiente no turno: `grp.setupMin <= shEnd - cMin`
   - **SetupCrew check (HARD):** `setupCrew.findNextAvailable(abs, dur, shiftEnd)` — procura gap sem conflitos com outros setups já agendados. Retorna -1 se não cabe no turno.
   - **ToolTimeline check (HARD):** `toolTL.findNextAvailable(toolId, slot, dur, shiftEnd, machineId)` — verifica se a ferramenta não está a ser usada noutra máquina ao mesmo tempo. Retorna -1 se conflito.
3. Se encontrou slot: book setup em setupCrew e toolTL, avançar cursor
4. Se não encontrou após 12 tentativas: **INFEASIBLE** com razão `SETUP_CREW_EXHAUSTED`. Todos os SKUs do grupo ficam com `type='infeasible'`.

**B) Produção por SKU (alocação proporcional):**

Quando um ToolGroup tem múltiplos SKUs e a capacidade restante não chega para todos:

```
needsProportional = skus.length > 1 && totalSkuProdMin > estCapacity
```

Se sim, cada SKU recebe um budget proporcional:
```
fraction = sk.prodMin / totalSkuProdMin
allocBudget = floor(fraction * estCapacity)
```

Isto previne "FIFO starvation" — sem isto, o primeiro SKU consumiria toda a capacidade e os seguintes teriam 0.

**C) Loop de alocação minuto-a-minuto (7 verificações pela ordem EXACTA do código):**

Para cada SKU, enquanto `rem > 0` e `totalAllocated < allocBudget`:

1. **SETUP check (HARD)** — se ferramenta muda (descrito em A acima):
   - SetupCrew: `findNextAvailable()` — max 1 setup simultâneo
   - ToolTimeline durante setup: verifica disponibilidade da ferramenta

2. **ESPAÇO / Capacity Factor (falhas temporais):**
   ```
   rawAvail = shEnd - cMin    // minutos físicos até fim do turno
   capF = mCapFactor(cDay, curShift())
   ```
   Se `capF <= 0`: turno totalmente indisponível → **skip para próximo turno**.
   Se `0 < capF < 1.0`: `avail = floor(rawAvail * capF)` — tempo reduzido.

3. **AVARIA check (inline com espaço):**
   Integrado no capacity factor. Se a máquina tem falha total (`capF = 0`), turno é saltado.

4. **OPERADORES check (SOFT — apenas aviso, NUNCA bloqueia):**
   - Se `shift !== 'Z'` e pool existe:
     - `pool.hasCapacity(dayIdx, shift, operators, machineId)`
     - **Se sem capacidade:** Marca `operatorWarning=true`, regista `OPERATOR_CAPACITY_WARNING` — **mas agenda na mesma**
     - **Se dados desconhecidos (MO >= 99):** Marca `hasDataGap=true`, regista `DATA_MISSING` — **mas agenda na mesma**
     - Em nenhum caso bloqueia ou declara infeasível

5. **CALÇO check (HARD):**
   ```
   calcoTL.findNextAvailable(calcoCode, absStart, duration, shiftEnd)
   ```
   Se o calço está ocupado, adia para quando ficar livre. Se não cabe no turno, avança.
   **Nota:** Calço NÃO tem excepção "mesma máquina OK" (ao contrário da ferramenta).

6. **FERRAMENTA check (HARD):**
   ```
   toolTL.findNextAvailable(toolId, absStart, duration, shiftEnd, machineId)
   ```
   Verifica que a ferramenta não está noutra máquina ao mesmo tempo. Suporta multi-instância (`instances`).

7. **SHIPPING check (quando deadlines activos):**
   ```
   opDeadline.latestFinishAbs    // deadline absoluto
   ```
   Se a alocação ultrapassa o deadline, corta ou termina o loop.

**Após verificações — Book e emitir bloco:**
```
alloc = min(rem, avail, allocBudget - totalAllocated)
bQty = rem <= alloc ? qRem : round(alloc * ppm)     // ppm = prodQty / prodMin
```
Book em: pool, calcoTL, toolTL. Cria bloco `type='ok'` com startMin, endMin, qty, prodMin.

**Overflow:** Se `rem > 0` após esgotar toda a capacidade, cria bloco `type='overflow'` com `overflowMin = rem`.

**O modelo de operadores — Peak Concurrent:**

O OperatorPool não soma bookings cumulativos. Usa "peak concurrent": para cada máquina/turno, regista o MÁXIMO de operadores necessários (pico). O total da zona = soma dos picos de cada máquina na zona.

Exemplo: Se PRM019 precisa de 2 ops e PRM031 precisa de 1 op no turno X do dia 0, o total de BIG_PRESSES = 2 + 1 = 3.

Se PRM019 depois agenda outro SKU com 1 op no mesmo turno, o pico de PRM019 continua 2 (o máximo). O delta = max(0, 1-2) = 0, não soma nada.

### Passo 6: Load Leveling (`levelLoad`)

**Ficheiro:** `src/scheduler/load-leveler.ts`

**O que faz:** Equilibra a carga entre dias, movendo blocos de dias pesados (>85%) para dias leves (<50%).

**Regras:**
- SÓ move para TRÁS (dias anteriores) — nunca atrasa entregas
- Respeita `earliestStart` do backward scheduling
- Só move blocos `type='ok'`
- Novo dia não pode ficar acima de `LEVEL_HIGH_THRESHOLD` depois da mudança
- Procura até `LEVEL_LOOKAHEAD` (15) dias úteis para trás

**Algoritmo:**
1. Para cada máquina, calcular utilização por dia
2. Identificar dias pesados (>85%), ordenar por pior primeiro
3. Para cada dia pesado, identificar blocos candidatos (maiores primeiro)
4. Para cada candidato, procurar dia leve dentro de 15 dias úteis para trás
5. Se encontrado: mover bloco, marcar `isLeveled=true`, registar decisão `LOAD_LEVEL`
6. Reavaliação: se o dia pesado já está <=85%, parar para essa máquina

### Passo 7: Merge de Blocos (`mergeConsecutiveBlocks`)

**Ficheiro:** `src/scheduler/block-merger.ts`

**O que faz:** Une blocos adjacentes da mesma operação no mesmo dia/máquina. Se BWI003/SKU-A produz 200 pcs das 07:00-08:30 e depois 150 pcs das 08:30-10:00, merge num único bloco de 350 pcs das 07:00-10:00.

### Passo 7.5: Enforcement de Deadlines

Após o merge, o scheduler verifica CADA operação:

```
totalDemand = sum(op.d[]) + op.atr
produced = sum(okBlocks.qty)
```

Se `produced < totalDemand`:
1. Converte blocos `overflow` em `infeasible` com razão `DEADLINE_VIOLATION`
2. Gera propostas de remediação (até 5 tipos):
   - `THIRD_SHIFT`: Activar 3.º turno (+420 min/dia)
   - `TRANSFER_ALT_MACHINE`: Mover para máquina alternativa
   - `ADVANCE_PRODUCTION`: Antecipar produção
   - `OVERTIME`: Horas extra (até +450 min/máquina via auto-replan)
   - `FORMAL_RISK_ACCEPTANCE`: Aceitar atraso formalmente

### Passo 8: Feasibility Report

Construído no final de cada corrida:

```typescript
{
  totalOps: number,          // Total de operações analisadas
  feasibleOps: number,       // Agendadas com sucesso
  infeasibleOps: number,     // Declaradas infeasíveis
  entries: InfeasibilityEntry[],  // Detalhe de cada infeasibilidade
  byReason: Partial<Record<InfeasibilityReason, number>>,
  feasibilityScore: number,  // feasibleOps / totalOps (0.0 - 1.0)
  remediations: RemediationProposal[],
  deadlineFeasible: boolean, // true se TODA a procura é coberta
}
```

**O `deadlineFeasible` é crítico:** Quando `false`, o `scoreSchedule()` retorna `score = -Infinity`.

### Passo 9: D+1 Workforce Forecast (`computeWorkforceForecast`)

**Ficheiro:** `src/analysis/workforce-forecast.ts`

**O que faz:** Quando `workforceConfig` está presente, calcula a previsão de mão-de-obra para D+1 (primeiro dia útil >= dia 1). Identifica sobrecarga por zona/turno.

**Saída:** `WorkforceForecast` com:
- `warnings[]`: avisos de sobrecarga (zona, turno, pico projectado vs capacidade)
- `coverageMissing[]`: cobertura em falta (overtime sem zona mapeada, 3.º turno com Z=0)
- `suggestions[]`: sugestões (antecipar, mover, replanear, pedir reforço)

**Decisões registadas:** `WORKFORCE_FORECAST_D1`, `WORKFORCE_COVERAGE_MISSING`

**Causalidade:** Soft warning — NUNCA bloqueia scheduling. Informação para o utilizador tomar decisões preventivas.

### Passo 10: Transparency Report (`buildTransparencyReport`)

**Ficheiro:** `src/analysis/transparency-report.ts`

**O que faz:** Quando o novo pipeline está activo, constrói um relatório de transparência com justificações para cada encomenda, incluindo shipping deadlines, work content, déficits, e metadados de co-produção (twins) e workforce.

**Campos incluídos:** `OrderJustification` com `isTwinProduction?`, `twinPartnerSku?`, `twinOutputs?`, mais `workforceWarnings?` e `workforceForecast?`.

---

## 5. AS 3 RESTRIÇÕES HARD + 1 RESTRIÇÃO SOFT (Operadores)

As 3 primeiras restrições são HARD — nunca relaxadas, nunca violadas. Se uma restrição HARD não pode ser satisfeita, a operação é declarada INFEASIBLE. A 4.ª restrição (operadores) é SOFT — apenas gera aviso, nunca bloqueia.

### 5.1 SetupCrew (Max 1 Setup Simultâneo)

**Ficheiro:** `src/constraints/setup-crew.ts`

**Realidade:** A equipa de setup é um recurso físico único na fábrica. Só pode montar/desmontar uma ferramenta de cada vez.

**Modelo:** Lista de slots `{ start, end, machineId }` em minutos absolutos. `findNextAvailable()` itera sobre todos os slots existentes e encontra um gap onde o novo setup cabe sem conflito.

**Impacto causal:** Se PRM019 tem setup das 07:00-07:30 e PRM020 quer setup às 07:15, PRM020 é adiado para as 07:30. Isto pode causar um efeito cascata se 07:30 + setupMin > shiftEnd, empurrando para o próximo turno ou dia.

### 5.2 ToolTimeline (Ferramenta Única por Máquina)

**Modelo inline** no `slot-allocator.ts` (função `createToolTimeline`).

**Realidade:** Uma ferramenta física só pode estar montada numa máquina de cada vez.

**Modelo:** Lista de slots `{ start, end, machineId }` por toolId. O `findNextAvailable()` verifica conflitos APENAS com outras máquinas (a mesma máquina pode ter a ferramenta continuamente — excepção "mesma máquina OK").

**Multi-instância:** A ferramenta suporta o parâmetro opcional `instances` (default = 1). Se `instances = 2`, até 2 máquinas diferentes podem usar a mesma ferramenta em simultâneo. O conflito só ocorre quando `conflicting.size >= instances`.

**Impacto causal:** Se BWI003 está na PRM019 das 08:00-12:00 e tem `instances=1`, PRM020 não pode usar BWI003 nesse período. Se tiver `instances=2`, PRM020 pode usá-la ao mesmo tempo (há 2 cópias físicas).

### 5.3 CalcoTimeline (Calço Único por Máquina)

**Modelo inline** no `slot-allocator.ts` (função `createCalcoTimeline`).

**Realidade:** Um calço (calco) é um recurso partilhado entre ferramentas — não pode ser usado em duas máquinas ao mesmo tempo.

**Modelo:** Similar ao ToolTimeline mas indexado por `calcoCode` em vez de `toolId`. **Diferença importante:** ao contrário da ToolTimeline, o CalcoTimeline NÃO tem a excepção "mesma máquina OK" — se um calço está reservado por qualquer máquina (incluindo a própria), conta como conflito. Também NÃO suporta multi-instância.

### 5.4 OperatorPool — RESTRIÇÃO SOFT (Apenas Aviso, Nunca Bloqueia)

**Ficheiro:** `src/constraints/operator-pool.ts`

**IMPORTANTE: Esta é a ÚNICA restrição SOFT do sistema.** O OperatorPool NUNCA bloqueia o agendamento e NUNCA declara uma operação como impossível. O scheduler agenda SEMPRE, mesmo sem operadores suficientes, e marca o bloco com uma bandeira de aviso (`operatorWarning=true`).

**Modelo:** Zone-based (não PG1/PG2). As máquinas são agrupadas em zonas:
- **BIG_PRESSES:** PRM019, PRM031, PRM039, PRM043
- **MEDIUM_PRESSES:** PRM042
- Máquinas não mapeadas → sem restrição (unconstrained)

**Capacidade por zona/turno (WorkforceConfig):**
- BIG_PRESSES: X=6, Y=5, Z=0
- MEDIUM_PRESSES: X=9, Y=4, Z=0
- Turno Z nunca é verificado (capacidade não é constante)

**Modelo Peak Concurrent:**
- Para cada máquina/turno/dia, regista o MÁXIMO de operadores necessários (pico)
- Total da zona = soma dos picos de cada máquina na zona (não soma cumulativa)

**Comportamento:**
- Se capacidade excedida → marca `operatorWarning=true` no bloco, regista `OPERATOR_CAPACITY_WARNING` — **mas agenda na mesma**
- Se dados desconhecidos (MO >= 99 ou = 0) → marca `hasDataGap=true`, regista `DATA_MISSING` — **mas agenda na mesma**
- Em NENHUM caso a operação é bloqueada ou declarada infeasível por operadores

---

## 6. SISTEMA DE DECISÕES (Decision Registry) — 27 Tipos

**Ficheiro:** `src/decisions/decision-registry.ts`
**Tipos:** `src/types/decisions.ts`

Log append-only de TODAS as decisões tomadas durante o scheduling. Cada decisão tem:

```typescript
{
  id: string,           // "dec_1710000000_1"
  type: DecisionType,   // Ver lista abaixo (27 tipos)
  timestamp: number,
  opId?: string,
  toolId?: string,
  machineId?: string,
  dayIdx?: number,
  shift?: 'X' | 'Y' | 'Z',
  detail: string,       // Texto explicativo
  metadata?: Record<string, any>,
}
```

**27 Tipos de decisão (completos, do código `src/types/decisions.ts`):**

| Tipo | Quando é Registado |
|---|---|
| `BACKWARD_SCHEDULE` | EarliestStart calculado pelo backward-scheduler |
| `LOAD_LEVEL` | Bloco movido pelo load leveler |
| `OVERFLOW_ROUTE` | Operação movida para máquina alternativa (auto-route) |
| `ADVANCE_PRODUCTION` | Produção antecipada para dia anterior |
| `DATA_MISSING` | MO desconhecido, pH=0, setup em falta |
| `INFEASIBILITY_DECLARED` | Operação não pode ser agendada |
| `DEADLINE_CONSTRAINT` | Deadline não pode ser cumprido |
| `OPERATOR_REALLOCATION` | Operador emprestado de outra área |
| `ALTERNATIVE_MACHINE` | Operação movida para máquina alternativa |
| `TOOL_DOWN` | Ferramenta indisponível (falha temporal) |
| `MACHINE_DOWN` | Máquina indisponível (falha temporal) |
| `FAILURE_DETECTED` | Falha detectada no timeline |
| `FAILURE_MITIGATION` | Acção de mitigação aplicada |
| `FAILURE_UNRECOVERABLE` | Falha sem recuperação possível |
| `SHIPPING_CUTOFF` | Deadline de shipping aplicado |
| `PRODUCTION_START` | Início de produção registado |
| `CAPACITY_COMPUTATION` | Cálculo de capacidade efectuado |
| `SCORING_DECISION` | Decisão baseada em scoring |
| `OPERATOR_CAPACITY_WARNING` | Aviso: operadores insuficientes (soft constraint) |
| `AUTO_REPLAN_ADVANCE` | Auto-replan: antecipação de produção |
| `AUTO_REPLAN_MOVE` | Auto-replan: movimento para máquina alternativa |
| `AUTO_REPLAN_SPLIT` | Auto-replan: divisão de operação entre máquinas |
| `AUTO_REPLAN_OVERTIME` | Auto-replan: horas extra atribuídas |
| `AUTO_REPLAN_THIRD_SHIFT` | Auto-replan: 3.º turno activado |
| `TWIN_VALIDATION_ANOMALY` | Anomalia na validação de peças gémeas |
| `WORKFORCE_FORECAST_D1` | Previsão de mão-de-obra D+1 |
| `WORKFORCE_COVERAGE_MISSING` | Cobertura de workforce insuficiente |

**Causalidade:** O DecisionRegistry é criado no início de `scheduleAll()` e passado por TODOS os passos do pipeline. No final, `registry.getAll()` é incluído no resultado para rastreabilidade completa.

---

## 7. SISTEMA DE INFEASIBILIDADE

**Ficheiro:** `src/types/infeasibility.ts`

Quando uma operação não pode ser agendada, é declarada INFEASIBLE com uma razão estruturada.

**10 Razões de Infeasibilidade:**

| Razão | Significado |
|---|---|
| `SETUP_CREW_EXHAUSTED` | Nenhum slot disponível para setup em nenhum turno/dia |
| `OPERATOR_CAPACITY` | Operadores insuficientes após tentativas de reallocation |
| `TOOL_CONFLICT` | Ferramenta ocupada em todas as janelas disponíveis |
| `CALCO_CONFLICT` | Calço ocupado em todas as janelas disponíveis |
| `DEADLINE_VIOLATION` | Produção insuficiente para cobrir procura |
| `MACHINE_DOWN` | Máquina inactiva sem alternativa |
| `CAPACITY_OVERFLOW` | Capacidade total da máquina esgotada no horizonte |
| `DATA_MISSING` | Dados essenciais em falta |
| `MACHINE_PARTIAL_DOWN` | Máquina com capacidade reduzida insuficiente |
| `TOOL_DOWN_TEMPORAL` | Ferramenta indisponível num período específico |

**7 Tipos de Remediação:**

| Tipo | Automática? | Ganho |
|---|---|---|
| `THIRD_SHIFT` | Não | +420 min/dia |
| `EXTRA_OPERATORS` | Não | Variável |
| `OVERTIME` | Não | Até +450 min/máquina (2700 total) |
| `SPLIT_OPERATION` | Sim | Dividir entre máquinas |
| `ADVANCE_PRODUCTION` | Sim | Antecipar produção |
| `TRANSFER_ALT_MACHINE` | Sim | Mover para alternativa |
| `FORMAL_RISK_ACCEPTANCE` | Não | 0 (aceitar atraso) |

---

## 8. SISTEMA DE FALHAS TEMPORAIS

**Ficheiro:** `src/failures/failure-timeline.ts`

Modelo que permite falhas com granularidade temporal (dia/turno/capacityFactor).

### 8.1 FailureEvent

```typescript
{
  id: string,
  resourceType: 'machine' | 'tool',
  resourceId: string,
  startDay: number,
  startShift: ShiftId | null,
  endDay: number,
  endShift: ShiftId | null,
  severity: 'total' | 'major' | 'minor' | 'degraded',
  capacityFactor: number,    // 0.0 = totalmente down, 0.5 = metade da capacidade
  description: string,
}
```

### 8.2 ResourceTimeline

Estrutura: `Array<Record<ShiftId, DayShiftCapacity>>` — array indexado por dia, cada dia tem mapa de turno para capacidade.

```typescript
DayShiftCapacity = {
  status: 'running' | 'degraded' | 'partial' | 'down',
  capacityFactor: number,    // 0.0 - 1.0
  failureIds: string[],
}
```

### 8.3 Como as falhas afectam o scheduling

1. **No demand-grouper:** Se recurso está `isFullyDown()` para TODO o horizonte → bucket bloqueado
2. **No slot-allocator:** `capF = getTimelineCap(machineTimelines[mId], cDay, curShift())`
   - Se `capF <= 0`: turno totalmente indisponível, skip
   - Se `0 < capF < 1.0`: `avail = floor(rawAvail * capF)` — tempo disponível reduzido
   - Se `capF = 1.0`: sem efeito

**Exemplo:** Máquina PRM019 com falha `capacityFactor=0.5` no turno X do dia 3:
- rawAvail = 510 min (07:00-15:30)
- avail = floor(510 * 0.5) = 255 min
- A máquina só pode produzir 255 min nesse turno

### 8.4 Sobreposição de falhas

Quando múltiplas falhas afectam o mesmo recurso/dia/turno, usa-se o **mínimo** (pior caso):
```
newFactor = Math.min(slot.capacityFactor, fe.capacityFactor)
```

### 8.5 Impact Analysis

**Ficheiro:** `src/failures/impact-analysis.ts`

`analyzeFailureImpact()`: Compara blocos agendados com o timeline de falhas. Para cada bloco afectado:
```
qtyAtRisk = block.qty * (1 - capacityFactor)
```

### 8.6 Cascading Replan

**Ficheiro:** `src/failures/cascading-replan.ts`

`cascadingReplan()`: Quando uma falha é introduzida:
1. Constrói timelines
2. Gera mitigation moves (mover blocos afectados para alternativas)
3. Re-executa `scheduleAll()` com os moves de mitigação

---

## 9. OVERFLOW E AUTO-REPLAN

### 9.1 Auto-Route Overflow (básico)

**Ficheiro:** `src/overflow/auto-route-overflow.ts`

**O que faz:** Quando há blocos overflow/infeasible com máquina alternativa disponível, tenta mover operações automaticamente.

**Algoritmo greedy:**
1. Executar schedule inicial com moves do utilizador
2. Se não há overflow: retornar imediatamente
3. Para cada iteração (max `MAX_AUTO_MOVES * MAX_OVERFLOW_ITER` = 50 × 3 = 150):
   a. Encontrar blocos overflow com alternativa disponível
   b. Ordenar por maior overflow primeiro
   c. Para o melhor candidato:
      - Verificar se máquina alternativa não está down
      - Verificar se utilização da alternativa < `ALT_UTIL_THRESHOLD` (95%)
      - Verificar se tem >= 30 min restantes
   d. Mover operação, re-agendar, verificar se melhorou
   e. Se piorou: desfazer, tentar próximo candidato
4. Parar quando não há melhoria ou limites atingidos

**Nota:** Durante as iterações, `enableLeveling=false` e `enforceDeadlines=false` para performance. O resultado final é depois nivelado no chamador.

### 9.2 Sistema AUTO-REPLAN Completo

**Ficheiros:**
- `src/overflow/auto-replan.ts` (814 linhas) — orquestrador + 5 estratégias
- `src/overflow/auto-replan-config.ts` (95 linhas) — configuração + defaults
- `src/overflow/auto-replan-control.ts` (496 linhas) — API de controlo do utilizador
- `src/overflow/strategies/overtime-strategy.ts` — estratégia de horas extra
- `src/overflow/strategies/split-strategy.ts` — estratégia de split
- `src/overflow/strategies/third-shift-strategy.ts` — estratégia de 3.º turno

**O que faz:** Sistema avançado de resolução automática de overflow. Após o scheduling inicial, se existem blocos em overflow, o auto-replan tenta 5 estratégias por ordem de prioridade para eliminar o overflow sem intervenção humana.

#### 5 Estratégias (por ordem de prioridade)

| # | Estratégia | DecisionType | O que faz |
|---|---|---|---|
| 1 | **ADVANCE_PRODUCTION** | `AUTO_REPLAN_ADVANCE` | Antecipa produção para dias anteriores com capacidade livre. Sem limite de dias (`MAX_ADVANCE_DAYS = Infinity`). Só antecipa se utilização do dia-destino < `ADVANCE_UTIL_THRESHOLD` (95%). |
| 2 | **MOVE_ALT_MACHINE** | `AUTO_REPLAN_MOVE` | Move operação para máquina alternativa. Só move se utilização da alternativa < `ALT_UTIL_THRESHOLD` (95%). |
| 3 | **SPLIT_OPERATION** | `AUTO_REPLAN_SPLIT` | Divide operação entre máquina primária e alternativa. Mínimo `SPLIT_MIN_FRACTION` (30%) por lado. Déficit mínimo: `SPLIT_MIN_DEFICIT` (60 min). |
| 4 | **OVERTIME** | `AUTO_REPLAN_OVERTIME` | Atribui horas extra à máquina. Máximo por máquina/dia: `DEFAULT_OVERTIME_MAX_PER_MACHINE` (450 min = 7h30). Máximo total/dia: `DEFAULT_OVERTIME_MAX_TOTAL` (2700 min = 45h). |
| 5 | **THIRD_SHIFT** | `AUTO_REPLAN_THIRD_SHIFT` | Activa o 3.º turno globalmente (+420 min/dia por máquina). Só se `thirdShift` não está já activo e capacidade Z > 0. |

#### Orquestrador (outer loop)

```
maxOuterRounds = 5 (default)
```

**Algoritmo:**
1. **Outer loop** (até `maxOuterRounds` ou overflow = 0):
   - Para cada estratégia (na ordem acima):
     - **Inner loop greedy**: aplica 1 acção de cada vez
     - Após cada acção, re-executa `scheduleAll()` para verificar melhoria
     - Se piorou: desfaz e tenta próximo candidato
     - Se melhorou: mantém e procura mais
   - Se nenhuma estratégia melhorou: para
2. **Capacidade cruzada:** Estratégias mais tardias (ex: overtime) libertam capacidade que permite estratégias mais prioritárias (ex: advance) funcionar na ronda seguinte

#### Tiebreaker D+1 Workforce

Quando existem múltiplos candidatos para ADVANCE ou MOVE, o sistema usa o risco de workforce D+1 como critério de desempate:
```
melhor candidato = min(overflow) → min(D+1 workforce risk)
```

#### Marcação das acções

Cada bloco afectado pelo auto-replan é marcado com:
- `isSystemReplanned = true`
- `replanStrategy`: nome da estratégia (ex: `'ADVANCE_PRODUCTION'`)
- `replanDecisionId`: ID da decisão no registry

#### Configuração (`AutoReplanConfig`)

```typescript
{
  enabled: boolean,                    // default: true
  strategyOrder: string[],             // ['ADVANCE_PRODUCTION', 'MOVE_ALT_MACHINE', 'SPLIT_OPERATION', 'OVERTIME', 'THIRD_SHIFT']
  maxOuterRounds: number,              // default: 5
  maxTotalActions: number,             // limite global de acções
  excludeOps: string[],               // operações NUNCA tocadas pelo auto-replan
  overtimeConfig: { maxPerMachine, maxTotal },
  thirdShiftConfig: { ... },
}
```

#### API de Controlo do Utilizador (6 funções)

**Ficheiro:** `src/overflow/auto-replan-control.ts`

| Função | O que faz |
|---|---|
| `getReplanActions()` | Retorna lista de todas as acções auto-replan com detalhes (para UI) |
| `undoReplanActions(actionIds)` | Desfaz acções específicas — re-executa scheduling sem elas |
| `applyAlternative(actionId, altId)` | Substitui uma acção por uma alternativa (da `AlternativeAction`) |
| `simulateWithout(actionIds)` | Preview rápido: mostra overflow que resulta de remover acções |
| `replanWithUserChoices(choices)` | Controlo total: keep/undo/replace para cada acção, re-executa |
| `getBlockReplanInfo(blockId)` | Contexto completo de replan para um bloco específico |

**Alternativas (`AlternativeAction`):** Cada decisão de auto-replan pode ter alternativas registadas no `DecisionEntry`. O utilizador pode escolher uma alternativa em vez da acção automática.

**Undo funcional:** Desfazer = re-executar `scheduleAll()` sem a acção desfeita. Não há estado mutável — tudo é recalculado de raiz (pureza funcional).

**NOTA CRÍTICA:** As decisões de auto-replan devem ser re-registadas no registry final. O `finalResult.decisions` é um snapshot do último `scheduleAll()`, não um registo "vivo" — por isso o orquestrador reinjeta as decisões após a última corrida.

---

## 10. MRP (Material Requirements Planning) — Nível 0

**Ficheiro:** `src/mrp/mrp-engine.ts`

### 10.1 computeMRP()

Processo principal: itera sobre todas as ferramentas, executa netting per-tool e acumula RCCP.

### 10.2 Netting per-tool (computeToolMRP)

Para cada ferramenta:

1. **Gross Requirements:** Soma `op.d[]` de todas as operações da ferramenta por dia. Acumula `op.atr` como backlog.

2. **Projected Available:**
   ```
   projected = tool.stk + totalWip - totalBacklog
   ```
   Onde `totalWip` = soma de `op.wip` (Work-in-Progress) de todas as operações da ferramenta.
   Para cada dia: `projected -= grossReq[d]`

3. **Net Requirement:** Se `projected < 0`:
   ```
   netReq = abs(projected)
   plannedReceipt = lt > 0 ? ceil(netReq / lt) * lt : netReq
   projected += plannedReceipt
   ```

4. **Lead Time Estimation (onde o SCAP entra):**
   ```
   setupMin = tool.sH * 60
   prodMinPerLot = (leadEstQty / safePH) * 60
   leadDays = max(1, ceil((setupMin + prodMinPerLot) / scap))
   ```
   O SCAP serve como proxy de "minutos produtivos por dia" para estimar quantos dias de calendário um lote demora.

5. **Planned Order Release:**
   ```
   releaseDay = max(0, d - leadDays)
   ```
   Offseta a ordem planeada para o passado, indicando quando a produção deve COMEÇAR.

6. **Coverage Days:** Quantos dias o stock actual cobre a procura futura:
   - Acumula procura dia a dia até exceder stock
   - Interpola o dia parcial de ruptura

### 10.3 RCCP (Rough-Cut Capacity Planning)

Para cada máquina/dia, acumula:
- `setupMin`: setup das ferramentas que têm Planned Order Release nesse dia
- `prodMin`: minutos de produção
- `availableMin`: `capacityOverrides[m][d]` ou `SCAP` (aqui o SCAP serve como capacidade de referência)
- `utilization`: `requiredTotal / available`
- `overloaded`: `requiredTotal > available`

### 10.4 Per-SKU Netting

Quando há stock ao nível do SKU (`op.stk`), o MRP também faz netting individual por SKU, com buckets e coverage separados.

---

## 11. MÓDULOS MRP COMPLEMENTARES

### 11.1 ROP / Safety Stock (`src/mrp/mrp-rop.ts`)

`computeROP()`: Para cada ferramenta:
- **Average Daily Demand:** `avgDD = totalDemand / numDays`
- **Demand Variability (CV):** Coeficiente de variação da procura diária
- **ABC Classification:** Por valor de consumo (A=80%, B=95%, C=100%)
- **XYZ Classification:** Por variabilidade (X: CV<0.5, Y: 0.5-1.0, Z: >1.0)
- **Safety Stock:** `SS = Z-score * CV * avgDD * sqrt(leadDays)`
- **ROP:** `ROP = avgDD * leadDays + SS`

`computeCoverageMatrix()`: Matriz de cobertura dia×ferramenta com status (green/yellow/red).

### 11.2 CTP — Capable-to-Promise (`src/mrp/mrp-ctp.ts`)

`computeCTP()`: Para uma nova encomenda (toolId, qty, requestedDay):
1. Procurar a primeira janela livre no timeline da máquina
2. Verificar capacidade disponível (DAY_CAP - carga existente)
3. Retornar: `{ canPromise, promiseDay, leadDays, capGap }`

### 11.3 Action Messages (`src/mrp/mrp-actions.ts`)

`computeActionMessages()`: Gera alertas accionáveis:

| Tipo | Condição |
|---|---|
| `launch_por` | Planned Order Release > 0 nos primeiros 3 dias |
| `transfer_tool` | Máquina overloaded mas alternativa tem capacidade |
| `advance_prod` | Stockout iminente, antecipação possível |
| `no_alt_risk` | Ferramenta sem alternativa em máquina sobrecarregada |
| `failure_impact` | Falha temporal afecta produção planeada |
| `failure_reroute` | Falha detectada, reroute possível |

### 11.4 What-If (`src/mrp/mrp-what-if.ts`)

`computeWhatIf()`: Aplica mutações à procura e re-executa MRP:
```typescript
WhatIfMutation = {
  toolId: string,
  dayIndex: number,
  deltaQty: number,
  type: 'demand_increase' | 'demand_decrease' | 'new_order',
}
```

---

## 12. SCORING E KPIs

**Ficheiro:** `src/analysis/score-schedule.ts`

`scoreSchedule()` calcula uma pontuação multi-objectivo:

```
score = -(
  100 * tardinessDays
  + 10 * setupCount
  + 1 * setupMin
  + 30 * setupBalance
  + 5 * churn
  + 50 * overflows
  + 5 * belowMinBatch
)
```

Se `deadlineFeasible = false` → `score = -Infinity` (penalidade máxima).

**KPIs calculados:**

| KPI | Fórmula | Significado |
|---|---|---|
| `otd` | `100 - (totalDemand - produced) / totalDemand * 100` | % de procura coberta |
| `otdDelivery` | Verifica cumProd >= cumDemand por cada due date | % de entregas a tempo |
| `setupCount` | Blocos com setupS != null | Número de mudanças de ferramenta |
| `setupMin` | Soma de (setupE - setupS) | Minutos totais gastos em setups |
| `setupBalance` | abs(setups_turno_X - setups_turno_Y) | Equilíbrio de setups entre turnos |
| `capUtil` | Média de (prod+setup)/1020 por máquina/dia | Utilização média |
| `capVar` | Variância da utilização | Dispersão da carga |
| `peakOps` | Máximo de operadores necessários em qualquer dia | Pico de MO |
| `overOps` | Operadores acima da capacidade | Excesso de MO |
| `tardinessDays` | Overflow em dias-equivalentes | Atrasos |
| `churn` | Diferença vs baseline em minutos de start | Estabilidade do plano |

---

## 13. VALIDAÇÃO PÓS-SCHEDULE

**Ficheiro:** `src/analysis/validate-schedule.ts`

`validateSchedule()` verifica o schedule final para 4 tipos de violações:

1. **TOOL_UNIQUENESS:** Mesma ferramenta em 2 máquinas com overlap temporal → severity: critical
2. **SETUP_CREW_OVERLAP:** 2+ setups em máquinas diferentes ao mesmo tempo → severity: high
3. **MACHINE_OVERCAPACITY:** Máquina excede DAY_CAP num dia → severity: high
4. **DEADLINE_MISS:** Produção insuficiente para cobrir procura → severity: critical

Resultado: `ScheduleValidationReport` com `valid = true` se nenhuma violação critical/high.

---

## 14. RISK GRID

**Ficheiro:** `src/risk/risk-grid.ts`

`computeRiskGrid()`: Combina 3 dimensões de risco numa grelha unificada:

1. **Capacity Risk:** Da capAnalysis — máquinas sobrecarregadas
2. **Stock Risk:** Do MRP — ferramentas com stockout iminente
3. **Constraint Risk:** Das violações de validação

**Thresholds de risco (do `src/constants.ts`):**

| Nível | Threshold de Utilização | Significado |
|---|---|---|
| `ok` | ≤ 0.85 | Capacidade confortável |
| `medium` | > 0.85 | Atenção — carga elevada |
| `high` | > 0.95 | Risco — quase sem margem |
| `critical` | > 1.0 | Sobre-capacidade — overflow certo |

Cada célula (máquina × dia) tem: `riskLevel: 'ok' | 'medium' | 'high' | 'critical'`

---

## 15. ANÁLISES COMPLEMENTARES

### 15.1 Cap Analysis (`src/analysis/cap-analysis.ts`)

`capAnalysis()`: Para cada máquina/dia, calcula:
```
{ prod: minutos_produção, setup: minutos_setup, ops: num_operações, pcs: peças, blk: bloqueados }
```

### 15.2 Workforce Demand (`src/analysis/op-demand.ts`)

`computeWorkforceDemand()` (substituiu `opDemand()`): Calcula operadores necessários por zona/turno/dia:
- Peak-per-machine model: MAX operadores por bloco por máquina, depois SOMA entre máquinas na zona
- Zonas: BIG_PRESSES, MEDIUM_PRESSES (não PG1/PG2)
- Retorna `ZoneShiftDemand[]`: `{ zone, shift, dayIdx, peakNeed, capacity, overloaded }`
- Warnings de sobrecarga incluídos na resposta

### 15.3 Coverage Audit (`src/analysis/coverage-audit.ts`)

`auditCoverage()`: Para cada operação, verifica:
```
totalDemand vs totalProduced vs deficit
coveragePercent = produced / demand * 100
```

---

## 16. TRANSFORMAÇÃO DE DADOS

### 16.1 Normalize (`src/transform/normalize.ts`)

`normalizeNikufraData()`: Converte NikufraData (nomes curtos) em NormalizedFactory (nomes completos):
- Máquinas com alternativas derivadas das ferramentas
- Ferramentas com primaryMachine, altMachine, ratePerHour, etc.
- Demand lines, calendar, labor pools

`FactoryLookup`: Classe com índices O(1) para queries relacionais:
- `getToolsForMachine(machineId)` — ferramentas por máquina
- `getSkusForTool(toolId)` — SKUs por ferramenta
- `getDemandForSku(sku)` — procura por SKU
- `isCriticalMachine(machineId)` — true se tem ferramentas sem alternativa

### 16.2 Transform Plan State (`src/transform/transform-plan-state.ts`)

`transformPlanState()`: Converte dados de estado do plano (com datas reais, NP cumulativo, etc.) em EngineData normalizado.

**Pipeline de transformação de NP (3 passos):**

1. **`deltaizeCumulativeNP()`**: Os valores NP do ISOP são ACUMULADOS (não diários). Positivo = stock que sobra, Negativo = falta acumulada. Esta função converte o NP cumulativo em procura diária calculando o delta entre dias consecutivos.

2. **Extracção de stock**: No modo `raw_np`, o stock inicial vem dos valores NP positivos do primeiro dia (NÃO da coluna STOCK-A separada). Se NP[0] > 0, esse valor é o stock existente.

3. **WIP**: Se disponível, o WIP (Work-in-Progress) é incluído no stock inicial: `stockInicial = stk + wip`.

**Sobre "red cells" do ISOP:** As células vermelhas (marcações de falha/avaria) no ISOP são **IGNORADAS** pelo transform. O mecanismo correcto para representar falhas é via `FailureEvent[]` no input — estas são convertidas em timelines de capacidade no `failure-timeline.ts`. Nunca se deve confiar nas red cells do ISOP para representar avarias no scheduling.

---

## 17. FLUXO CAUSAL COMPLETO — DO INPUT AO OUTPUT

```
NikufraData (raw input)
  ├─── machines, tools, operations, mo, dates
  │    (NP do ISOP: deltaize → filtrar → normalizar)
  │
  ▼
EngineData (transformado)
  ├─── ops[].d[] (procura diária, derivada do NP)
  ├─── ops[].atr (backlog)
  ├─── ops[].wip (work-in-progress)
  ├─── toolMap[].pH, sH, lt, oee, op, alt, calco, mp
  ├─── workforceConfig (zonas, capacidade por turno)
  ├─── workdays[]
  │
  ▼ scheduleAll()
  │
  ├── [1] computeShippingDeadlines() ← CORRE PRIMEIRO
  │     ├── computeWorkContent()
  │     ├── computeDeficitEvolution()
  │     └── Result: deadlines, workContents, deficits
  │
  ├── [1b] computeEarliestStarts(ops, workdays)
  │      └── ops[].ltDays → earliestStarts Map
  │
  ├── [2b] scoreOperations() (quando scoring activo)
  │      └── workContents + deficits + deadlines → scores
  │
  ├── [2] groupDemandIntoBuckets(ops, toolMap, ...)
  │     ├── ops[].d[] + ops[].atr → accQty por bucket
  │     ├── tool.lt → arredondamento a lote económico → prodQty
  │     ├── tool.pH + tool.oee → prodMin = (prodQty/pH)*60/oee
  │     ├── tool.sH → setupMin = sH * 60
  │     ├── mSt/tSt/timelines → blocked/reason
  │     └── Result: Record<machineId, ToolGroup[]>
  │
  ├── [3] sortAndMergeGroups / sortGroupsByScore
  │     ├── supplyBoosts → prioridade primária
  │     ├── rule (EDD/CR/WSPT/SPT) ou scores → ordenação
  │     ├── mergeConsecutiveTools → reduz setups (MAX_EDD_GAP)
  │     ├── mergeMaterialParts → reduz trocas MP
  │     └── sortSkusWithinGroups → backlog e stock-zero primeiro
  │
  ├── [4] orderMachinesByUrgency(machines, mGroups)
  │     └── Máquinas sem alternativa primeiro → machOrder
  │
  ├── [5] scheduleMachines(mGroups, machOrder, ...)
  │     ├── Ordem: SETUP → ESPAÇO → AVARIA → OPERADORES → CALÇO → FERRAMENTA → SHIPPING
  │     ├── SetupCrew HARD → max 1 setup simultâneo
  │     ├── ToolTimeline HARD → ferramenta numa máquina (multi-instância)
  │     ├── CalcoTimeline HARD → calço numa máquina de cada vez
  │     ├── OperatorPool SOFT → aviso apenas, nunca bloqueia
  │     ├── machineTimelines → capF * rawAvail = avail
  │     ├── Proporcional allocation → previne FIFO starvation
  │     └── Result: blocks[] (ok/blocked/overflow/infeasible) + infeasibilities[]
  │
  ├── [6] levelLoad(blocks, machines, workdays, earliestStarts)
  │     ├── Heavy days (>85%) → Light days (<50%)
  │     ├── Só move para trás (nunca atrasa)
  │     ├── Lookahead: 15 dias úteis
  │     └── Respeita earliestStart
  │
  ├── [7] mergeConsecutiveBlocks(blocks)
  │     └── Une blocos adjacentes mesma op/dia/máquina
  │
  ├── [7.5] Enforce Deadlines
  │     ├── produced < totalDemand → INFEASIBLE
  │     └── Gera RemediationProposals
  │
  ├── [8] FeasibilityReport
  │     ├── feasibilityScore = feasibleOps / totalOps
  │     ├── deadlineFeasible = (remediations.length === 0)
  │     └── entries[], remediations[]
  │
  ├── [9] computeWorkforceForecast() (quando workforceConfig)
  │     ├── D+1 overload warnings por zona/turno
  │     └── Suggestions + coverageMissing
  │
  └── [10] buildTransparencyReport() (novo pipeline)
        ├── OrderJustification por operação
        ├── Twin metadata (co-produção)
        └── Workforce warnings + forecast
```

---

## 18. TIPOS DE BLOCO (OUTPUT)

Cada bloco no array de resultado tem um `type`:

| type | Significado | Quando |
|---|---|---|
| `ok` | Produção agendada com sucesso | Todas as constraints satisfeitas |
| `blocked` | Recurso indisponível | Máquina ou ferramenta down |
| `overflow` | Capacidade insuficiente | Não cabe no horizonte (antes de deadline enforcement) |
| `infeasible` | Impossível agendar | Constraint violation ou deadline miss |

**Campos importantes de cada bloco:**

| Campo | Tipo | Significado |
|---|---|---|
| `startMin` | number | Minuto de início no dia (ex: 420 = 07:00) |
| `endMin` | number | Minuto de fim no dia |
| `qty` | number | Peças produzidas neste bloco |
| `prodMin` | number | Minutos de produção |
| `setupS/setupE` | number/null | Início/fim do setup (se é o primeiro bloco da ferramenta) |
| `setupMin` | number | Duração do setup em minutos |
| `dayIdx` | number | Índice do dia (0-based) |
| `shift` | 'X'/'Y'/'Z' | Turno |
| `machineId` | string | Máquina onde foi agendado |
| `origM` | string | Máquina original (antes de move) |
| `moved` | boolean | Se foi movido por auto-route ou user |
| `hasAlt` | boolean | Se tem máquina alternativa |
| `altM` | string/null | Máquina alternativa |
| `blocked` | boolean | Se está bloqueado |
| `reason` | string/null | Razão do bloqueio |
| `overflow` | boolean | Se é overflow |
| `overflowMin` | number | Minutos não agendados |
| `belowMinBatch` | boolean | Se qty < lote económico |
| `hasDataGap` | boolean | Se há dados em falta |
| `dataGapDetail` | string | Detalhe dos dados em falta |
| `infeasibilityReason` | string | Razão de infeasibilidade |
| `isLeveled` | boolean | Se foi movido pelo load leveler |
| `earliestStart` | number | EarliestDayIdx do backward scheduling |

---

## 19. RESUMO DAS VARIÁVEIS E RELAÇÕES CAUSAIS

### Variáveis que AUMENTAM tempo de produção (pior performance):
- `oee` ↓ → `prodMin` ↑ (mais minutos por peça)
- `pH` ↓ → `prodMin` ↑ (menos peças por hora)
- `lt` ↑ → `prodQty` ↑ (arredondamento ao lote)
- `sH` ↑ → `setupMin` ↑ (mais tempo de setup)
- `op` = 2 → Consome mais operadores por turno

### Variáveis que RESTRINGEM a alocação:
- `DAY_CAP = 1020` → Limite físico absoluto por dia
- `S0/T1/S1/S2` → Limites dos turnos
- `setupCrew` → Max 1 setup simultâneo na fábrica
- `toolTimeline` → Ferramenta numa só máquina
- `calcoTimeline` → Calço numa só máquina
- `operatorPool` → MO por zona/turno (SOFT — apenas aviso)
- `capacityFactor` (falhas) → Reduz tempo disponível por turno
- `workdays[]` → Dias não-úteis = 0 capacidade
- `earliestStart` → Limite inferior para início de produção

### Variáveis que AJUDAM a resolver conflitos:
- `alt` → Permite reroute para máquina alternativa
- `supplyBoosts` → Override de prioridade
- `thirdShift` → +420 min/dia
- `poolBorrowing` → Operadores emprestados entre áreas
- `LEVEL_LOOKAHEAD` → Dias para equilibrar carga

### Variáveis que MEDEM qualidade:
- `otd/otdDelivery` → Entregas a tempo
- `setupCount/setupMin` → Eficiência de setups
- `capUtil/capVar` → Utilização e equilíbrio
- `deadlineFeasible` → Zero atrasos?
- `feasibilityScore` → Ops agendadas / total
- `score` → Pontuação multi-objectivo composta

---

## 20. MAPA COMPLETO DE FICHEIROS (65 ficheiros, ~11.000 linhas)

### Scheduler (core pipeline)
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/scheduler/scheduler.ts` | 518 | Pipeline principal (`scheduleAll`) |
| `src/scheduler/slot-allocator.ts` | 632 | Alocação minuto-a-minuto (hard constraints) |
| `src/scheduler/demand-grouper.ts` | 399 | Agrupamento de procura em ToolGroups |
| `src/scheduler/dispatch-rules.ts` | 246 | Regras de dispatch (EDD/CR/WSPT/SPT) |
| `src/scheduler/load-leveler.ts` | 236 | Nivelamento de carga |
| `src/scheduler/production-scorer.ts` | 198 | Scoring de operações (novo pipeline) |
| `src/scheduler/work-content.ts` | 156 | Conteúdo de trabalho |
| `src/scheduler/shipping-cutoff.ts` | 136 | Deadlines de shipping |
| `src/scheduler/backward-scheduler.ts` | 132 | Backward scheduling (Prz.Fabrico) |
| `src/scheduler/block-merger.ts` | 73 | Merge de blocos consecutivos |

### Constraints (restrições)
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/constraints/constraint-manager.ts` | 442 | Wrapper unificado de todas as constraints |
| `src/constraints/tool-timeline.ts` | 223 | Timeline de ferramentas (HARD + multi-instância) |
| `src/constraints/operator-pool.ts` | 217 | Pool de operadores por zona (SOFT) |
| `src/constraints/calco-timeline.ts` | 173 | Timeline de calços (HARD) |
| `src/constraints/setup-crew.ts` | 135 | Setup crew único (HARD) |

### Overflow / Auto-Replan
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/overflow/auto-replan.ts` | 813 | Orquestrador + 5 estratégias |
| `src/overflow/auto-replan-control.ts` | 495 | API de controlo do utilizador (6 funções) |
| `src/overflow/auto-route-overflow.ts` | 403 | Auto-route overflow básico |
| `src/overflow/strategies/split-strategy.ts` | 260 | Estratégia: split de operação |
| `src/overflow/strategies/overtime-strategy.ts` | 186 | Estratégia: horas extra |
| `src/overflow/auto-replan-config.ts` | 94 | Configuração + defaults |
| `src/overflow/strategies/third-shift-strategy.ts` | 94 | Estratégia: 3.º turno |

### Analysis (relatórios e KPIs)
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/analysis/workforce-forecast.ts` | 393 | Previsão D+1 de mão-de-obra |
| `src/analysis/transparency-report.ts` | 258 | Relatório de transparência |
| `src/analysis/validate-schedule.ts` | 215 | Validação pós-schedule |
| `src/analysis/score-schedule.ts` | 193 | Scoring e KPIs |
| `src/analysis/coverage-audit.ts` | 149 | Auditoria de cobertura |
| `src/analysis/op-demand.ts` | 148 | Workforce demand por zona |
| `src/analysis/cap-analysis.ts` | 45 | Análise de capacidade |

### MRP
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/mrp/mrp-engine.ts` | 381 | Motor MRP principal |
| `src/mrp/mrp-actions.ts` | 276 | Action messages |
| `src/mrp/mrp-rop.ts` | 160 | ROP / Safety Stock |
| `src/mrp/mrp-ctp.ts` | 145 | Capable-to-Promise |
| `src/mrp/mrp-what-if.ts` | 137 | What-If analysis |
| `src/mrp/supply-priority.ts` | 78 | Supply boost |

### Failures (falhas temporais)
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/failures/failure-timeline.ts` | 226 | Timeline de falhas |
| `src/failures/impact-analysis.ts` | 119 | Análise de impacto |
| `src/failures/cascading-replan.ts` | 112 | Replan em cascata |
| `src/failures/shift-utils.ts` | 36 | Utilitários de turno |

### Decisions
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/decisions/unknown-tracker.ts` | 165 | Tracker de dados desconhecidos |
| `src/decisions/decision-registry.ts` | 160 | Registry de decisões |

### Risk
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/risk/risk-grid.ts` | 267 | Grelha de risco unificada |

### Transform (normalização de dados)
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/transform/transform-plan-state.ts` | 266 | Transformação PlanState → EngineData |
| `src/transform/normalize.ts` | 227 | Normalização NikufraData |
| `src/transform/twin-validator.ts` | 225 | Validação de peças gémeas |

### Types (definições de tipos)
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/types/mrp.ts` | 225 | Tipos MRP |
| `src/types/blocks.ts` | 167 | Tipos de bloco (ok/blocked/overflow/infeasible) |
| `src/types/infeasibility.ts` | 149 | Tipos de infeasibilidade |
| `src/types/workforce.ts` | 126 | WorkforceConfig, zonas, capacidade |
| `src/types/plan-state.ts` | 114 | Estado do plano |
| `src/types/failure.ts` | 121 | Tipos de falha |
| `src/types/engine.ts` | 102 | EngineData (modelo central) |
| `src/types/core.ts` | 101 | Tipos base (NikufraData) |
| `src/types/decisions.ts` | 94 | 27 DecisionTypes |
| `src/types/transparency.ts` | 93 | Relatório de transparência |
| `src/types/kpis.ts` | 92 | KPIs |
| `src/types/twin.ts` | 89 | Peças gémeas |
| `src/types/scoring.ts` | 81 | Tipos de scoring |
| `src/types/shipping.ts` | 47 | Tipos de shipping |
| `src/types/constraints.ts` | 32 | Tipos de constraints |

### Utils + Exports
| Ficheiro | Linhas | Descrição |
|---|---|---|
| `src/index.ts` | 190 | Barrel exports |
| `src/constants.ts` | 124 | Constantes de produção |
| `src/utils/time.ts` | 80 | Utilitários de tempo |
| `src/utils/block-production.ts` | 66 | Produção por bloco (twin-aware) |
| `src/utils/colors.ts` | 31 | Utilitários de cor |
| `src/utils/prng.ts` | 19 | PRNG determinístico |

---

## 21. API PÚBLICA

O ficheiro `src/index.ts` exporta 128 símbolos organizados em:

- **Scheduler:** `scheduleAll`, `scheduleFromEngineData`
- **Overflow:** `autoRouteOverflow`
- **Auto-Replan:** `autoReplan`, `getReplanActions`, `undoReplanActions`, `applyAlternative`, `simulateWithout`, `replanWithUserChoices`, `getBlockReplanInfo`
- **MRP:** `computeMRP`, `computeToolMRP`, `computeROP`, `computeCTP`, `computeActionMessages`, `computeWhatIf`, `computeCoverageMatrix`
- **Failures:** `buildResourceTimelines`, `deriveLegacyStatus`, `cascadingReplan`, `analyzeFailureImpact`
- **Analysis:** `scoreSchedule`, `validateSchedule`, `capAnalysis`, `computeWorkforceDemand`, `auditCoverage`, `computeWorkforceForecast`, `buildTransparencyReport`
- **Risk:** `computeRiskGrid`
- **Transform:** `normalizeNikufraData`, `FactoryLookup`, `transformPlanState`, `validateTwinReferences`
- **Decisions:** `DecisionRegistry`
- **Constraints:** `createSetupCrew`, `createOperatorPool`, `ConstraintManager`
- **Constants:** Todas as constantes de produção
- **Types:** Todos os tipos TypeScript (incluindo `WorkforceConfig`, `TwinGroup`, `AutoReplanConfig`)
