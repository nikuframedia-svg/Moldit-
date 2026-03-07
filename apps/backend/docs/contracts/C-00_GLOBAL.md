# C-00 — Convenções Globais

- **Contract ID**: C-00
- **Version**: 20260204.1
- **Status**: ACTIVE
- **Created**: 2026-02-04
- **Last Updated**: 2026-02-04
- **Owner**: PP1 Engineering Team
- **Related Contracts**: C-01, C-02, C-03, C-04, C-05, C-06, C-07, C-08, C-09, C-10, C-11, C-12, C-13, C-14, C-15
- **Related Decisions**: DEC-0001

## Objetivo

Este contrato estabelece as convenções globais que todos os outros contratos (C-01 a C-15) herdam e devem seguir. Define o "DNA" do sistema PP1: versionamento, hashing canónico, nomenclatura de IDs, invariantes globais, códigos de erro e casos edge comuns.

## Não-objetivo

Este contrato não define:
- Estruturas de dados específicas (isso é responsabilidade de C-01 a C-15)
- Algoritmos de solver (isso é C-05)
- Regras de negócio específicas (isso é C-06, C-07, etc.)

## Schema

Este contrato não possui um JSON Schema próprio, pois é um contrato meta que governa outros contratos. Os schemas específicos estão definidos em `/contracts/schemas/`.

### Convenções de Versionamento

#### Versionamento de Contratos (C-XX)

**Formato:** `YYYYMMDD.N` (ex.: `20260204.1`)

- **YYYYMMDD**: Data da criação/atualização do contrato
- **N**: Número sequencial da versão no mesmo dia (1, 2, 3, ...)

**Tipos de mudança:**

1. **MAJOR (breaking)**:
   - Remover campo obrigatório
   - Tornar campo opcional em obrigatório (ou vice-versa)
   - Mudar semântica/unidade de um campo sem campo novo
   - Mudar regras de derivação (ex.: como derivar `due_date`)
   - Mudar invariantes fundamentais

2. **MINOR (compatível)**:
   - Adicionar campo opcional
   - Adicionar novo valor a `enum` mantendo compatibilidade
   - Adicionar novo endpoint (sem alterar existentes)
   - Clarificar documentação sem mudar comportamento

3. **PATCH (doc-only)**:
   - Clarificação textual
   - Corrigir exemplos/typos
   - Melhorar checklist sem alterar comportamento

**Regra operacional (sem desculpas):**
- MAJOR exige obrigatoriamente:
  1. `DEC-...` (decisão formal)
  2. Guia de migração (o que muda, como migrar, como validar)
  3. Fixtures em dupla versão (v-1 e v)
  4. Testes de compatibilidade

**Período de depreciação (normativo):**
- Manter MAJOR anterior **mínimo 6 meses** (ou 2 ciclos de release do cliente, o que for maior)
- Exceção: risco de segurança crítico
- Durante depreciação:
  - API/contract antigo continua suportado em modo read-only quando possível
  - Alertas explícitos em logs/telemetria (`deprecated_contract_version`)

#### Versionamento de APIs

- API externa é versionada no path: `/v1/...`, `/v2/...`
- **Regra:** nunca alterar retroativamente `/v1` de forma breaking; criar `/v2`
- Versão mínima suportada deve ser documentada

### Algoritmo de Hash Canónico

**Objetivo:** Garantir que o mesmo snapshot/plano produz sempre o mesmo hash, permitindo detecção de mudanças e reprodutibilidade.

**Algoritmo:** SHA-256

**Pseudocódigo:**
```python
def canonical_hash(obj: dict) -> str:
    """
    Calcula hash canónico SHA-256 de um objeto JSON.
    
    Regras:
    1. Ordenar todas as chaves recursivamente
    2. Ignorar campos não-determinísticos:
       - created_at
       - updated_at
       - correlation_id
       - audit_refs
       - generated_at (em explain_trace)
    3. Serializar para JSON canónico (sem espaços, ordenado)
    4. Calcular SHA-256 do JSON string
    5. Retornar hex lowercase (64 caracteres)
    """
    # 1. Copiar objeto e remover campos não-determinísticos
    canonical = remove_non_deterministic_fields(obj)
    
    # 2. Ordenar chaves recursivamente
    sorted_obj = sort_keys_recursive(canonical)
    
    # 3. Serializar para JSON canónico
    json_str = json.dumps(sorted_obj, sort_keys=True, separators=(',', ':'))
    
    # 4. Calcular SHA-256
    hash_bytes = hashlib.sha256(json_str.encode('utf-8')).digest()
    
    # 5. Retornar hex lowercase
    return hash_bytes.hex()
```

