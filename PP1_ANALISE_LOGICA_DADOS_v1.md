# PP1 — Super-Analise da Logica dos Dados

> **Data**: 2026-02-11
> **Fontes**: ISOP Nikufra.xlsx, PP_PG1.pdf, PP_PG2.pdf, email Joao
> **Objectivo**: Documentar como os dados fluem, o que significam, e como devem ser aplicados no software

---

## 1. AS TRES FONTES DE DADOS

### 1.1 ISOP Nikufra.xlsx — A Fonte Mestre

O ISOP (Information Sheet of Production) e o ficheiro **mestre** de dados. Contem:

| Aspecto | Valor |
|---------|-------|
| Linhas de dados | 81 (rows 8-88) |
| Maquinas | 6 (PRM019, PRM020, PRM031, PRM039, PRM042, PRM043) |
| Ferramentas | 44 unicas |
| Clientes | 14 unicos |
| SKUs | ~60 unicos |
| Colunas de datas | 35 (02/02/2026 a 08/03/2026) |
| Dias uteis | 24 de 35 |
| Dias nao-uteis | 14 (sabados, domingos, feriado 17/02) |

**Estrutura do ISOP (Planilha1)**:
- **Row 5**: Flags de dias uteis (1=util, 0=nao-util) — CALENDARIO
- **Row 7**: Headers
- **Rows 8-88**: Dados — cada linha = 1 combinacao (Cliente × SKU × Maquina)
- **Cols A-M**: Dados mestres (cliente, SKU, maquina, ferramenta, setup, rate, operadores)
- **Cols N-P**: Stock actual, WIP, Atraso
- **Cols Q-AY**: Quantidades por data (series temporais)

### 1.2 PP_PG1.pdf e PP_PG2.pdf — Os Planos Actuais

Os PDFs sao o **output** do sistema MRP actual (versao 25.10). Mostram:
- O planeamento de producao JA CALCULADO pelo sistema existente
- Quantidades diarias a produzir por maquina/ferramenta
- MAN (man-minutes) por maquina por dia
- M.O. (mao-de-obra total) por area por dia
- Componentes/materias-primas necessarias (codigos EMPxxxx, BFxxxx)
- ATRASO (backlog acumulado)

**Relacao ISOP → PP**: O ISOP contem a PROCURA (o que precisa ser produzido). Os PPs contem o PLANO (como a producao esta distribuida). O nosso software deve replicar e melhorar esta transformacao.

### 1.3 Email do Joao — Regras de Negocio

Complementa os dados com regras que NAO estao nos ficheiros:
- Prioridade #1: cumprir datas de entrega
- Setup max 1 de cada vez (hard constraint)
- Distribuir setups pelos 2 turnos
- Operadores limitados e variantes diariamente
- Maquinas/ferramentas podem estar indisponiveis por avaria
- Futuro: calcos partilhados reduzem tempo de setup

---

## 2. MODELO DE DADOS — ENTIDADES E RELACOES

### 2.1 Hierarquia de Entidades

```
CLIENTE (14)
  └── ENCOMENDA/LINHA (81 linhas no ISOP)
        ├── SKU (Referencia Artigo) — ~60 unicos
        ├── Maquina primaria
        ├── Maquina alternativa (se existir)
        ├── Ferramenta
        ├── Setup time (horas)
        ├── Rate (pecas/hora)
        ├── Operadores necessarios
        └── Serie temporal (quantidades por data)

MAQUINA (6 focus)
  └── FERRAMENTA (44 total)
        └── SKU(s) que produz

AREA (2)
  ├── PG1: Prensas Mecanicas > 200T (area 1)
  └── PG2: Prensas Mecanicas > 200T (area 2)
```

### 2.2 Relacao N:M entre SKUs e Clientes

**CRITICO**: Um mesmo SKU pode ter encomendas de MULTIPLOS clientes.

Exemplos (marcados com *** no ISOP):

| SKU | Clientes | Qt.Exp por Cliente |
|-----|----------|--------------------|
| 1064169X100 | FAURECIA (13000), FAUR-SIEGE (13000), FAUREC.CZ (5200) | 31200 total |
| 1064186X100 | FAURECIA (13000), FAUR-SIEGE (13000), FAUREC.CZ (5200) | 31200 total |
| 1092262X100 | FAURECIA (3200), FAUR-SIEGE (5520), F.POLSKA (2400) | 11120 total |
| 1065170X100 | FAURECIA (3200), FAUR-SIEGE (1920) | 5120 total |
| 1661545X070 | FAURECIA (960), FAUR-SIEGE (4800) | 5760 total |
| 8718696125 | BOSCH-TERM (1344), E.L.M. (2500) | 3844 total |

