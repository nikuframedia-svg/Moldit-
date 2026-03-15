# ProdPlan PP1 — Industrial Cognitive APS

SaaS de planeamento de produção para fábricas de estampagem.
Fábrica: Incompol (5 prensas, 59 ferramentas, ~94 SKUs, 14 clientes).
Empresa: NIKUFRA.AI (Portugal).

## Arquitectura

Monorepo Turborepo + pnpm:
- apps/frontend — React 18 + TS + Vite + Zustand + Ant Design 5
- apps/backend — FastAPI + PostgreSQL + OR-Tools (CP-SAT)
- packages/scheduling-engine — TypeScript puro (scheduling client-side)

## Comandos
pnpm dev | pnpm build | pnpm test | pnpm lint | pnpm format

## Convenções
- Named exports. Ficheiros max 400 linhas. Zustand selectores atómicos.
- Biome formata TS. Ruff formata Python.

## ═══ PRIORIDADE Nº1 ═══
ENTREGAR TUDO A TEMPO. Sem excepção. Tudo o resto é subordinado.

## ═══ OTD-DELIVERY = 100% (OBRIGATÓRIO) ═══

### Definição
- **OTD** (global) = total produzido >= total procura → 100%
- **OTD-D** (por dia) = em CADA dia com procura, produção acumulada >= procura acumulada → 100%
- OTD-D é mais exigente: não basta produzir tudo, tem de estar pronto A TEMPO para cada entrega
- Qualquer regressão abaixo de 100% é um BUG

### Como funciona (autoRouteOverflow — 3 Tiers)
- **Tier 1**: Resolve overflow (antecipar produção + mover para máquina alternativa)
- **Tier 2**: Resolve tardiness por bloco (advance + alt + combo + batch)
- **Tier 3**: Resolve OTD-Delivery — 7 fases (A-G) + busca multi-regra (EDD/ATCS/CR/SPT/WSPT)
- Selecção final: grid leveling × deadlines, escolhe combinação com menor OTD-D failures

### Parâmetros OBRIGATÓRIOS
Sempre passar ao `autoRouteOverflow`:
- `orderBased: true` — trata cada encomenda individualmente com o seu prazo
- `twinValidationReport` — informação de peças gémeas para co-produção correcta
- Sem estes, o motor agrupa encomendas e perde noção dos prazos individuais

### Verificação
- Testes: `late-delivery-analysis.test.ts` (asserts otdDelivery=100)
- Frozen: `OTD_TOLERANCE = 1.0` (invariante frozen em `frozen-invariants.test.ts`)
- Pipeline: `schedule-pipeline.ts` passa ambos parâmetros nos 3 call sites
- Engine: `computeOtdDeliveryFailures()` valida em cada iteração do Tier 3
- 865/865 testes engine passam, build limpo

## ═══ DADOS ISOP ═══

Colunas: A(Cliente) B(Nome) C(SKU) D(Designação) E(Lote Eco—SOFT)
G(Máquina) H(Ferramenta) I(Peças/H) J(Pessoas) L(WIP) M(Gémea) N(Atraso)
O+(Datas ~80 dias—FONTE PRINCIPAL)

IGNORAR SEMPRE: F(Prz.Fabrico) e K(STOCK-A)

Valores NP nas datas:
- Positivo (preto) = STOCK REAL disponível
- Negativo (vermelho) = ENCOMENDA INDEPENDENTE (NÃO cumulativo)
  |valor| = qtd a produzir, data coluna = deadline
- Vazio = sem dados

Stock real = último positivo antes do primeiro negativo.
Lote económico: SOFT — só se houver tempo. NUNCA atrasa encomenda.

## ═══ PEÇAS GÉMEAS ═══
Mesma ferramenta + máquina, produção SIMULTÂNEA.
Quantidade = max(|NP_A|, |NP_B|) para AMBAS.
Tempo = UMA quantidade (não dobro). Excedente → stock.

## ═══ MÁQUINAS ═══
PRM019(Grandes,21SKUs) PRM031(Grandes,20,Faurecia) PRM039(Grandes,28,+variedade)
PRM042(Médias,11,SEM ALTERNATIVA) PRM043(Grandes,14)
PRM020 — FORA DE USO. IGNORAR.

## ═══ TURNOS ═══
Grandes: A 07:00-15:30 (6p) | B 15:30-00:00 (5p)
Médias: A 07:00-15:30 (9p) | B 15:30-00:00 (4p)
Noite 00:00-07:00: SÓ EMERGÊNCIA (sinalizar, não criar automaticamente)

## ═══ 4 CONSTRAINTS ═══
1.SetupCrew: max 1 setup simultâneo 2.ToolTimeline: ferramenta 1 máq vez
3.CalcoTimeline: calço 1 máq vez 4.OperatorPool: capacidade por turno (advisory)

## ═══ MOTOR DE SCHEDULING — 3 CAMADAS ═══

Camada 1 — ATCS client-side (<10ms):
  Prioridade(j) = (w/p)·exp(-slack/k1p̄)·exp(-setup/k2s̄)
  Grid search k1/k2 (25 combos). Selecção UCB1 entre ATCS/EDD/CR/SPT/WSPT.

Camada 2 — SA client-side (Web Worker, 1-3s):
  Vizinhança swap/insert. 10K iterações. Melhoria 5-15%.

Camada 3 — CP-SAT server-side (OR-Tools, 5-60s):
  <50 jobs: solução óptima. 50-200: time limit 30-60s. >200: fallback Camada 1.

## ═══ LÓGICA CONFIGURÁVEL — 7 NÍVEIS ═══

L1: Parâmetros numéricos (sliders, thresholds)
L2: Regras SE/ENTÃO (react-querybuilder → json-rules-engine)
L3: Fórmulas custom (expr-eval — parser seguro sem eval)
L4: Definições de conceito ("atrasado" = fórmula custom por fábrica)
L5: Workflows & aprovações (quem aprova o quê, governance L0-L5)
L6: Estratégias multi-passo (sequência de regras como Asprova)
L7: Plugins Python (Fase 2+)

Config persistida em JSON validado com Zod. Tudo versionado.

## ═══ DECISION INTEGRITY FIREWALL ═══

Cada desvio do óptimo TEM:
- Custo explícito (calculado deterministicamente, NUNCA pelo LLM)
- Motivo declarado (dropdown: técnico/comercial/conveniência/hierárquico)
- Categoria de incentivo classificada
- Registo imutável no Decision Ledger
- Contrafactual obrigatório para L3+

O Firewall NÃO impede decisões. Torna-as CARAS e VISÍVEIS.

## ═══ TRUSTINDEX ═══

TI = 0.15·C + 0.20·V + 0.15·F + 0.20·K + 0.15·P + 0.15·A
Gates: ≥0.90 Full Auto | ≥0.70 Monitoring | ≥0.50 Suggestion | <0.50 Manual

## ═══ GOVERNANCE L0-L5 ═══
L0: Logging | L1: +Validação | L2: +Preview
L3: +Contrafactual+CustoDesvio | L4: +Aprovação | L5: +Multi-aprovação

## ═══ REPLANEAMENTO 4 CAMADAS ═══
1.Right-shift (<30min) 2.Match-up (30min-2h) 3.Parcial (>2h) 4.Regen (catástrofe)
Zonas: frozen(0-5d) slushy(5d-2sem) liquid(resto)

## ═══ LEARNING ENGINE ═══
Compara previsão vs realidade. UCB1 ajusta selecção de heurística.
Variance >10% → propor ajuste. NUNCA aplica automaticamente.
