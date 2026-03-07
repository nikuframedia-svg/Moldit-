# C-08 — Sandbox Scenarios

- **Contract ID**: C-08
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-04, C-09
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define sandbox e cenários: criação de cenários com mutações (diffs), execução de cenários, cálculo de diffs (ΔKPIs), e comparação com baseline.

## Não-objetivo

Este contrato não define:
- Governança de planos (isso é C-09)
- Algoritmo do solver (isso é C-05)

## Schema

### JSON Schema
- Schema file: `/contracts/schemas/scenario.schema.json`
- Version: v1

### Campos obrigatórios

- `scenario_id`: `string` (UUID) — ID único do cenário
- `baseline_plan_hash`: `string` (SHA-256) — Hash do plano baseline
- `diff`: `object` — Diferenças aplicadas
  - `move_operations`: `array` — Operações movidas
  - `freeze`: `object` — Janela de freeze

## Invariantes

1. **Sandbox isolado**: Cenários não afetam baseline até PR/merge.
2. **Diff calculável**: Diffs são calculados determinísticamente.

## Validações

### Validações obrigatórias

1. `baseline_plan_hash` existe e é válido
2. `diff` é válido (operações existem, recursos válidos)
3. ΔKPIs calculados corretamente

## Exemplos

Ver `/fixtures/scenarios/scenario_diff_v1.json`.

## Referências

- Documento Mestre: Secção 6.9 (Sandbox)
- Contrato C-04: Plan API
- Contrato C-09: IMPROVE PRs
