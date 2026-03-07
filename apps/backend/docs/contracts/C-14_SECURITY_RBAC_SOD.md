# C-14 — Security RBAC/SoD

- **Contract ID**: C-14
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-09, C-13
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define segurança: RBAC (Role-Based Access Control), SoD (Segregation of Duties), e gates de automação baseados em TrustIndex.

## Não-objetivo

Este contrato não define:
- Observabilidade (isso é C-15)
- LLM/Copilot detalhado (isso é C-13)

## Schema

Roles, permissions e SoD rules definidos em configuração.

### Roles (v1)

- `PLANNER` — Pode criar planos, cenários, PRs
- `APPROVER` — Pode aprovar PRs
- `ADMIN` — Acesso total
- `VIEWER` — Apenas leitura

### SoD Rules

- Quem propõe não aprova (quando aplicável)
- Aprovações múltiplas para mudanças críticas

## Invariantes

1. **SoD obrigatório**: SoD aplicado quando definido.
2. **TrustIndex gates**: Automação bloqueada se TrustIndex < limiar.

## Validações

### Validações obrigatórias

1. Permissões verificadas em todas as operações
2. SoD respeitado
3. TrustIndex gates aplicados

## Referências

- Documento Mestre: Secção 6.15 (Security), requisito xcv (SoD)
- Contrato C-09: IMPROVE PRs
- Contrato C-13: LLM Copilot
