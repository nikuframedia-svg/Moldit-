# claude-backend.md — ProdPlan PP1 Backend Reference

> OBRIGATÓRIO para todo o trabalho backend (.py).
> Para frontend, ver `claude-frontend.md`.
> Para dados mestres Nikufra, ver `claude-bdmestre.md`.
> Last verified: 2026-02-18

---

## 1. SOLVER: PLAN-MIN

### 1.1 Algorithm Overview

PLAN-MIN is a **deterministic heuristic solver** that:
1. **Derives WorkOrders** from snapshot demand/needs
2. **Assigns machines** (primary from routing, alternatives if capacity exceeded)
3. **Sequences by EDD** (Earliest Due Date) per machine with deterministic tie-breakers
4. **Generates operations** within shift boundaries, respecting all constraints
5. **Calculates KPIs** (tardiness, setup count, overtime, churn, etc.)

### 1.2 Objective Function

```
Z = 100 * tardiness
  + 10 * setup_count
  + 1 * setup_time
  + 10 * setup_balance_by_shift
  + 5 * churn
  + 50 * overtime
  + 5 * coil_fragmentation
```

**Weights** (configurable via `plan_params.objective_weights`):
| Component | Default Weight | Unit |
|-----------|---------------|------|
| tardiness | 100 | days late |
| setup_count | 10 | count |
| setup_time | 1 | minutes |
| setup_balance_by_shift | 10 | max-min imbalance |
| churn | 5 | ops moved |
| overtime | 50 | hours |
| coil_fragmentation | 5 | count |

**Default Costs** (for EUR valuation):
- `tardiness_eur_per_day`: EUR per day late
- `setup_eur_per_setup`: EUR per setup
- `setup_eur_per_minute`: EUR per setup minute
- `overtime_eur_per_hour`: EUR per overtime hour
- `churn_eur_per_moved_operation`: EUR per moved operation

### 1.3 Constraints

#### SetupCrew (SP-BE-10, C-06)
- **Capacity**: 1 (only one setup at a time across ALL machines)
- **Resource code**: `SETUPCREW`
- **Rule**: Setup operation is created when tool changes on a machine
- **No setup needed** when consecutive operations use the same tool on the same machine
- Uses `SetupCrewTimeline` to track bookings and find available slots

#### Operator Capacity (SP-BE-11)
- **Model**: Bucket per shift (v1)
- **Pools**: Operator pools mapped to shifts (X, Y)
- **Rule**: Sum of `operators_required` in a shift cannot exceed pool capacity
- **Fallback**: If capacity not defined, assumes infinite (prototype mode)
- Uses `OperatorCapacityTracker` with `(date, shift_code, pool_code)` keys

#### Calco (SP-BE-13, C-16)
- **Capacity**: 1 per calco (not simultaneous)
- **Rule**: A calco (die/tooling) is shared between machines; only one machine can use a given calco at a time
- **Mapping**: tool_code → calco_id (via `CalcoService`)
- Uses `CalcoTimeline` to prevent overlap

#### Material (SP-BE-13, C-16)
- **Rule**: Production requires materials; consumption = `consumption_rate * production_qty`
- **Availability**: stock (lots) + scheduled arrivals
- **Fallback**: If no material service, assumes infinite availability (prototype)
- Uses `MaterialAvailabilityTracker`

### 1.4 Calendar & Shifts

- **Timezone**: `Europe/Lisbon` (IANA)
- **Shift X**: 06:00 — 14:00 (morning)
- **Shift Y**: 14:00 — 22:00 (afternoon)
- **OFF**: 22:00 — 06:00 (no production)
- Operations must not cross shift boundaries
- Calendar supports working/non-working days

### 1.5 ExplainTrace

Every plan includes an `explain_trace` for transparency:
- Per-workorder: selected machine, alternative machines considered, reason
- Per-operation: binding constraints, delay reasons, evidence refs
- Objective breakdown: contribution of each component to total cost

### 1.6 KPIPack

```typescript
interface KPIPack {
  tardiness_total_days: number      // Sum of days late across all workorders
  setup_count_total: number         // Total number of setup operations
  setup_count_by_shift?: Record<string, number>  // Setups per shift (X, Y)
  setup_balance_penalty?: number    // max(shift_counts) - min(shift_counts)
  overtime_hours?: number           // Hours outside shift boundaries
  churn_ops_moved?: number          // Operations moved vs previous plan
  load_by_machine_day?: Record<string, Record<string, number>>  // Utilization
}
```

