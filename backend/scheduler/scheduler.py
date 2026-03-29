"""Scheduler entry point.

Pipeline (stubbed — Phase 2 will implement Moldit-specific logic):
  Phase 1: lot_sizing      — EOps → Lots
  Phase 2: tool_grouping   — Lots → ToolRuns
  Phase 3: dispatch         — assign + sequence + allocate segments
  Phase 4: jit              — LST-gated re-dispatch
  Phase 5: scoring          — KPI computation
"""

from __future__ import annotations

import logging
from collections import defaultdict

from backend.scheduler.constants import DAY_CAP
from backend.config.types import FactoryConfig
from backend.scheduler.types import Lot, ScheduleResult, Segment, ToolRun
from backend.types import EngineData

logger = logging.getLogger(__name__)


def _detect_buffer_need(
    runs: list[ToolRun],
    config: FactoryConfig | None = None,
    machine_runs: dict[str, list[ToolRun]] | None = None,
    holidays: set[int] | None = None,
) -> int:
    """Return number of buffer days needed so no machine has infeasible early load.

    For each machine, simulates strict-EDD dispatch accounting for holidays.
    If any run completes after its EDD, computes how many extra days are needed.
    Falls back to simple edd=0 check when machine_runs not provided.
    """
    import math
    day_cap = config.day_capacity_min if config else DAY_CAP
    hols = holidays or set()

    if machine_runs:
        max_buffer = 0
        for m_id, m_runs in machine_runs.items():
            sorted_runs = sorted(m_runs, key=lambda r: r.edd)
            abs_min = 0.0
            for run in sorted_runs:
                # Snap to workday
                day = int(abs_min) // day_cap
                while day in hols:
                    day += 1
                    abs_min = float(day * day_cap)

                remaining = run.total_min
                while remaining > 0.01:
                    day = int(abs_min) // day_cap
                    while day in hols:
                        day += 1
                        abs_min = float(day * day_cap)
                    day_used = abs_min - day * day_cap
                    day_left = day_cap - day_used
                    block = min(remaining, day_left)
                    abs_min += block
                    remaining -= block
                    if remaining > 0.01:
                        abs_min = float((day + 1) * day_cap)

                comp_day = day
                if comp_day > run.edd:
                    tardiness = comp_day - run.edd
                    max_buffer = max(max_buffer, tardiness)
        return max_buffer

    # Fallback: simple edd=0 check
    max_buffer = 0
    for run in runs:
        if run.edd == 0 and run.total_min > day_cap:
            days_needed = math.ceil(run.total_min / day_cap)
            max_buffer = max(max_buffer, days_needed - 1)
    return max_buffer


def _apply_buffer(runs: list[ToolRun], buffer_days: int) -> None:
    """Shift all run and lot EDDs forward by buffer_days."""
    for run in runs:
        run.edd += buffer_days
        for lot in run.lots:
            lot.edd += buffer_days


def _shift_engine_data(data: EngineData, buffer_days: int) -> EngineData:
    """Return a copy of EngineData with n_days increased and holidays shifted."""
    import copy
    shifted = copy.copy(data)
    shifted.n_days = data.n_days + buffer_days
    if hasattr(data, "holidays") and data.holidays:
        shifted.holidays = [h + buffer_days for h in data.holidays]
    return shifted


def _unshift_segments(segments: list[Segment], buffer_days: int) -> list[Segment]:
    """Shift segment day_idx and edd back by buffer_days.

    Buffer-day production keeps negative day_idx (e.g. day -1) so the
    Gantt can display it truthfully instead of cramming into day 0.
    """
    for seg in segments:
        seg.day_idx = seg.day_idx - buffer_days
        seg.edd -= buffer_days
    return segments


def _unshift_lots(lots: list[Lot], buffer_days: int) -> list[Lot]:
    """Shift lot EDDs back by buffer_days."""
    for lot in lots:
        lot.edd -= buffer_days
    return lots


def _next_workday(day: int, holidays: set[int]) -> int:
    """Return next day that is not a holiday."""
    d = day
    while d in holidays:
        d += 1
    return d


