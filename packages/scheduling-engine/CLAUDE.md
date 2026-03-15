# INCOMPOL PLAN — System Rules (FROZEN)

**ALL rules in this file are IMMUTABLE.** Any AI agent, developer, or contributor
working on this codebase MUST follow these rules without exception. Breaking any
rule listed here WILL cause the `frozen-invariants.test.ts` tests to fail.

---

## 1. FROZEN CONSTANTS

These values are EXACT and must NEVER change without explicit project owner approval:

| Constant | Value | Meaning |
|----------|-------|---------|
| S0 | 420 | Shift X start (07:00) |
| T1 | 930 | Shift change X→Y (15:30) |
| TG_END | 960 | Turno geral end (16:00) |
| S1 | 1440 | Shift Y end (24:00) |
| S2 | 1860 | Shift Z end (07:00 next day = S1 + S0) |
| DAY_CAP | 1020 | Daily capacity 2 shifts (S1 - S0) |
| DEFAULT_OEE | 0.66 | Overall equipment effectiveness |
| DEFAULT_SCAP | 673 | Effective capacity (round(1020 * 0.66)) |
| BUCKET_WINDOW | 5 | Days for lot grouping |
| MAX_EDD_GAP | 5 | Max days for tool merge |
| MAX_AUTO_MOVES | 50 | Max auto-corrections per run |
| MAX_OVERFLOW_ITER | 3 | Overflow resolution iterations |
| ALT_UTIL_THRESHOLD | 0.95 | Alt machine utilization limit |
| MAX_ADVANCE_DAYS | Infinity | No limit on advance days |
| ADVANCE_UTIL_THRESHOLD | 0.95 | Advance target utilization |
| OTD_TOLERANCE | 1.0 | Deadline is hard (no tolerance) |
| LEVEL_LOW_THRESHOLD | 0.50 | Day is "light" |
| LEVEL_HIGH_THRESHOLD | 0.85 | Day is "heavy" |
| LEVEL_LOOKAHEAD | 15 | Days to look back for leveling |
| RISK_MEDIUM_THRESHOLD | 0.85 | Medium risk |
| RISK_HIGH_THRESHOLD | 0.95 | High risk |
| RISK_CRITICAL_THRESHOLD | 1.0 | Critical risk |
| DEFAULT_OVERTIME_MAX_PER_MACHINE | 450 | Max overtime min per machine/day |
| DEFAULT_OVERTIME_MAX_TOTAL | 2700 | Max overtime min total per day |
| SPLIT_MIN_FRACTION | 0.30 | Min fraction on original machine |
| SPLIT_MIN_DEFICIT | 60 | Min deficit to justify split (min) |
| DEFAULT_MO_CAPACITY | 99 | Sentinel for missing MO data |
| DEFAULT_SHIPPING_BUFFER_HOURS | 0 | No buffer between production and shipping |

### Known Focus Machines (6 exact)
`PRM019`, `PRM020`, `PRM031`, `PRM039`, `PRM042`, `PRM043`

---

## 2. HARD CONSTRAINTS (3) + SOFT CONSTRAINT (1)

### HARD (never violated):
1. **Setup Crew** — Only 1 setup at a time in the entire factory (exclusive)
2. **Tool Timeline** — A tool can only be on 1 machine at a time (same-machine reuse OK)
3. **Calco Timeline** — A calco can only be in 1 place at a time (NO same-machine exception — more restrictive than tool)

### SOFT (advisory only):
4. **Operator Pool** — Warns when capacity exceeded but NEVER blocks scheduling. The system always schedules and records `OPERATOR_CAPACITY_WARNING`.

**RULE: The operator pool must NEVER block or prevent scheduling. It is advisory only.**

---

## 3. PIPELINE ORDER (exact, 16 steps)

The scheduling pipeline in `scheduler.ts` executes in this EXACT order:

1. **twin_validation_recording** — Record twin anomalies into registry
2. **shipping_deadlines** — Compute shipping deadlines (when shippingCutoff active)
3. **work_content** — Compute work content (when shippingCutoff active)
4. **deficit_evolution** — Compute deficit evolution (when shippingCutoff active)
5. **backward_scheduling** — `computeEarliestStarts` (ALWAYS runs)
6. **scoring** — `scoreOperations` (when deterministic scoring active)
7. **demand_grouping** — `groupDemandIntoBuckets`
8. **sort_and_merge** — `sortAndMergeGroups` / `sortGroupsByScore`
9. **machine_ordering** — `orderMachinesByUrgency`
10. **slot_allocation** — `scheduleMachines` (Phase 2 — the core engine)
11. **load_leveling** — `levelLoad` (optional)
12. **block_merging** — `mergeConsecutiveBlocks`
13. **enforce_deadlines** — Convert overflow → infeasible with precise reason
14. **feasibility_report** — `finalizeFeasibilityReport`
15. **workforce_forecast_d1** — `computeWorkforceForecast` (when workforceConfig present)
16. **transparency_report** — `buildTransparencyReport` (when shippingCutoff active)

---

## 4. SLOT-ALLOCATOR VERIFICATION ORDER (7 checks)

Inside `slot-allocator.ts`, each block passes through these checks in this EXACT order:

1. **Setup Crew** — HARD, runs before production loop. Exclusive setup crew.
2. **Machine Capacity** — Shift boundaries / remaining time in current shift.
3. **Failure Timeline** — Avaria / capacity factor. 0.0 = skip entire shift.
4. **Operator Pool** — ADVISORY. Warns but NEVER blocks. R6 tiebreaker. R8 unmapped.
5. **Calco Timeline** — HARD. No same-machine exception.
6. **Tool Timeline** — HARD. Same-machine OK, other machines blocked.
7. **Shipping Cutoff** — HARD (when active). Trim or break at deadline.

---

## 5. DECISION TYPES (28 exact)

The system records exactly 28 decision types. No more, no less:

`BACKWARD_SCHEDULE`, `LOAD_LEVEL`, `OVERFLOW_ROUTE`, `ADVANCE_PRODUCTION`,
`DATA_MISSING`, `INFEASIBILITY_DECLARED`, `DEADLINE_CONSTRAINT`,
`OPERATOR_REALLOCATION`, `ALTERNATIVE_MACHINE`, `TOOL_DOWN`, `MACHINE_DOWN`,
`FAILURE_DETECTED`, `FAILURE_MITIGATION`, `FAILURE_UNRECOVERABLE`,
`SHIPPING_CUTOFF`, `PRODUCTION_START`, `CAPACITY_COMPUTATION`,
`SCORING_DECISION`, `OPERATOR_CAPACITY_WARNING`,
`AUTO_REPLAN_ADVANCE`, `AUTO_REPLAN_MOVE`, `AUTO_REPLAN_SPLIT`,
`AUTO_REPLAN_OVERTIME`, `AUTO_REPLAN_THIRD_SHIFT`,
`TWIN_VALIDATION_ANOMALY`, `WORKFORCE_FORECAST_D1`,
`WORKFORCE_COVERAGE_MISSING`, `LABOR_GROUP_UNMAPPED`

---

## 6. INFEASIBILITY REASONS (11 exact)

`SETUP_CREW_EXHAUSTED`, `OPERATOR_CAPACITY`, `TOOL_CONFLICT`,
`CALCO_CONFLICT`, `DEADLINE_VIOLATION`, `MACHINE_DOWN`,
`CAPACITY_OVERFLOW`, `DATA_MISSING`, `MACHINE_PARTIAL_DOWN`,
`TOOL_DOWN_TEMPORAL`, `SHIPPING_CUTOFF_VIOLATION`

---

## 7. REMEDIATION TYPES (7 exact)

`THIRD_SHIFT`, `EXTRA_OPERATORS`, `OVERTIME`, `SPLIT_OPERATION`,
`ADVANCE_PRODUCTION`, `TRANSFER_ALT_MACHINE`, `FORMAL_RISK_ACCEPTANCE`

---

## 8. START REASONS (6 exact)

`urgency_slack_critical`, `density_heavy_load`, `free_window_available`,
`setup_reduction`, `future_load_relief`, `deficit_elimination`

---

## 9. BLOCK TYPES (4 exact)

