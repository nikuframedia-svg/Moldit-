# DEC-0001 — Stack Tecnológico e Ferramentas (Baseline)

- **Data**: 2026-02-04
- **Estado**: ACEITE
- **Owner**: PP1 Engineering Team
- **Stakeholders**: Equipa PP1 (engineering)
- **Contratos afetados**: C-00, C-04, C-05, C-13, C-14, C-15
- **Prompts Cursor relacionados**: SP-DEC-0001, SP-FE-01, SP-BE-01
- **Worklogs relacionados**: WORKLOG-SP-DEC-0001

## Contexto

O PP1 exige:
- determinismo (solver e canonicalização),
- auditabilidade (lineage + hashes + logs),
- capacidade industrial (planeamento finito com multi‑recurso),
- frontend modular (UI fornecida separadamente),
- integração via API (export governado/outbox).

Uma stack "exótica" aumenta risco e reduz velocidade. O baseline tem de ser:
- mainstream,
- suportado por tooling maduro,
- adequado a solver OR.

## Problema

Sem decisão formal sobre stack tecnológico, há ambiguidade sobre:
- Versões mínimas exatas de dependências
- Alternativas consideradas e trade-offs
- Riscos e consequências de cada escolha
- Critérios de revisão da stack

Isto bloqueia desenvolvimento de FE e BE, pois não há garantia de compatibilidade e alinhamento.

## Opções consideradas

### 1) Frontend Framework

**Opção A — React 18.2+ + TypeScript 5.0+**
- Vantagens:
  - Ecossistema maduro e amplamente suportado
  - TypeScript reduz ambiguidade e maximiza reuso
  - Pool de talento grande
  - Tooling excelente (Vite, ESLint, etc.)
- Desvantagens:
  - Curva de aprendizagem para iniciantes
  - Bundle size maior que alternativas
- Riscos:
  - Baixo risco (tecnologia mainstream)
- Alinhamento com PP1:
  - ✅ Suporta contract-driven development (TypeScript)
  - ✅ Tooling maduro para validação (Zod)

**Opção B — Vue 3.x**
- Vantagens:
  - Sintaxe mais simples
  - Performance excelente
- Desvantagens:
  - Menor pool de talento
  - Ecossistema menor que React
- Riscos:
  - Médio risco (menor adoção)
- Alinhamento com PP1:
  - ⚠️ Ecossistema menor pode limitar ferramentas de validação

**Opção C — Angular**
- Vantagens:
  - Framework completo (não precisa escolher bibliotecas)
  - TypeScript nativo
- Desvantagens:
  - Curva de aprendizagem íngreme
  - Overhead para projetos pequenos/médios
- Riscos:
  - Alto risco (complexidade desnecessária para protótipo)
- Alinhamento com PP1:
  - ⚠️ Complexidade pode atrasar desenvolvimento

**Decisão**: Opção A (React 18.2+ + TypeScript 5.0+)

### 2) Backend Framework

**Opção A — FastAPI 0.104+ (Python 3.11+)**
- Vantagens:
  - Produtividade alta
  - OpenAPI "de borla" (contratos automáticos)
  - Async nativo
  - Python é direto para OR/analytics
  - Ecossistema maduro para solver (OR-Tools)
- Desvantagens:
  - Performance inferior a Go/Rust (mas suficiente para PP1)
- Riscos:
  - Baixo risco (tecnologia mainstream)
- Alinhamento com PP1:
  - ✅ OpenAPI gera contratos automaticamente
  - ✅ Integração excelente com OR-Tools

**Opção B — Node.js + Express/Fastify**
- Vantagens:
  - Mesma linguagem que frontend
  - Performance excelente
- Desvantagens:
  - Menos adequado para OR/analytics
  - Ecossistema de solver limitado
- Riscos:
  - Médio risco (menos adequado para solver)
- Alinhamento com PP1:
  - ❌ Não adequado para solver OR

**Opção C — Java + Spring Boot**
- Vantagens:
  - Enterprise-grade
  - Performance excelente
- Desvantagens:
  - Overhead de desenvolvimento
  - Menos adequado para protótipos rápidos
- Riscos:
  - Alto risco (complexidade desnecessária)
- Alinhamento com PP1:
  - ⚠️ Complexidade pode atrasar desenvolvimento

**Decisão**: Opção A (FastAPI 0.104+ com Python 3.11+)

### 3) Database

**Opção A — PostgreSQL 15+**
- Vantagens:
  - Standard para workloads analíticos
  - ACID completo
  - JSONB para payloads canónicos
  - Extensões úteis
  - Sem lock-in
- Desvantagens:
  - Requer setup (Docker ou instalação local)
- Riscos:
  - Baixo risco (tecnologia mainstream)
- Alinhamento com PP1:
  - ✅ Suporta JSONB para snapshots/planos
  - ✅ ACID garante consistência

