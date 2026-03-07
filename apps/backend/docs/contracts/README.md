# Contratos de Dados e APIs

Este diretório contém os contratos versionados que governam o sistema PP1.

## Estrutura

```
/contracts/
  C-00_GLOBAL.md              # Convenções globais
  C-01_SNAPSHOT.md            # InputSnapshot
  C-02_IMPORT_ISOP_XLSX.md    # Import XLSX
  C-03_PDF_VALIDATION.md      # Validação PDF (não-canónico)
  C-04_PLAN_API.md            # API de Planos
  C-05_SOLVER_INTERFACE.md    # Interface do Solver
  C-06_SETUP_RULES.md         # Regras de Setup
  C-07_CALENDARS_AND_POOLS.md # Calendários e Pools
  C-08_SANDBOX_SCENARIOS.md   # Sandbox e Cenários
  C-09_IMPROVE_PRS.md         # PRs e Governança
  C-10_SUGGESTIONS_OUTCOMES.md # Sugestões e Outcomes
  C-11_CAUSAL_AND_BANDITS.md  # Causal Inference e Bandits
  C-12_EXPLAINABILITY.md      # Explicabilidade
  C-13_LLM_COPILOT.md         # Copilot/LLM
  C-14_SECURITY_RBAC_SOD.md   # Segurança RBAC/SoD
  C-15_OBSERVABILITY_AUDIT.md # Observabilidade e Audit
  /schemas/                    # JSON Schemas
  /iterations/                 # Histórico de iterações
```

## Status dos Contratos

| ID | Título | Status | Versão | Última Atualização |
|----|--------|--------|--------|-------------------|
| C-00 | Global | ACTIVE | 20260204.1 | 2026-02-04 |
| C-01 | Snapshot | ACTIVE | 20260204.1 | 2026-02-04 |
| C-02 | Import ISOP XLSX | ACTIVE | 20260204.1 | 2026-02-04 |
| C-03 | PDF Validation | ACTIVE | 20260204.1 | 2026-02-04 |
| C-04 | Plan API | ACTIVE | 20260204.1 | 2026-02-04 |
| C-05 | Solver Interface | ACTIVE | 20260204.1 | 2026-02-04 |
| C-06 | Setup Rules | ACTIVE | 20260204.1 | 2026-02-04 |
| C-07 | Calendars and Pools | ACTIVE | 20260204.1 | 2026-02-04 |
| C-08 | Sandbox Scenarios | ACTIVE | 20260204.1 | 2026-02-04 |
| C-09 | IMPROVE PRs | ACTIVE | 20260204.1 | 2026-02-04 |
| C-10 | Suggestions Outcomes | ACTIVE | 20260204.1 | 2026-02-04 |
| C-11 | Causal and Bandits | ACTIVE | 20260204.1 | 2026-02-04 |
| C-12 | Explainability | ACTIVE | 20260204.1 | 2026-02-04 |
| C-13 | LLM Copilot | ACTIVE | 20260204.1 | 2026-02-04 |
| C-14 | Security RBAC/SoD | ACTIVE | 20260204.1 | 2026-02-04 |
| C-15 | Observability Audit | ACTIVE | 20260204.1 | 2026-02-04 |

## Regras de Versionamento

- **MAJOR (breaking)**: exige DEC + migração
- **MINOR (compatível)**: adiciona campos opcionais
- **PATCH (doc-only)**: clarificações

Ver Secção 1.3.3 do Documento Mestre.

## Validação

```bash
# Validar todos os schemas
python scripts/validate_schemas.py

# Validar fixtures contra schemas
python scripts/validate_fixtures.py
```
