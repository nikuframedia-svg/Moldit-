# C-XX — <Título do Contrato>

- **Contract ID**: C-XX
- **Version**: YYYYMMDD.N (ex.: 20260204.1)
- **Status**: DRAFT | ACTIVE | DEPRECATED
- **Created**: YYYY-MM-DD
- **Last Updated**: YYYY-MM-DD
- **Owner**: <nome/role>
- **Related Contracts**: C-YY, C-ZZ
- **Related Decisions**: DEC-XXXX

## Objetivo

<Descrição clara do que este contrato governa>

## Não-objetivo

<O que explicitamente NÃO está coberto>

## Schema

### JSON Schema
- Schema file: `/contracts/schemas/<entity>.schema.json`
- Version: v1

### Campos obrigatórios
- `<campo>`: <tipo> — <descrição>
- ...

### Campos opcionais
- `<campo>`: <tipo> — <descrição>
- ...

### Enums
- `<enum_name>`: `<value1> | <value2> | ...`

## Invariantes

1. <Invariante 1>
2. <Invariante 2>
...

## Validações

### Validações obrigatórias
- <Validação 1>
- <Validação 2>
...

### Códigos de erro
- `ERR_XXX`: <Descrição>
- `ERR_YYY`: <Descrição>
...

## Casos edge

### E1 — <Cenário>
- **Decisão**: <Decisão determinística>
- **Justificação**: <Porquê>

## Exemplos

### Exemplo mínimo
```json
{
  ...
}
```

## Testes obrigatórios

- [ ] Unit: <teste>
- [ ] Contract: <teste>
- [ ] Integration: <teste>

## Critérios de aceitação

- [ ] Schema valida
- [ ] Invariantes testadas
- [ ] Exemplos validam contra schema

## Referências

- Documento Mestre: Secção X.Y
- PP1.docx: <referência>
