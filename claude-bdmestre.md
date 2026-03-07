# BD Mestre Nikufra — Documento Mestre de Dados

> **ESTE E O DOCUMENTO MESTRE DE DADOS DO PROJECTO.**
> Fonte unica de verdade para TODOS os dados mestres da fabrica Nikufra (grupo Incompol).
> Qualquer dado de producao (routing, maquinas, tools, setup, rates, operadores, SKUs, clientes,
> calendario, M.O., constraints) DEVE vir deste documento ou do ISOP real.
> Ver tambem: `CLAUDE.md` §22 — Mandato de dados 100% reais.
>
> Fixture real: `frontend/public/fixtures/nikufra/nikufra_data.json`

---

## 1. Maquinas (6 prensas)

| Maquina | Area | Tools | Alt. Comum | Notas |
|---------|------|-------|------------|-------|
| **PRM019** | PG1 | 7 | PRM039, PRM043 | |
| **PRM020** | PG1 | 3 | PRM039 | Baixa carga |
| **PRM031** | PG2 | 7 | PRM039 | Alta carga (FAURECIA) |
| **PRM039** | PG2 | 10 | PRM031, PRM043 | Maior variedade |
| **PRM042** | PG2 | 6 | **NENHUMA** | Maquina CRITICA — sem alternativas |
| **PRM043** | PG1 | 11 | PRM039, PRM031 | 3 tools sem alt (BFP195, BFP202, HAN002) |

### Mapa Machine -> Area
```
PRM019 → PG1    PRM020 → PG1    PRM031 → PG2
PRM039 → PG2    PRM042 → PG2    PRM043 → PG1
```

### Recurso Virtual
- **SETUPCREW** — capacidade=1, partilhado por TODAS as maquinas (so 1 setup simultaneo)

---

## 2. Turnos & Calendario

| Turno | Horario | Duracao |
|-------|---------|---------|
| X (manha) | 07:00 — 15:30 | 510 min |
| Y (tarde) | 15:30 — 24:00 | 510 min |
| OFF | 00:00 — 07:00 | Sem producao |
| Z (excepcional) | 00:00 — 07:00 | 420 min (activavel via flag `thirdShift`) |

- **Timezone**: Europe/Lisbon (IANA)
- **Capacidade diaria**: 1020 min (2 turnos x 510)
- **Operacoes NAO cruzam fronteiras de turno** (15:30)
- **Turno Geral**: 07:00 — 16:00 (TG_END=960 min) — overlap com turno Y entre 15:30-16:00
- **Constantes**: S0=420 (07:00), T1=930 (15:30), S1=1440 (24:00), S2=1860 (07:00 +1d)

### 8 Dias Uteis do Fixture
```
02/02 Seg | 03/02 Ter | 04/02 Qua | 05/02 Qui | 06/02 Sex
09/02 Seg | 10/02 Ter | 11/02 Qua
```

### Calendario Completo (24 dias uteis, 14 nao-uteis)
```
02/02 SEG Y  03/02 TER Y  04/02 QUA Y  05/02 QUI Y  06/02 SEX Y
07/02 SAB N  08/02 DOM N
09/02 SEG Y  10/02 TER Y  11/02 QUA Y  12/02 QUI Y  13/02 SEX Y
14/02 SAB N  15/02 DOM N  16/02 SEG Y  17/02 TER N (FERIADO)
18/02 QUA Y  19/02 QUI Y  20/02 SEX Y
21/02 SAB N  22/02 DOM N
23/02-27/02 SEG-SEX Y
28/02 SAB N  01/03 DOM N
02/03-06/03 SEG-SEX Y
07/03 SAB N  08/03 DOM N
```

---

## 3. M.O. (Mao de Obra) por Area por Dia

| Area | D0 | D1 | D2 | D3 | D4 | D5 | D6 | D7 |
|------|----|----|----|----|----|----|----|----|
| PG1 | 2.6 | 0.4 | 4.1 | 2.0 | 0.3 | 2.5 | 0.1 | 3.2 |
| PG2 | 6.2 | 2.2 | 1.0 | 0.9 | 2.7 | 0.5 | 2.2 | 0.6 |

---

## 4. Routing Completo — 44 Tools

