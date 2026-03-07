// ═══════════════════════════════════════════════════════════
//  INCOMPOL PLAN — D+1 Workforce Forecast
//  Predicts next working day workforce overload and emits
//  rich warnings with operational suggestions.
//
//  Window-based model: capacity varies within a shift
//  (e.g. 07:00-15:30=6, 15:30-16:00=6, 16:00-00:00=5 for Grandes).
//
//  Pure function — no side effects.
//  Soft warning only — never blocks scheduling.
// ═══════════════════════════════════════════════════════════

import { T1 } from '../constants.js';
import type { Block } from '../types/blocks.js';
import type { ETool } from '../types/engine.js';
import type {
  WorkforceConfig,
  WorkforceCoverageMissing,
  WorkforceForecast,
  WorkforceForecastWarning,
  WorkforceSuggestion,
} from '../types/workforce.js';

// ── Input ────────────────────────────────────────────────

export interface WorkforceForecastInput {
  blocks: Block[];
  workforceConfig: WorkforceConfig;
  workdays: boolean[];
  dates: string[];
  toolMap: Record<string, ETool>;
  overtimeMap?: Record<string, Record<number, number>>;
  thirdShift?: boolean;
  /** Day index from which to find the next working day. Default: 0. */
  fromDayIdx?: number;
}

// ── Helpers ──────────────────────────────────────────────

/** Find the next working day index after fromIdx (first workdays[d] === true where d > fromIdx) */
function findNextWorkingDay(workdays: boolean[], fromIdx = 0): number {
  for (let d = fromIdx + 1; d < workdays.length; d++) {
    if (workdays[d]) return d;
  }
  return -1;
}

/** Derive shift code from a minute within the day */
function minuteToShift(minute: number): 'X' | 'Y' {
  return minute < T1 ? 'X' : 'Y';
}

/** Build overload window description for a window */
function overloadWindowLabel(start: number, end: number): string {
  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };
  return `${fmt(start)}-${fmt(end)}`;
}

// ── Main Forecast ────────────────────────────────────────

/**
 * Compute D+1 workforce forecast from scheduled blocks.
 *
 * Algorithm:
 * 1. Find next working day (D+1)
 * 2. For that day, compute peak concurrent operators per laborGroup × window
 * 3. For each laborGroup/window with excess > 0, emit a rich warning with suggestions
 * 4. Check for overtime/3rd shift without configured workforce → coverage missing
 *
 * @param input - Blocks, workforce config, workdays, dates, tool map
 * @returns WorkforceForecast with warnings and suggestions
 */
