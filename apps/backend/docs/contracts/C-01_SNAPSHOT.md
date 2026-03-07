# C-01 — InputSnapshot

- **Contract ID**: C-01
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-02, C-05
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define o `InputSnapshot`: a "fotografia imutável" dos inputs canónicos usados pelo solver PLAN. O snapshot é a fronteira entre dados externos (XLSX, PDF, API, manual) e o solver determinístico. Deve ser canónico, validado, rastreável e imutável após criação.

## Não-objetivo

Este contrato não define:
- Como importar dados de fontes externas (isso é C-02)
- Como o solver processa o snapshot (isso é C-05)
- Como validar PDFs (isso é C-03)
- Regras de negócio específicas (isso é C-06, C-07, etc.)

## Schema

### JSON Schema
- Schema file: `/contracts/schemas/snapshot.schema.json`
- Version: v1

### Campos obrigatórios

- `snapshot_id`: `string` (UUID) — ID único do snapshot (imutável após criação)
- `tenant_id`: `string` (UUID) — ID do tenant
- `created_at`: `string` (date-time UTC) — Timestamp UTC de criação
- `sources`: `array` — Fontes de dados (XLSX, PDF, API, etc.)
  - `source_id`: `string` (UUID) — ID único da fonte
  - `type`: `enum` — Tipo de fonte: `XLSX | PDF | API | MANUAL`
  - `file_hash_sha256`: `string` (SHA-256 hex) — Hash SHA-256 do ficheiro original
- `semantics`: `object` — Semântica dos dados
  - `series_semantics`: `enum` — Semântica das séries temporais (obrigatório)
- `master_data`: `object` — Dados mestres
  - `items`: `array` — Items/SKUs
  - `resources`: `array` — Recursos (máquinas, SetupCrew, etc.)
  - `tools`: `array` — Ferramentas
- `routing`: `array` — Rotas de produção (operações por item)
- `trust_index`: `object` — Índice de confiança (obrigatório)
  - `overall`: `number` (0..1) — Score global de confiança

### Campos opcionais

- `series`: `array` — Séries temporais (quando `series_semantics` é posição/saldo)
- `derived`: `object` — Dados derivados
  - `needs`: `array` — Necessidades derivadas (quando aplicável)
  - `supplies`: `array` — Fornecimentos derivados (quando aplicável)
- `calendars`: `array` — Calendários e turnos (opcional v1)
- `raw_fields`: `object` — Campos brutos não interpretados (ex.: `qtd_exp`)

### Enums

#### `series_semantics`
- `NET_POSITION_AFTER_ALL_NEEDS_BY_DATE` — Posição líquida/saldo no fim do dia (recomendado para ISOP)
- `PROJECTED_AVAILABLE_AFTER_ALL_NEEDS_BY_DATE` — Alternativa semântica equivalente
- `DEMAND_QTY_BY_DATE` — Quantidade do dia (não saldo), valores >= 0
- `PLANNED_PRODUCTION_QTY_BY_DATE` — Plano de produção diário, valores >= 0
- `PROJECTED_STOCK_LEVEL` — Legado (usar `NET_POSITION_AFTER_ALL_NEEDS_BY_DATE`)
- `NET_REQUIREMENT` — Necessidade líquida (pode ser negativa/positiva)
- `UNKNOWN` — Semântica desconhecida (bloqueia automação)

#### `setup_time_uom`
- `HOURS` — Horas
- `MINUTES` — Minutos
- `SECONDS` — Segundos
- `UNKNOWN` — Unidade desconhecida

#### `mo_uom` (Manufatura Order Unit of Measure)
- `HOURS` — Horas
- `FTE` — Full-Time Equivalent
- `OPERATORS` — Número de operadores
- `UNKNOWN` — Unidade desconhecida

#### `source.type`
- `XLSX` — Ficheiro Excel
- `PDF` — Ficheiro PDF (não-canónico)
- `API` — Integração via API
- `MANUAL` — Entrada manual

## Invariantes

1. **Imutabilidade**: Um `InputSnapshot` após criação é imutável. Qualquer alteração cria um novo snapshot com novo `snapshot_id` e `snapshot_hash`.

2. **Hash Canónico Determinístico**: O `snapshot_hash` é calculado excluindo campos não-determinísticos (`snapshot_id`, `created_at`, `trust_index`). O mesmo input lógico → o mesmo hash.

3. **Unicidade de snapshot_id**: Cada snapshot tem um `snapshot_id` único e imutável.

4. **Semântica Explícita**: `semantics.series_semantics` é obrigatório e não pode ser `UNKNOWN` para automação (TrustIndex < 0.70).

5. **Rastreabilidade**: Todos os campos derivados de fontes externas devem ter `source_locator` (quando aplicável).

6. **TrustIndex Calculado**: `trust_index.overall` é calculado determinísticamente e não pode ser omitido.

7. **Consistência de Referências**: 
   - `routing[].resource_code` deve existir em `master_data.resources[]`
   - `routing[].tool_code` (quando presente) deve existir em `master_data.tools[]`
   - `series[].item_sku` deve existir em `master_data.items[].sku`