### PRM019 (PG1) — 7 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs | Nomes | Lot Eco | Stock |
|------|----------|-----------|-----|-----|------|-------|---------|-------|
| BFP080 | 1.25 | 1923 | 1 | PRM039 | 1065170X100 | REAR LINK BVH2 | 23040 | 0 |
| BFP082 | 1.25 | 1980 | 1 | PRM039 | 1092262X100 | Rear Link HA RH With Bushing | 32000 | 0 |
| BFP179 | 0.5 | 1802 | 1 | PRM043 | 5246946X080, 5246947X080 | Patte gauche Supp Palonnier, Patte Droite Supp Palonnier | 7200 | 0 |
| BFP181 | 0.5 | 1802 | 1 | PRM043 | 3829548020 | Support Palonnier | 7200 | 0 |
| BFP192 | 0.5 | 1799 | 1 | PRM043 | 3775166060.10 | Front Lower Catcher LH | 7600 | 41 |
| BFP197 | 0.5 | 1799 | 1 | PRM043 | 3822924050, 3822925050.10 | Air Bag Mounting Bracket LH, Air Bag Mounting Bracket RH | 2400 | 0 |
| VUL038 | 1.25 | 1200 | **2** | PRM043 | 8708007153 | CHAPA DE SUPORTE (TRAS) | 1920 | 0 |

### PRM020 (PG1) — 3 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs | Nomes | Lot Eco | Stock |
|------|----------|-----------|-----|-----|------|-------|---------|-------|
| MIC009 | 0.5 | 600 | 1 | - | 8750738609 | Platina | 2160 | 0 |
| VUL031 | 1.0 | 2083 | 1 | - | 8711304305 | PONTE SOBRE IGNICAO | 8000 | 0 |
| VUL068 | 1.0 | 1250 | 1 | PRM039 | 8708006154 | Suporte Queimador Tras | 576 | 2321 |

### PRM031 (PG2) — 7 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs | Nomes | Lot Eco | Stock |
|------|----------|-----------|-----|-----|------|-------|---------|-------|
| BFP079 | 1.0 | 1681 | 1 | PRM039 | 1064169X100, 1064186X100 | Front Link HA With Bushings LH, Front Link HA With Bushings RH | 36400 | 0 |
| BFP083 | 1.0 | 1681 | 1 | PRM039 | 1115324X080, 1115328X080 | CJ. BIELA FR. REH. DIR. AF REG, CJ. BIELA FR. REH. ESQ. AF REG | 10880 | 0 |
| BFP114 | 1.25 | 3610 | 1 | PRM039 | 1172769X030, 1694825X040 | REAR PIVOT LINK, Rear Pivot link | 16800 | 0 |
| BFP162 | 1.25 | 1560 | 1 | PRM039 | 1768601X030, 1768602X030 | Ha Front link LH, Ha Front link RH | 4800 | 0 |
| BFP171 | 0.5 | 1802 | 1 | PRM039 | 2689556X090, 2689557X090 | Bracket - HHN - LH Unlocking, Bracket - HHN - RH Unlocking | 10640 | 0 |
| BFP183 | 0.5 | 3610 | 1 | PRM039 | 1661545X070 | Rear link HA RH With Bushing | 12000 | 0 |
| BFP184 | 0.5 | 3610 | 1 | PRM039 | 1661546X070 | Rear link HA LH With Bushing | 14400 | 0 |

### PRM039 (PG2) — 10 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs | Nomes | Lot Eco | Stock |
|------|----------|-----------|-----|-----|------|-------|---------|-------|
| BFP091 | 1.0 | 2639 | 1 | PRM043 | 1134691X140 | Bracket Rear Link Fix Act LH | 3840 | 0 |
| BFP092 | 1.0 | 2639 | 1 | PRM043 | 1009675X140 | Bracket Rear Link Fix Act RH | 3840 | 42 |
| BFP096 | 1.0 | 2639 | 1 | PRM043 | 1012535X080 | Bracket Linear Actuator HA | 3600 | 0 |
| BFP100 | 1.0 | 1319 | 1 | PRM043 | 1086227X070, 1954311X030 | Support Tilt Nut Motor LH, Tilt Support LH | 3600 | 5163 |
| BFP101 | 1.0 | 1319 | 1 | PRM043 | 1135760X070, 1955341X030 | Support Tilt Nut Motor RH, Support Tilt RH | 3200 | 4981 |
| BFP110 | 1.0 | 1802 | 1 | PRM043 | 1177295X150, 1177297X150 | Fix Gusset 5_3Door Man L, Fix Gusset 5_3Door Man R | 8000 | 5558 |
| BFP112 | 0.5 | 3597 | 1 | PRM031 | 1197914X050 | Rear link pivot | 20000 | 51931 |
| BFP178 | 0.5 | 1802 | 1 | PRM043 | 2100373X120.10, 2185094X110.10 | Bracket 20Ways Support LH, Bracket 20Ways Support RH | 32000 | 27267 |
| BFP186 | 0.5 | 1802 | 1 | PRM031 | 3778765060.10, 3778766060.10 | 20 Way Support Bracket LH, 20 Way Support Bracket RH | 18000 | 46366 |
| VUL127 | 1.0 | 1441 | **2** | PRM043 | 8750302197.20, 8750302200.20 | Bracket Bottom Infill All Hole, Bracket Bottom Infill | 2304 | 1717 |

