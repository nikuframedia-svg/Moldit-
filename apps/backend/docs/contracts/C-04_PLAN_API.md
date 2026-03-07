# C-04 — Plan API

- **Contract ID**: C-04
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-01, C-05
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define a API REST para gestão de planos (criar, obter, listar, executar solver). Define endpoints, formatos de request/response, idempotência e versionamento.

## Não-objetivo

Este contrato não define:
- Algoritmo do solver (isso é C-05)
- Regras de negócio (isso é C-06, C-07)
- Governança de planos (isso é C-09)

## Schema

### JSON Schema
- Schema file: `/contracts/schemas/plan.schema.json`
- Version: v1

### Endpoints

#### `POST /v1/plans/run`
Cria e executa um novo plano.

**Request:**
```json
{
  "snapshot_id": "uuid",
  "plan_params": {
    "timebox_s": 30,
    "seed": 42,
    "objective_weights": {...},
    "modes": {...}
  },
  "idempotency_key": "uuid" // opcional
}
```

**Response:**
```json
{
  "plan_id": "uuid",
  "snapshot_hash": "sha256",
  "plan_hash": "sha256",
  "status": "CANDIDATE",
  "created_at": "2026-02-04T16:30:00Z",
  "kpi_pack": {...},
  "explain_trace": {...}
}
```

#### `GET /v1/plans/{plan_id}`
Obtém um plano específico.

#### `GET /v1/plans?snapshot_id={snapshot_id}`
Lista planos por snapshot.

### Campos obrigatórios

- `plan_id`: `string` (UUID) — ID único do plano
- `snapshot_hash`: `string` (SHA-256) — Hash do snapshot usado
- `plan_hash`: `string` (SHA-256) — Hash canónico do plano
- `status`: `enum` — `CANDIDATE | OFFICIAL`
- `plan_params`: `object` — Parâmetros do solver
- `operations`: `array` — Operações do plano
- `kpi_pack`: `object` — KPIs calculados

### Enums

#### `status`
- `CANDIDATE` — Plano candidato (não aprovado)
- `OFFICIAL` — Plano oficial (aprovado/mergido)

## Invariantes

1. **Determinismo**: Mesmo `snapshot_hash` + mesmos `plan_params` (incluindo `seed`) → mesmo `plan_hash`.
2. **Idempotência**: Requests com mesmo `idempotency_key` retornam mesma resposta.
3. **Imutabilidade**: Planos `OFFICIAL` são imutáveis (apenas leitura).

## Validações

### Validações obrigatórias

1. `snapshot_id` existe e é válido
2. `plan_params` valida contra schema
3. `seed` é obrigatório e fixo
4. `timebox_s` é respeitado (hard timeout)

### Códigos de erro

- `ERR_PLAN_SNAPSHOT_NOT_FOUND`: Snapshot não existe
- `ERR_PLAN_PARAMS_INVALID`: Parâmetros inválidos
- `ERR_PLAN_NON_DETERMINISTIC`: Plano não é determinístico
- `ERR_PLAN_TIMEOUT`: Solver excedeu timebox

## Casos edge

### E4.1 — Timeout do Solver
**Decisão**: Retornar melhor solução conhecida até ao timeout, marcar `kpi_pack.timeout_occurred = true`

### E4.2 — Snapshot Inválido
**Decisão**: Retornar erro `ERR_PLAN_SNAPSHOT_NOT_FOUND` ou `ERR_SNAPSHOT_INVALID`

## Exemplos

Ver `/fixtures/plan/plan_v1.json`.

## Testes obrigatórios

- [ ] Unit: determinismo (mesmo input → mesmo hash)
- [ ] Contract: validação contra schema
- [ ] Integration: idempotência funciona
- [ ] Integration: timeout respeitado

## Critérios de aceitação

- [ ] Endpoints documentados
- [ ] Idempotência implementada
- [ ] Determinismo provado
- [ ] Testes obrigatórios planeados

## Referências

- Documento Mestre: Secção 8.3 (Plan API)
- Contrato C-01: InputSnapshot
- Contrato C-05: Solver Interface
