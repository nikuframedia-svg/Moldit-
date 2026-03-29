# Moldit Planner — Mold Production Scheduler

Scheduler de produção para fábricas de moldes de injeção.
Forked de INCOMPOLINHO (APS stamping factory scheduler).

## Status: Phase 6 (Testing & Quality)

Phase 1: Fork & cleanup (Incompol modules removed).
Phase 2: Moldit types, transform, guardian, config.
Phase 3: Greedy forward scheduler (dispatch, scoring, pipeline).
Phase 4: CPO optimizer, VNS, simulator, risk, analytics (CTP, late delivery, replan).
Phase 5: Eliminated all Incompol references (.sku, .pH, .sH, .eco_lot, .oee). New Moldit API endpoints (/moldes, /timeline, /bottlenecks). Rewrote presets, coverage audit, trust index, console modules.
Phase 6: Added python-multipart dep, fixed transform_mpp->transform import in upload endpoint, .mpp validation + error handling, aligned LoadResponse types, data-testid attributes, test fixture script, upload integration tests, Playwright config + e2e scaffold.

## Architecture

- `backend/` — Python backend (scheduler, optimizer, analytics, simulator, API)
- `frontend/` — React + TypeScript + Vite
- `config/factory.yaml` — Factory configuration (empty template)
- `tests/` — pytest suite

## Stack

Python 3.12+, FastAPI, OR-Tools (CP-SAT), openpyxl, jpype1/mpxj (MPP parser), React 19, TypeScript, Vite, Zustand

## Working Modules (Phase 3)

- `backend/scheduler/dispatch.py` — Priority queue, machine assignment, timeline dispatch
- `backend/scheduler/scoring.py` — KPI computation (makespan, compliance, utilization, balance)
- `backend/scheduler/scheduler.py` — schedule_all() pipeline (validate → prioritize → assign → dispatch → score)
- `backend/scheduler/stress.py` — Per-machine stress analysis
- `backend/scheduler/types.py` — SegmentoMoldit, ScheduleResult, OperatorAlert
- `backend/guardian/` — Input/output validation
- `backend/transform/transform.py` — MPP parser + enrichment
- `backend/config/` — Factory YAML loader + types

## API Endpoints (Phase 5)

- GET /api/data/moldes — list molds with progress, deadline
- GET /api/data/moldes/{molde_id} — operations, segments, critical path for a mold
- GET /api/data/timeline — segments grouped by machine/day for Gantt
- GET /api/data/bottlenecks — top 5 machines by stress
- POST /api/data/load — upload .mpp, transform, schedule, respond
- POST /api/data/ctp — CTP per molde (molde_id + target_week)
- Config presets: rapido, equilibrado, min_setups, balanceado

## Working Modules (Phase 4)

- `backend/cpo/chromosome.py` — MolditChromosome (4 genes: machine_choice, sequence_keys, mold_priority, setup_aversion)
- `backend/cpo/optimizer.py` — optimize() with GA loop (quick/normal/deep/max modes)
- `backend/cpo/cached_pipeline.py` — CachedPipeline (hash-based eval caching)
- `backend/cpo/population.py` — FRRMAB, MAPElites, OneFifthRule, tournament_select
- `backend/cpo/surrogate.py` — SurrogateModel (RandomForest pre-screening)
- `backend/cpo/cpsat_polish.py` — cpsat_polish() pass-through stub
- `backend/scheduler/vns.py` — VNS post-processing (4 neighbourhoods)
- `backend/simulator/mutations.py` — 8 mutation handlers (machine_down, overtime, deadline_change, priority_boost, add/remove_holiday, force_machine, op_done)
- `backend/simulator/simulator.py` — simulate() what-if with DeltaReport
- `backend/risk/monte_carlo.py` — Monte Carlo risk (LHS, work_h + setup_h perturbation)
- `backend/analytics/ctp.py` — CTP per molde (compute_ctp_molde)
- `backend/analytics/late_delivery.py` — Late delivery root cause analysis
- `backend/analytics/replan_proposals.py` — Replan proposals (move_to_alt, extend_regime, resequence)

## Testing

### Backend
```bash
python -m pytest tests/ -v --tb=short
ruff check backend/ tests/ scripts/
```

### Test fixture
```bash
python scripts/create_test_fixture.py          # generates data/test_fixture.mpp
python -m pytest tests/test_upload_flow.py -v   # upload integration test
```

### Frontend E2E (Playwright)
```bash
cd frontend && npx playwright test
```

## data-testid Attributes

- `upload-zone` — UploadZone drop area
- `nav-{id}` — Sidebar nav buttons (console, gantt, deadlines, risk, sim, config, journal)
- `kpi-strip`, `kpi-makespan`, `kpi-compliance`, `kpi-setups`, `kpi-balance` — ConsolePage KPIs
- `gantt-container` — GanttPage root
- `btn-add-mutation`, `btn-simulate`, `btn-ctp` — SimulatorPage buttons

## Commands

```bash
python -m pytest tests/ -v --tb=short
ruff check backend/ tests/ scripts/
```

## Moldit Domain (Reference)

- 7 moldes, 548 operações reais, 7.501h work total
- 443 dependências FS (1 cross-mold), 124 pares compatibilidade
- 30+ máquinas em 7 grupos (CNC, EDM, Furação, Bancada, Polimento, Tapagem, Externo)
- Regimes: CNC 16h/24h, Manual 8h, Externo lead-time
- 2ª Placa (//): paralelismo na mesma máquina CNC
- Input: .mpp via MPXJ (Java bridge)
