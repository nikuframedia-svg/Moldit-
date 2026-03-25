# PP1 — Industrial APS Scheduler

Production planning scheduler for stamping factories.
Factory: Incompol (5 presses, 59 tools, ~94 SKUs, 14 clients).

## Run

```bash
python -m pytest tests/ -v
```

## Structure

- `backend/` — Scheduler, analytics, simulator, parser, transform
- `config/` — Factory master data (incompol.yaml)
- `tests/` — 86+ tests