**Implicacao no software**:
- A PRODUCAO e agregada por SKU (nao interessa de que cliente vem — a ferramenta e maquina sao as mesmas)
- A ENTREGA e por cliente (cada cliente tem a sua due date e quantidade)
- O solver deve agrupar a producao mas rastrear as entregas separadamente

### 2.3 Relacao 1:N entre Ferramenta e SKUs

Uma ferramenta pode produzir MAIS de um SKU **sem trocar de ferramenta** (sem setup adicional):

| Ferramenta | SKUs | Nota |
|------------|------|------|
| BFP079 | 1064169X100, 1064186X100 | Front Link LH e RH — mesma ferramenta |
| BFP083 | 1115324X080, 1115328X080 | Biela Dir e Esq |
| BFP100 | 1086227X070, 1954311X030 | Support Tilt Motor + sub-componente |
| BFP101 | 1135760X070, 1955341X030 | idem RH |
| BFP110 | 1177295X150, 1177297X150 | Fix Gusset L e R |
| BFP125 | 1403150X050, 1413147X070 | Belt Buckle + PPV Bracket |
| BFP172 | 2513974X100, 2785359X050 | Plate + Flange Reinforcement |
| BFP178 | 2100373X120.10, 2185094X110.10 | Bracket 20Ways L e R |
| BFP179 | 5246946X080, 5246947X080 | par LH/RH |
| JDE002 | TP042173-0040-1, -0040-2, -0060-1, -0060-2 | 4 variantes Heat Shield |
| HAN004 | CF624K9TAB01.30, CF624K9TAB02.20 | 2 variantes HSG Inverter |
| VUL115 | 8716774145, 8718696125 | 2 SKUs para E.L.M./BOSCH |

**Implicacao no software**: Quando uma ferramenta esta montada, TODOS os SKUs dessa ferramenta podem ser produzidos sequencialmente sem setup. O setup so ocorre quando se MUDA de ferramenta.

---

## 3. MAPEAMENTO MAQUINA → AREA (DEFINITIVO)

Cruzando PP_PG1.pdf e PP_PG2.pdf:

| Maquina | Area | Fonte | No ISOP? | Ferramentas | Nota |
|---------|------|-------|----------|-------------|------|
| **PRM019** | **PG1** | PP_PG1 p.1 | Sim | BFP080, BFP082, BFP179, BFP181, BFP192, BFP197, VUL038 | Prensa principal PG1 |
| **PRM020** | **PG1** | — | Sim | VUL031, VUL068, MIC009 | Sem carga esta semana (man=0 todos dias). 3 tools BOSCH |
| **PRM031** | **PG2** | PP_PG2 | Sim | BFP079, BFP083, BFP114, BFP162, BFP171, BFP183, BFP184 | Alta carga FAURECIA |
| **PRM032** | **PG1** | PP_PG1 p.1 | Nao | BFP173, BFP185 | Nao esta no ISOP (sem focus) |
| **PRM033** | **PG2** | PP_PG2 | Nao | VUL168 | Nao esta no ISOP (sem focus) |
| **PRM039** | **PG2** | PP_PG2 | Sim | BFP091-096, BFP100-101, BFP110, BFP112, BFP178, BFP186, VUL127 | 10 ferramentas, maior variedade |
| **PRM042** | **PG2** | PP_PG2 | Sim | DYE025, EBR001, HAN004, JDE002, LEC002, VUL115 | Clientes especiais (JOAO DEUS, BORGWARNER, etc.) |
| **PRM043** | **PG1** | PP_PG1 p.1-2 | Sim | BFP125, BFP172, BFP187-188, BFP195, BFP202, BFP204, HAN002, JTE001, JTE003, VUL111 | 11 ferramentas, maior diversidade |
| PRH006 | PG2 | PP_PG2 | Nao | VUL170 (VL1824) | Nao esta no ISOP |
| PRM022 | PG2 | PP_PG2 | Nao | VUL129, VUL130 | Nao esta no ISOP |

**NOTA**: As 6 maquinas do ISOP (PRM019/020/031/039/042/043) sao o **"focus"** do software. As outras 4 (PRM032, PRM033, PRH006, PRM022) aparecem nos PPs mas NAO estao no ISOP, logo nao tem dados de routing completos.