def _fix_day_overlaps(segments: list[Segment], config: FactoryConfig | None = None, holidays: set[int] | None = None) -> list[Segment]:
    """Fix overlapping segments on same machine/day after buffer unshift.

    Per machine: sort all segments by (day_idx, start_min), then sequentially
    ensure each segment starts after the previous one ends. Segments that
    overflow past shift_b_end are pushed to the next workday (skipping holidays).
    """
    shift_a_start = config.shift_a_start if config else 420
    shift_b_end = config.shift_b_end if config else 1440
    hols = holidays or set()

    by_machine: defaultdict[str, list[Segment]] = defaultdict(list)
    for seg in segments:
        by_machine[seg.machine_id].append(seg)

    for machine_id, segs in by_machine.items():
        segs.sort(key=lambda s: (s.day_idx, s.start_min))
        for i in range(1, len(segs)):
            prev = segs[i - 1]
            curr = segs[i]

            # Only fix overlaps within the same day
            if curr.day_idx != prev.day_idx:
                continue

            if curr.start_min < prev.end_min:
                duration = curr.end_min - curr.start_min
                new_start = prev.end_min
                new_end = new_start + duration

                # If overflows day, move to next workday
                if new_end > shift_b_end:
                    new_day = _next_workday(curr.day_idx + 1, hols)
                    # EDD guard: never cause tardy by moving to next day
                    if new_day > curr.edd:
                        if prev.end_min < shift_b_end:
                            curr.start_min = prev.end_min
                            curr.end_min = shift_b_end
                        else:
                            # No space left — keep zero-duration placeholder to preserve EDD
                            curr.start_min = shift_b_end
                            curr.end_min = shift_b_end
                        continue
                    # Safe to move to next workday
                    curr.day_idx = new_day
                    curr.start_min = shift_a_start
                    curr.end_min = min(shift_a_start + duration, shift_b_end)
                    curr.is_continuation = True
                    curr.shift = "A"
                    # Re-sort needed since we moved a segment to a later day
                    segs.sort(key=lambda s: (s.day_idx, s.start_min))
                    break
                else:
                    curr.start_min = new_start
                    curr.end_min = new_end
        else:
            continue
        # Break happened — re-scan this machine (max iterations = n_segments)
        for _ in range(len(segs)):
            segs.sort(key=lambda s: (s.day_idx, s.start_min))
            cascaded = False
            for i in range(1, len(segs)):
                prev = segs[i - 1]
                curr = segs[i]
                if curr.day_idx != prev.day_idx:
                    continue
                if curr.start_min < prev.end_min:
                    duration = curr.end_min - curr.start_min
                    new_start = prev.end_min
                    new_end = new_start + duration
                    if new_end > shift_b_end:
                        new_day = _next_workday(curr.day_idx + 1, hols)
                        if new_day > curr.edd:
                            if prev.end_min < shift_b_end:
                                curr.start_min = prev.end_min
                                curr.end_min = shift_b_end
                            else:
                                curr.start_min = shift_b_end
                                curr.end_min = shift_b_end
                            continue
                        curr.day_idx = new_day
                        curr.start_min = shift_a_start
                        curr.end_min = min(shift_a_start + duration, shift_b_end)
                        curr.is_continuation = True
                        curr.shift = "A"
                        cascaded = True
                        break
                    else:
                        curr.start_min = new_start
                        curr.end_min = new_end
            if not cascaded:
                break

    return segments


def _sanitize_segments(
    segments: list[Segment],
    config: FactoryConfig | None = None,
    holidays: set[int] | None = None,
) -> list[Segment]:
    """Final safety net: enforce shift bounds without causing tardiness.

    1. Remove truly inverted segments (start > end)
    2. Clamp start_min >= shift_a_start
    3. Cap end_min at shift_b_end (never move to next day — that could cause tardy)
    """
    shift_a_start = config.shift_a_start if config else 420
    shift_b_end = config.shift_b_end if config else 1440

    result: list[Segment] = []
    for seg in segments:
        # Remove truly inverted segments (start > end)
        if seg.start_min > seg.end_min:
            continue

        # Clamp start to shift_a_start
        if seg.start_min < shift_a_start:
            seg.start_min = shift_a_start

        # Cap end_min at shift_b_end (safe: preserves day_idx = no tardy risk)
        if seg.end_min > shift_b_end:
            seg.end_min = shift_b_end

        # Keep segment (including zero-duration EDD placeholders)
        result.append(seg)

    removed = len(segments) - len(result)
    if removed > 0:
        logger.info("Sanitize: removed %d degenerate segments", removed)

    return result


def _find_predecessor_end(segments: list[Segment], target: Segment, shift_a_start: int) -> int:
    """Find the end_min of the latest predecessor on the same machine/day before target."""
    pred_end = shift_a_start
    for other in segments:
        if (other.machine_id == target.machine_id
                and other.day_idx == target.day_idx
                and other.end_min <= target.start_min
                and other.end_min > pred_end):
            pred_end = other.end_min
    return pred_end