`ok`, `blocked`, `overflow`, `infeasible`

---

## 10. AUTO-REPLAN STRATEGY TYPES (5 exact)

`ADVANCE_PRODUCTION`, `MOVE_ALT_MACHINE`, `SPLIT_OPERATION`, `OVERTIME`, `THIRD_SHIFT`

### Default Strategy Order:
1. ADVANCE_PRODUCTION
2. MOVE_ALT_MACHINE
3. SPLIT_OPERATION
4. OVERTIME
5. THIRD_SHIFT

### Auto-Replan Defaults:
- `maxOuterRounds`: 5
- `maxTotalActions`: 50
- `maxIterations`: 150 (50 × 3)
- Overtime: 450 min/machine/day, 2700 min total/day
- Split: 30% min on original, 60 min min deficit

---

## 11. WORKFORCE MODEL

### Labor Groups:
| Group | Machines | Window 07:00-15:30 | Window 15:30-16:00 | Window 16:00-00:00 |
|-------|----------|--------------------|---------------------|---------------------|
| Grandes | PRM019, PRM031, PRM039, PRM043 | 6 operators | 6 operators | 5 operators |
| Medias | PRM042 | 9 operators | 8 operators | 4 operators |

### Special Rules:
- **PRM020 is NOT mapped** to any labor group (unmapped = no operator constraint, flagged R8)
- Peak model: MAX operators per block per machine, then SUM across machines in labor group
- Cross-window blocks: evaluated per segment, WORST result wins (R9)
- R6 tiebreaker: 1-step lookahead, max 2 attempts per SKU

---

## 12. SCORE WEIGHTS (frozen)

| Weight | Value |
|--------|-------|
| tardiness | 100.0 |
| setup_count | 10.0 |
| setup_time | 1.0 |
| setup_balance | 30.0 |
| churn | 5.0 |
| overflow | 50.0 |
| below_min_batch | 5.0 |

**Score = -Infinity when lostPcs > 0** (hard constraint: all demand must be met)

---

## 13. BEHAVIORAL RULES (IMMUTABLE)

1. **NEVER invent data** — Missing data is flagged as `DATA_MISSING`, never assumed
2. **Operations NEVER silently disappear** — Always overflow or infeasible, never dropped
3. **Supply boost OVERRIDES dispatch rules** — VIP priority
4. **Load leveling only moves BACKWARD** (earlier days), never forward
5. **MRP twin-aware**: `grossReq = max(A, B)`, NOT sum; `backlog = max(atrA, atrB)`
6. **3rd shift is GLOBAL activation** — all machines, not per-machine
7. **Calco is MORE restrictive than Tool** — no same-machine exception
8. **Setup crew is EXCLUSIVE** — 1 at a time in entire factory
9. **PRM020 is intentionally unmapped** from labor groups
10. **OTD-Delivery = 100% is MANDATORY** — at each demand day, cumProd ≥ cumDemand. Requires `orderBased: true` + `twinValidationReport` passed to `autoRouteOverflow`

---

## 14. CONSTRAINT CONFIG DEFAULTS

All 4 constraints default to mode `'hard'`:
- `setupCrew: { mode: 'hard' }`
- `toolTimeline: { mode: 'hard' }`
- `calcoTimeline: { mode: 'hard' }`
- `operatorPool: { mode: 'hard' }` — mode is 'hard' but BEHAVIOR is advisory (warns, never blocks)

---

## 15. REFERENCE

- Frozen rules module: `src/rules/frozen-rules.ts`
- Frozen invariant tests: `tests/frozen-invariants.test.ts`
- Constants: `src/constants.ts`
- Types: `src/types/decisions.ts`, `src/types/infeasibility.ts`, `src/types/transparency.ts`, `src/types/blocks.ts`
- Workforce: `src/types/workforce.ts`
- Constraints: `src/types/constraints.ts`
- Auto-replan config: `src/overflow/auto-replan-config.ts`
- Scheduler pipeline: `src/scheduler/scheduler.ts`
- Slot allocator: `src/scheduler/slot-allocator.ts`
- Score weights: `src/analysis/score-schedule.ts`
