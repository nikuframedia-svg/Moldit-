# COMO FUNCIONA O PP1 — Documento Técnico

> ProdPlan PP1 — Motor de planeamento de produção Nikufra
> Última actualização: 2026-02-24

---

## 1. FLUXO GLOBAL

Tudo começa com os dados de produção da Incompol (ficheiro ISOP), que passam por uma cadeia de transformações automáticas:

```
Dados ISOP → transformPlanState() → Motor de Scheduling (scheduleBatch)
  → Auto-Routing (autoRouteOverflow) → Análise de Capacidade (capAnalysis)
  → KPIs (scoreSchedule) → Validação (validateSchedule) → Decisões de Replan (genDecisions)
```

Cada passo alimenta o seguinte. Tudo corre no browser (client-side), sem servidor, e **recalcula instantaneamente** a cada alteração de estado (ex: marcar máquina DOWN, aplicar um move).

A reactividade funciona via `useMemo` do React: qualquer alteração em `mSt` (estado máquinas), `tSt` (estado ferramentas) ou `moves` (movimentos aplicados) desencadeia o recálculo de `autoRouteOverflow` → `capAnalysis` → `validateSchedule` → re-render do Gantt/Plan/Replan.

---

## 2. MOTOR DE SCHEDULING

O coração do sistema é a função `scheduleBatch()` (~250 linhas). Funciona em duas fases.

### Fase 1 — Organizar o trabalho (linhas 527-585)

Para cada operação, o sistema:

1. **Soma a procura total**: procura dos próximos 8 dias úteis + backlog pendente (`atr`)
2. **Arredonda para lote económico**: se a procura é 450 pcs e o lote mínimo (`lt`) é 500, produz 500. Fórmula exacta: `Math.ceil(totalQty / lt) * lt`
3. **Calcula o EDD** (Earliest Due Date): se há backlog (`atr > 0`), EDD = dia 0 (máxima urgência). Caso contrário, é o primeiro dia com procura positiva
4. **Agrupa por ferramenta** (tool group): todos os SKUs na mesma máquina que usam a mesma ferramenta física formam um grupo. Um grupo = um único setup

**O que é um "grupo de ferramentas"**: É o conjunto de SKUs que partilham a mesma ferramenta física (tool) na mesma máquina. Por exemplo, se os SKUs "Perfil X", "Perfil Y" e "Perfil Z" usam todos a ferramenta `F-1234` na máquina `PRM019`, formam um grupo. A vantagem: o setup da ferramenta é feito UMA VEZ para o grupo inteiro, não uma vez por SKU. Isto minimiza o tempo perdido em trocas de ferramenta.

**Ordenação dentro de cada grupo** (prioridade de produção):
1. SKUs com backlog (`atr > 0`) — primeiro
2. SKUs com stock zero E lote económico positivo — segundo (risco de paragem)
3. Maior volume total — terceiro

### Ordenação de máquinas (linhas 587-597)

As **máquinas** (não referências/SKUs) são ordenadas para decidir qual recebe prioridade de acesso à equipa de setup:

1. **EDD mais urgente primeiro**: a máquina cuja ferramenta mais urgente tem o menor EDD é processada primeiro
2. **Tiebreaker**: máquinas com ferramentas que **NÃO têm alternativa** (`hasAlt = false`) recebem prioridade. Razão: se uma ferramenta só pode correr numa máquina e essa máquina tem atraso, não há como redirecionar — logo tem prioridade absoluta no setup

### Fase 2 — Colocar tudo no tempo (linhas 599-748)

O sistema usa um **cursor temporal** (`cDay`, `cMin`) que avança desde as 06:00 do dia 0. Para cada grupo de ferramentas numa máquina:

1. **Setup** (se a ferramenta mudou): verifica 3 restrições antes de agendar:
   - Equipa de setup disponível (constraint global)?
   - Ferramenta não está montada noutra máquina nesse momento (ToolTimeline)?
   - Cabe no turno actual?

   Se o setup não cabe no restante do turno, avança para o início do próximo turno. Faz até 6 tentativas.