**Opção B — MySQL 8.0+**
- Vantagens:
  - Amplamente usado
  - Performance excelente
- Desvantagens:
  - Menos adequado para workloads analíticos
  - JSONB limitado
- Riscos:
  - Médio risco (menos adequado para PP1)
- Alinhamento com PP1:
  - ⚠️ Menos adequado para dados JSON complexos

**Opção C — SQLite (apenas dev)**
- Vantagens:
  - Zero setup
  - Rápido para desenvolvimento
- Desvantagens:
  - Não adequado para produção
  - Limitações de concorrência
- Riscos:
  - Alto risco se usado em produção
- Alinhamento com PP1:
  - ⚠️ Apenas para desenvolvimento local

**Decisão**: Opção A (PostgreSQL 15+), com SQLite opcional para dev local

### 4) Solver

**Opção A — Google OR-Tools 9.8+ (CP-SAT)**
- Vantagens:
  - Open-source (sem vendor lock-in)
  - CP-SAT competitivo em scheduling discreto
  - Boa integração com Python
  - Teste determinístico
  - Timeboxing/LNS suportado
- Desvantagens:
  - Pode ser insuficiente em instâncias muito grandes
- Riscos:
  - Médio risco (pode precisar de solver comercial no futuro)
- Alinhamento com PP1:
  - ✅ Determinismo garantido (seed fixa)
  - ✅ Timeboxing suportado

**Opção B — Gurobi/CPLEX**
- Vantagens:
  - Performance superior
  - Qualidade de solução excelente
- Desvantagens:
  - Licenças comerciais (custo)
  - Fricção de setup
- Riscos:
  - Alto risco (custo e complexidade)
- Alinhamento com PP1:
  - ⚠️ Custo pode ser proibitivo para protótipo

**Decisão**: Opção A (OR-Tools 9.8+), com possibilidade de reavaliar solver comercial se performance/qualidade exigirem (criar DEC nova)

### 5) State Management (Frontend)

**Opção A — Zustand 4.4+**
- Vantagens:
  - Leve e simples
  - Sem boilerplate excessivo
  - TypeScript-first
- Desvantagens:
  - Menos features que Redux Toolkit
- Riscos:
  - Baixo risco (adequado para protótipo)
- Alinhamento com PP1:
  - ✅ Simplicidade acelera desenvolvimento

**Opção B — Redux Toolkit**
- Vantagens:
  - Time-travel devtools
  - Padrão estabelecido
- Desvantagens:
  - Mais boilerplate
  - Overhead para protótipo
- Riscos:
  - Médio risco (complexidade desnecessária)
- Alinhamento com PP1:
  - ⚠️ Complexidade pode atrasar desenvolvimento

**Decisão**: Opção A (Zustand 4.4+), com possibilidade de migrar para Redux Toolkit se necessário

### 6) Validation (Frontend)

**Opção A — Zod 3.22+**
- Vantagens:
  - TypeScript-first
  - Validação de schemas JSON
  - Alinhado com contratos
- Desvantagens:
  - Bundle size adicional
- Riscos:
  - Baixo risco
- Alinhamento com PP1:
  - ✅ Validação de fixtures contra schemas
  - ✅ Contract-driven development

**Opção B — Yup**
- Vantagens:
  - Amplamente usado
- Desvantagens:
  - Menos TypeScript-first
- Riscos:
  - Médio risco
- Alinhamento com PP1:
  - ⚠️ Menos adequado para contract-driven

**Decisão**: Opção A (Zod 3.22+)

## Decisão

### Frontend

- **Framework**: React **18.2+** + TypeScript **5.2+**
- **Build**: Vite **5.0+**
- **State Management**: Zustand **4.4+**
- **Validation**: Zod **3.22+**
- **HTTP Client**: Axios **1.6+**
- **Routing**: React Router DOM **7.13+**
- **Date Handling**: date-fns **3.0+**
- **Testes**: Vitest **1.0+** + Playwright **1.41+** (E2E mínimo)

### Backend

- **Runtime**: Python **3.11+**
- **Framework HTTP/API**: FastAPI **0.104+** (OpenAPI/JSON)
- **ORM**: SQLAlchemy **2.0+** (async)
- **Migrations**: Alembic **1.13+**
- **Database**: PostgreSQL **15+** (produção), SQLite (opcional para dev)
- **Testes**: pytest **7.4+** + pytest-cov **4.1+**

### Solver

- **OR**: Google OR-Tools **9.8+** (CP-SAT)
- **Seed**: Fixo por defeito (ex.: 42) — determinismo de regressão

### API

- **Estilo**: REST com OpenAPI gerado pelo FastAPI
- **Formato**: JSON (schemas versionados em `/contracts/schemas/*`)
- **Versionamento**: `/v1/...`, `/v2/...` (nunca alterar retroativamente `/v1`)

### Qualidade e Análise Estática