def _try_pull_back(
    segments: list[Segment],
    blocker_seg_idx: int,
    blocker_abs_start: float,
    prev_crew_end: float,
    delay_needed: float,
    shift_a_start: int,
) -> tuple[bool, float, float]:
    """Try pulling the blocker segment back in time to make room.

    Returns (pulled, new_blocker_abs_start, new_crew_free_at).
    """
    bseg = segments[blocker_seg_idx]
    pull_back_available = blocker_abs_start - prev_crew_end
    is_full = pull_back_available >= delay_needed
    pull_amount = int(delay_needed + 0.5) if is_full else int(pull_back_available)

    if pull_amount < 1:
        return False, blocker_abs_start, 0.0

    new_bstart = bseg.start_min - pull_amount
    pred_end = _find_predecessor_end(segments, bseg, shift_a_start)

    # Limit pull to available intra-machine space
    if new_bstart < pred_end:
        pull_amount = max(0, bseg.start_min - pred_end)
        new_bstart = bseg.start_min - pull_amount

    if pull_amount < 1 or new_bstart < shift_a_start:
        return False, blocker_abs_start, 0.0

    bseg.end_min -= pull_amount
    bseg.start_min = new_bstart
    new_blocker_abs = blocker_abs_start - pull_amount
    new_crew_free = new_blocker_abs + bseg.setup_min
    return is_full, new_blocker_abs, new_crew_free


def _push_forward(
    seg: Segment,
    crew_free_at: float,
    abs_start: float,
    duration: float,
    shift_a_start: int,
    shift_b_end: int,
    holidays: set[int],
) -> bool:
    """Push a setup segment forward in time to avoid crew overlap.

    Returns True if segment was shifted.
    """
    new_abs_start = crew_free_at
    delay = int(new_abs_start - abs_start + 0.5)
    if delay < 1:
        return False

    new_start = seg.start_min + delay
    new_end = seg.end_min + delay

    if new_end > shift_b_end:
        # Overflow: move entire segment to next workday
        seg_duration = seg.end_min - seg.start_min
        new_day = seg.day_idx + 1
        while new_day in holidays:
            new_day += 1
        seg.day_idx = new_day
        seg.start_min = shift_a_start
        seg.end_min = shift_a_start + seg_duration
    else:
        seg.start_min = new_start
        seg.end_min = new_end
    return True


def _serialize_crew_setups(
    segments: list[Segment],
    config: FactoryConfig | None = None,
    holidays: set[int] | None = None,
    crew_priority: list[str] | None = None,
) -> list[Segment]:
    """Serialize setups across machines: single crew can only do one setup at a time.

    JIT/VNS dispatch each machine independently (no shared crew) for gate independence.
    This post-processing step delays ONLY the overlapping setup segment (not all
    subsequent segments). Intra-machine cascading is handled by _fix_day_overlaps.

    Bidirectional resolution: tries pulling the blocker back before pushing current forward.
    """
    day_cap = config.day_capacity_min if config else DAY_CAP
    shift_a_start = config.shift_a_start if config else 420
    shift_b_end = config.shift_b_end if config else 1440
    hols = holidays or set()

    # Build priority lookup (lower index = higher priority = not delayed)
    prio_map: dict[str, int] = {}
    if crew_priority:
        prio_map = {m: i for i, m in enumerate(crew_priority)}

    # Collect setups with absolute time
    setup_entries: list[tuple[float, float, int]] = []
    for idx, seg in enumerate(segments):
        if seg.setup_min > 0 and seg.day_idx >= 0:
            abs_start = seg.day_idx * day_cap + (seg.start_min - shift_a_start)
            setup_entries.append((abs_start, seg.setup_min, idx))

    if not setup_entries:
        return segments

    setup_entries.sort(key=lambda e: (e[0], prio_map.get(segments[e[2]].machine_id, 99)))

    crew_free_at = 0.0
    prev_crew_end = 0.0
    blocker_seg_idx = -1
    blocker_abs_start = 0.0
    shifted = 0

    for abs_start, duration, seg_idx in setup_entries:
        seg = segments[seg_idx]

        if abs_start < crew_free_at - 0.01:
            # Overlap detected — resolve bidirectionally
            pulled = False
            if blocker_seg_idx >= 0:
                is_full, blocker_abs_start, new_crew_free = _try_pull_back(
                    segments, blocker_seg_idx, blocker_abs_start, prev_crew_end,
                    crew_free_at - abs_start, shift_a_start,
                )
                if new_crew_free > 0:
                    crew_free_at = new_crew_free
                    pulled = is_full

            if pulled:
                crew_free_at = abs_start + duration
                blocker_seg_idx = seg_idx
                blocker_abs_start = abs_start
                shifted += 1
            else:
                pushed = _push_forward(seg, crew_free_at, abs_start, duration,
                                       shift_a_start, shift_b_end, hols)
                if pushed:
                    new_abs = crew_free_at
                    new_end = seg.start_min + duration if seg.end_min - seg.start_min >= duration else seg.end_min
                    # Update tracking only for same-day pushes (not day-overflow)
                    if seg.day_idx * day_cap + (seg.start_min - shift_a_start) >= abs_start:
                        crew_free_at = seg.day_idx * day_cap + (seg.start_min - shift_a_start) + duration
                        prev_crew_end = blocker_abs_start + segments[blocker_seg_idx].setup_min if blocker_seg_idx >= 0 else 0.0
                        blocker_seg_idx = seg_idx
                        blocker_abs_start = seg.day_idx * day_cap + (seg.start_min - shift_a_start)
                    shifted += 1
                else:
                    crew_free_at = abs_start + duration
                    prev_crew_end = blocker_abs_start + segments[blocker_seg_idx].setup_min if blocker_seg_idx >= 0 else 0.0
                    blocker_seg_idx = seg_idx
                    blocker_abs_start = abs_start
        else:
            prev_crew_end = crew_free_at
            crew_free_at = abs_start + duration
            blocker_seg_idx = seg_idx
            blocker_abs_start = abs_start

    if shifted > 0:
        logger.info("Crew serialization: shifted %d setup segments", shifted)

    return segments


