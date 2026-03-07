# C-05 — Solver Interface

- **Contract ID**: C-05
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-01, C-04, C-06, C-07
- **Related Decisions**: DEC-0001, DEC-0002, DEC-0003

## Objetivo

Este contrato define a interface entre o sistema PP1 e o solver PLAN. Define inputs (`InputSnapshot` + `PlanParams`), outputs (`Plan` + `explain_trace` + `kpi_pack`), determinismo obrigatório e timeboxing.

## Não-objetivo

Este contrato não define:
- Algoritmo interno do solver (implementação específica)
- Regras de negócio (isso é C-06, C-07)
- API REST (isso é C-04)

## Schema

### Input

- `InputSnapshot`: Conforme C-01
- `PlanParams`: Conforme schema em `/contracts/schemas/plan.schema.json`

### Output

- `Plan`: Conforme schema em `/contracts/schemas/plan.schema.json`
- `explain_trace`: Rastreabilidade de explicação
- `kpi_pack`: KPIs calculados

## Invariantes

1. **Determinismo Absoluto**: Mesmo `InputSnapshot` + mesmos `PlanParams` (incluindo `seed`) → mesmo `plan_hash` (bit-a-bit).
2. **Timeboxing**: Solver respeita `timebox_s` (hard timeout).
3. **Seed Fixa**: `seed` é obrigatório e usado para qualquer aleatoriedade.
4. **Zero Não-Determinismo**: Sem timestamps no objetivo, sem aleatoriedade não seedada, sem paralelismo não determinístico.

## Validações

### Validações obrigatórias

1. `InputSnapshot` válido (conforme C-01)
2. `PlanParams` válido (seed obrigatório, timebox > 0)
3. `plan_hash` determinístico (mesmo input → mesmo hash)
4. `explain_trace` completo (rastreabilidade)

### Códigos de erro

- `ERR_SOLVER_INPUT_INVALID`: Input inválido
- `ERR_SOLVER_NON_DETERMINISTIC`: Solver produziu resultado não-determinístico
- `ERR_SOLVER_TIMEOUT`: Solver excedeu timebox
- `ERR_SOLVER_SEED_MISSING`: Seed não fornecido

## Casos edge

### E5.1 — Timeout do Solver
**Decisão**: Retornar melhor solução conhecida até ao timeout, marcar `kpi_pack.timeout_occurred = true`

### E5.2 — Solver Não-Determinístico
**Decisão**: Erro fatal `ERR_SOLVER_NON_DETERMINISTIC`, bloquear commit

## Exemplos

Ver `/fixtures/plan/plan_v1.json` e `explain_trace` completo.

## Testes obrigatórios

- [ ] Unit: determinismo (mesmo input → mesmo hash) — 10 runs
- [ ] Unit: timeboxing respeitado
- [ ] Contract: `explain_trace` completo
- [ ] Integration: KPIs calculados corretamente

## Critérios de aceitação

- [ ] Interface documentada
- [ ] Determinismo provado
- [ ] Timeboxing implementado
- [ ] Testes obrigatórios planeados

## Referências

- Documento Mestre: Secção 6.6 (Solver), Secção 6.7 (Função-objectivo)
- Contrato C-01: InputSnapshot
- Contrato C-04: Plan API
- Contrato C-06: Setup Rules
- Contrato C-07: Calendars and Pools