2. **Produção** (por SKU, sequencialmente): para cada SKU no grupo, aloca tempo de produção verificando:
   - Operadores disponíveis (OperatorPool por área/turno)?
   - Calço disponível (CalcoTimeline)?
   - Ferramenta não em uso noutra máquina (ToolTimeline)?

**Regra de divisão entre turnos**: A **produção CAN e DEVE ser dividida** entre turnos e até entre dias. O loop `while (rem > 0)` continua a alocar produção em fatias de tempo disponível — se o turno X acaba com 200 min de trabalho restante, o cursor avança para o turno Y (14:00) e continua. A ferramenta permanece montada entre turnos (não há setup adicional).

O que **NÃO é dividido** é o **setup**: se o setup de 45 minutos não cabe nos 30 minutos restantes do turno X, vai **inteiro** para o turno Y (06:00 ou 14:00 do próximo turno/dia disponível).

---

## 3. AS 4 RESTRIÇÕES FÍSICAS DA FÁBRICA

### 3.1 Equipa de Setup (linhas 173-196)

**Constraint**: Apenas **uma equipa de setup** para a fábrica inteira. Dois setups em máquinas diferentes **nunca** podem ocorrer em simultâneo.

**Implementação**: `createSetupCrew()` mantém uma lista global de slots reservados. Para cada novo setup, `findNextAvailable()` procura o primeiro momento em que não há conflito com nenhum setup já agendado. Se não cabe no turno, retorna -1.

**Efeito prático**: Se PRM019 está a fazer setup das 06:00 às 06:45, e PRM020 também precisa de setup, PRM020 só pode começar às 06:45.

### 3.2 Calço / Molde (linhas 198-228)

**Constraint**: O mesmo molde/calço físico não pode estar em duas máquinas ao mesmo tempo.

**Estado actual**: A infraestrutura está **implementada e activa** no código (`createCalcoTimeline()`). É verificada durante o scheduling (linha 706-711). **Porém**, actualmente **nenhuma ferramenta no fixture de dados tem o campo `calco_code` preenchido**. Logo a constraint existe mas está **efectivamente dormante**.

**Recomendação do utilizador**: Ignorar por agora e integrar quando houver dados de calço disponíveis. **Concordo** — a infraestrutura está pronta, basta preencher `calco_code` nos dados das ferramentas para activar automaticamente.

### 3.3 Ferramenta Física (linhas 230-279)

**Constraint**: A mesma ferramenta física só pode estar num local de cada vez. Se a ferramenta `F-1234` está montada na PRM019 das 06:00 às 12:00, não pode ser usada na PRM020 nesse período.

**Implementação**: `createToolTimeline()` com suporte para `instances` — se uma ferramenta tiver múltiplas cópias físicas, podem existir em N máquinas em simultâneo (default: 1 instância). O scheduling verifica tanto durante o setup como durante a produção.

### 3.4 Operadores (linhas 281-323)

**Constraint**: Número máximo de operadores por área (PG1/PG2) por turno. Definido via `AreaCaps` ou `DayAreaCaps` (que permite caps diferentes por dia).

**Implementação**: `createOperatorPool()` com tracking de **pico concorrente** — se uma máquina já tem 2 operadores reservados e a mesma máquina precisa de 2 para outra operação no mesmo turno, o delta é 0 (os operadores são os mesmos, já estão na máquina). Se for outra máquina, o delta é +2.

**Efeito prático**: Se PG1 tem cap=8 operadores e já há 7 em uso no turno X, uma ferramenta que requer 2 operadores não cabe e é empurrada para o turno Y.

---

## 4. AUTO-ROUTING (linhas 771-851)

### O que é uma "operação em overflow"

Uma operação está em **overflow** quando o scheduling não conseguiu alocar todo o seu tempo de produção dentro do horizonte de 8 dias úteis. Critérios objectivos:

1. **Capacidade da máquina esgotada**: o cursor temporal passou o último dia útil e ainda sobra tempo de produção por alocar (`rem > 0` na linha 744)
2. **Setup impossível de colocar**: após 6 tentativas, o setup não encontrou slot disponível (equipa de setup sempre ocupada ou ferramenta nunca livre) — toda a produção do grupo vai para overflow (linha 679-681)
3. **Advance falhou**: não há mais dias úteis no horizonte