**Campos não-determinísticos (ignorados no hash):**
- `created_at`, `updated_at`
- `correlation_id`
- `audit_refs`
- `generated_at` (em `explain_trace`)
- `duration_ms` (em logs)
- `request_id`

**Invariante:** O mesmo objeto canónico (após remoção de campos não-determinísticos) MUST produzir o mesmo hash.

### Nomenclatura de IDs

#### UUIDs (Recomendado)

**Formato:** UUID v4 (RFC 4122)

**Uso obrigatório para:**
- `snapshot_id`
- `tenant_id`
- `plan_id`
- `scenario_id`
- `pr_id`
- `suggestion_id`
- `source_id`
- `workorder_id`
- `operation_id`

**Exemplo:** `70763a5c-e9c2-439a-a0c7-0edc6d91c57a`

#### IDs Estáveis (Alternativa)

Para IDs legíveis por humanos, usar formato: `<prefix>-<sequence>`

**Exemplos:**
- `snapshot-001`
- `plan-001`
- `sc-001` (scenario)
- `pr-001` (pull request)

**Regra:** IDs estáveis devem ser únicos dentro do seu namespace e imutáveis após criação.

### Campos Obrigatórios Globais

Todos os contratos que representam entidades versionadas devem incluir:

- `*_id`: ID único (UUID ou estável)
- `created_at`: Timestamp UTC (ISO 8601 com 'Z')
- `*_hash`: Hash canónico SHA-256 (quando aplicável)

### Enums Globais

#### Status de Entidades

```typescript
type EntityStatus = 
  | "DRAFT"      // Rascunho, não finalizado
  | "ACTIVE"     // Ativo, em uso
  | "DEPRECATED" // Depreciado, não usar em novos casos
  | "ARCHIVED"   // Arquivado, apenas leitura
```

#### Tipos de Fonte

```typescript
type SourceType = 
  | "XLSX"   // Ficheiro Excel
  | "PDF"    // Ficheiro PDF (não-canónico)
  | "API"    // Integração via API
  | "MANUAL" // Entrada manual
```

## Invariantes

1. **Imutabilidade de Snapshots**: Um `InputSnapshot` após criação é imutável. Qualquer alteração cria um novo snapshot com novo `snapshot_id` e `snapshot_hash`.

2. **Determinismo de Planos**: Dado o mesmo `InputSnapshot` + os mesmos `PlanParams` (incluindo `seed`), o solver MUST produzir o mesmo `plan_hash`.

3. **Unicidade de IDs**: Todos os IDs (`*_id`) são únicos dentro do seu namespace e imutáveis após criação.

4. **Hash Canónico**: O hash canónico de uma entidade é calculado ignorando campos não-determinísticos e ordenando chaves recursivamente.

5. **Versionamento**: Qualquer mudança MAJOR em um contrato exige DEC formal, guia de migração e testes de compatibilidade.

6. **Auditabilidade**: Todas as mutações de estado têm `audit_log` + `correlation_id` + actor (humano/serviço).

7. **Idempotência**: Endpoints mutáveis aceitam `Idempotency-Key`; repetição ⇒ resposta idêntica e sem duplicação.

## Validações

### Validações Obrigatórias Globais

1. **Validação de UUID**: IDs com formato UUID devem validar contra RFC 4122
2. **Validação de Hash**: Hashes SHA-256 devem ter exatamente 64 caracteres hexadecimais (lowercase)
3. **Validação de Timestamp**: Timestamps devem estar em formato ISO 8601 com sufixo 'Z' (UTC)
4. **Validação de Versionamento**: Versões de contratos devem seguir formato `YYYYMMDD.N`

### Códigos de Erro Globais

- `ERR_INVALID_UUID`: ID não é um UUID válido
- `ERR_INVALID_HASH`: Hash não é SHA-256 válido (64 hex chars)
- `ERR_INVALID_TIMESTAMP`: Timestamp não está em formato ISO 8601 UTC
- `ERR_NON_DETERMINISTIC`: Operação produziu resultado não-determinístico
- `ERR_CONTRACT_VERSION_MISMATCH`: Versão do contrato não é suportada
- `ERR_IDEMPOTENCY_KEY_CONFLICT`: Idempotency-Key usado com payload diferente
- `ERR_SNAPSHOT_IMMUTABLE`: Tentativa de modificar snapshot imutável
- `ERR_PLAN_NON_DETERMINISTIC`: Plano não é determinístico (hash diferente em runs repetidos)

