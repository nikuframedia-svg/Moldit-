# C-07 — Calendars and Pools

- **Contract ID**: C-07
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-05, C-06
- **Related Decisions**: DEC-0002, DEC-0003

## Objetivo

Este contrato define calendários (2 turnos), pools de operadores, e "freeze window" (janela temporal onde operações são fixas).

## Não-objetivo

Este contrato não define:
- Algoritmo completo do solver (isso é C-05)
- Regras de setup (isso é C-06)

## Schema

### Turnos (v1)

- **Turno X**: 06:00-14:00 local (Europe/Lisbon)
- **Turno Y**: 14:00-22:00 local
- **OFF**: Fora de horário

### Pools de Operadores

- **Pool X**: Operadores do turno X
- **Pool Y**: Operadores do turno Y
- Capacidade por turno (configurável)

### Freeze Window

- `freeze_window_minutes`: Janela temporal onde operações são fixas (não podem ser movidas)

## Invariantes

1. **2 Turnos**: Sistema suporta 2 turnos (X e Y) por padrão.
2. **Freeze Window**: Operações dentro de freeze window são imutáveis.

## Validações

### Validações obrigatórias

1. Turnos definidos corretamente (X: 06:00-14:00, Y: 14:00-22:00)
2. Capacidade de pools respeitada
3. Freeze window aplicada corretamente

## Referências

- Documento Mestre: Secção 6.8, requisito xcv (2 turnos)
- Contrato C-05: Solver Interface
- DEC-0002: Split de operações entre turnos
- DEC-0003: Capacidade de operadores
