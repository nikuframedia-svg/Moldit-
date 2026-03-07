# Scripts de Automação PP1

Este diretório contém scripts de automação para o projeto PP1.

## Scripts Disponíveis

### Shell Scripts (Desenvolvimento)

| Script | Descrição |
|--------|-----------|
| `fe_run.sh` | Inicia o servidor de desenvolvimento do frontend |
| `fe_test.sh` | Executa os testes do frontend |
| `be_run.sh` | Inicia o servidor de desenvolvimento do backend |
| `be_test.sh` | Executa os testes do backend |

### TypeScript Scripts (Validação)

| Script | Descrição |
|--------|-----------|
| `validate-contracts.ts` | Valida contratos contra schemas e tipos TS |
| `generate-fixtures.ts` | Gera fixtures de teste baseados nos schemas |

### Python Scripts (Validação)

| Script | Descrição |
|--------|-----------|
| `validate_schemas.py` | Valida JSON schemas |
| `generate_fixture_snapshot.py` | Gera snapshots de fixture |

### Benchmark Scripts

| Script | Descrição |
|--------|-----------|
| `benchmark/run_benchmark.py` | Executa benchmarks de performance |
| `benchmark/run_regression.py` | Executa testes de regressão |

## Como Executar

### Scripts Shell
```bash
# Frontend
./scripts/fe_run.sh    # Inicia dev server
./scripts/fe_test.sh   # Executa testes

# Backend
./scripts/be_run.sh    # Inicia dev server
./scripts/be_test.sh   # Executa testes
```

### Scripts TypeScript
```bash
# Na pasta frontend
cd frontend

# Validar contratos
npx tsx ../scripts/validate-contracts.ts

# Gerar fixtures
npx tsx ../scripts/generate-fixtures.ts
```

### Scripts Python
```bash
# Instalar dependências
pip install -r scripts/requirements.txt

# Validar schemas
python scripts/validate_schemas.py

# Gerar fixtures
python scripts/generate_fixture_snapshot.py
```

## Estrutura de Diretórios

```
/scripts/
├── README.md                     # Este ficheiro
├── requirements.txt              # Dependências Python
├── fe_run.sh                     # Start frontend
├── fe_test.sh                    # Test frontend
├── be_run.sh                     # Start backend
├── be_test.sh                    # Test backend
├── validate_schemas.py           # Validação Python
├── generate_fixture_snapshot.py  # Geração Python
├── validate-contracts.ts         # Validação TypeScript
├── generate-fixtures.ts          # Geração TypeScript
└── benchmark/
    ├── __init__.py
    ├── run_benchmark.py
    └── run_regression.py
```

## Dependências

### Python
- jsonschema
- pyyaml

### Node.js
- tsx (via npx)
- zod

## Convenções

1. **Logs**: Scripts devem emitir logs com prefixo `[SCRIPT]`
2. **Exit Codes**: 0 = sucesso, 1 = erro de validação, 2 = erro de sistema
3. **Output**: JSON para integração com CI, texto para uso manual
4. **Idempotência**: Scripts devem ser idempotentes quando possível

## Integração com CI/CD

Estes scripts são utilizados no pipeline de CI/CD:

```yaml
# .github/workflows/ci.yml
- name: Validate Contracts
  run: npx tsx scripts/validate-contracts.ts

- name: Validate Schemas
  run: python scripts/validate_schemas.py
```

## Contribuição

1. Novos scripts devem seguir as convenções acima
2. Adicionar documentação neste README
3. Incluir testes quando aplicável
