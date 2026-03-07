# C-13 — LLM Copilot

- **Contract ID**: C-13
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-09, C-10, C-14
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define LLM/Copilot: interface conversacional, RAG allow-listed, citações obrigatórias, propostas estruturadas (PR drafts), e proibição de gerar planos.

## Não-objetivo

Este contrato não define:
- Geração de planos (LLM não gera planos, solver gera)
- Segurança detalhada (isso é C-14)

## Schema

Interações LLM são estruturadas (não texto livre).

### Regras

1. **Não gera planos**: LLM não executa solver, não cria `plan_version`.
2. **Citações obrigatórias**: Respostas devem citar evidence IDs.
3. **Propostas estruturadas**: LLM cria PR drafts estruturados, não texto livre.
4. **RAG allow-listed**: Apenas documentos allow-listed são usados no RAG.

## Invariantes

1. **Determinismo preservado**: LLM não altera determinismo do solver.
2. **Estado read-only**: LLM lê estado, não modifica diretamente.
3. **Governança obrigatória**: Mudanças passam por PR (C-09).

## Validações

### Validações obrigatórias

1. LLM não executa solver
2. Citações presentes em respostas
3. Propostas são estruturadas (PR drafts)

## Referências

- Documento Mestre: Secção 6.14 (LLM Copilot), Secção 2.1 (LLM não gera plano)
- Contrato C-09: IMPROVE PRs
- Contrato C-14: Security RBAC/SoD