### PRM042 (PG2) — 6 tools (SEM ALTERNATIVAS)

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs | Nomes | Lot Eco | Stock |
|------|----------|-----------|-----|-----|------|-------|---------|-------|
| DYE025 | 1.5 | 1000 | 1 | - | E1730002926.10 | BAFFLE-FLANGE 12 SLOTS | 4000 | 0 |
| EBR001 | 0.5 | 1200 | **2** | - | 1127024045004D | Mantel - CMFB HJB | 750 | 0 |
| HAN004 | 0.5 | 2882 | 1 | - | CF624K9TAB01.30, CF624K9TAB02.20 | HSG Inverter Cover LH, HSG Inverter Cover RH | 24000 | 13107 |
| JDE002 | 1.0 | 1200 | **2** | - | TP042173-0040-1, TP042173-0040-2, TP042173-0060-1, TP042173-0060-2 | Heat Shield 40-1, Heat Shield 40-2, Heat Shield 60-1, Heat Shield 60-2 | 12250 | 0 |
| LEC002 | 0.5 | 1802 | **2** | - | F00000001.20 | Passive Cooling plate | 10080 | 0 |
| VUL115 | 1.0 | 1441 | **2** | - | 8718696125, 8716774145 | Mounting Wall Plate, Hanging Plate | 4032 | 0 |

### PRM043 (PG1) — 11 tools

| Tool | Setup(h) | Rate(p/h) | Ops | Alt | SKUs | Nomes | Lot Eco | Stock |
|------|----------|-----------|-----|-----|------|-------|---------|-------|
| BFP125 | 1.0 | 1621 | 1 | PRM039 | 1403150X050, 1413147X070 | Belt Buckle Bracket RH L, PPV Bracket RH R | 6400 | 7969 |
| BFP172 | 0.5 | 1802 | 1 | PRM039 | 2513974X100, 2785359X050 | Plate - Reinforcement RH, Flange - Reinforcement LH | 5120 | 0 |
| BFP187 | 0.5 | 1560 | 1 | PRM039 | 3610299040 | Bracket-Internal Gusset40P RH | 7200 | 0 |
| BFP188 | 0.5 | 1321 | **2** | PRM031 | 3610295060 | Retractor support bracket | 3200 | 0 |
| BFP195 | 0.5 | 1200 | **2** | - | 3836208090 | D85 Floor Bracket IB RH | 0 | 146 |
| BFP202 | 0.5 | 3003 | 1 | - | 4313085020.10 | Epumping Closing Bracket | 11520 | 13 |
| BFP204 | 0.5 | 1560 | 1 | PRM039 | 4398644050 | Central Floor Bracket | 1440 | 0 |
| HAN002 | 0.5 | 1200 | 1 | - | CF589MMA1A02.20 | HV Protection Sheet | 3840 | 13197 |
| JTE001 | 1.0 | 1560 | 1 | - | 6800016767A.10 | Motor Cover Plate | 7580 | 0 |
| JTE003 | 1.0 | 1200 | 1 | - | 6800017267C.30 | Inverter Cover Plate | 4800 | 0 |
| VUL111 | 1.5 | 120 | **2** | - | 8738722724 | Painel Exterior LAM 10 Lts | 360 | 0 |

---

## 5. Tools com 2 Operadores (14 de 44)

BFP188, BFP195, EBR001, JDE002, LEC002, VUL038, VUL111, VUL115, VUL127

Todos os outros requerem 1 operador.

---

## 6. Relacao Tool -> SKU (1:N — Sem Setup Extra)

Uma tool produz MULTIPLOS SKUs **sem mudar ferramental** (sem setup adicional):