export function computeWorkforceForecast(input: WorkforceForecastInput): WorkforceForecast {
  const { blocks, workforceConfig, workdays, dates, toolMap, overtimeMap, thirdShift, fromDayIdx } =
    input;

  const d1 = findNextWorkingDay(workdays, fromDayIdx ?? 0);
  if (d1 === -1) {
    return {
      nextWorkingDayIdx: -1,
      date: '',
      warnings: [],
      coverageMissing: [],
      hasWarnings: false,
      hasCritical: false,
    };
  }

  const date = dates[d1] ?? `dia ${d1}`;

  // Build reverse map: laborGroup → machineIds
  const groupMachines: Record<string, Set<string>> = {};
  for (const [machineId, laborGroup] of Object.entries(workforceConfig.machineToLaborGroup)) {
    if (!groupMachines[laborGroup]) groupMachines[laborGroup] = new Set();
    groupMachines[laborGroup].add(machineId);
  }

  // Filter D+1 active blocks
  const d1Blocks = blocks.filter((b) => b.dayIdx === d1 && b.type !== 'blocked');

  const warnings: WorkforceForecastWarning[] = [];

  for (const laborGroup of Object.keys(workforceConfig.laborGroups)) {
    const machSet = groupMachines[laborGroup];
    const windows = workforceConfig.laborGroups[laborGroup];

    for (const w of windows) {
      if (!machSet) continue;

      // Find blocks that overlap this window [w.start, w.end)
      const windowBlocks = d1Blocks.filter((b) => {
        if (!machSet.has(b.machineId)) return false;
        return b.startMin < w.end && b.endMin > w.start;
      });

      // Peak operators per machine in this window
      const machPeaks: Record<string, number> = {};
      for (const b of windowBlocks) {
        machPeaks[b.machineId] = Math.max(machPeaks[b.machineId] || 0, b.operators);
      }

      // Sum peaks across machines in group
      let peakNeed = 0;
      for (const ops of Object.values(machPeaks)) {
        peakNeed += ops;
      }

      const capacity = w.capacity;
      const excess = peakNeed - capacity;
      if (excess <= 0) continue;

      const peakShortage = excess;
      const windowDuration = w.end - w.start;
      const overloadPeopleMinutes = peakShortage * windowDuration;
      const shortageMinutes = windowDuration;

      // Collect causing blocks (all blocks in this laborGroup/window with operators > 0)
      const causingBlocks: WorkforceForecastWarning['causingBlocks'] = [];
      const machinesSet = new Set<string>();
      for (const b of windowBlocks) {
        if (b.operators <= 0) continue;
        causingBlocks.push({
          opId: b.opId,
          machineId: b.machineId,
          operators: b.operators,
          sku: b.sku,
        });
        machinesSet.add(b.machineId);
      }

      // Build opId → toolId map from actual blocks
      const opToolMap: Record<string, string> = {};
      for (const b of windowBlocks) {
        opToolMap[b.opId] = b.toolId;
      }

      // Generate suggestions
      const suggestions = buildSuggestions(causingBlocks, d1, workdays, toolMap, excess, opToolMap);

      const shift = minuteToShift(w.start);

      warnings.push({
        date,
        dayIdx: d1,
        laborGroup,
        shift,
        windowStart: w.start,
        windowEnd: w.end,
        capacity,
        projectedPeak: peakNeed,
        excess,
        peakShortage,
        overloadPeopleMinutes,
        shortageMinutes,
        causingBlocks,
        machines: Array.from(machinesSet),
        overloadWindow: overloadWindowLabel(w.start, w.end),
        suggestions,
      });
    }
  }

  // Coverage missing detection
  const coverageMissing = detectCoverageMissing(d1, workforceConfig, overtimeMap, thirdShift);

  return {
    nextWorkingDayIdx: d1,
    date,
    warnings,
    coverageMissing,
    hasWarnings: warnings.length > 0,
    hasCritical: coverageMissing.length > 0,
  };
}

// ── Suggestions ──────────────────────────────────────────

function buildSuggestions(
  causingBlocks: WorkforceForecastWarning['causingBlocks'],
  d1: number,
  workdays: boolean[],
  toolMap: Record<string, ETool>,
  excess: number,
  opToolMap: Record<string, string>,
): WorkforceSuggestion[] {
  const suggestions: WorkforceSuggestion[] = [];
  const seenOps = new Set<string>();

  // Check if there's a previous working day to advance into
  let hasPreviousWorkday = false;
  for (let d = d1 - 1; d >= 0; d--) {
    if (workdays[d]) {
      hasPreviousWorkday = true;
      break;
    }
  }

  for (const cb of causingBlocks) {
    if (seenOps.has(cb.opId)) continue;
    seenOps.add(cb.opId);

    // ADVANCE_BLOCK: if previous workday exists, suggest advancing
    if (hasPreviousWorkday) {
      suggestions.push({
        type: 'ADVANCE_BLOCK',
        description: `Antecipar bloco ${cb.sku} (${cb.opId}) para dia anterior`,
        opId: cb.opId,
        machineId: cb.machineId,
        expectedReduction: cb.operators,
      });
    }

    // MOVE_ALT_MACHINE: look up the operation's tool and check for alt machine
    const toolId = opToolMap[cb.opId];
    const tool = toolId ? toolMap[toolId] : undefined;
    if (tool?.alt && tool.alt !== '-') {
      suggestions.push({
        type: 'MOVE_ALT_MACHINE',
        description: `Mover ${cb.sku} para máquina alternativa ${tool.alt}`,
        opId: cb.opId,
        machineId: tool.alt,
        expectedReduction: cb.operators,
      });
    }
  }

  // REPLAN_EQUIVALENT: generic suggestion
  if (causingBlocks.length > 0) {
    suggestions.push({
      type: 'REPLAN_EQUIVALENT',
      description: `Considerar replaneamento equivalente para reduzir carga no grupo`,
      expectedReduction: Math.ceil(excess / 2),
    });
  }

  // REQUEST_REINFORCEMENT: always present when there's excess
  suggestions.push({
    type: 'REQUEST_REINFORCEMENT',
    description: `Solicitar reforço de ${excess} operador${excess > 1 ? 'es' : ''}`,
    expectedReduction: excess,
  });

  return suggestions;
}