---

## 2. LEARNING LOOP

### 2.1 Suggestion Generation

The system generates suggestions by analyzing plan KPIs and identifying optimization opportunities:
- Tool grouping changes to reduce setups
- Overtime addition to reduce tardiness
- Order moves between machines
- Weight adjustments for objective function
- Machine reassignment for better load balancing

### 2.2 Impact Estimation

**Methods**:
- `NAIVE_DIFFERENCE` — Simple before/after KPI comparison
- `DiD` (Difference-in-Differences) — Causal estimation
- `MATCHED` — Matched comparison groups

**ImpactCase** (predicted): baseline_kpis, scenario_kpis, expected_value_eur, confidence
**ImpactResult** (measured): measured_kpis, measured_value_eur, method, confidence

### 2.3 Bandit Policy

Uses Thompson Sampling to rank suggestion types by expected value:
- Each suggestion type is an "arm"
- Reward = measured impact in EUR
- Policy updates on accept/implement feedback
- Stored in `learning_policies` table with `state_json` (JSONB)

---

## 3. API ENDPOINTS

All endpoints prefixed with `/v1/`.

### Snapshots
| Method | Path | Description |
|--------|------|-------------|
| POST | `/snapshots/import` | Import XLSX, create snapshot |
| POST | `/snapshots/{id}/seal` | Seal snapshot (make immutable) |
| GET | `/snapshots` | List snapshots |
| GET | `/snapshots/{id}` | Get snapshot by ID |

### Plans
| Method | Path | Description |
|--------|------|-------------|
| POST | `/plan/run` | Run solver synchronously |
| POST | `/plan/{id}/commit` | Commit plan (CANDIDATE → OFFICIAL) |
| GET | `/plans` | List plans (filter by snapshot_id) |
| GET | `/plans/{id}` | Get plan by ID |

### Plan Jobs (Async)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/plan-jobs/run` | Run solver asynchronously (returns job_id) |
| GET | `/plan-jobs/jobs/{id}` | Get job status |
| GET | `/plan-jobs/jobs` | List all jobs |
| DELETE | `/plan-jobs/jobs/{id}` | Cancel job |

### Scenarios
| Method | Path | Description |
|--------|------|-------------|
| POST | `/scenarios` | Create scenario |
| POST | `/scenarios/{id}/run` | Run scenario |
| GET | `/scenarios` | List scenarios |
| GET | `/scenarios/{id}` | Get scenario with diff |

### PRs
| Method | Path | Description |
|--------|------|-------------|
| POST | `/prs` | Create PR |
| POST | `/prs/{id}/approve` | Approve PR |
| POST | `/prs/{id}/merge` | Merge PR |
| POST | `/prs/{id}/reject` | Reject PR |
| POST | `/prs/{id}/rollback` | Rollback PR |
| GET | `/prs` | List PRs |
| GET | `/prs/{id}` | Get PR by ID |

### Suggestions
| Method | Path | Description |
|--------|------|-------------|
| POST | `/suggestions` | Create suggestion from scenario |
| POST | `/suggestions/{id}/accept` | Accept suggestion |
| GET | `/suggestions` | List suggestions (filter: status, type) |
| GET | `/suggestions/{id}` | Get suggestion by ID |
| GET | `/suggestions/{id}/impact` | Get impact analysis |

### Events
| Method | Path | Description |
|--------|------|-------------|
| POST | `/events` | Create event |
| GET | `/events` | List events |
| GET | `/events/{id}` | Get event by ID |

### Audit
| Method | Path | Description |
|--------|------|-------------|
| GET | `/audit` | List audit entries (filters: entity_type, action, actor, date range) |
| GET | `/audit/{id}` | Get audit entry |
| GET | `/audit/search` | Search audit log |
| GET | `/audit/correlation/{id}` | Get entries by correlation ID |
| GET | `/audit/entity/{type}/{id}` | Get entries for entity |
| GET | `/audit/stats` | Get audit statistics |

### Calendars & Capacity & Materials
| Method | Path | Description |
|--------|------|-------------|
| GET | `/calendars` | List calendars |
| GET | `/calendars/{id}` | Get calendar |
| GET | `/capacity/pools` | List operator pools |
| PUT | `/capacity/pools/{id}` | Set pool capacity for date/shift |
| GET | `/materials` | List materials |
| POST | `/materials` | Create material |

