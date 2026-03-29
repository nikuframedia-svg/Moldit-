# Análise Completa — MPP Moldit (MDT / 732. Detalhado)

**Fonte**: `Moldit_Dados_Operacionais_MPP.xlsx` (extração validada do `Template_para_teste_Moldit.mpp`)
**Última gravação MPP**: 13 Março 2026 (por Júlio Lopes, revisão #17671)
**Data desta análise**: 29 Março 2026

---

## 1. Números Gerais

| Métrica | Valor |
|---------|-------|
| Tasks totais | 590 (com nome) + 152 linhas vazias = 742 IDs |
| Operações reais (não-summary, não-milestone) | 548 |
| Summary tasks | 27 |
| Milestones | 15 |
| Assignments com recurso nomeado | 402 |
| Assignments sem recurso (task-only) | 174 |
| Recursos (máquinas + postos) | 48 com nome (+ 1 ID vazio) |
| Dependências | 443 (100% Finish-to-Start, lag 0) |
| Dependências cross-molde | 1 (Barra Extração #3500: 2951 → 2950) |
| Calendários | Standard + individuais por máquina |

---

## 2. Moldes em Produção

### 2.1 Visão geral

| Molde | Cliente | Deadline | Ensaio | Ops | Work (h) | Dur (h) | Feitas | Parciais | Pendentes | Componentes |
|-------|---------|----------|--------|-----|----------|---------|--------|----------|-----------|-------------|
| **2954** | AIS | **S15** | 02-Abr | 61 | 460 | 500 | 45 | 0 | 16 | 11 |
| **2944** | (AM) | **S19** | 07-Mai | 98 | 1.757 | 2.177 | 47 | 10 | 41 | 9 |
| **2950** | Pro-X Automotive (CC) | **S18** | 19-Mai | 136 | 2.008 | 2.300 | 52 | 3 | 81 | 15 |
| **2951** | (macho/cavidade) | **S22** | 19-Mai | 134 | 1.720 | 2.360 | 37 | 14 | 83 | 15 |
| **2948** | Pro-X Automotive AG (AM) | **S25** | 29-Abr | 109 | 1.180 | 1.696 | 24 | 7 | 78 | 13 |
| **2947** | ASG (grupo) | **S22** | — | 5 | 176 | 176 | 1 | 0 | 4 | — |
| **2949** | ASG (grupo) | **S24** | — | 5 | 200 | 200 | 0 | 0 | 5 | — |
| **TOTAL** | | | | **548** | **7.501** | **9.409** | **206** | **34** | **308** | |

### 2.2 Progresso por molde (% por contagem de operações concluídas)

```
2954  ████████████████████████████████████░░░░░░░░░░░░░  73.8%  (45/61)
2944  ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░  48.0%  (47/98)
2950  ███████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  38.2%  (52/136)
2951  █████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  27.6%  (37/134)
2948  ███████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  22.0%  (24/109)
2947  ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  20.0%  (1/5)
2949  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0.0%  (0/5)
```

### 2.3 Moldes ASG (2947 / 2949)

Operações parciais feitas na Moldit para a ASG (empresa do grupo). Processo simplificado:

**Molde 2947** (S22, 176h, 1/5 feito):
- Cavidade: Polimento 64h ✅ → Furação 40h (MA07) → Fecho circuitos 16h (Tapagem)
- Macho: Furação 40h (MA08) → Fecho circuitos 16h (Tapagem)

**Molde 2949** (S24, 200h, 0/5 feito):
- Macho: Furação 40h (MA07) → Fecho circuitos 16h (Tapagem)
- Cavidade: Polimento 64h → Furação 64h (MA07) → Fecho circuitos 16h (Tapagem)

### 2.4 Componentes por molde

Os moldes completos (2944, 2948, 2950, 2951) seguem a mesma estrutura com variação na complexidade:

| Componente | 2954 | 2944 | 2950 | 2951 | 2948 |
|------------|------|------|------|------|------|
| Macho | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cavidade | ✓ | ✓ | ✓ | ✓ | ✓ |
| Postiços | ✓ | ✓ | ✓ | ✓ | ✓ |
| Postiço Macho | — | ✓ | ✓ | ✓ | ✓ |
| Barras extração | ✓ | — | ✓ | ✓ | ✓ |
| Barra Extração #3500 | — | — | ✓ | ✓ | — |
| Balancés | — | — | ✓ | ✓ | ✓ |
| Movimentos | — | — | ✓ | ✓ | ✓ |
| Maxilas | — | ✓ | ✓ | ✓ | — |
| Estrutura | ✓ | ✓ | ✓ | ✓ | ✓ |
| Placas (Traseira/Extração/Carburador) | ✓ | ✓(2) | ✓ | ✓ | ✓ |
| Calços | ✓ | — | ✓ | ✓ | ✓ |
| Acessórios | ✓ | — | — | — | — |
| Molde (montagem final) | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## 3. Recursos (Máquinas e Postos)

### 3.1 Inventário completo — 48 recursos

#### CNC — Fresadoras (regime 16h/dia, pico 24h)

| ID | Recurso | Grupo | Work (h) | Actual (h) | Ops | Moldes | 2ª Placa |
|----|---------|-------|----------|------------|-----|--------|----------|
| 7 | FE31 - MasterMill | Maq_3D/2D - GD | 512 | 422 | 16 | 2944,2948,2950,2951 | — |
| 38 | // FE31 - MasterMill | Maq_3D/2D - GD | 116 | 108 | 10 | 2944,2948,2950,2951 | ✓ |
| 10 | FE35 - Promac | Maq_3D/2D - GD | 472 | 308 | 35 | 2944,2948,2950,2951 | — |
| 39 | // FE35 - Promac | Maq_3D/2D - GD | 32 | 4 | 4 | 2944,2950,2954 | ✓ |
| 8 | FE32 - UMILL 1800 | Maq_3D - MD | 372 | 295 | 7 | 2944,2950,2951 | — |
| 9 | // FE32 - UMILL 1800 | Maq_3D - MD | 12 | 0 | 1 | 2951 | ✓ |
| 4 | FE26 - Depo | Maq_3D - GD | 228 | 119 | 14 | 2948,2950,2951,2954 | — |
| 11 | FE25 - Correia | Maq_3D - PD | 132 | 100 | 4 | 2948,2954 | — |
| 12 | // FE25 - Correia | Maq_3D - PD | 0 | 0 | 0 | — | ✓ |
| 5 | FE28 - Sdv | Maq_estruturas | 366 | 219 | 41 | Todos 5 | — |
| 36 | FE38 - Doosan 750L | Maq_estruturas | 0 | 0 | 0 | — | — |
| 23 | FE23 - Mori | FACESS | 36 | 12 | 3 | 2950 | — |

#### CNC — Desbaste

| ID | Recurso | Grupo | Work (h) | Actual (h) | Ops | Moldes |
|----|---------|-------|----------|------------|-----|--------|
| 26 | FE19 - Eumach | Desb_PD | 332 | 286 | 14 | Todos 5 |
| 6 | FE18 - Rambaudi | Desbaste | 268 | 248 | 12 | 2944,2948,2950,2951 |
| 3 | FE22 - Rambaudi | Desbaste | 176 | 176 | 6 | 2944,2948,2950,2951 |
| 2 | FE16 - Zayer | Desbaste | 32 | 32 | 2 | 2950 |

#### CNC — 5 Eixos

| ID | Recurso | Grupo | Work (h) | Actual (h) | Ops | Moldes |
|----|---------|-------|----------|------------|-----|--------|
| 35 | FE36 - Mikron | Acab. 5ax PD | 136 | 53 | 6 | 2944,2950,2951 |
| 22 | FE30 - 5 Eixos | Acab. 5ax PD | 70 | 70 | 5 | 2950,2954 |
| 37 | FE37 - DOOSAN 5AX | Acab. 5ax PD | 0 | 0 | 0 | — |

#### Erosão

| ID | Recurso | Grupo | Work (h) | Actual (h) | Ops | Moldes |
|----|---------|-------|----------|------------|-----|--------|
| 19 | EE08 - Ona NX8 | EROSÃO | 336 | 156 | 13 | 2944,2948,2950,2951 |
| 18 | EE07 - Ona 700 | EROSÃO | 136 | 32 | 3 | 2944,2950,2951 |
| 20 | EE09 - Ona 400 | EROSÃO | 128 | 0 | 5 | 2950,2951,2954 |
| 17 | EE01 - Ona 30 | EROSÃO | 0 | 0 | 0 | — |
| 21 | EE11 - Erosão fio | Erosão | 0 | 0 | 0 | — |

#### Furação

| ID | Recurso | Grupo | Work (h) | Actual (h) | Ops | Moldes |
|----|---------|-------|----------|------------|-----|--------|
| 15 | MA07 - Cheto IX 3000 | FURAÇÃO | 388 | 56 | 11 | 2944,2947,2949,2950,2951 |
| 16 | MA08 - Heto | FURAÇÃO | 200 | 86 | 8 | 2944,2947,2948,2950,2951 |
| 14 | MA06 - Heto | FURAÇÃO | 172 | 112 | 8 | Todos 5+2954 |
| 13 | MA01 - Collet | FURAÇÃO | 24 | 24 | 3 | 2954 |

#### Elétrodos

| ID | Recurso | Grupo | Work (h) | Actual (h) | Ops | Moldes |
|----|---------|-------|----------|------------|-----|--------|
| 33 | FE29 - GT | Maq_Eletrodos | 0 | 0 | 0 | — |
| 34 | FE33 - Microcut | Maq_Eletrodos | 0 | 0 | 0 | — |

#### Postos manuais (regime 8h/dia)

| ID | Recurso | Grupo | Work (h) | Actual (h) | Ops | Dedicado a |
|----|---------|-------|----------|------------|-----|------------|
| 31 | BA03 | Bancada | 556 | 5 | 30 | 2948, 2951 |
| 30 | BA02 | Bancada | 373 | 57 | 26 | 2944, 2954 |
| 29 | BA01 | Bancada | 312 | 16 | 15 | 2950 |
| 32 | Polimento | Polimento | 592 | 64 | 19 | Todos 7 |
| 25 | TP - Tapagem de águas | Tapagem | 228 | 32 | 19 | Todos 7 |
| 27 | Prensa Grande | Bancada | 0 | 0 | 0 | — |
| 28 | Prensa Pequena | Bancada | 0 | 0 | 0 | — |
| 47 | Controlo Dimensional | Qualidade | 0 (milestones) | 0 | 15 | Todos 5 |

#### Externos

| ID | Recurso | Grupo | Work (h) | Ops | Moldes |
|----|---------|-------|----------|-----|--------|
| 41 | Externo/Ret | Retificação | 592 | 35 | Todos 5 |
| 48 | Externo/Aço | Compra Aço | 0 | 0 | — |

#### Outros (sem atribuições ou uso especial)

| Recurso | Notas |
|---------|-------|
| TO02 - Clovis 28 (Torno) | 0 atribuições |
| FE11/FE34 - convencionais | 48h cada, só 2954 (acessórios) |
| RE05 | 8h, 2 ops no 2954 (retificação?) |
| ? (condicional) | 68h, 8 ops em 2944/2950 |
| ASG, PP, FE365 | 0 atribuições (recursos fantasma) |

### 3.2 Carga total por recurso (ordenado)

```
Externo/Ret           ██████████████████████████████████████████  592h
Polimento             ██████████████████████████████████████████  592h (÷2 operadores = ~296h cada)
BA03                  ███████████████████████████████████████░░░  556h
FE31+//FE31           ████████████████████████████████████████░░  628h (512+116)
FE35+//FE35           ███████████████████████████████████░░░░░░░  504h (472+32)
MA07 - Cheto          ███████████████████████████░░░░░░░░░░░░░░░  388h
BA02                  ██████████████████████████░░░░░░░░░░░░░░░░  373h
FE32+//FE32           ███████████████████████████░░░░░░░░░░░░░░░  384h (372+12)
FE28 - Sdv            ██████████████████████████░░░░░░░░░░░░░░░░  366h
EE08 - Ona NX8        ████████████████████████░░░░░░░░░░░░░░░░░░  336h
FE19 - Eumach         ███████████████████████░░░░░░░░░░░░░░░░░░░  332h
BA01                  ██████████████████████░░░░░░░░░░░░░░░░░░░░  312h
FE18 - Rambaudi       ███████████████████░░░░░░░░░░░░░░░░░░░░░░░  268h
TP - Tapagem          ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  228h (÷2 operadores = ~114h cada)
FE26 - Depo           ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  228h
MA08 - Heto           ██████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  200h
FE22 - Rambaudi       ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  176h
MA06 - Heto           ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  172h
```

---

## 4. Operações — Tipologia e Frequência

### 4.1 Top 20 operações por work total

| Código | Tipo | Ocorrências | Work Total (h) | Work Médio (h) |
|--------|------|-------------|----------------|----------------|
| FE020 | Acabamento CNC | 23 | 806 | 35.0 |
| FU001 | Furação Refrigeração/Hidráulica | 27 | 732 | 27.1 |
| BA045 | Polimento | 23 | 592 | 25.7 |
| EE005 | Erosão Zona Moldante | 22 | 580 | 26.4 |
| FE070 | Acabamento 5 Eixos | 17 | 438 | 25.8 |
| FE010 | Desbaste | 37 | 404 | 10.9 |
| RE001 | Retificação (externo) | 20 | 388 | 19.4 |
| FE013 | Desbaste GD | 16 | 332 | 20.8 |
| FE023 | Trabalho Desenho Frente | 25 | 298 | 11.9 |
| BA020 | Ajuste Acessórios | 38 | 288 | 7.6 |
| FE032 | Trabalho Desenho Lateral | 28 | 234 | 8.4 |
| FU015 | Fecho circuitos (Tapagem) | 19 | 228 | 12.0 |
| FE024 | Trabalho Desenho Trás | 26 | 222 | 8.5 |
| FE036 | Acabamento Zona Ajuste | 13 | 184 | 14.2 |
| BA050 | Montagem Lado Móvel/Fixo | 9 | 152 | 16.9 |
| BA055 | Ajuste de Face | — | 132 | — |
| BA015 | Ajuste Barras | 5 | 124 | 24.8 |
| BA010 | Ajuste Balancés | — | 120 | — |
| FE014 | Desbaste Frente | 13 | 120 | 9.2 |
| FE031 | Trabalho Desenho Inclinado | 16 | 110 | 6.9 |

### 4.2 Elétrodos — O buraco nos dados

| Código | Tipo | Ocorrências | Work Total |
|--------|------|-------------|------------|
| EL001 | Modelação de Elétrodos | 21 | **0h** |
| EL005 | Maquinação de Elétrodos | 21 | **0h** |

42 operações de elétrodos nos moldes 2948 e 2950 com **zero work hours** e **zero recurso atribuído**. O FE29-GT (confirmado como máquina de elétrodos) tem 0 atribuições no MPP. As operações aparecem nos deadlines com semanas TEXT3 (15, 16, 114, 115, etc.) mas sem duração estimada.

---

## 5. Dependências (Grafo de Precedências)

### 5.1 Estatísticas

- **443 relações** de precedência
- **100% Finish-to-Start** com lag 0
- **1 dependência cross-molde**: Barra de Extração #3500 do 2951 precede a do 2950
- Restantes 442 são **intra-molde**

### 5.2 Implicação

Cada molde é essencialmente um **sub-projeto independente** que compete com os outros pelas mesmas máquinas. O único ponto de ligação real é a partilha de recursos e a única dependência cross-molde (2951 → 2950 na Barra #3500).

---

## 6. Compatibilidade Operação → Máquina

A matriz tem **124 pares** código-operação ↔ máquina. As operações com mais alternativas de máquina:

| Operação | Máquinas possíveis | Nomes |
|----------|--------------------|-------|
| FE024 (TD Trás) | 7 | FE28, FE31, //FE31, FE35, //FE35, FE26, FE36 |
| FE032 (TD Lateral) | 6 | FE31, //FE31, FE35, //FE35, FE36, FE28 |
| FE020 (Acabamento) | 6 | FE31, FE35, FE32, FE26, FE25, FE28 |
| FE023 (TD Frente) | 6 | FE31, //FE31, FE35, //FE35, FE26, FE28 |
| FE010 (Desbaste) | 5 | FE18, FE19, FE22, FE26, FE28 |
| FU001 (Furação) | 5 | MA07, MA08, MA06, MA01, FE26 |
| FE031 (TD Inclinado) | 5 | //FE31, FE35, //FE35, FE36, FE28 |
| FE036 (Acab. Zona Ajuste) | 5 | FE32, FE36, FE30, FE25, FE23 |

Operações com **1 só máquina** (sem alternativa):

| Operação | Máquina única |
|----------|---------------|
| BA045 (Polimento) | Polimento |
| FU015 (Fecho circuitos) | TP - Tapagem de águas |
| CD001 (Medição) | Controlo Dimensional |
| EE001 (Erosão 1ª) | EE08 - Ona NX8 |
| FE040 (Maq. Balancés) | FE35 - Promac |
| FE085 (Maq. Sist. Injeção) | ? (condicional) |
| TEX001 (Textura Laser) | Externo/Ret |

---

## 7. Calendários

Calendário Standard com exceções (feriados portugueses + férias de agosto). Calendários individuais por máquina baseados no Standard. Feriados incluem: 1 Jan, Carnaval, Sexta-feira Santa, 25 Abr, 1 Mai, Corpo de Deus, 10 Jun, 15 Ago, 5 Out, 1 Nov, 1 Dez, 8 Dez, 25 Dez. Férias de Agosto tipicamente 1 semana completa.

---

## 8. 2ª Placa (Prato Duplo)

### 8.1 Dados

- **4 máquinas** com 2ª placa: FE31-MasterMill, FE35-Promac, FE32-UMILL 1800, FE25-Correia
- **15 assignments** usando 2ª placa | **160h** de work total
- // FE31: 116h em 10 ops (TD Frente/Trás/Lateral/Inclinado)
- // FE35: 32h em 4 ops (maquinação conjunto + TD)
- // FE32: 12h em 1 op (maquinação no 2951)
- // FE25: 0h (nunca utilizado)

### 8.2 O que significa

A 2ª placa permite executar uma operação secundária (tipicamente Trabalho Desenho) **sem retirar a peça principal** da CNC. Funciona como um recurso paralelo virtual da mesma máquina, com setup ~0h. O FE31 é o que mais beneficia disto — absorve 116h de TD que de outra forma precisariam de setup adicional.

---

## 9. Operações Especiais

### 9.1 Operações "Fora?" (decisão interna/externa pendente)

10 operações de furação de refrigeração/hidráulica marcadas com nota "Fora ?":

| Molde | Componente | Work (h) | Recurso atual |
|-------|-----------|----------|---------------|
| 2954 | Macho | 8 | MA01 |
| 2954 | Cavidade | 8 | MA01 |
| 2950 | Macho | 32 | MA07 |
| 2950 | Cavidade | 16 | MA08 |
| 2944 | Macho | 36 | MA07 |
| 2944 | Cavidade | 48 | MA07 |
| 2951 | Macho | 28 | MA07 |
| 2951 | Cavidade | 36 | MA07 |
| 2948 | Macho | 40 | MA07 |
| 2948 | Cavidade | 36 | MA07 |
| **Total** | | **288h** | |

Decisão por **capacidade e prazo** (confirmado pelo utilizador). Se externalizadas, libertam ~288h nas furadoras.

### 9.2 Operações condicionais ("?")

8 operações atribuídas ao recurso "?" — podem não ser executadas:

| Molde | Operação | Work (h) |
|-------|----------|----------|
| 2950 | Maquinação c/ Maxilas (FE045) | 12 |
| 2950 | Maquinação c/ sistema injeção (FE085) | 4 |
| 2950 | Balancés Furação (FU001) | 8 |
| 2950 | Calços Acabamento (FE020) | 16 |
| 2950 | Calços TD Lateral (FE032) | 8 |
| 2944 | Maquinação c/ Postiços (FE050) | 8 |
| 2944 | Maquinação c/ Maxilas (FE045) | 8 |
| 2944 | Maquinação c/ Barras (FE060) | 4 |
| **Total** | | **68h** |

---

## 10. Bancadas — Alocação Dedicada

As 3 bancadas estão **dedicadas por molde**, não são intercambiáveis no plano atual:

| Bancada | Moldes | Work (h) | Ops | Actual (h) |
|---------|--------|----------|-----|------------|
| BA01 | 2950 | 312 | 15 | 16 |
| BA02 | 2944, 2954 | 373 | 26 | 57 |
| BA03 | 2948, 2951 | 556 | 30 | 5 |

A BA03 tem a carga mais pesada (556h para 2 moldes complexos) e quase nada executado (5h actual).

---

## 11. Análise de Actual Work vs. Planned Work

Work restante por recurso CNC (planned - actual):

| Recurso | Planned (h) | Actual (h) | Restante (h) | % Executado |
|---------|-------------|------------|---------------|-------------|
| FE31 - MasterMill | 512 | 422 | 90 | 82% |
| FE35 - Promac | 472 | 308 | 164 | 65% |
| FE32 - UMILL 1800 | 372 | 295 | 77 | 79% |
| FE28 - Sdv | 366 | 219 | 147 | 60% |
| EE08 - Ona NX8 | 336 | 156 | 180 | 46% |
| FE19 - Eumach | 332 | 286 | 46 | 86% |
| FE18 - Rambaudi | 268 | 248 | 20 | 93% |
| MA07 - Cheto IX 3000 | 388 | 56 | 332 | 14% |
| FE26 - Depo | 228 | 119 | 109 | 52% |
| MA08 - Heto | 200 | 86 | 114 | 43% |
| MA06 - Heto | 172 | 112 | 60 | 65% |
| FE22 - Rambaudi | 176 | 176 | 0 | 100% |

**Destaques**:
- **FE22 - Rambaudi**: 100% executado (desbaste concluído)
- **FE18 - Rambaudi**: 93% executado (quase concluído)
- **MA07 - Cheto**: apenas 14% executado — **332h restantes** de furação, é o recurso com mais trabalho pendente em proporção
- **EE08 - Ona NX8**: 46% executado — 180h de erosão por fazer

---

## 12. Deadlines e Elétrodos

### 12.1 Deadlines dos moldes (TEXT3 no summary)

| Molde | Deadline | Data Ensaio | Significado |
|-------|----------|-------------|-------------|
| 2954 | S15 | 02-Abr-2026 | Semana 15 — mais próximo |
| 2950 | S18 | 19-Mai-2026 | Semana 18 |
| 2944 | S19 | 07-Mai-2026 | Semana 19 |
| 2947 | S22 | — | Semana 22 (ASG) |
| 2951 | S22 | 19-Mai-2026 | Semana 22 |
| 2949 | S24 | — | Semana 24 (ASG) |
| 2948 | S25 | 29-Abr-2026 | Semana 25 |

TEXT3 = semana **objetivo** (soft deadline). A data real ajusta conforme o progresso.

### 12.2 Deadlines dos elétrodos (TEXT3 numérico)

Nos moldes 2948 e 2950, cada componente que precisa de erosão tem 2 operações de elétrodos (EL001 Modelação + EL005 Maquinação) com TEXT3 numérico que parece codificar a **referência do componente**, não uma semana:

| TEXT3 | Componente | Operação |
|-------|-----------|----------|
| 15 | Macho | EL001 (Modelação) |
| 16 | Macho | EL005 (Maquinação) |
| 114 | Cavidade / Postiço Macho | EL001 |
| 115 | Cavidade / Postiço Macho | EL005 |
| 207 | Postiços | EL001 |
| 208 | Postiços | EL005 |
| 307 | Barras de extração | EL001 |
| 308 | Barras de extração | EL005 |
| 407 | Balancés | EL001 |
| 408 | Balancés | EL005 |
| 510 | Movimentos | EL001 |
| 511 | Movimentos | EL005 |

Padrão: centena = componente (1=Macho/Cavidade, 2=Postiços, 3=Barras, 4=Balancés, 5=Movimentos), unidade = tipo (EL001=7, EL005=8).

---

## 13. Resumo Executivo

### O que este MPP contém

Um plano de produção de **7 moldes** em simultâneo, com **548 operações reais** distribuídas por **48 recursos** (máquinas CNC, erosões, furadoras, bancadas, polimento, tapagem, e serviços externos). Total de **7.501 horas de work** planeado, das quais **~3.200h já foram executadas**.

### A conclusão central

**Não há problema de capacidade — há problema de sequenciamento.** Com regime de 16h/dia (2 turnos) nas CNC, nenhum recurso excede 71% de utilização. Mas 7 moldes competem pelas mesmas ~35 máquinas com 443 dependências de precedência, e a sequência em que as operações são alocadas determina se os deadlines são cumpridos.

### Os 5 riscos operacionais

1. **MA07 - Cheto IX 3000**: 332h de furação pendente (86% do trabalho por fazer), serve 5 moldes + 2 ASG. MA06/MA08 aliviam parcialmente mas são mais limitadas.

2. **Elétrodos sem dados**: 42 operações EL001/EL005 com 0h de work e 0 recurso. A erosão (EE005, 580h) depende dos elétrodos estarem prontos. Sem esta informação, o scheduler não pode planear a erosão.

3. **BA03 sobrecarregada**: 556h para 2 moldes complexos (2948+2951) com apenas 5h executadas. É o recurso manual com mais atraso.

4. **Decisões "Fora?" pendentes**: 288h de furação sem decisão interna/externa. Se ficarem internas, agravam a carga do MA07.

5. **Operações condicionais ("?")**: 68h que podem ou não ser executadas nos moldes 2944 e 2950. O scheduler precisa de suportar operações opcionais.

### Para o software de scheduling

Dados disponíveis e validados:
- ✅ 548 operações com duração, work, recurso, datas, progresso
- ✅ 443 dependências FS com lag 0
- ✅ 124 pares de compatibilidade operação↔máquina
- ✅ Calendários com feriados e exceções
- ✅ Deadlines por molde (TEXT3)
- ✅ 15 assignments de 2ª placa (160h)

Dados em falta:
- ❌ Duração dos elétrodos (42 operações com 0h)
- ❌ Decisão final "Fora?" nas furações (10 operações, 288h)
- ❌ Confirmação das operações condicionais "?" (8 operações, 68h)