## Casos edge

### E0.1 — Snapshot Vazio

**Cenário:** `InputSnapshot` sem items, sem routing, sem series.

**Decisão:** 
- Aceitar snapshot (não bloquear import)
- Marcar `trust_index.overall = 0.0`
- Adicionar causa: `EMPTY_SNAPSHOT`
- Bloquear automação (modo advisory apenas)

**Justificação:** Permite import de dados parciais para análise, mas não permite planeamento sem dados.

### E0.2 — Hash Collision

**Cenário:** Dois objetos diferentes produzem o mesmo hash canónico.

**Decisão:**
- Tratar como erro fatal (`ERR_HASH_COLLISION`)
- Registrar em audit log
- Bloquear operação até resolução

**Justificação:** Hash collision é extremamente improvável (SHA-256), mas se ocorrer, indica problema crítico no algoritmo de hash canónico.

### E0.3 — Timestamp em Timezone Diferente de UTC

**Cenário:** Timestamp fornecido sem sufixo 'Z' ou com timezone diferente.

**Decisão:**
- Converter para UTC automaticamente
- Armazenar sempre em UTC com sufixo 'Z'
- Logar aviso se conversão foi necessária

**Justificação:** Garantir consistência temporal global.

### E0.4 — Versão de Contrato Não Suportada

**Cenário:** Entidade com versão de contrato mais antiga que a versão mínima suportada.

**Decisão:**
- Retornar erro `ERR_CONTRACT_VERSION_MISMATCH`
- Incluir versão mínima suportada na mensagem de erro
- Oferecer guia de migração se disponível

**Justificação:** Prevenir uso de contratos depreciados sem migração adequada.

## Exemplos

### Exemplo Mínimo: Hash Canónico

```json
{
  "snapshot_id": "70763a5c-e9c2-439a-a0c7-0edc6d91c57a",
  "tenant_id": "tenant-001",
  "created_at": "2026-02-04T16:30:00Z",
  "sources": [],
  "semantics": {
    "series_semantics": "NET_POSITION_AFTER_ALL_NEEDS_BY_DATE"
  },
  "master_data": {
    "items": [],
    "resources": [],
    "tools": []
  },
  "routing": [],
  "trust_index": {
    "overall": 0.0
  }
}
```

**Hash canónico (ignorando `created_at`):**
```
snapshot_hash = sha256(canonical_json_without_created_at)
```

### Exemplo: Versionamento MAJOR

**Antes (v20260204.1):**
```json
{
  "plan_id": "plan-001",
  "snapshot_hash": "abc123...",
  "operations": [...]
}
```

**Depois (v20260205.1 - MAJOR):**
```json
{
  "plan_id": "plan-001",
  "snapshot_hash": "abc123...",
  "operations": [...],
  "workorders": [...]  // NOVO campo obrigatório
}
```

**Migração obrigatória:**
1. Criar DEC-XXXX justificando mudança
2. Atualizar fixtures (v1 e v2)
3. Criar script de migração
4. Testes de compatibilidade

## Testes obrigatórios

- [ ] Unit: função de hash canónico (mesmo input → mesmo hash)
- [ ] Unit: hash canónico ignora campos não-determinísticos
- [ ] Unit: hash canónico ordena chaves recursivamente
- [ ] Contract: validação de versionamento (MAJOR quebra compatibilidade)
- [ ] Contract: validação de UUID (formato RFC 4122)
- [ ] Contract: validação de hash SHA-256 (64 hex chars)
- [ ] Integration: determinismo de planos (mesmo snapshot + params → mesmo hash)

## Critérios de aceitação

- [ ] Algoritmo de hash canónico documentado e implementado
- [ ] Convenções de versionamento documentadas
- [ ] Nomenclatura de IDs documentada
- [ ] Invariantes globais documentadas
- [ ] Códigos de erro globais documentados
- [ ] Casos edge documentados
- [ ] Exemplos mínimos fornecidos
- [ ] Testes obrigatórios planeados

## Referências

- Documento Mestre: Secção 1.3 (Versionamento), Secção 1.4 (Definition of Truth), Secção 2.1 (Determinismo)
- RFC 2119: Keywords for use in RFCs to Indicate Requirement Levels
- RFC 4122: A Universally Unique IDentifier (UUID) URN Namespace
- JSON Schema Draft 2020-12: https://json-schema.org/draft/2020-12/schema
