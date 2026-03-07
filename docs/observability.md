# Observabilidade

**Conforme SP-OBS-01 e C-15**

---

## Visão Geral

O sistema implementa observabilidade de ponta a ponta com:
- **Correlation ID**: Rastreamento de requisições através de todo o sistema
- **Logs estruturados**: Logs em formato JSON com correlation_id
- **Métricas**: Contadores, timers, e gauges para SLOs
- **Tracing**: Correlation IDs como traços básicos

---

## Correlation ID

### Backend

**Middleware:** `CorrelationMiddleware` (`backend/src/core/middleware.py`)

- **Header obrigatório:** `X-Correlation-ID` (UUID)
- **Geração automática:** Se não fornecido, gera UUID
- **Propagação:** Adicionado a todos os logs e respostas HTTP
- **Validação:** Formato UUID obrigatório

**Uso:**
```python
from ...core.logging import correlation_filter

# Correlation ID está disponível em:
correlation_filter.correlation_id
```

### Frontend

**ApiClient:** `frontend/src/adapters/ApiClient.ts`

- **Geração automática:** UUID gerado no primeiro request
- **Propagação:** Enviado em header `X-Correlation-ID` em todos os requests
- **Captura:** Atualizado quando recebido na resposta
- **Visibilidade:** Exibido em páginas de erro e componentes de audit trail

**Exibição:**
- Páginas de erro mostram correlation_id quando disponível
- `AuditTrailViewer` sempre exibe correlation_id
- Componentes de PR e Suggestion exibem correlation_id em ações

---

## Logs Estruturados

### Formato

**Backend:** JSON (produção) ou texto (desenvolvimento)

**Configuração:** `backend/src/core/logging.py`

```python
from ...core.logging import get_logger

logger = get_logger(__name__)

logger.info(
    "Operation completed",
    extra={
        "operation_id": str(operation_id),
        "duration_ms": 150,
        "correlation_id": correlation_filter.correlation_id,
    },
)
```

### Campos Padrão

- `timestamp`: ISO 8601
- `level`: INFO, WARNING, ERROR, etc.
- `name`: Nome do logger (módulo)
- `message`: Mensagem do log
- `correlation_id`: Correlation ID da requisição

### Campos Adicionais

Logs podem incluir campos adicionais via `extra`:
- `duration_ms`: Duração em milissegundos
- `entity_id`: ID da entidade afetada
- `operation_id`: ID da operação
- `error`: Mensagem de erro
- `status_code`: HTTP status code

---

## Métricas

### Coletor de Métricas

**Localização:** `backend/src/core/metrics.py`

**Tipos:**
- **Counters**: Contadores incrementais (ex: `http_requests_total`)
- **Timers**: Medições de duração (ex: `http_request.get./v1/plans`)
- **Gauges**: Valores pontuais (ex: `active_connections`)

### Métricas Disponíveis

**HTTP Requests:**
- `http_requests_total`: Total de requests
- `http_requests_success`: Requests bem-sucedidos (2xx)
- `http_requests_error`: Requests com erro (4xx, 5xx)
- `http_request.{method}.{path}`: Timer por endpoint

**Outbox:**
- `outbox_events_delivered`: Eventos entregues
- `outbox_events_failed`: Eventos falhados
- `outbox_events_error`: Erros no processamento
- `outbox_dispatch`: Timer de dispatch

### Acesso às Métricas

**Endpoint:** `GET /v1/metrics`

**Resposta:**
```json
{
  "counters": {
    "http_requests_total": 1000,
    "http_requests_success": 950,
    "http_requests_error": 50
  },
  "timers": {
    "http_request.get./v1/plans": {
      "count": 100,
      "min_ms": 10.5,
      "max_ms": 250.0,
      "mean_ms": 45.2,
      "p50_ms": 42.0,
      "p95_ms": 120.0,
      "p99_ms": 200.0
    }
  },
  "gauges": {},
  "timestamp": "2026-02-05T12:00:00Z"
}
```

### Uso Programático

```python
from ...core.metrics import increment, timer_start, timer_stop, gauge_set

# Incrementar contador
increment("operation_count", value=1)

# Timer
timer_id = timer_start("operation_duration")
# ... operação ...
timer_stop(timer_id, "operation_duration")

# Gauge
gauge_set("active_connections", value=10)
```

---

## Tracing

### Correlation ID como Trace

O correlation_id serve como trace básico:

