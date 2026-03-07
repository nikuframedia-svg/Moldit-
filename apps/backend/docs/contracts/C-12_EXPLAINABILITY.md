# C-12 — Explainability

- **Contract ID**: C-12
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-05
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define explicabilidade: `explain_trace` obrigatório em planos, rastreabilidade de decisões, constraints binding, e evidência de escolhas.

## Não-objetivo

Este contrato não define:
- Algoritmo do solver (isso é C-05)
- LLM/Copilot (isso é C-13)

## Schema

`explain_trace` definido em `/contracts/schemas/plan.schema.json`.

### Campos obrigatórios

- `plan_id`: `string` (UUID)
- `snapshot_hash`: `string` (SHA-256)
- `generated_at`: `string` (date-time)
- `solver`: `object` — Informação do solver
- `workorders`: `array` — Rastreabilidade por workorder
- `global_notes`: `string` — Notas globais

## Invariantes

1. **Obrigatório**: `explain_trace` é obrigatório em todos os planos.
2. **Rastreável**: Decisões são rastreáveis até constraints e evidência.

## Referências

- Documento Mestre: Secção 6.13 (Explainability)
- Contrato C-05: Solver Interface
