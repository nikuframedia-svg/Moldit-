# Documentação PP1

Este diretório contém toda a documentação do projeto PP1 (Production Planning).

## Estrutura

```
/docs/
├── README.md           # Este ficheiro
├── worklogs/           # Registos de trabalho por sessão
├── decisions/          # Architecture Decision Records (ADRs)
├── benchmarks/         # Resultados de benchmarks de performance
├── observability.md    # Documentação de observabilidade
└── STATUS_PROJETO.md   # Estado actual do projeto
```

## Worklogs

Os worklogs documentam cada sessão de trabalho realizada no projeto. Cada worklog segue o template em `worklogs/WORKLOG-TEMPLATE.md` e inclui:

- Objetivo da sessão
- Alterações realizadas (ficheiros criados/modificados/removidos)
- Decisões tomadas
- Riscos identificados
- Validações executadas
- Próximos passos

Ver [worklogs/README.md](./worklogs/README.md) para instruções de uso.

## Decisions (ADRs)

Architecture Decision Records documentam decisões técnicas significativas. Cada ADR segue o template em `decisions/DEC-TEMPLATE.md` e inclui:

- Contexto e problema
- Opções consideradas
- Decisão tomada
- Justificação técnica
- Consequências

Ver [decisions/README.md](./decisions/README.md) para instruções de uso.

## Benchmarks

Resultados de benchmarks de performance do solver e processamento de snapshots.

## Convenções

### Nomenclatura de Ficheiros

- Worklogs: `WORKLOG-SP-XX-YYYYMMDD-HHMM.md`
- Decisões: `DEC-XXXX-titulo-curto.md`
- Benchmarks: `benchmark_{tipo}_{yyyymmdd_hhmmss}.md`

### Referências Cruzadas

Sempre que possível, incluir referências a:
- Contratos relacionados (C-XX)
- Decisões relacionadas (DEC-XXXX)
- Worklogs relacionados

## Links Úteis

- [Contratos](/contracts/README.md)
- [Documento Mestre](/PP1_DOCUMENTO_MESTRE.md)
- [Frontend](/frontend/README.md)
- [Backend](/backend/README.md)