1. **Request inicial:** Frontend gera correlation_id
2. **Propagação:** Enviado em header `X-Correlation-ID`
3. **Backend:** Adicionado a todos os logs
4. **Workers:** Propagado para eventos do outbox
5. **Resposta:** Retornado em header `X-Correlation-ID`

### Rastreamento E2E

Para rastrear uma operação E2E:

1. Obter correlation_id do header da resposta ou do log
2. Buscar logs com `correlation_id=<id>`
3. Filtrar por `correlation_id` em audit_logs (se aplicável)

**Exemplo:**
```bash
# Buscar logs com correlation_id
grep "correlation_id.*abc-123" logs/app.log

# Buscar em audit_logs (SQL)
SELECT * FROM audit_logs WHERE correlation_id = 'abc-123';
```

---

## Instrumentação de Workers

### Outbox Dispatcher

**Localização:** `backend/src/workers/outbox_dispatcher.py`

**Métricas:**
- `outbox_events_delivered`: Eventos entregues com sucesso
- `outbox_events_failed`: Eventos falhados (retry)
- `outbox_events_error`: Erros no processamento
- `outbox_dispatch`: Timer de dispatch

**Logs:**
- Cada evento processado é logado com correlation_id
- Erros incluem outbox_id e correlation_id

### Learning Job

**Localização:** `backend/src/workers/learning_job.py`

**Logs:**
- Início e fim do job
- Policy ID e versão
- Número de estimativas calculadas

---

## SLOs e Métricas Críticas

### SLOs Definidos

**R-SLO-001 — Solver timeboxed (~30s)**
- Métrica: `solver_duration_ms` (timer)
- Gate: P95 < 30000ms

**R-PERF-001 — API response time**
- Métrica: `http_request.*` (timers)
- Gate: P95 < 1000ms para endpoints read-only

### Métricas Críticas

1. **Request Rate:** `http_requests_total` (counter)
2. **Error Rate:** `http_requests_error / http_requests_total`
3. **Latency:** P95/P99 dos timers `http_request.*`
4. **Outbox Throughput:** `outbox_events_delivered` (counter)
5. **Outbox Failure Rate:** `outbox_events_failed / outbox_events_total`

---

## Como Inspecionar

### 1. Logs em Tempo Real

```bash
# Logs estruturados (JSON)
tail -f logs/app.log | jq '.'

# Filtrar por correlation_id
tail -f logs/app.log | jq 'select(.correlation_id == "abc-123")'

# Filtrar por nível
tail -f logs/app.log | jq 'select(.level == "ERROR")'
```

### 2. Métricas

```bash
# Obter métricas via API
curl http://localhost:8000/v1/metrics | jq '.'

# Filtrar timers
curl http://localhost:8000/v1/metrics | jq '.timers'

# Filtrar contadores
curl http://localhost:8000/v1/metrics | jq '.counters'
```

### 3. Correlation ID no Frontend

- **Páginas de erro:** Correlation ID exibido automaticamente
- **Audit Trail:** Sempre visível em `AuditTrailViewer`
- **Console:** Logs incluem correlation_id em desenvolvimento

### 4. Audit Logs

```sql
-- Buscar por correlation_id
SELECT * FROM audit_logs 
WHERE correlation_id = 'abc-123' 
ORDER BY created_at;

-- Buscar por entidade
SELECT * FROM audit_logs 
WHERE entity_type = 'Plan' 
  AND entity_id = 'plan-uuid'
ORDER BY created_at;
```

---

## Integração com Sistemas Externos

### Prometheus (Futuro)

A implementação atual (v0) usa coletor em memória. Para produção:

1. Integrar com Prometheus client library
2. Expor endpoint `/metrics` em formato Prometheus
3. Configurar scraping no Prometheus

### Grafana (Futuro)

Dashboards podem ser criados usando:
- Logs estruturados (Loki)
- Métricas (Prometheus)
- Correlation IDs como traces

---

## Boas Práticas

1. **Sempre incluir correlation_id em logs críticos**
2. **Usar timers para operações assíncronas**
3. **Incrementar contadores em pontos de decisão**
4. **Não logar PII ou segredos**
5. **Usar níveis de log apropriados** (DEBUG, INFO, WARNING, ERROR)

---

## Referências

- **Contrato C-15:** Observability and Audit
- **SP-OBS-01:** Instrumentação completa
- **SP-BE-01:** Logging estruturado
- **SP-BE-16:** Outbox instrumentation