## Validações

### Validações obrigatórias

1. **Validação de Schema**: Snapshot deve validar contra `/contracts/schemas/snapshot.schema.json`
2. **Validação de UUID**: `snapshot_id`, `tenant_id`, `source_id` devem ser UUIDs válidos
3. **Validação de Hash**: `file_hash_sha256` deve ser SHA-256 válido (64 hex chars)
4. **Validação de TrustIndex**: `trust_index.overall` deve estar em [0, 1]
5. **Validação de Semântica**: Se `series_semantics == UNKNOWN`, TrustIndex deve ser <= 0.69
6. **Validação de Referências**: Referências cruzadas devem ser válidas (resource_code, tool_code, item_sku)
7. **Validação de Séries**: 
   - Se `DEMAND_QTY_BY_DATE` ou `PLANNED_PRODUCTION_QTY_BY_DATE`: todos os valores >= 0
   - Se `NET_POSITION_AFTER_ALL_NEEDS_BY_DATE`: valores podem ser negativos

### Códigos de erro

- `ERR_SNAPSHOT_INVALID`: Snapshot não valida contra schema
- `ERR_SNAPSHOT_IMMUTABLE`: Tentativa de modificar snapshot imutável
- `ERR_SNAPSHOT_HASH_MISMATCH`: Hash canónico não corresponde ao esperado
- `ERR_SERIES_SEMANTICS_UNKNOWN`: `series_semantics == UNKNOWN` bloqueia automação
- `ERR_SERIES_NEGATIVE_NOT_ALLOWED`: Valores negativos quando `DEMAND_QTY_BY_DATE` ou `PLANNED_PRODUCTION_QTY_BY_DATE`
- `ERR_REFERENCE_INVALID`: Referência cruzada inválida (resource_code, tool_code, item_sku não existe)
- `ERR_TRUST_INDEX_INVALID`: `trust_index.overall` fora de [0, 1]

## Casos edge

### E1.1 — Série Vazia

**Cenário:** `series[]` vazio ou `derived.needs[]` e `derived.supplies[]` vazios.

**Decisão:**
- Aceitar snapshot (não bloquear import)
- Marcar `trust_index.overall` reduzido (completude_score afetado)
- Adicionar causa: `MISSING_TEMPORAL_DATA`
- Bloquear automação se `trust_index.overall < 0.70`

**Justificação:** Permite import de dados parciais (master_data apenas) para análise, mas não permite planeamento sem dados temporais.

### E1.2 — Routing sem Operations

**Cenário:** `routing[]` contém entrada sem `operations[]` ou `operations[]` vazio.

**Decisão:**
- Rejeitar snapshot (erro de contrato)
- Retornar `ERR_ROUTING_EMPTY_OPERATIONS`

**Justificação:** Routing sem operations não permite planeamento.

### E1.3 — TrustIndex = 0.0

**Cenário:** `trust_index.overall = 0.0` (dados completamente inválidos).

**Decisão:**
- Aceitar snapshot (não bloquear import)
- Bloquear todas as operações automáticas (quarentena)
- Permitir apenas visualização advisory
- Exigir correção manual antes de qualquer uso

**Justificação:** Permite import para diagnóstico, mas bloqueia uso operacional.

### E1.4 — series_semantics = UNKNOWN

**Cenário:** `semantics.series_semantics == UNKNOWN`.

**Decisão:**
- Aceitar snapshot (não bloquear import)
- Clampar `trust_index.overall <= 0.69` (quarentena)
- Bloquear automação
- Adicionar causa: `UNKNOWN_SERIES_SEMANTICS`

**Justificação:** Sem semântica explícita, não é seguro derivar eventos ou planejar.

### E1.5 — Valores Negativos em DEMAND_QTY_BY_DATE

**Cenário:** `series_semantics == DEMAND_QTY_BY_DATE` mas existem valores negativos.

**Decisão:**
- Rejeitar snapshot (erro de contrato)
- Retornar `ERR_SERIES_NEGATIVE_NOT_ALLOWED`
- Sugerir usar `NET_POSITION_AFTER_ALL_NEEDS_BY_DATE` se valores podem ser negativos

**Justificação:** `DEMAND_QTY_BY_DATE` por definição não pode ter valores negativos.

### E1.6 — Duplicados de SKU em Múltiplas Linhas

**Cenário:** Mesmo `item_sku` aparece em múltiplas linhas do import (clientes diferentes).

**Decisão:**
- `items[]` é único por `sku` (deduplicar, manter primeira ocorrência)
- `customers[]` é único por `code`
- `needs[]/demand_lines[]` são por `(customer, sku, date)` quando existirem eventos

**Justificação:** SKU é identificador único de item, independente do cliente.

## Exemplos

### Exemplo mínimo