O bloco de overflow tem `type: 'overflow'`, `overflow: true` e `overflowMin` = minutos de produção não alocados.

### Como funciona o auto-routing

Após o scheduling inicial, o sistema tenta **resolver overflows automaticamente**:

1. Detecta todos os blocos em overflow que têm máquina alternativa (`hasAlt && altM`)
2. Para cada um, verifica que a máquina alternativa:
   - Não está DOWN
   - Tem utilização média **< 95%** (`ALT_UTIL_THRESHOLD = 0.95`)
   - Tem pelo menos **30 minutos livres** (`altRemaining < 30` → skip)
3. Cria um `MoveAction` (opId → altM) e re-escalona tudo
4. Se o overflow total **melhorou** → mantém os moves; se **piorou** → reverte

### Limitações: porquê MAX_ITER=3 e MAX_AUTO_MOVES=16

**MAX_ITER = 3 iterações**: Cada iteração re-escalona o plano inteiro (recria todos os blocos). O custo computacional é O(ops × dias × constraints). Com 3 iterações, o sistema converge na grande maioria dos casos sem impacto perceptível no browser. Mais iterações dariam retornos marginais decrescentes.

**MAX_AUTO_MOVES = 16 movimentos**: Serve como **guarda de segurança** — o auto-routing é uma heurística greedy, não um optimizador global. Movimentos automáticos em excesso podem:
- Criar cascatas indesejadas (mover A para B causa overflow em B, que move C para D...)
- Tornar o plano irreconhecível para o utilizador
- Escapar ao controlo humano

O número 16 é conservador de propósito: cobre a maioria dos cenários reais (tipicamente 3-6 ferramentas por máquina, 6 máquinas, logo ~5-10 operações potenciais em overflow) sem perder controlabilidade. Se o auto-routing não resolve em 16 moves, é sinal de que o problema precisa de intervenção humana (Replan ou What-If).

**Threshold de 95%**: Impede que o sistema "encha" uma máquina alternativa até ao limite, deixando zero margem para imprevistos.

---

## 5. REPLAN — Gestão de Avarias (linhas 1041-1209)

Quando uma ou mais máquinas são marcadas como DOWN, o sistema analisa **cada operação afectada** e gera decisões automáticas.

### Fluxo

1. `capAnalysis()` calcula a utilização actual de cada máquina
2. Identifica blocos com `type: 'blocked'` (operações em máquinas DOWN que ainda não têm move)
3. **Ordena por severidade** — stock zero + maior backlog primeiro (processamento prioritário)
4. Para cada operação bloqueada, analisa:

| Caso | Resultado |
|------|-----------|
| Ferramenta avariada (`tool_down`) | Decisão tipo `blocked` — sem solução automática |
| Sem máquina alternativa | Decisão tipo `blocked` — indica buffer de stock disponível |
| Alternativa também DOWN | Decisão tipo `blocked` — severity `critical` |
| Alternativa disponível | Decisão tipo `replan` — propõe move com análise de capacidade |

### Análise combinada (multi-máquina)

Quando múltiplas máquinas estão DOWN simultaneamente, o sistema usa um **tracker de capacidade acumulada** (`runCap`). Isto significa que:

- A 1ª operação redireccionada para PRM031 vê a capacidade actual de PRM031
- A 2ª operação redireccionada para PRM031 vê a capacidade actual **+ a carga da 1ª operação já proposta**
- Se PRM031 fica sobrecarregada com a 2ª operação, o aviso inclui "inclui N ops já propostas"

Isto evita que o sistema proponha enviar 5 operações para a mesma máquina alternativa sem considerar o efeito cumulativo.

### Classificação

Cada decisão tem:
- **Severity**: `critical` (stock zero + sem alternativa), `high`, `medium`, `low`
- **Type**: `replan` (tem solução, acção sugerida) ou `blocked` (sem solução automática)
- **Reasoning**: Lista de frases explicativas (ex: "Máquina PRM019 DOWN → F-1234/SKU-001 afetada", "Alt. disponível: PRM020", "Capacidade PRM020: pico 78% — OK")
- **Impact**: Custo em EUR (produção perdida + setup adicional + churn)
- **Action**: `{ opId, toM }` — o move sugerido (ou `null` se bloqueado)