| Tool | SKUs | Nota |
|------|------|------|
| BFP079 | 1064169X100, 1064186X100 | Front Link LH e RH |
| BFP083 | 1115324X080, 1115328X080 | Biela Dir e Esq |
| BFP100 | 1086227X070, 1954311X030 | Support Tilt Motor + sub |
| BFP101 | 1135760X070, 1955341X030 | Support Tilt Motor RH + sub |
| BFP110 | 1177295X150, 1177297X150 | Fix Gusset L e R |
| BFP114 | 1172769X030, 1694825X040 | Rear Pivot Link (2 refs) |
| BFP125 | 1403150X050, 1413147X070 | Belt Buckle + PPV Bracket |
| BFP162 | 1768601X030, 1768602X030 | Ha Front link LH e RH |
| BFP171 | 2689556X090, 2689557X090 | Bracket HHN LH e RH |
| BFP172 | 2513974X100, 2785359X050 | Plate + Flange Reinforcement |
| BFP178 | 2100373X120.10, 2185094X110.10 | Bracket 20Ways L e R |
| BFP179 | 5246946X080, 5246947X080 | Patte Supp Palonnier L e R |
| BFP186 | 3778765060.10, 3778766060.10 | 20 Way Support L e R |
| BFP197 | 3822924050, 3822925050.10 | Air Bag Bracket LH e RH |
| HAN004 | CF624K9TAB01.30, CF624K9TAB02.20 | HSG Inverter Cover L e R |
| JDE002 | TP042173-0040-1, -0040-2, -0060-1, -0060-2 | Heat Shield 4 variantes |
| VUL115 | 8718696125, 8716774145 | Mounting Wall + Hanging Plate |
| VUL127 | 8750302197.20, 8750302200.20 | Bracket Bottom Infill (2 refs) |

**Regra**: Setup so quando MUDA de tool. Dentro da mesma tool, SKUs produzidos sequencialmente sem setup.

---

## 7. Maquinas Alternativas

| Primaria | Alternativa | Tools Afectadas |
|----------|-------------|-----------------|
| PRM019 | PRM039, PRM043 | 7 tools (todas tem alt) |
| PRM020 | PRM039 | 1 de 3 (so VUL068) |
| PRM031 | PRM039 | 7 tools (todas tem alt) |
| PRM039 | PRM031, PRM043 | 10 tools (todas tem alt) |
| **PRM042** | **NENHUMA** | **6 tools — SEM ALTERNATIVA** |
| PRM043 | PRM039, PRM031 | 8 de 11 tem alt; 3 sem (BFP195, BFP202, HAN002) |

**PRM042 e a maquina MAIS CRITICA**: se avariar, 6 tools e 11 SKUs ficam sem producao.

---

## 8. Clientes (14)

| Codigo | Nome |
|--------|------|
| 210020 | FAURECIA |
| 210099 | BOSCH-TERM (Bosch Termotecnologia) |
| 210204 | FAUR-SIEGE (Faurecia Sieges) |
| 210112 | JOAO DEUS |
| 210194 | E.L.M. |
| 210208 | Cliente 208 |
| 210273 | Cliente 273 |
| (+ 7 outros) | |

### Agregacao Cross-Cliente

Mesmo SKU pode ter encomendas de MULTIPLOS clientes:

| SKU | Clientes | Total |
|-----|----------|-------|
| 1064169X100 | FAURECIA (13000), FAUR-SIEGE (13000), FAUREC.CZ (5200) | 31200 |
| 1064186X100 | FAURECIA (13000), FAUR-SIEGE (13000), FAUREC.CZ (5200) | 31200 |
| 1092262X100 | FAURECIA (3200), FAUR-SIEGE (5520), F.POLSKA (2400) | 11120 |
| 1065170X100 | FAURECIA (3200), FAUR-SIEGE (1920) | 5120 |
| 8718696125 | BOSCH-TERM (1344), E.L.M. (2500) | 3844 |

**Producao agrega por SKU. Entrega rastreia por cliente.**

---

## 9. Constraints do Solver

| # | Constraint | Capacidade | Regra |
|---|-----------|------------|-------|
| 1 | **SetupCrew** | 1 | So 1 setup simultaneo em TODAS as maquinas |
| 2 | **OperatorCapacity** | Por turno/area | Soma de operadores por turno nao excede pool da area |
| 3 | **Calco** | 1 por calco | Mesmo calco nao pode ser usado em 2 maquinas ao mesmo tempo |
| 4 | **Material** | Stock + chegadas | Producao requer materiais disponiveis |

### Funcao Objectivo
```
Z = 100 * tardiness
  + 10 * setup_count
  + 1 * setup_time
  + 10 * setup_balance_by_shift
  + 5 * churn
  + 50 * overtime
  + 5 * coil_fragmentation
```

---

## 10. Regras de Negocio (Prioridade)

