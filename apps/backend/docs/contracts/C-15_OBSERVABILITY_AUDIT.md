# C-15 — Observability and Audit

- **Contract ID**: C-15
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-14
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define observabilidade e audit: logging estruturado, métricas, tracing (correlation_id), audit log append-only, e evidence packs.

## Não-objetivo

Este contrato não define:
- Segurança detalhada (isso é C-14)
- Algoritmos específicos (isso é C-05)

## Schema

Logs, métricas e audit logs são estruturados (JSON).

### Logging Estruturado

- `correlation_id`: `string` (UUID) — ID de correlação
- `timestamp`: `string` (date-time) — Timestamp UTC
- `level`: `enum` — `DEBUG | INFO | WARN | ERROR`
- `message`: `string` — Mensagem
- `metadata`: `object` — Metadados adicionais

### Audit Log

- `audit_id`: `string` (UUID) — ID único
- `actor`: `string` — Actor (humano/serviço)
- `action`: `string` — Ação realizada
- `before`: `object` — Estado anterior (hash)
- `after`: `object` — Estado novo (hash)
- `correlation_id`: `string` (UUID)
- `timestamp`: `string` (date-time)

## Invariantes

1. **Append-only**: Audit log é append-only (imutável).
2. **Correlation obrigatório**: Todos os requests têm `correlation_id`.
3. **Rastreabilidade completa**: Cada mutação tem audit log.

## Validações

### Validações obrigatórias

1. Logs estruturados (JSON)
2. `correlation_id` presente em todos os logs
3. Audit log criado para mutações

## Referências

- Documento Mestre: Secção 6.16 (Observability), Secção 12 (Observability)
- Contrato C-00: Convenções Globais
- Contrato C-14: Security RBAC/SoD