```json
{
  "snapshot_id": "70763a5c-e9c2-439a-a0c7-0edc6d91c57a",
  "tenant_id": "tenant-001",
  "created_at": "2026-02-04T16:30:00Z",
  "sources": [
    {
      "source_id": "2ba05610-f0d7-4d07-854d-e4bb126a732a",
      "type": "XLSX",
      "filename": "ISOP_ Nikufra.xlsx",
      "file_hash_sha256": "6378a255c366965b4cd873ee5dd4745b7c4fa2e2be61a1f701d893adb1bba5cb",
      "generated_at_local": "2026-02-02T15:39:00",
      "source_timezone": "Europe/Lisbon"
    }
  ],
  "semantics": {
    "series_semantics": "NET_POSITION_AFTER_ALL_NEEDS_BY_DATE",
    "setup_time_uom": "HOURS",
    "mo_uom": "OPERATORS"
  },
  "master_data": {
    "items": [
      {
        "item_id": "item-0001",
        "sku": "1064169X100",
        "name": "Front Link HA With Bushings LH"
      }
    ],
    "resources": [
      {
        "resource_id": "res-0001",
        "code": "PRM019",
        "type": "MACHINE"
      }
    ],
    "tools": []
  },
  "routing": [
    {
      "item_sku": "1064169X100",
      "operations": [
        {
          "operation_id": "op-0001",
          "resource_code": "PRM019",
          "setup_time": 1.0,
          "rate_pieces_per_hour": 1799.0,
          "operators_required": 1
        }
      ]
    }
  ],
  "series": [
    {
      "item_sku": "1064169X100",
      "date": "2026-02-02",
      "value": 22427
    }
  ],
  "trust_index": {
    "overall": 0.75,
    "by_domain": {
      "master_data": 0.80,
      "demand_or_series": 0.70,
      "capacity": 0.75
    },
    "causes": []
  }
}
```

### Exemplo: Derivação Delta (Needs/Supplies)

Quando `series_semantics == NET_POSITION_AFTER_ALL_NEEDS_BY_DATE`, o sistema deriva `needs[]` e `supplies[]` por delta:

**Série temporal:**
```json
{
  "item_sku": "1064169X100",
  "series": [
    {"date": "2026-02-02", "value": 22427},
    {"date": "2026-02-03", "value": 22427},
    {"date": "2026-02-04", "value": 16667},
    {"date": "2026-02-05", "value": 7067}
  ]
}
```

**Derivado (needs):**
```json
{
  "derived": {
    "needs": [
      {
        "item_sku": "1064169X100",
        "date": "2026-02-04",
        "quantity": 5760,
        "due_date": "2026-02-04T22:00:00Z"
      },
      {
        "item_sku": "1064169X100",
        "date": "2026-02-05",
        "quantity": 9600,
        "due_date": "2026-02-05T22:00:00Z"
      }
    ],
    "supplies": []
  }
}
```

**Algoritmo (pseudocódigo Python):**
```python
def derive_delta_events(state_by_day: Dict[date, int]) -> Tuple[List[Need], List[Supply]]:
    """
    Converte série de estado em eventos por delta diário.
    - delta < 0 => need (consumo/necessidade)
    - delta > 0 => supply (receção/produção)
    """
    days = sorted(state_by_day.keys())
    needs = []
    supplies = []
    
    prev = state_by_day[days[0]]
    for d in days[1:]:
        cur = state_by_day[d]
        delta = cur - prev
        if delta < 0:
            needs.append(Need(item_sku=..., date=d, quantity=-delta))
        elif delta > 0:
            supplies.append(Supply(item_sku=..., date=d, quantity=delta))
        prev = cur
    
    return needs, supplies
```

## Testes obrigatórios

- [ ] Unit: hash canónico (mesmo snapshot → mesmo hash, ignorando campos não-determinísticos)
- [ ] Unit: derivação delta (série → needs/supplies) — ver Secção 7.6.3 do documento mestre
- [ ] Contract: validação contra schema JSON
- [ ] Contract: validação de referências cruzadas (resource_code, tool_code, item_sku)
- [ ] Integration: import XLSX → snapshot → hash idêntico em runs repetidos
- [ ] Integration: TrustIndex calculado corretamente (fórmula da Secção 7.5)
- [ ] Integration: `series_semantics == UNKNOWN` clampa TrustIndex <= 0.69

## Critérios de aceitação

- [ ] Schema completo e validado
- [ ] Invariantes documentadas e testáveis
- [ ] Algoritmo de derivação delta documentado (pseudocódigo)
- [ ] Casos edge documentados com decisões determinísticas
- [ ] Exemplos mínimos e completos fornecidos
- [ ] Testes obrigatórios planeados e executáveis

## Referências

- Documento Mestre: Secção 7.4 (InputSnapshot), Secção 7.5 (TrustIndex), Secção 7.6 (Import XLSX)
- Contrato C-00: Convenções Globais (versionamento, hashing, nomenclatura)
- Contrato C-02: Import ISOP XLSX (mapeamento de colunas)
- Contrato C-05: Solver Interface (como o solver consome o snapshot)
- Fixture: `/fixtures/snapshot/isop_snapshot_v1.json`
