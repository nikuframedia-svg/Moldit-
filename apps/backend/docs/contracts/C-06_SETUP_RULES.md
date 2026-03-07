# C-06 — Setup Rules

- **Contract ID**: C-06
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-05, C-07
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define as regras de setup: SetupCrew (capacidade 1), penalização de concentração por turno, e cálculo de `setup_balance_penalty`.

## Não-objetivo

Este contrato não define:
- Algoritmo completo do solver (isso é C-05)
- Calendários e turnos (isso é C-07)

## Schema

Regras definidas em `PlanParams.modes` e função-objectivo.

### Regras

1. **SetupCrew (capacidade 1)**: Apenas um setup pode ocorrer de cada vez.
2. **Penalização de concentração**: Penalizar concentração de setups no mesmo turno.
3. **Setup balance penalty**: `(max_setups_per_shift - min_setups_per_shift)`

## Invariantes

1. **SetupCrew capacidade 1**: SetupCrew é recurso com capacidade = 1.
2. **Balanceamento**: Penalização aumenta com concentração de setups.

## Validações

### Validações obrigatórias

1. SetupCrew existe em `master_data.resources[]` com `type = "SETUPCREW"`
2. Capacidade de SetupCrew = 1
3. `setup_balance_penalty` calculado corretamente

## Casos edge

### E6.1 — Sem SetupCrew
**Decisão**: Erro se solver requer SetupCrew mas não existe em snapshot

## Referências

- Documento Mestre: Secção 6.7 (Função-objectivo), requisito xcv
- Contrato C-05: Solver Interface