**M.O. (Mao de Obra) por area por dia** (do PP):
- **PG1**: [2.6, 0.4, 4.1, 2.0, 0.3, 2.5, 0.1, 3.2]
- **PG2**: [6.2, 2.2, 1.0, 0.9, 2.7, 0.5, 2.2, 0.6]

---

## 4. ROUTING COMPLETO — AS 44 FERRAMENTAS

### 4.1 Ferramentas PRM019 (PG1) — 7 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs |
|------|----------|-----------|-----|-----|------|
| BFP080 | 1.25 | 1923 | 1 | PRM039 | 1065170X100 |
| BFP082 | 1.25 | 1980 | 1 | PRM039 | 1092262X100 |
| BFP179 | 0.5 | 1802 | 1 | PRM043 | 5246946X080, 5246947X080 |
| BFP181 | 0.5 | 1802 | 1 | PRM043 | 3829548020 |
| BFP192 | 0.5 | 1799 | 1 | PRM043 | 3775166060.10 |
| BFP197 | 0.5 | 1799 | 1 | PRM043 | 3822924050, 3822925050.10 |
| VUL038 | 1.25 | 1200 | 2 | PRM043 | 8708007153 |

### 4.2 Ferramentas PRM020 (PG1) — 3 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs |
|------|----------|-----------|-----|-----|------|
| MIC009 | 0.5 | 600 | 1 | - | 8750738609 |
| VUL031 | 1.0 | 2083 | 1 | - | 8711304305 |
| VUL068 | 1.0 | 1250 | 1 | PRM039 | 8708006154 |

### 4.3 Ferramentas PRM031 (PG2) — 7 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs |
|------|----------|-----------|-----|-----|------|
| BFP079 | 1.0 | 1681 | 1 | PRM039 | 1064169X100, 1064186X100 |
| BFP083 | 1.0 | 1681 | 1 | PRM039 | 1115324X080, 1115328X080 |
| BFP114 | 1.25 | 3610 | 1 | PRM039 | 1172769X030, 1694825X040 |
| BFP162 | 1.25 | 1560 | 1 | PRM039 | 1768601X030, 1768602X030 |
| BFP171 | 0.5 | 1802 | 1 | PRM039 | 2689556X090, 2689557X090 |
| BFP183 | 0.5 | 3610 | 1 | PRM039 | 1661545X070 |
| BFP184 | 0.5 | 3610 | 1 | PRM039 | 1661546X070 |

### 4.4 Ferramentas PRM039 (PG2) — 10 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs |
|------|----------|-----------|-----|-----|------|
| BFP091 | 1.0 | 2639 | 1 | PRM043 | 1134691X140 |
| BFP092 | 1.0 | 2639 | 1 | PRM043 | 1009675X140 |
| BFP096 | 1.0 | 2639 | 1 | PRM043 | 1012535X080 |
| BFP100 | 1.0 | 1319 | 1 | PRM043 | 1086227X070, 1954311X030 |
| BFP101 | 1.0 | 1319 | 1 | PRM043 | 1135760X070, 1955341X030 |
| BFP110 | 1.0 | 1802 | 1 | PRM043 | 1177295X150, 1177297X150 |
| BFP112 | 0.5 | 3597 | 1 | PRM031 | 1197914X050 |
| BFP178 | 0.5 | 1802 | 1 | PRM043 | 2100373X120.10, 2185094X110.10 |
| BFP186 | 0.5 | 1802 | 1 | PRM031 | 3778765060.10, 3778766060.10 |
| VUL127 | 1.0 | 1441 | 2 | PRM043 | 8750302197.20, 8750302200.20 |

### 4.5 Ferramentas PRM042 (PG2) — 6 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs |
|------|----------|-----------|-----|-----|------|
| DYE025 | 1.5 | 1000 | 1 | - | E1730002926.10 |
| EBR001 | 0.5 | 1200 | 2 | - | 1127024045004D |
| HAN004 | 0.5 | 2882 | 1 | - | CF624K9TAB01.30, CF624K9TAB02.20 |
| JDE002 | 1.0 | 1200 | 2 | - | TP042173-0040-1, -0040-2, -0060-1, -0060-2 |
| LEC002 | 0.5 | 1802 | 2 | - | F00000001.20 |
| VUL115 | 1.0 | 1441 | 2 | - | 8716774145, 8718696125 |

**NOTA PRM042**: Nenhuma ferramenta tem maquina alternativa! Se PRM042 avaria, estas 6 ferramentas NAO podem produzir.

