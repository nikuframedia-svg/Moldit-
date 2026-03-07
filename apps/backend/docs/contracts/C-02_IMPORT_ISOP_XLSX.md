# C-02 — Import ISOP XLSX

- **Contract ID**: C-02
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-00, C-01
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato define como transformar o ficheiro XLSX `ISOP_ Nikufra.xlsx` (ou ficheiros similares) em `InputSnapshot` canónico, com normalização determinística, lineage (`source_locator`) por campo, `series_semantics` explícito, validação e TrustIndex calculável.

## Não-objetivo

Este contrato não define:
- Como validar PDFs (isso é C-03)
- Como o solver processa o snapshot (isso é C-05)
- Regras de negócio específicas (isso é C-06, C-07, etc.)

## Schema

Este contrato não possui JSON Schema próprio, mas produz `InputSnapshot` que valida contra `/contracts/schemas/snapshot.schema.json`.

### Mapeamento de Colunas (v1)

| XLSX (coluna) | Snapshot (campo canónico) | Regra determinística |
|---|---|---|
| `Cliente` | `customers[].code` | normalizar (trim) |
| `Nome` | `customers[].name` | texto livre |
| `Produto Acabado` | `items[].parent_sku` | opcional; quando diferente de `Referência Artigo` |
| `Referência Artigo` | `items[].sku` | obrigatório |
| `Designação` | `items[].name` | opcional |
| `Lote Económico` | `items[].lot_economic_qty` | opcional; numérico |
| `Máquina` | `resources[].code` | obrigatório; normalizar (upper/trim) |
| `Máquina alternativa` | `routing.operations[].alt_resources[]` | se vazio/"-" ⇒ lista vazia |
| `Ferramenta` | `tools[].code` + `routing.operations[].tool_code` | opcional mas recomendada; se vazio ⇒ `tool_code=null` |
| `Tp.Setup` | `routing.operations[].setup_time` + `setup_time_uom` | numérico ≥ 0; se vazio ⇒ erro (para solver) |
| `Peças/H` | `routing.operations[].rate_pieces_per_hour` | numérico > 0; se vazio ⇒ erro (para solver) |
| `Nº Pessoas` | `routing.operations[].operators_required` | inteiro ≥ 1; se vazio ⇒ erro (para solver) |
| `Qtd Exp` | `raw_fields.qtd_exp` | **não assumir semântica**; guardar bruto + source_locator |
| colunas por data | `series[]` (time series) | semântica MUST ser declarada |

### Campos obrigatórios

- `series_semantics`: `enum` — Obrigatório e explícito no import
- `file_hash_sha256`: `string` — SHA-256 do ficheiro original
- `source_locator`: `object` — Rastreabilidade campo-a-campo (quando aplicável)

## Invariantes

1. **Determinismo**: O mesmo ficheiro XLSX → o mesmo `snapshot_hash` (ignorando `snapshot_id`, `created_at`).
2. **Semântica Explícita**: `series_semantics` é obrigatório e não pode ser `UNKNOWN` para automação.
3. **Rastreabilidade**: Campos derivados têm `source_locator` (sheet, row_idx, column_name).
4. **Normalização**: Strings normalizadas (trim, upper para códigos, trim para nomes).

## Validações

### Validações obrigatórias

1. Ficheiro existe e é XLSX válido
2. Headers na linha 7 (conforme estrutura observada)
3. Campos obrigatórios presentes (`Referência Artigo`, `Máquina`)
4. Valores numéricos válidos (`Tp.Setup >= 0`, `Peças/H > 0`, `Nº Pessoas >= 1`)
5. `series_semantics` explícito (não `UNKNOWN` para automação)

### Códigos de erro

- `ERR_XLSX_INVALID`: Ficheiro não é XLSX válido
- `ERR_XLSX_MISSING_HEADERS`: Headers não encontrados na linha esperada
- `ERR_XLSX_MISSING_REQUIRED_FIELD`: Campo obrigatório ausente
- `ERR_XLSX_INVALID_NUMERIC`: Valor numérico inválido
- `ERR_SERIES_SEMANTICS_UNKNOWN`: `series_semantics == UNKNOWN` bloqueia automação

## Casos edge

### E2.1 — `Máquina alternativa` vazio ou "-"
**Decisão**: `alt_resources = []`

### E2.2 — Valores negativos quando `DEMAND_QTY_BY_DATE` ou `PLANNED_PRODUCTION_QTY_BY_DATE`
**Decisão**: Erro de contrato `ERR_SERIES_NEGATIVE_NOT_ALLOWED`

### E2.3 — `Qtd Exp` vazio mas existem valores por data
**Decisão**: Aceitar import (há série temporal suficiente)

### E2.4 — `Qtd Exp` preenchido mas não existem valores por data
**Decisão**: Aceitar import em modo "master_data-only", gerar causa `MISSING_SERIES_BLOCK`, TrustIndex < 0.85

### E2.5 — Duplicados de SKU em múltiplas linhas
**Decisão**: `items[]` é único por `sku` (deduplicar), `customers[]` é único por `code`

## Exemplos

Ver `/fixtures/snapshot/isop_snapshot_v1.json` e `/scripts/generate_fixture_snapshot.py`.

## Testes obrigatórios

- [ ] Unit: import do mesmo XLSX 2× produz `snapshot_hash` idêntico
- [ ] Unit: derivação delta (série → needs/supplies) — ver Secção 7.6.3
- [ ] Contract: snapshot gerado valida contra schema
- [ ] Integration: fixture `isop_snapshot_v1.json` valida

## Critérios de aceitação

- [ ] Mapeamento de colunas documentado
- [ ] Algoritmo de derivação delta documentado
- [ ] Casos edge documentados
- [ ] Testes obrigatórios planeados

## Referências

- Documento Mestre: Secção 7.6 (Import XLSX)
- Contrato C-01: InputSnapshot
- Script: `/scripts/generate_fixture_snapshot.py`