### Custos (heurísticos)

| Componente | Valor | Significado |
|-----------|-------|-------------|
| Tardiness | 100 EUR/dia | Custo estimado por dia de atraso |
| Setup | 50 EUR/setup + 1 EUR/min | Custo de cada troca de ferramenta |
| Churn | 10 EUR/op movida | Custo de perturbação do plano |

Estes valores são **coeficientes heurísticos**, não custos reais da fábrica. Servem para comparar cenários entre si ("cenário A custa 450 EUR a menos que cenário B").

---

## 6. WHAT-IF / OPTIMIZAÇÃO (linhas 1231-1670)

### Estrutura

O What-If é um **optimizador iterativo** que explora N configurações de escalonamento. O utilizador configura:

- Máquinas/ferramentas DOWN (cenário)
- Operadores por área (PG1/PG2)
- Número de iterações (100, 300, 500, 1000)
- Seed (determinismo)

### Fases da optimização

**Fase 1 — Baseline** (0 moves)
Escalona o plano sem nenhum movimento. É o ponto de comparação.

**Fase 2 — Auto-Replan**
Gera decisões via `genDecisions()` e aplica todos os moves sugeridos. Produz um segundo plano.

**Fase 3 — Melhoria iterativa** (N iterações)
Partindo do melhor resultado das fases 1-2, aplica **3 vizinhanças** em round-robin:

| Vizinhança | Estratégia | Quando ajuda |
|-----------|-----------|-------------|
| **A: Swap Tardiness** | Encontra a máquina com mais overflow. Move as top 3 operações atrasadas para alternativas. Mantém se melhorou. | Máquinas sobrecarregadas com alternativas livres |
| **B: Setup Reduction** | Remove um move aleatório (não forçado) para ver se a ferramenta volta à máquina original e reduz setups. | Moves anteriores que criaram setups desnecessários |
| **C: Load Balance** | Identifica a máquina mais carregada e a menos carregada na mesma área. Move uma operação entre elas. | Desequilíbrio de carga entre máquinas |

Após cada vizinhança, aplica **2-opt resequencing**: troca blocos adjacentes no mesmo dia/máquina para reduzir trocas de ferramenta.

### Scoring (função objectivo)

O score é uma **soma ponderada negativa** (quanto menor o custo, maior o score):

```
score = -(
    100 × tardinessDays        // Dias de atraso (peso máximo)
  + 10  × setupCount          // Número de setups
  + 1   × setupMinutes        // Tempo total de setup
  + 10  × setupBalance        // |setups turno X - setups turno Y|
  + 5   × churnNorm           // Perturbação vs baseline (min/60)
  + 50  × overflowCount       // Operações em overflow
  + 5   × belowMinBatchCount  // Operações abaixo do lote económico
)
```

### Determinismo

**Mesmo input + mesma seed = mesmo resultado**. O gerador pseudo-aleatório é `mulberry32(seed)`, o que garante reprodutibilidade. Se o utilizador muda a seed, obtém resultados diferentes. Se mantém a seed, os resultados são idênticos.

### Resultado

O sistema apresenta os **top 3 planos** (deduplicated por signature de moves), ordenados por score. Para cada plano mostra: OTD%, número de setups, número de moves, custo estimado em EUR.

---

## 7. GANTT CHART

### Visualização

- **Eixo vertical**: uma linha por máquina (6 máquinas Nikufra)
- **Eixo horizontal**: tempo, organizado por dia × turno (8 dias × 2 turnos)
- **Blocos de produção**: coloridos por ferramenta, mostram SKU, quantidade, tempo
- **Blocos de setup**: tom mais escuro, precedem a produção
- **Indicadores visuais**:
  - Borda vermelha = overflow (produção excede capacidade)
  - Borda azul = operação movida (replan/auto-route)
  - Background vermelho = máquina DOWN
  - Ícone de warning = violação detectada

