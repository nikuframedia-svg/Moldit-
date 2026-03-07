# C-11 — Causal Inference and Bandits

- **Contract ID**: C-11
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-10
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define causal inference e bandits para aprendizagem contínua: métodos (DiD, matched, etc.), bandit algorithms, e aprendizagem 24/7 offline.

## Não-objetivo

Este contrato não define:
- Sugestões básicas (isso é C-10)
- LLM/Copilot (isso é C-13)

## Schema

Métodos e algoritmos definidos em `impact_result.method` e configuração de bandits.

### Métodos de Causal Inference

- `NAIVE_DIFFERENCE` — Diferença simples
- `DiD` — Difference-in-Differences
- `MATCHED` — Matched pairs
- `UNKNOWN` — Método desconhecido

## Invariantes

1. **Aprendizagem offline**: Aprendizagem ocorre offline (não em tempo real).
2. **Evidência obrigatória**: Métodos de causal inference requerem evidência.

## Referências

- Documento Mestre: Secção 6.12 (Causal Inference), requisito lkj
- Contrato C-10: Suggestions Outcomes
