# Moldit Planner — Mold Production Scheduler

Scheduler de produção para fábricas de moldes de injeção.
Forked de INCOMPOLINHO (APS stamping factory scheduler).

## Status: Phase 7 (Production Cockpit + Copilot)

Phase 1: Fork & cleanup (Incompol modules removed).
Phase 2: Moldit types, transform, guardian, config.
Phase 3: Greedy forward scheduler (dispatch, scoring, pipeline).
Phase 4: CPO optimizer, VNS, simulator, risk, analytics (CTP, late delivery, replan).
Phase 5: Eliminated all Incompol references. New Moldit API endpoints. Rewrote presets, coverage audit, trust index, console modules.
Phase 6: Testing & quality. Upload integration, Playwright scaffold, data-testid attributes.
Phase 7: Frontend cockpit for factory director. 9 pages rewritten for non-technical user. Copilot with Anthropic Claude. Auto-assignment of machines via inferred compatibility. All text in Portuguese.

## Architecture

- `backend/` — Python backend (scheduler, optimizer, analytics, simulator, API, copilot)
- `frontend/` — React + TypeScript + Vite (9 pages, dark theme, PT-only)
- `config/factory.yaml` — Factory configuration
- `tests/` — pytest suite

## Stack

Python 3.12+, FastAPI, OR-Tools (CP-SAT), openpyxl, jpype1/mpxj (MPP parser), Anthropic SDK (copilot), React 19, TypeScript, Vite, Zustand

## Key Backend Modules

### Scheduler (`backend/scheduler/`)
- `dispatch.py` — Priority queue (ATCS), machine assignment (least-loaded), timeline dispatch (shift-aware)
- `scoring.py` — KPI computation (makespan, compliance, utilization, balance, weighted score)
- `scheduler.py` — schedule_all() pipeline (validate → prioritize → assign → dispatch → score → VNS)
- `vns.py` — VNS post-processing (4 neighbourhoods)
- `stress.py` — Per-machine stress analysis

### Transform (`backend/transform/`)
- `transform.py` — MPP parser + enrichment + auto-compatibility inference
  - `_infer_compatibility()` — Learns machine compatibility from existing op→machine assignments
  - `_apply_progress()` — Recalculates work_restante_h; uses duracao_h as fallback when work_h=0

### Analytics (`backend/analytics/`)
- `ctp.py` — CTP per molde (compute_ctp_molde)
- `late_delivery.py` — Late delivery root cause (capacity/dependency/setup/priority)
- `replan_proposals.py` — Replan proposals (move_to_alt, extend_regime, resequence)
- `coverage_audit.py` — Coverage audit (ops agendadas vs total, ops_sem_maquina)

### Alerts (`backend/alerts/`)
- `engine.py` — AlertEngine with 6 rules (R1-R3, R7-R9)
- `store.py` — SQLite persistence + lifecycle (ativo → reconhecido → resolvido/ignorado)

### Copilot (`backend/copilot/`)
- `llm_provider.py` — OpenAI, Anthropic (Claude), Ollama providers
- `tools.py` — 44 tools for LLM function calling
- `engine.py` — Tool executor
- `prompts.py` — System prompt builder

### ML (`backend/ml/`)
- 5 models: M1 duration, M2 risk, M3 analogy, M4 machine ranking, M5 anomaly detection

### Explain (`backend/explain/`)
- Portuguese phrase generator for every UI number (O QUÊ + PORQUÊ + IMPACTO + ACÇÃO)

## API Endpoints (79 total)

### Core Data (`/api/data/`)
- GET /score, /segments, /moldes, /moldes/{id}, /timeline, /bottlenecks
- GET /stress, /deadlines, /ops, /coverage, /late, /risk, /trust
- GET /config, /holidays, /rules, /journal, /learning, /today
- GET /proposals — replan proposals from analytics engine
- POST /load — upload .mpp, transform, schedule
- POST /simulate, /simulate-apply, /revert, /ctp, /recalculate
- PUT /config, /machines/{mid}
- POST /holidays, DELETE /holidays/{date}
- POST /presets/{name}

### Alerts (`/api/alerts/`)
- GET / — list alerts (trailing slash required)
- GET /stats, /{id}
- PUT /{id}/acknowledge, /{id}/resolve, /{id}/ignore
- POST /evaluate

