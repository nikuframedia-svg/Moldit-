# C-09 — IMPROVE PRs

- **Contract ID**: C-09
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-04, C-08, C-10
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define Pull Requests (PRs) para governar mudanças de plano: lifecycle (DRAFT → OPEN → APPROVED → MERGED), approvals, rollback, e audit trail.

## Não-objetivo

Este contrato não define:
- Sugestões (isso é C-10)
- Sandbox (isso é C-08)

## Schema

### JSON Schema
- Schema file: `/contracts/schemas/pr.schema.json`
- Version: v1

### Campos obrigatórios

- `pr_id`: `string` (UUID) — ID único do PR
- `status`: `enum` — Status do PR
- `author`: `string` — Autor do PR
- `baseline_plan_id`: `string` (UUID) — Plano baseline
- `candidate_plan_id`: `string` (UUID) — Plano candidato
- `approvals`: `array` — Aprovações

### Enums

#### `status`
- `DRAFT` — Rascunho
- `OPEN` — Aberto para review
- `APPROVED` — Aprovado
- `MERGED` — Mergido (plano oficial)
- `ROLLED_BACK` — Revertido
- `REJECTED` — Rejeitado

## Invariantes

1. **Governança obrigatória**: Mudanças de plano oficial passam por PR.
2. **Append-only**: Audit log é append-only.
3. **Rollback possível**: PRs podem ser revertidos.

## Validações

### Validações obrigatórias

1. `baseline_plan_id` e `candidate_plan_id` existem
2. Diff anexado ao PR
3. Approvals válidos (SoD quando aplicável)

## Exemplos

Ver `/fixtures/pr/pr_v1.json`.

## Referências

- Documento Mestre: Secção 6.10 (IMPROVE)
- Contrato C-04: Plan API
- Contrato C-08: Sandbox Scenarios
