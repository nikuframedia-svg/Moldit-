# Moldit Planner — Mold Production Scheduler

Scheduler de produção para fábricas de moldes de injeção.
Forked de INCOMPOLINHO (APS stamping factory scheduler).

## Status: Phase 3 (Greedy Scheduler)

Phase 1: Fork & cleanup (Incompol modules removed).
Phase 2: Moldit types, transform, guardian, config.
Phase 3: Greedy forward scheduler (dispatch, scoring, pipeline).

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

## Stubbed Modules (Phase 4+)

- `backend/cpo/optimizer.py` — optimize() → NotImplementedError
- `backend/scheduler/vns.py` — vns_polish() → NotImplementedError
- `backend/simulator/` — What-if simulation (stubbed pending optimizer)

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