### Other
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/version` | API version |
| GET | `/metrics` | Prometheus-style metrics |
| GET | `/explain/{plan_id}` | Get explain trace for plan |
| POST | `/copilot/query` | Natural language query |
| POST | `/copilot/draft-pr` | AI-assisted PR draft |
| GET | `/learning/policy` | Get learning policy |
| GET | `/learning/impact-report` | Get impact report |
| GET | `/learning/ranking` | Get suggestion ranking |
| GET | `/outbox` | List outbox entries |

---

## 4. DATABASE MODELS

### snapshots
| Column | Type | Notes |
|--------|------|-------|
| snapshot_id | UUID PK | |
| tenant_id | UUID | Multi-tenant support |
| snapshot_hash | VARCHAR(64) | SHA-256, unique, indexed |
| series_semantics | ENUM | See SeriesSemantics |
| setup_time_uom | VARCHAR(20) | HOURS/MINUTES/SECONDS |
| mo_uom | VARCHAR(20) | HOURS/FTE/OPERATORS |
| trust_index_overall | NUMERIC(3,2) | 0.00 to 1.00 |
| sealed_at | TIMESTAMP | NULL = not sealed |
| snapshot_json | JSONB | Full canonical snapshot |
| created_at | TIMESTAMP | |

**Related**: snapshot_sources, items, resources, tools, routings → routing_operations

### plans
| Column | Type | Notes |
|--------|------|-------|
| plan_id | UUID PK | |
| snapshot_id | UUID FK → snapshots | |
| snapshot_hash | VARCHAR(64) | |
| plan_hash | VARCHAR(64) | Unique, deterministic |
| status | ENUM | CANDIDATE, OFFICIAL |
| plan_params | JSONB | Solver parameters |
| plan_json | JSONB | Full plan data |
| kpi_pack | JSONB | KPI results |
| explain_trace | JSONB | Solver explanations |
| created_at | TIMESTAMP | |

**Related**: workorders, plan_operations

### prs
| Column | Type | Notes |
|--------|------|-------|
| pr_id | UUID PK | |
| status | ENUM | DRAFT/OPEN/APPROVED/MERGED/REJECTED/ROLLED_BACK |
| author | VARCHAR(255) | |
| scenario_id | UUID FK → scenarios | Optional |
| baseline_plan_id | UUID FK → plans | |
| candidate_plan_id | UUID FK → plans | |
| created_at, merged_at, rolled_back_at | TIMESTAMP | |

**Related**: pr_approvals (approval_id, pr_id, approver_id, approved_at, comment)

### scenarios
| Column | Type | Notes |
|--------|------|-------|
| scenario_id | UUID PK | |
| name | VARCHAR(255) | |
| baseline_plan_id | UUID FK → plans | |
| patch | JSONB | Mutations to apply |
| created_at | TIMESTAMP | |

**Related**: scenario_runs → scenario_diffs

### suggestions
| Column | Type | Notes |
|--------|------|-------|
| suggestion_id | UUID PK | |
| type | ENUM | See SuggestionType |
| status | ENUM | OPEN/ACCEPTED/REJECTED |
| created_from_scenario_id | UUID FK | |
| created_from_plan_id | UUID FK | |
| recommended_action_structured | JSONB | |
| created_at, accepted_at | TIMESTAMP | |

**Related**: impact_cases, impact_results

### audit_log
| Column | Type | Notes |
|--------|------|-------|
| audit_id | UUID PK | |
| timestamp | TIMESTAMP | Indexed |
| actor | VARCHAR(255) | Indexed |
| action | VARCHAR(100) | Indexed |
| correlation_id | UUID | Indexed |
| entity_type | VARCHAR(50) | Indexed |
| entity_id | VARCHAR(255) | Indexed |
| before, after | JSONB | State snapshots |
| audit_metadata | JSONB | |

### Other Tables
- **learning_policies**: Bandit policy state (Thompson Sampling)
- **impact_estimates**: Per-suggestion-type impact statistics
- **integration_outbox**: Outbox pattern (PENDING → PROCESSING → DELIVERED → DLQ)
- **operator_pools**: Pool capacity per date/shift
- **materials, material_lots, material_arrivals**: Material tracking
- **calcos**: Calco (die/tooling) capacity tracking
- **calendars, shift_templates**: Shift definitions (X, Y)
- **run_events**: Production events

---

## 5. REPLAN WORKFLOW

### 5.1 High-Level Flow

```
1. Event occurs (MachineDown, OperatorAbsent, etc.)
2. User adds event via UI
3. Event stored in useReplanStore (events[])
4. User clicks "Simulate Impact"
   a. Events sent to backend (POST /events)
   b. Scenario created (POST /scenarios)
   c. Solver runs on scenario (POST /scenarios/{id}/run)
   d. Diff computed (baseline vs candidate)
   e. Preview operations loaded into store