def _serialize_crew_safe(
    segments: list[Segment],
    config: FactoryConfig | None = None,
    holidays: set[int] | None = None,
    crew_priority: list[str] | None = None,
) -> list[Segment]:
    """EDD-safe per-overlap crew serialization.

    Like _serialize_crew_setups but checks EDD before each fix:
    - Only delays a setup if the new day_idx <= seg.edd
    - Tries BOTH orderings (A-then-B vs B-then-A) for each overlap
    - Skips unfixable overlaps (logs warning)

    Used as fallback when standard serialization causes tardy.
    """
    day_cap = config.day_capacity_min if config else DAY_CAP
    shift_a_start = config.shift_a_start if config else 420
    shift_b_end = config.shift_b_end if config else 1440
    hols = holidays or set()

    prio_map: dict[str, int] = {}
    if crew_priority:
        prio_map = {m: i for i, m in enumerate(crew_priority)}

    # Collect setup intervals
    setup_entries: list[tuple[float, float, int]] = []
    for idx, seg in enumerate(segments):
        if seg.setup_min > 0 and seg.day_idx >= 0:
            abs_start = seg.day_idx * day_cap + (seg.start_min - shift_a_start)
            setup_entries.append((abs_start, seg.setup_min, idx))

    if not setup_entries:
        return segments

    setup_entries.sort(key=lambda e: (e[0], prio_map.get(segments[e[2]].machine_id, 99)))

    crew_free_at = 0.0
    crew_machine = ""
    fixed = 0
    skipped = 0

    for abs_start, duration, seg_idx in setup_entries:
        seg = segments[seg_idx]

        if abs_start < crew_free_at - 0.01 and seg.machine_id != crew_machine:
            delay = int(crew_free_at - abs_start + 0.5)

            if delay < 1:
                crew_free_at = abs_start + duration
                crew_machine = seg.machine_id
                continue

            # Try push-forward with EDD check
            new_start = seg.start_min + delay
            new_end = seg.end_min + delay

            if new_end <= shift_b_end:
                # Same day — safe if day_idx <= edd
                if seg.day_idx <= seg.edd:
                    seg.start_min = new_start
                    seg.end_min = new_end
                    crew_free_at = (seg.day_idx * day_cap + (new_start - shift_a_start)) + duration
                    crew_machine = seg.machine_id
                    fixed += 1
                    continue

            # Try next workday with EDD check
            seg_duration = seg.end_min - seg.start_min
            new_day = seg.day_idx + 1
            while new_day in hols:
                new_day += 1

            if new_day <= seg.edd:
                seg.day_idx = new_day
                seg.start_min = shift_a_start
                seg.end_min = shift_a_start + seg_duration
                fixed += 1
                # Don't update crew_free_at — crew is free today for others
                continue

            # Can't fix without exceeding EDD — skip this overlap
            skipped += 1
            logger.warning(
                "Crew overlap unfixable (EDD %d): %s day %d delay %d min",
                seg.edd, seg.machine_id, seg.day_idx, delay,
            )

        # Update tracking
        if abs_start + duration > crew_free_at:
            crew_free_at = abs_start + duration
            crew_machine = seg.machine_id

    if fixed > 0:
        logger.info("Safe crew serialization: fixed %d, skipped %d overlaps", fixed, skipped)

    return segments


def schedule_all(data: EngineData, audit: bool = False, config: FactoryConfig | None = None, crew_priority: list[str] | None = None) -> ScheduleResult:
    """Run the full scheduling pipeline."""
    raise NotImplementedError("Moldit scheduler pipeline — Phase 2")