### 4.6 Ferramentas PRM043 (PG1) — 11 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs |
|------|----------|-----------|-----|-----|------|
| BFP125 | 0.75 | 1621 | 1 | PRM039 | 1403150X050, 1413147X070 |
| BFP172 | 0.5 | 1802 | 1 | PRM039 | 2513974X100, 2785359X050 |
| BFP187 | 0.5 | 1560 | 1 | PRM039 | 3610299040 |
| BFP188 | 0.5 | 1321 | 2 | PRM031 | 3610295060 |
| BFP195 | 0.5 | 1200 | 2 | - | 3836208090 |
| BFP202 | 0.5 | 3003 | 1 | - | 4313085020.10 |
| BFP204 | 0.5 | 1560 | 1 | PRM039 | 4398644050 |
| HAN002 | 0.5 | 1200 | 1 | - | CF589MMA1A02.20 |
| JTE001 | 1.0 | 1560 | 1 | - | 6800016767A.10 |
| JTE003 | 1.0 | 1200 | 1 | - | 6800017267C.30 |
| VUL111 | 1.5 | 120 | 2 | - | 8738722724 |

---

## 5. SEMANTICA DAS SERIES TEMPORAIS

### 5.1 Colunas de Datas no ISOP

As 35 colunas de datas (Q-AY) contem **quantidades de procura** — especificamente, representam a **posicao liquida apos todas as necessidades** (NET_POSITION_AFTER_ALL_NEEDS_BY_DATE).

**Interpretacao**:
- Valor POSITIVO = stock disponivel apos necessidades desse dia
- Valor NEGATIVO ou em ATRASO = deficit/necessidade de producao
- A **variacao entre dias** indica a procura incremental desse dia

### 5.2 Coluna ATRASO (Col P)

Quantidade ja em atraso (deveria ter sido produzida antes de 02/02). Exemplos:
- 1064169X100: ATRASO = 5265 pecas
- 1092262X100: ATRASO = 8293 pecas
- 8708007153: ATRASO = 1069 pecas (todo o stock necessario)

**Implicacao**: O solver deve priorizar a producao de items em ATRASO antes das necessidades futuras.

### 5.3 Colunas Stock-A e WIP

- **Stock-A** (Col N): Stock actual em armazem
- **WIP** (Col O): Work In Progress (em producao)

Quando Stock-A > 0 E nao ha procura, o item nao precisa de producao nesta semana.

### 5.4 Calendario de Dias Uteis (Row 5)

```
02/02 SEG ✓  03/02 TER ✓  04/02 QUA ✓  05/02 QUI ✓  06/02 SEX ✓
07/02 SAB ✗  08/02 DOM ✗
09/02 SEG ✓  10/02 TER ✓  11/02 QUA ✓  12/02 QUI ✓  13/02 SEX ✓
14/02 SAB ✗  15/02 DOM ✗  16/02 SEG ✓  17/02 TER ✗ (FERIADO)
18/02 QUA ✓  19/02 QUI ✓  20/02 SEX ✓
21/02 SAB ✗  22/02 DOM ✗
23/02 SEG ✓  24/02 TER ✓  25/02 QUA ✓  26/02 QUI ✓  27/02 SEX ✓
28/02 SAB ✗  01/03 DOM ✗
02/03 SEG ✓  03/03 TER ✓  04/03 QUA ✓  05/03 QUI ✓  06/03 SEX ✓
07/03 SAB ✗  08/03 DOM ✗
```

**24 dias uteis, 14 nao-uteis** (incluindo feriado 17/02)

---

## 6. REGRAS DE NEGOCIO E CONSTRAINTS

### 6.1 Prioridades (Funcao-Objectivo)

Ordenadas por importancia (do email do Joao):

1. **Cumprir datas de entrega** (tardiness = 0) — PRIORIDADE MAXIMA
2. **Minimizar numero total de setups** — custo operacional
3. **Apenas 1 setup de cada vez** — HARD CONSTRAINT (nao violavel)
4. **Distribuir setups pelos 2 turnos** — balanceamento
5. **Consumir rolos completos de MP** — eficiencia de material (futuro)
6. **Considerar ferramentas com mesmo calco** — setup reduzido (futuro)

### 6.2 Turnos de Producao

| Turno | Inicio | Fim | Duracao |
|-------|--------|-----|---------|
| X | 06:00 | 14:00 | 8 horas (480 min) |
| Y | 14:00 | 22:00 | 8 horas (480 min) |
| Total | 06:00 | 22:00 | 16 horas (960 min) |