5. GanttChart shows preview overlay
6. User clicks "Apply Plan"
   a. PR created (baseline → candidate)
   b. PR approved + merged (candidate becomes OFFICIAL)
7. Gantt refreshes with new official plan
```

### 5.2 useReplanStore State

```typescript
interface ReplanState {
  events: ReplanEvent[]
  previewOperations: PlanOperation[]
  blockages: BlockageZone[]
  isPreviewMode: boolean
  isSimulating: boolean
  simulationError: string | null
  currentScenarioId: string | null
  resultPlanId: string | null
  kpiDelta: Partial<KPIPack> | null
}
```

### 5.3 Simulation Flow (simulateEvents)

```
1. Create events in backend (POST /events for each event)
2. Look up baseline plan operations (getPlan → operations[])
3. Find affected operations on blocked resources (blocking events only)
4. Build move_operations[] with actual operation_ids (to_resource: 'AUTO_ASSIGN')
5. Handle URGENT_ORDER/RUSH_ORDER via parameter_changes: { priority_boost: true }
6. Create scenario (POST /scenarios with baseline_plan_id + diff)
7. Run scenario (POST /scenarios/{id}/run → result_plan_id + kpi_delta)
8. Load result plan operations for Gantt preview
```

**Key**: Step 2-3 uses REAL baseline plan operations (not synthetic IDs). The store calls `dataSource.getPlan(baselinePlanId)` to get actual operations, then filters by `resource_code` to find which operations are affected by blocking events.

---

## 6. BACKEND DIRECTORY STRUCTURE

```
backend/src/
  api/v1/            → FastAPI routers (22 endpoint files)
  core/              → Config, errors, exception_handler, logging, metrics, middleware
  db/                → SQLAlchemy base, Alembic migrations (10 versions)
  domain/
    ├── models/      → SQLAlchemy models
    ├── solver/      → PLAN-MIN solver + constraints
    ├── planning/    → NikufraScheduler (deterministic EDD, shift-aware)
    ├── snapshot/    → Snapshot service, repository, hash computation
    ├── plan/        → Plan service, repository, job service
    ├── sandbox/     → Scenario sandbox (diff_calculator, patch_applier)
    ├── improve/     → PR service and repository
    ├── suggestions/ → Suggestion service and repository
    ├── run_events/  → Event processing (event_applier)
    ├── calendar/    → Calendar service, models (shifts X/Y)
    ├── capacity/    → Operator pool capacity service
    ├── materials/   → Material & calco service
    ├── ingest/      → ISOP XLSX parser
    ├── dqa/         → Data Quality Assessment (TrustIndex)
    ├── explain/     → ExplainTrace builder
    ├── learning/    → Bandit policy (Thompson Sampling)
    ├── copilot/     → RAG + LLM copilot service
    └── integration/ → Outbox pattern for external integration
  workers/           → Background workers
```

---

## 7. TESTING

- **Framework**: pytest
- **Run**: `cd backend && pytest`
- **Location**: `tests/`
- **Note**: `pythonjsonlogger` not installed locally — only planning tests (`test_planning_engine.py`) run cleanly
- Two parallel solver stacks: `domain/solver/` vs `domain/planning/` — intentional, consolidation deferred

---

## 8. KEY CONVENTIONS

- Pydantic V2: use `model_config = {"extra": "allow"}` NOT `class Config`
- Backend path: `backend/src/` (NOT `backend/app/`)
- numpy/scipy available for vectorized computations
- Timezone: always `Europe/Lisbon`
- All mutating endpoints require `Idempotency-Key` header
- All endpoints require `X-Correlation-ID` header