- **Backend lint**: ruff **0.1+**
- **Backend type checking**: mypy **1.7+** (typing gradual, obrigatório em módulos críticos)
- **Frontend lint**: ESLint **8.55+**
- **Frontend format**: Prettier (se adotado)
- **Backend format**: ruff format (se adotado)

### Observabilidade

- **Logs**: Estruturados (JSON) com correlation_id
- **Métricas**: Duração import/solve, TrustIndex histogram, lag read-model
- **Tracing**: OpenTelemetry (opcional v1; recomendado v2)

## Justificação técnica

### Frontend

- **React+TypeScript**: Reduz ambiguidade, maximiza reuso e disciplina de tipos. Alinhado com contract-driven development.
- **Vite**: Reduz friction e tempo de build. HMR excelente para desenvolvimento rápido.
- **Zustand**: Leve, simples, sem boilerplate excessivo. Adequado para protótipo.
- **Zod**: Impede UI "a aceitar lixo" e força contrato no boundary. Validação de fixtures contra schemas.

### Backend

- **Python 3.11+**: Caminho mais curto para OR e tooling de dados. Ecossistema maduro para solver.
- **FastAPI**: Produtividade alta + OpenAPI "de borla". Contratos claros sem discussão.
- **SQLAlchemy 2.0 async**: Base sólida e conhecida. Alembic é o "default" de migrações — reduz risco operativo.
- **PostgreSQL 15+**: Features ACID + índices + extensões, sem lock-in. JSONB para payloads canónicos.

### Solver

- **OR-Tools CP-SAT**: Robusto, open-source, integra bem com Python, bom para timeboxing/LNS. Determinismo garantido com seed fixa.

## Consequências

### Curto prazo

- Stack assume ecossistema Node para FE e Python para BE ⇒ CI tem de suportar ambos.
- Setup local requer Node.js 20+, Python 3.11+, Docker (para PostgreSQL).
- Desenvolvimento paralelo FE/BE possível (FE-first com mocks).

### Longo prazo

- OR-Tools pode ser insuficiente em instâncias muito grandes ⇒ mitigação: timeboxing + heurísticas + profiling; reavaliar solver comercial com DEC dedicada.
- Possibilidade de migrar para Redux Toolkit se Zustand for insuficiente (baixo risco, migração simples).
- PostgreSQL pode precisar de otimizações (índices, particionamento) em escala.

### Migração/Rollback

- Migração de OR-Tools para solver comercial: Requer DEC nova, testes de compatibilidade, possível mudança de API.
- Migração de Zustand para Redux Toolkit: Baixo risco, migração incremental possível.
- Rollback: Todas as versões são pinned, rollback é possível mas requer atualização de dependências.

## Plano de verificação

### Testes a criar/atualizar

- [ ] Verificação: versões instaladas >= versões mínimas
- [ ] Build: projeto compila com versões mínimas (FE e BE)
- [ ] Testes unitários correm em CI com versões pinned
- [ ] `scripts/benchmark_plan_min.py` executa e produz resultados estáveis

### Métricas a observar

- Tempo de build (FE e BE)
- Tempo de execução de testes
- Performance do solver (benchmarks)
- Cobertura de testes (mínimos definidos em Secção 11.7)

### Critério objetivo de sucesso

- ✅ Repositório compila FE e BE localmente (ver Secção 17)
- ✅ Testes unitários correm em CI com versões pinned
- ✅ `scripts/benchmark_plan_min.py` executa e produz resultados estáveis
- ✅ Documentação de setup local completa e testada

## Checklist de fecho

- [x] Contratos atualizados e versionados (C-00, C-04, C-05, C-13, C-14, C-15)
- [x] DEC criada e completa (sem placeholders)
- [x] Versões mínimas explícitas (sem ">=" vagos)
- [x] Trade-offs documentados (mín. 2 alternativas por camada)
- [x] Riscos identificados e mitigados
- [x] Plano de verificação definido
- [ ] Tests executados e evidência anexada no Worklog (após setup)
- [ ] FE/BE não quebraram (contract tests) — após implementação

## Gatilhos de revisão (obrigatórios)

Criar nova DEC se ocorrer:
- Necessidade de GraphQL (atualmente REST)
- Exigência de solver comercial (SLA/qualidade) — substituir OR-Tools
- Requisitos de latência/escala fora dos benchmarks definidos (Secção 11.5)
- Constraints legais/compliance que imponham tecnologia específica
- Performance do solver insuficiente após otimizações (timeboxing, heurísticas, profiling)

## Referências

- Documento Mestre: Secção 16 (Stack Tecnológico e Ferramentas)
- Contrato C-00: Convenções Globais
- Contrato C-04: Plan API
- Contrato C-05: Solver Interface
- Contrato C-13: LLM Copilot
- Contrato C-14: Security RBAC/SoD
- Contrato C-15: Observability Audit