1. **Cumprir datas de entrega** (tardiness = 0) — PRIORIDADE MAXIMA
2. **Minimizar setups totais** — custo operacional
3. **Max 1 setup simultaneo** — CONSTRAINT HARD (SetupCrew cap=1)
4. **Distribuir setups pelos 2 turnos** — balanceamento
5. **Consumir bobines completas** — eficiencia material (futuro)
6. **Considerar calcos partilhados** — setup reduzido (futuro)

---

## 11. ISOP — Estrutura do Ficheiro Fonte

| Aspecto | Valor |
|---------|-------|
| Ficheiro | ISOP Nikufra.xlsx |
| Sheet | Planilha1 |
| Linhas de dados | 81 (rows 8-88) |
| Row 5 | Flags dia util (1=util, 0=nao-util) |
| Row 7 | Headers |
| Cols A-M | Master data |
| Cols N-P | Stock-A, WIP, ATRASO |
| Cols Q-AY | Quantidades por data (35 datas) |

### Mapa Colunas ISOP -> Campos Engine

| Coluna ISOP | Campo Engine | Notas |
|-------------|-------------|-------|
| Col D (Referencia Artigo) | `sku` | Unico — agregado cross-cliente |
| Col G (Maquina) | `m` | Maquina primaria |
| Col H (Maq. Alternativa) | `alt` | '-' se nenhuma |
| Col I (Ferramenta) | `t` | Codigo tool |
| Col E (Designacao) | `nm` | Nome produto |
| Col J (Tp.Setup) | `s` / `sH` | Horas |
| Col K (Pecas/H) | `pH` | Taxa producao |
| Col L (No Pessoas) | `op` | 1 ou 2 |
| Col F (Lote Economico) | `lt` | Tamanho minimo lote |
| Col N (Stock-A) | `stk` | Stock actual |
| Col P (ATRASO) | `atr` | Backlog |
| Cols Q-AY | `d[]` | Array 8 valores (primeiros 8 dias uteis) |

### Semantica Time Series

Colunas de data contem **NET_POSITION_AFTER_ALL_NEEDS_BY_DATE**:
- **Valor positivo** = stock disponivel apos necessidades do dia
- **Valor negativo / ATRASO** = deficit — precisa producao
- `demand = max(0, -net_position)` por cliente, agregado por SKU

---

## 12. Invariantes de Validacao

### Na importacao:
1. Toda tool tem maquina primaria (col G nunca vazio)
2. Todo SKU tem tool (col I nunca vazio)
3. Rate > 0 para toda tool activa (col K > 0)
4. Setup >= 0 (col J >= 0)
5. Operadores em {1, 2} (col L)
6. Maquina alternativa != maquina primaria (col H != col G)
7. Flags dia util sao binarios (row 5: 0 ou 1)

### No scheduling:
1. `setup_overlap_violations == 0` — nunca 2 setups simultaneos
2. `shift_crossing_violations == 0` — nenhuma operacao cruza 14:00
3. Todas operacoes cabem no dia — sem overflow nao reportado
4. Operadores <= pool disponivel por turno por area
5. Tardiness minimizado — objectivo dominante

---

## 13. Fixture Real: `nikufra_data.json`

Localizado em: `frontend/public/fixtures/nikufra/nikufra_data.json`

### Estrutura
```json
{
  "dates": ["02/02", "03/02", ..., "11/02"],     // 8 dias uteis
  "days_label": ["Seg", "Ter", ..., "Qua"],      // Labels dos dias
  "mo": { "PG1": [...], "PG2": [...] },          // M.O. por area
  "machines": [{ "id", "area", "man": [...] }],   // 6 maquinas
  "tools": [{ "id", "m", "alt", "s", "pH", "op", "skus", "nm", "lt", "stk" }],  // 44 tools
  "operations": [{ "id", "m", "t", "sku", "nm", "pH", "atr", "d", "s", "op" }]  // 64 ops
}
```

### Nomes Curtos (Short Property Names)
| Campo | Significado |
|-------|-------------|
| `m` | machine |
| `t` | tool |
| `s` / `sH` | setup_hours |
| `pH` | pcs_per_hour (rate) |
| `op` | operators_required |
| `alt` | alt_machine ('-' se nenhuma) |
| `d` | daily_demand (array 8 valores) |
| `atr` | backlog (atraso) |
| `lt` | lot_economic_qty |
| `stk` | stock |
| `nm` | name |
| `sku` | SKU code |

### Conteudo Actual
- **44 tools** — todas do ISOP real
- **64 operacoes** — 19 com demanda ISOP (deficit), 45 geradas com lot_eco
- **6 maquinas** — todas com man-minutes > 0
- **Fonte**: ISOP Nikufra.xlsx + CLAUDE.md sec 21.4