// ── Coverage Missing ─────────────────────────────────────

function detectCoverageMissing(
  d1: number,
  config: WorkforceConfig,
  overtimeMap?: Record<string, Record<number, number>>,
  thirdShift?: boolean,
): WorkforceCoverageMissing[] {
  const missing: WorkforceCoverageMissing[] = [];

  // Check overtime machines on D+1
  if (overtimeMap) {
    for (const [machineId, dayMap] of Object.entries(overtimeMap)) {
      const extraMin = dayMap[d1];
      if (!extraMin || extraMin <= 0) continue;

      const laborGroup = config.machineToLaborGroup[machineId];
      if (!laborGroup) {
        // Machine not mapped to any labor group — workforce coverage unknown
        missing.push({
          type: 'OVERTIME',
          machineId,
          dayIdx: d1,
          shift: 'Y', // overtime extends Y shift
          detail: `Overtime +${extraMin} min em ${machineId} no dia ${d1} — máquina sem grupo laboral configurado`,
        });
      }
      // If labor group is mapped, check if last window has 0 capacity (overtime extends end of day)
      else {
        const windows = config.laborGroups[laborGroup];
        const lastWindow = windows?.[windows.length - 1];
        if (lastWindow && lastWindow.capacity === 0) {
          missing.push({
            type: 'OVERTIME',
            machineId,
            dayIdx: d1,
            shift: 'Y',
            detail: `Overtime +${extraMin} min em ${machineId} no dia ${d1} — grupo ${laborGroup} sem capacidade na última janela`,
          });
        }
      }
    }
  }

  // Check 3rd shift without workforce capacity
  // Z shift is not modeled in labor windows (only X/Y windows defined),
  // so any 3rd shift activation is flagged as coverage missing
  if (thirdShift) {
    for (const laborGroup of Object.keys(config.laborGroups)) {
      // Get one representative machine for this labor group
      const machineId =
        Object.entries(config.machineToLaborGroup).find(([, lg]) => lg === laborGroup)?.[0] ?? '';
      missing.push({
        type: 'THIRD_SHIFT',
        machineId,
        dayIdx: d1,
        shift: 'Z',
        detail: `3.º turno activo mas grupo ${laborGroup} não tem janelas Z configuradas — sem workforce configurada para turno nocturno`,
      });
    }
  }

  return missing;
}

// ── D+1 Risk (lightweight helper for auto-replan tiebreaker) ──

/**
 * Compute D+1 workforce risk as the total excess across all laborGroups/windows.
 *
 * Returns 0 if no excess. Used by auto-replan tiebreaker to prefer actions
 * that cause less workforce overload on the next working day.
 *
 * @param blocks - Scheduled blocks
 * @param config - Workforce configuration
 * @param workdays - Per-day workday flags
 * @returns Total excess operators on D+1 (0 = no risk)
 */
export function computeD1WorkforceRisk(
  blocks: Block[],
  config: WorkforceConfig,
  workdays: boolean[],
): number {
  const d1 = findNextWorkingDay(workdays);
  if (d1 === -1) return 0;

  // Build reverse map: laborGroup → machineIds
  const groupMachines: Record<string, Set<string>> = {};
  for (const [machineId, laborGroup] of Object.entries(config.machineToLaborGroup)) {
    if (!groupMachines[laborGroup]) groupMachines[laborGroup] = new Set();
    groupMachines[laborGroup].add(machineId);
  }

  const d1Blocks = blocks.filter((b) => b.dayIdx === d1 && b.type !== 'blocked');
  let totalExcess = 0;

  for (const laborGroup of Object.keys(config.laborGroups)) {
    const machSet = groupMachines[laborGroup];
    if (!machSet) continue;

    const windows = config.laborGroups[laborGroup];

    for (const w of windows) {
      // Find blocks that overlap this window
      const windowBlocks = d1Blocks.filter((b) => {
        if (!machSet.has(b.machineId)) return false;
        return b.startMin < w.end && b.endMin > w.start;
      });

      const machPeaks: Record<string, number> = {};
      for (const b of windowBlocks) {
        machPeaks[b.machineId] = Math.max(machPeaks[b.machineId] || 0, b.operators);
      }

      let peakNeed = 0;
      for (const ops of Object.values(machPeaks)) {
        peakNeed += ops;
      }

      const excess = peakNeed - w.capacity;
      if (excess > 0) totalExcess += excess;
    }
  }

  return totalExcess;
}
