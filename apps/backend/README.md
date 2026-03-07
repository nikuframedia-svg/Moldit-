# PP1 Backend

Backend API para PP1 conforme contratos e DEC-0001.

## Stack Tecnológico

- **Python**: 3.11+
- **Framework**: FastAPI 0.104+
- **Database**: PostgreSQL (via SQLAlchemy)
- **Migrations**: Alembic
- **Logging**: python-json-logger (estruturado)

## Estrutura

```
backend/
├── src/
│   ├── api/v1/        # Endpoints versionados
│   ├── core/           # Config, logging, errors, middleware
│   ├── db/             # Database (SP-BE-02)
│   ├── domain/         # Business logic (futuro)
│   └── workers/        # Background workers (futuro)
├── tests/              # Testes
└── scripts/            # Scripts utilitários
```

## Instalação

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # ou `venv\Scripts\activate` no Windows
pip install -r requirements.txt
```

## Executar

```bash
# Desenvolvimento
uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Produção
uvicorn src.main:app --host 0.0.0.0 --port 8000
```

## Testes

```bash
pytest
```

## Endpoints

- `GET /v1/health` - Health check
- `GET /v1/version` - Version info
- `GET /docs` - Swagger UI (apenas em debug)

## Middleware

- **CorrelationMiddleware**: Gera/preserva correlation_id (obrigatório conforme C-15)
- **IdempotencyMiddleware**: Valida Idempotency-Key em requests mutáveis (conforme C-00)
- **RequestLoggingMiddleware**: Logging estruturado com duration_ms (conforme SP-BE-01)

## Conformidade

- ✅ C-00: ErrorModel, Idempotency-Key, Correlation ID
- ✅ C-15: Logging estruturado, correlation_id obrigatório
- ✅ SP-BE-01: Endpoints health/version, middleware completo