### Interactividade

- Hover sobre bloco → tooltip com detalhes (SKU, qty, tempo, operadores)
- Click em operação de overflow/violação → sugestão de acção (ex: "Mover para PRM031")
- Zoom e filtragem controlados por UI

---

## 8. VALIDAÇÃO (linhas 874-999)

Quatro verificações automáticas após cada (re)scheduling:

| # | Check | Severity | O que verifica |
|---|-------|----------|---------------|
| 1 | **Tool Uniqueness** | `critical` | Mesma ferramenta em 2 máquinas ao mesmo tempo (sobreposição temporal) |
| 2 | **Setup Crew Overlap** | `high` | 2+ setups em máquinas diferentes ao mesmo tempo |
| 3 | **Machine Overcapacity** | `high` | Total de minutos num dia > 960 min (SCAP = 2 turnos × 8h × 60min) |
| 4 | **Deadline Miss** | `medium`/`high` | Produção total < 95% da procura total (demand não coberta) |

O relatório inclui:
- `valid: boolean` — true se nenhuma violação `critical` ou `high`
- `violations[]` — lista com id, tipo, severity, detalhe, operações afectadas, sugestão de fix
- `summary` — contagens por tipo
- Indicador visual no tab Gantt (ponto vermelho se inválido)

---

## 9. AS 4 VISTAS DO SISTEMA

### Plan — Dashboard de KPIs

Vista de resumo do plano actual:
- OTD% (on-time delivery)
- Número de setups / tempo total de setup
- Capacidade por máquina (heatmap utilização por dia)
- Operadores necessários por turno/área
- Custo estimado (EUR)
- Operações em overflow

### Gantt — Visualização temporal interactiva

Representação visual do plano no tempo (descrito na secção 7).

### Replan — Gestão de avarias com decisões automáticas

Interface para:
1. Marcar máquinas/ferramentas como DOWN (toggle)
2. Ver decisões automáticas geradas (`genDecisions`)
3. Aplicar moves individualmente ou em bloco ("Auto" = aplicar todos)
4. Ver impacto: OTD, peças perdidas, custo EUR
5. "Aplicar & Guardar" — aplica moves e (em modo API) persiste no backend; (em modo mock) aplica localmente e muda para Gantt

### What-If — Cenários de otimização

Interface para:
1. Configurar cenário (máquinas DOWN, operadores, seed)
2. Executar optimização (N iterações)
3. Comparar top 3 planos lado a lado
4. Aplicar o plano seleccionado (moves passam para o estado principal → Gantt actualiza)
5. Guardar versões / Commit / Ver histórico / Diff entre versões

---

## 10. CONSTANTES DO SISTEMA

| Constante | Valor | Significado |
|-----------|-------|-------------|
| `S0` | 360 (06:00) | Início turno X |
| `T1` | 840 (14:00) | Fim turno X / Início turno Y |
| `S1` | 1320 (22:00) | Fim turno Y |
| `SCAP` | 960 min | Capacidade total/dia (16h) |
| `MAX_ITER` | 3 | Iterações de auto-routing |
| `MAX_AUTO_MOVES` | 16 | Limite de moves automáticos |
| `ALT_UTIL_THRESHOLD` | 0.95 | Utilização máxima para aceitar redireccionamento |
| Horizonte | 8 dias | Janela de planeamento |
| Máquinas | 6 | PRM019, PRM020, PRM031, PRM039, PRM042, PRM043 |

---

## 11. RESUMO DO FLUXO REACTIVO

```
Utilizador marca PRM019 DOWN
  → setMSt({...mSt, PRM019: 'down'})
  → useMemo recalcula autoRouteOverflow()
    → scheduleBatch() escalona com PRM019 down → operações bloqueadas
    → autoRouteOverflow() tenta mover overflows para alternativas
  → useMemo recalcula capAnalysis() → nova utilização
  → useMemo recalcula validateSchedule() → novas violações
  → Re-render: Gantt mostra blocos vermelhos, Replan mostra decisões, Plan actualiza KPIs
  → Tudo instantâneo, sem servidor
```