**Regra DEC-0002**: Operacoes NAO cruzam fronteiras de turno. Se nao cabe no turno X, e empurrada para o turno Y.

### 6.3 Setup Crew (Constraint Global)

- Maximo 1 setup em simultaneo em TODAS as maquinas
- Se uma maquina precisa setup e outra ja esta em setup, a segunda ESPERA
- O tempo de setup varia: 0.5h a 1.5h (conforme ferramenta)

### 6.4 Operadores

| Parametro | Valor |
|-----------|-------|
| Operadores por operacao | 1 ou 2 (campo "No Pessoas" do ISOP) |
| Pool por area | X elementos (actualizado diariamente) |
| Pool overflow | Y elementos de outras areas (reserva) |
| Fonte de dados | Manual (futuro: sistema RH) |

**Ferramentas que requerem 2 operadores** (14 de 44):
BFP188, BFP195, EBR001, JDE002, LEC002, VUL038, VUL111, VUL115, VUL127

### 6.5 Maquinas Alternativas

Quando a maquina primaria esta sobrecarregada ou indisponivel:

| Maquina Primaria | Alternativa Possivel | Ferramentas Afectadas |
|-----------------|---------------------|----------------------|
| PRM019 | PRM039, PRM043 | 7 ferramentas (todas tem alt) |
| PRM020 | PRM039 | 1 de 3 (VUL068 apenas) |
| PRM031 | PRM039 | 7 ferramentas (todas tem alt) |
| PRM039 | PRM031, PRM043 | 10 ferramentas (todas tem alt) |
| PRM042 | **NENHUMA** | 6 ferramentas — SEM ALTERNATIVA |
| PRM043 | PRM039, PRM031 | 8 de 11 tem alt; 3 sem alt (BFP195, BFP202, HAN002) |

**PRM042 e a maquina MAIS CRITICA**: Se avaria, 6 ferramentas e 11 SKUs ficam parados sem alternativa.

### 6.6 Disponibilidade (Avarias)

- **Maquina down**: Todas as ferramentas dessa maquina ficam bloqueadas
- **Ferramenta down**: Apenas os SKUs dessa ferramenta ficam bloqueados
- **Fonte de dados**: Eventos manuais (MACHINE_DOWN, TOOL_BREAK)

---

## 7. COMO OS DADOS SE APLICAM NO SOFTWARE

### 7.1 Import/Ingest Pipeline

```
ISOP_Nikufra.xlsx
    │
    ├──▶ ISOPParser.parse()     ──▶ Snapshot JSON (canonical format)
    │    [isop_parser.py]            ├── master_data (items, resources, tools)
    │                                ├── routing (tool→machine→SKU mapping)
    │                                ├── series (demand per date per SKU)
    │                                └── semantics (units, calendar)
    │
    ├──▶ IngestExcel.parse()    ──▶ Machine/Tool/Operation models
    │    [ingest_excel.py]           ├── MACHINE_AREA_MAP (PG1/PG2 assignment)
    │                                ├── Working day flags
    │                                └── Demand arrays per operation
    │
    └──▶ IngestService.build()  ──▶ NikufraDashboardState
         [ingest_service.py]         ├── machines (with areas + MAN)
                                     ├── tools (with routing + rates)
                                     ├── operations (with demand series)
                                     └── mo (M.O. totals per area)
```

### 7.2 Scheduling Engine (NikufraEngine.tsx)

O motor client-side transforma os dados em blocos de producao:

```
Input:                              Output:
┌─────────────────────┐            ┌─────────────────────┐
│ EOp[] (operations)  │            │ Block[] (scheduled)  │
│ - id, sku, tool     │            │ - machineId          │
│ - machine, demand[] │──Engine──▶ │ - startMin, endMin   │
│ ETool[] (tools)     │            │ - setupS, setupE     │
│ - setup, rate, alt  │            │ - shift (X/Y)        │
│ Machines[]          │            │ - qty produced       │
│ - id, area          │            │ - overflow flag      │
└─────────────────────┘            └─────────────────────┘
```

### 7.3 Mapeamento ISOP → Engine

| Campo ISOP | Campo Engine (EOp) | Notas |
|------------|-------------------|-------|
| Referencia Artigo (col D) | `sku` | SKU unico — agregado across clients |
| Maquina (col G) | `m` | Maquina primaria |
| Ferramenta (col I) | `t` | Tool code |
| Designacao (col E) | `nm` | Nome do produto |
| ATRASO (col P) | `atr` | Quantidade em atraso |
| Datas (cols Q-AY) | `d[]` | Array de 8 valores (primeiros 8 dias uteis) |

