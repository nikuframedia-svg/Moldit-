# NikufraEngine.tsx — Deep Analysis

> Generated from Contrato B1 analysis of `apps/frontend/src/features/planning/NikufraEngine.tsx` (7888 lines)

---

## File Structure

| Section | Lines | Component |
|---------|-------|-----------|
| Imports + Constants | 1-161 | -- |
| UI Atoms (Pill, Tag, Metric, Card) | 162-277 | 4 micro-components |
| OpDetailPanel | 278-658 | Side panel detail operation |
| ValidationPanel | 660-826 | Violations panel (collapsible) |
| GanttView | 828-1484 | Day-by-day Gantt timeline |
| Decision constants | 1486-1584 | DECISION_CATEGORIES, labels, colors |
| PlanView | 1586-2705 | Plan view (KPIs, coverage, decisions) |
| ReplanView | 2707-5324 | Replanning (auto-replan, failures, opt) |
| WhatIfView | 5326-7170 | Monte Carlo + scenarios |
| **NikufraEngine** (main) | 7172-7888 | Main exported component |

---

## CLUSTER 1: GANTT (timeline, zoom, scroll, blocks)

**Component**: `GanttView` (L828-1484, 656 lines)

### useState (5)

| Name | Type | Initial | Consumers |
|------|------|---------|-----------|
| `hov` | `string \| null` | null | Block hover tooltip, z-index |
| `selDay` | `number` | 1st working day | Day strip pills, block filter, OpDetailPanel |
| `selM` | `string \| null` | null | Machine filter pills, activeM filter |
| `zoom` | `number` | 1 | ppm calc (1.2*zoom), totalW, zoom pills |
| `selOp` | `string \| null` | null | Block selection border, OpDetailPanel open/close |

### useMemo (6)

| Deps | Output |
|------|--------|
| `data.workdays` | `wdi` -- working day indices |
| `blocks, selOp, selDay` | `selBlock` -- selected block object |
| `blocks, selDay` | `dayB` -- blocks for selected day |
| `blocks, selDay` | `dayBlkN` -- blocked ops count |
| `blocks, selDay, selM, mSt, machines` | `activeM` -- active machines |
| `validation` | `violationsByDay` -- violations per day |

### useEffect: 0

### Handlers

- `setSelDay(i)` -- day pill click
- `setSelM(id/null)` -- machine filter toggle
- `setZoom(z)` -- zoom level
- `setSelOp(id/null)` -- block click toggle
- `setHov(key/null)` -- hover

### JSX consumes

- Props: `blocks`, `mSt`, `cap`, `data`, `applyMove`, `undoMove`, `validation`
- Sub-components: `ValidationPanel`, `OpDetailPanel`
- Constants: `S0`, `T1`, `S1`, `DAY_CAP`, `C`, `TC`, `tci`
- Shift overlays (T.X/T.Y), hour grid, tool legend, utilization bar

### OpDetailPanel (L278-658, 380 lines)

- Props only (no hooks): `block`, `tool`, `op`, `dayLoad`, `dnames`, `selDay`, `machines`, `mSt`, `tools`
- Handlers: `onMove`, `onUndo`, `onClose`
- Shows: production details, twin co-production, setup, stock/backlog, weekly barchart, machine utilization, actions

---

## CLUSTER 2: FILTERS (machine, tool, period, client)

Distributed across several components (not isolated):

| Component | Filter states |
|-----------|--------------|
| GanttView | `selDay`, `selM`, `zoom` |
| ReplanView | `arDayFrom`/`arDayTo`, `arExclude`, `editingDown`, `downStartDay`/`downEndDay` |
| WhatIfView | `editingDown`, `wiDownStartDay`/`wiDownEndDay`, `dispatchRule`, `objProfile` |

Total: ~14 useState distributed. 0 useEffect dedicated. No external store.

---

## CLUSTER 3: VALIDATION (constraints, infeasibility)

### ValidationPanel (L660-826, 166 lines)

**useState (1)**: `expanded` (boolean, false) -- toggle violations list

**JSX**: Zero violations -> green badge. With violations -> collapsible card, severity-sorted, with action buttons.

### NikufraEngine (main) -- validation useMemos

| useMemo | Deps | Output |
|---------|------|--------|
| `validation` | `blocks, engineData, allOps` | `validateSchedule()` -> ScheduleValidationReport |
| `feasibility` | `blocks, engineData` | FeasibilitySummary (ok/infeasible count, score) |

PlanView consumes `feasibility` -> circular score badge, deadline warning.

---

## CLUSTER 4: WHAT-IF (scenarios, Monte Carlo)

**Component**: `WhatIfView` (L5326-7170, 1844 lines)

### useState (14)

| Name | Type | Initial | Usage |
|------|------|---------|-------|
| `sc` | `{t1,p1,t2,p2,seed}` | {6,2,8,3,42} | Operator config |
| `N` | `number` | 300 | Iterations |
| `dispatchRule` | `DispatchRule` | 'EDD' | Heuristic |
| `objProfile` | `string` | 'balanced' | Objective |
| `res` | `{top3, moveable} \| null` | null | Results |
| `run` | `boolean` | false | Loading |
| `prog` | `number` | 0 | Progress |
| `editingDown` | `{type, id} \| null` | null | Down editor |
| `wiDownStartDay` | `number` | wdi[0] | Down start |
| `wiDownEndDay` | `number` | wdi[0] | Down end |
| `sel` | `number` | 0 | Selected result |
| `showHistory` | `boolean` | false | Version history |
| `showCompare` | `boolean` | false | Plan comparison |
| `diffPair` | `[string,string] \| null` | null | Diff pair |

