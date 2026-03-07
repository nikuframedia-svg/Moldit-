# Architecture Decision Records (ADRs)

Este diretório contém as decisões arquiteturais e técnicas significativas do projeto PP1.

## Propósito

ADRs documentam:
- Decisões técnicas importantes
- Contexto e justificação
- Alternativas consideradas
- Consequências da decisão

## Como Criar uma ADR

1. Copie o template `DEC-TEMPLATE.md`
2. Atribua o próximo número sequencial: `DEC-XXXX-titulo-curto.md`
3. Preencha todas as secções
4. Submeta para revisão antes de implementar (se PROPOSTA)
5. Atualize o estado após aprovação

## Estrutura do Template

```markdown
# DEC-XXXX — Título curto e técnico

- **Data**: YYYY-MM-DD
- **Estado**: PROPOSTA | ACEITE | REJEITADA | SUPERADA
- **Owner**: nome/role
- **Stakeholders**: lista
- **Contratos afetados**: C-XX, C-YY

## Contexto
## Problema
## Opções consideradas
## Decisão
## Justificação técnica
## Consequências
## Plano de verificação
## Checklist de fecho
```

## Estados

| Estado | Descrição |
|--------|-----------|
| PROPOSTA | Decisão em discussão, não implementada |
| ACEITE | Decisão aprovada e em implementação/implementada |
| REJEITADA | Decisão descartada após análise |
| SUPERADA | Decisão substituída por outra mais recente |

## Quando Criar uma ADR

Criar ADR quando:
- Escolher entre múltiplas tecnologias/abordagens
- Definir padrões arquiteturais
- Alterar contratos existentes (breaking changes)
- Decisões com impacto significativo no sistema

Não necessário para:
- Correções de bugs simples
- Refactoring interno sem impacto na API
- Atualizações de dependências menores

## Boas Práticas

1. **Clareza**: Decisão deve ser inequívoca
2. **Justificação**: Explicar o "porquê", não apenas o "o quê"
3. **Alternativas**: Documentar opções rejeitadas
4. **Consequências**: Ser honesto sobre trade-offs
5. **Verificação**: Definir como medir sucesso

## Relação com Contratos

Alterações a contratos (C-XX) que introduzem breaking changes devem:
1. Ter uma ADR associada
2. Criar uma iteração em `/contracts/iterations/`
3. Atualizar o worklog correspondente

## Índice de Decisões

| ID | Título | Estado | Data |
|----|--------|--------|------|
| DEC-0001 | Stack Tecnológico | ACEITE | 2026-02-04 |
| DEC-0002 | Split de Operações | ACEITE | 2026-02-05 |
| DEC-0003 | Capacidade de Operadores | ACEITE | 2026-02-05 |
