# C-10 — Suggestions Outcomes

- **Contract ID**: C-10
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-08, C-09, C-11
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define sugestões estruturadas com outcomes: tipos de sugestão, `impact_case`, `impact_result`, confiança, e validação em sandbox.

## Não-objetivo

Este contrato não define:
- Causal inference (isso é C-11)
- LLM/Copilot (isso é C-13)

## Schema

### JSON Schema
- Schema file: `/contracts/schemas/suggestion.schema.json`
- Version: v1

### Campos obrigatórios

- `suggestion_id`: `string` (UUID) — ID único da sugestão
- `type`: `enum` — Tipo de sugestão
- `status`: `enum` — Status
- `recommended_action_structured`: `object` — Ação recomendada
- `impact_case`: `object` — Caso de impacto
- `impact_result`: `object` — Resultado do impacto

### Enums

#### `type`
- `CHANGE_TOOL_GROUPING` — Mudar agrupamento de ferramentas
- `ADD_OVERTIME` — Adicionar horas extras
- `MOVE_ORDER` — Mover ordem
- `ADJUST_WEIGHTS` — Ajustar pesos da função-objectivo
- `REPLAN_ON_EVENT` — Replanejar por evento

#### `status`
- `OPEN` — Aberta
- `ACCEPTED` — Aceite
- `REJECTED` — Rejeitada

## Invariantes

1. **Estruturada**: Sugestões são estruturadas, não texto livre.
2. **Validável**: Sugestões podem ser validadas em sandbox.
3. **Impacto mensurável**: `impact_case` e `impact_result` são mensuráveis.

## Validações

### Validações obrigatórias

1. `recommended_action_structured` é válido
2. `impact_case` contém KPIs baseline e scenario
3. `confidence` em [0, 1]

## Exemplos

Ver `/fixtures/suggestions/suggestion_v1.json`.

## Referências

- Documento Mestre: Secção 6.11 (Sugestões)
- Contrato C-08: Sandbox Scenarios
- Contrato C-09: IMPROVE PRs