### Other
- GET/POST /api/copilot/chat, /health
- GET /api/explain/inicio, /molde/{id}, /equipa
- GET /api/ml/status, /evolution, /predict/*, /anomalies, /ranking/*
- POST /api/ml/train, /bootstrap, /feedback/analogy
- GET /api/reports/preview, /daily, /weekly, /client
- GET /api/workforce/operadores, /gaps, /conflicts, /forecast
- GET /api/explorer/moldes/{id}, /operacoes/{id}/*

## Frontend Pages (9)

1. **ConsolaPage** — Banner Explain, coverage warning, mold table (op names not numbers), AlertEngine alerts with resolve/ignore, anomalies, proposals, top 10 machines
2. **ProducaoPage** — Gantt with color legend per mold, unscheduled ops section
3. **MoldesPage** — Tabs with client names, pipeline visual (sequence of ops by state), MoldGantt, OpTable, action buttons above scroll
4. **RiscoPage** — Coverage at TOP, health score with caveat, heatmap (machine_id/day_idx/utilization), late deliveries with root cause
5. **SimuladorPage** — 8 mutation types with adaptive form, human-readable results, CTP with week-to-date conversion, simulate-apply + revert
6. **EquipaPage** — Empty state handling, competency gaps, zone blocks, conflicts
7. **AlertasPage** — Grouped by rule, expandable, severity filter, action buttons
8. **RegrasPage** — All scheduler params with real values: shifts, groups, weights (visual bars), presets, VNS, OEE
9. **ConfigPage2** — 9 tabs: Maquinas, Feriados, Turnos, Operadores, Presets, Pesos, Aprendizagem, Relatorios, Journal

## Key Fixes & Decisions

### Auto-assignment (Phase 7)
- `_infer_compatibility()` learns compat map from ops that already have machines assigned
- `_apply_progress()` uses duracao_h when work_h=0 (common in .mpp files)
- Safety: 1h minimum when both work_h and duracao_h are 0
- Result: coverage 48%→62%, lost ops 80→0 (with Template_para_teste_Moldit.mpp)

### Simulate endpoint
- `data_sim.py` uses `result.segments` (not `result.segmentos`)
- Summary joined as string: `"\n".join(result.summary)`
- simulate-apply converts SimulateResponse to ScheduleResult before update_schedule
- ValueError/KeyError caught and returned as HTTP 400

### Type alignment
- Backend ops return `op_id` (not `id`)
- `conclusao_prevista` populated for on-time molds via makespan_por_molde
- `ExplainInicio.frase_resumo` is `{text, color}` object
- `RiskResult.heatmap` uses `HeatmapCell` (machine_id, day_idx, utilization)
- `DeltaReport` has no `summary` field (summary is on SimulateResponse)
- `DeadlineStatus.conclusao_prevista` is string, not number
- Alerts endpoint requires trailing slash: `/api/alerts/`

### Copilot
- Anthropic Claude provider via `MOLDIT_LLM_BACKEND=anthropic`
- 44 tools, 8 max iterations, 120s timeout
- System messages from frontend concatenated to system prompt

## Testing

### Backend
```bash
python -m pytest tests/ -v --tb=short
ruff check backend/ tests/ scripts/
```

### Frontend
```bash
cd frontend && npm run build
```

### Full system test
```bash
# Start backend
uvicorn backend.api.copilot:app --host 0.0.0.0 --port 8000

# Upload test file
curl -X POST -F "file=@Template_para_teste_Moldit.mpp" http://localhost:8000/api/data/load

# Start frontend
cd frontend && npm run dev
```

## Commands

```bash
python -m pytest tests/ -v --tb=short
ruff check backend/ tests/ scripts/
cd frontend && npm run build
```

## Moldit Domain (Reference)

- 7 moldes, 548 operações reais, ~7.500h work total
- 443 dependências FS (1 cross-mold)
- 51 máquinas em 22 grupos (CNC, EDM, Furação, Bancada, Polimento, Tapagem, Externo, etc.)
- Regimes: CNC 16h, Manual 8h, Externo lead-time
- 2ª Placa (//): paralelismo na mesma máquina CNC
- Input: .mpp via MPXJ (Java bridge)
- Turnos: Manhã 07:00-15:30, Tarde 15:30-24:00
- 14 feriados configurados
