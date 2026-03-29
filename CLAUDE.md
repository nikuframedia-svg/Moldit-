# Moldit Planner — Mold Production Scheduler

Scheduler de produção para fábricas de moldes de injeção.
Forked de INCOMPOLINHO (APS stamping factory scheduler).

## Status: Phase 1 (Fork & Cleanup)

Incompol-specific modules removed (lot_sizing, tool_grouping, jit, ISOP parser).
Core scheduling infrastructure preserved but stubbed with NotImplementedError.
Moldit-specific logic to be implemented in Phase 2.

## Architecture

- `backend/` — Python backend (scheduler, optimizer, analytics, simulator, API)
- `frontend/` — React + TypeScript + Vite
- `config/factory.yaml` — Factory configuration (empty template)
- `tests/` — pytest suite

## Stack

Python 3.12+, FastAPI, OR-Tools (CP-SAT), openpyxl, jpype1/mpxj (MPP parser), React 19, TypeScript, Vite, Zustand

## Working Modules (Phase 1)

- `backend/scheduler/dispatch.py` — Machine assignment + sequencing
- `backend/scheduler/scoring.py` — KPI computation
- `backend/scheduler/types.py` — Data structures (Lot, Segment, ToolRun, ScheduleResult)
- `backend/guardian/` — Input/output validation
- `backend/simulator/` — What-if simulation (stubbed pending scheduler)
- `backend/cpo/population.py` — GA population management (MAP-Elites)
- `backend/cpo/surrogate.py` — Fast fitness approximation
- `backend/journal/` — Event journal
- `backend/audit/` — Audit logging
- `backend/risk/` — Monte Carlo simulation

## Stubbed Modules (Phase 2)

- `backend/scheduler/scheduler.py` — schedule_all() → NotImplementedError
- `backend/cpo/optimizer.py` — optimize() → NotImplementedError
- `backend/transform/transform.py` — transform() → NotImplementedError
- `backend/scheduler/vns.py` — vns_polish() → NotImplementedError

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