| Campo ISOP | Campo Engine (ETool) | Notas |
|------------|---------------------|-------|
| Ferramenta (col I) | `id` | Tool code |
| Maquina (col G) | `m` | Maquina primaria |
| Maq. Alternativa (col H) | `alt` | '-' se nenhuma |
| Tp.Setup (col J) | `sH` | Horas (converter para minutos no engine) |
| Pecas/H (col K) | `pH` | Rate de producao |
| No Pessoas (col L) | `op` | Operadores necessarios |
| Lote Economico (col F) | `lt` | Tamanho de lote preferencial |
| Stock-A (col N) | `stk` | Stock actual |

### 7.4 Agregacao de Demand por SKU

**Processo critico**: O ISOP tem multiplas linhas para o mesmo SKU (clientes diferentes). O engine precisa de UMA entrada por SKU com a procura TOTAL.

```
Exemplo: SKU 1064169X100
  Linha 8  (FAURECIA):  demand dia1 = 36400 (*)
  Linha 56 (FAUR-SIEGE): demand dia1 = ...
  Linha 86 (FAUREC.CZ):  demand dia1 = ...
  ────────────────────────────────
  Engine EOp: d[0] = SOMA de todas as linhas para este SKU
```

(*) Nota: os valores nas colunas de datas representam posicoes cumulativas, nao incrementais. A conversao para procura diaria requer calcular deltas.

### 7.5 Dados NAO Disponíveis no ISOP (Gaps)

| Dado | Disponivel | Fonte | Status no Software |
|------|------------|-------|--------------------|
| Componentes/MP (EMPxxxx) | PP PDFs | Manual | NAO implementado |
| Quantidade de rolos MP | Mencionado email | Manual | NAO implementado |
| Calcos partilhados | Futuro | Manual/Learning | NAO implementado |
| Pool operadores por dia | Manual | Manual input | Parcialmente (F-10) |
| Eventos avaria | Manual | Event API | Implementado (F-13) |
| Due dates por cliente | Derivado | Assuncao A-05 | END_OF_SHIFT_Y (22:00) |

---

## 8. VALIDACOES E INVARIANTES

### 8.1 Invariantes de Dados (devem ser verificados no import)

1. **Toda ferramenta tem maquina primaria** — col G nunca vazio
2. **Todo SKU tem ferramenta** — col I nunca vazio
3. **Rate > 0** para toda ferramenta activa — col K > 0
4. **Setup >= 0** — col J >= 0 (0 = ferramenta ja montada/sem setup)
5. **Operadores ∈ {1, 2}** — col L so tem 1 ou 2
6. **Maquina alternativa != maquina primaria** — col H != col G
7. **Dias uteis == 1 ou 0** — row 5 binario

### 8.2 Invariantes de Scheduling (devem ser verificados no output)

1. **setup_overlap_violations == 0** — nunca 2 setups em simultaneo
2. **shift_crossing_violations == 0** — nenhuma operacao cruza 14:00
3. **Todas as operacoes cabem no dia** — nenhum overflow nao-reportado
4. **Operadores <= pool disponivel** — por turno por area
5. **Tardiness minimizada** — funcao-objectivo dominante

---

## 9. RESUMO EXECUTIVO

### O que o ISOP nos da:
- 81 linhas de dados de producao para 6 maquinas
- 44 ferramentas com routing completo (setup, rate, alt, operadores)
- 35 dias de horizonte temporal com calendario de dias uteis
- Stock actual e atraso

### O que os PPs nos dao:
- Confirmacao de areas (PG1/PG2) para cada maquina
- MAN (man-minutes) e M.O. (operadores) por area
- Componentes/materias-primas (para futuro constraint de material)
- Validacao do plano gerado pelo MRP actual

### O que o email do Joao nos da:
- Prioridade: cumprir datas > minimizar setups > balancear turnos
- Hard constraint: 1 setup de cada vez
- Soft constraint: distribuir setups, consumir rolos completos
- Futuro: calcos partilhados, integracao RH

### O que falta:
- Dados reais de custos EUR (OP-08 do Doc Mestre)
- Pool de operadores por dia por area (input manual)
- BOM/materiais reais (componentes EMPxxxx)
- Mapeamento de calcos partilhados entre ferramentas