### useMemo (2): `wdiWI`, `qvWI`

### useCallback (1): `optimize` -- `runOptimization()` with progress

### Stores: `usePlanVersionStore` (versions, currentId), `useSettingsStore` (thirdShiftDefault)

---

## CLUSTER 5: REPLAN (auto-replan, overflow, undo, failures, optimization)

**Component**: `ReplanView` (L2707-5324, 2617 lines) -- THE LARGEST sub-component

### useState (33)

**Resource Down (3)**: `editingDown`, `downStartDay`, `downEndDay`

**Auto-Replan (10)**: `arResult`, `arActions`, `arRunning`, `arSim`, `arSimId`, `arExclude`, `arDayFrom`, `arDayTo`, `arExpanded`, `arShowExclude`

**Failures/Breakdowns (11)**: `failures`, `failureImpacts`, `showFailureForm`, `ffResType`, `ffResId`, `ffSev`, `ffCap`, `ffStartDay`, `ffEndDay`, `ffDesc`, `cascRunning`

**Optimization (5)**: `optRunning`, `optResults`, `optProgress`, `optN`, `optProfile`

**Rush Orders (3)**: `roTool`, `roQty`, `roDeadline`

**XAI (1)**: `xai`

### useRef (1): `arInputRef` -- caches scheduling input

### useMemo (5)

`blockCountByMachine`, `wdi`, `optMoveable`, `decs` (genDecisions), `qv` (quickValidate)

### useCallback (14)

`buildArInput`, `runAutoReplan`, `handleArUndo`, `handleArAlt`, `handleArSimulate`, `handleArUndoAll`, `handleArApplyAll`, `addFailure`, `removeFailure`, `runCascadingReplan`, `runOpt`, `applyOptResult`, `addRushOrder`, `removeRushOrder`

### Stores: `useSettingsStore`, `useToastStore`

---

## CLUSTER 6: EXPORT (PDF, Excel)

**DOES NOT EXIST** -- Zero export functionality in this file.

---

## CLUSTER 7: UI (modals, tabs, visual state)

### UI Atoms (L162-277, 115 lines)

`Pill`, `Tag`, `Metric`, `Card` -- micro-components without hooks

### PlanView (L1586-2705, 1119 lines)

**useState (6)**: `showAuditDetail`, `showDecisions`, `decFilter`, `decExpanded`, `arRunning`, `arSummary`

**useMemo (2)**: `opById`, `wdi`

**useCallback (2)**: `getEDD`, `handleQuickReplan`

**JSX sections**: KPI grid (6), coverage audit banner + table, feasibility circle + segmented bar, quick auto-replan, decisions panel (28 types, 6 categories), capacity heatmap, volume/day chart, top delays

### NikufraEngine main (L7172-7888, 716 lines)

**useState (12 + 1 useTransition)**:
`engineData`, `loading`, `error`, `mSt`, `tSt`, `moves`, `view`, `isSaving`, `failureEvents`, `rushOrders`, `isopBanner`, `isScheduling` (useTransition)

**useRef (1)**: `prevOpsRef`

**useEffect (3)**: loadData on mount, sync mSt/tSt from failures, replan store callback

**useCallback (9)**: `loadData`, `setResourceDown`, `clearResourceDown`, `applyMove`, `undoMove`, `handleApplyAndSave`, `toggleM`, `toggleT`, `handlePlanAutoReplan`

**useMemo (11)**: `replanTimelines`, `downDaysCache`, `getResourceDownDays`, `rushOps`, `allOps`, `{blocks,autoMoves,schedDecisions}`, `cap`, `neMetrics`, `validation`, `audit`, `feasibility`

**JSX**: Tab bar (Plan/Gantt/Replan/What-If), status pills, ISOP banner, scheduling indicator, conditional view render

---

## Summary by Cluster

| Cluster | useState | useEffect | useMemo | useCallback | useRef | Lines | Stores |
|---------|----------|-----------|---------|-------------|--------|-------|--------|
| GANTT | 5 | 0 | 6 | 0 | 0 | 656 | -- |
| FILTERS | ~14 dist. | 0 | 0 | 0 | 0 | ~200 | -- |
| VALIDATION | 1 | 0 | 2 | 0 | 0 | 166 | -- |
| WHAT-IF | 14 | 0 | 2 | 1 | 0 | 1844 | 2 |
| REPLAN | 33 | 0 | 5 | 14 | 1 | 2617 | 2 |
| EXPORT | 0 | 0 | 0 | 0 | 0 | 0 | -- |
| UI (Plan+main) | 18 | 3 | 13 | 11 | 1 | 1835 | 3 |
| **TOTAL** | **~85** | **3** | **~28** | **~26** | **2** | **7888** | 4 |

---

## Critical Notes

1. **ReplanView = 33 useState, 2617 lines** -- contains 4 functionalities (auto-replan, failures, optimization, rush orders) that should be separate components
2. **EXPORT does not exist** -- zero PDF/Excel
3. **Zero useReducer** -- all state is individual useState; ReplanView would benefit from a reducer
4. **Day range picker duplicated 3x** -- ReplanView (x2) + WhatIfView (x1), ~170 lines each
5. **Temporal down editor duplicated** -- nearly identical code between ReplanView and WhatIfView
6. **7888 lines in a single .tsx** -- violates the 300-line/component rule from CLAUDE.md frontend
7. **Decision rendering duplicated** -- PlanView and ReplanView use DECISION_CATEGORIES with different JSX
8. **WhatIfView re-renders Gantt inline** -- does not reuse GanttView
