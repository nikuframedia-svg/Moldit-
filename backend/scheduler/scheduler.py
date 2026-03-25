"""Scheduler entry point — Spec 02 v6 §9.

Pipeline:
  Phase 1: lot_sizing      — EOps → Lots (eco lot + twins + min prod_min)
  Phase 2: tool_grouping   — Lots → ToolRuns (group + split + EDD sort)
  Phase 3: dispatch         — assign + sequence + allocate segments
  Phase 4: jit              — LST-gated re-dispatch (safety: fallback)
  Phase 5: scoring          — OTD, OTD-D, setups, earliness, utilisation
"""

from __future__ import annotations

import logging
import time

from backend.scheduler.constants import DAY_CAP
from backend.config.types import FactoryConfig
from backend.guardian.guardian import validate_input, validate_output
from backend.journal.journal import Journal
from backend.scheduler.dispatch import (
    assign_machines,
    per_machine_dispatch,
    sequence_per_machine,
)
from backend.scheduler.jit import jit_dispatch
from backend.scheduler.lot_sizing import create_lots
from backend.scheduler.operators import compute_operator_alerts
from backend.scheduler.scoring import compute_score
from backend.scheduler.tool_grouping import create_tool_runs
from backend.scheduler.types import Lot, ScheduleResult, Segment, ToolRun
from backend.types import EngineData

logger = logging.getLogger(__name__)


def _detect_buffer_need(runs: list[ToolRun], config: FactoryConfig | None = None) -> int:
    """Return 1 if any run with edd=0 needs more than 1 day of work."""
    day_cap = config.day_capacity_min if config else DAY_CAP
    for run in runs:
        if run.edd == 0 and run.total_min > day_cap:
            return 1
    return 0


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

    Buffer-day production (day_idx < 0 after shift) is clamped to day 0.
    """
    for seg in segments:
        seg.day_idx = max(0, seg.day_idx - buffer_days)
        seg.edd -= buffer_days
    return segments


def _unshift_lots(lots: list[Lot], buffer_days: int) -> list[Lot]:
    """Shift lot EDDs back by buffer_days."""
    for lot in lots:
        lot.edd -= buffer_days
    return lots


def schedule_all(data: EngineData, params=None, audit: bool = False, config: FactoryConfig | None = None) -> ScheduleResult:
    """Run the full scheduling pipeline."""
    t0 = time.perf_counter()

    if config is None:
        config = FactoryConfig()

    journal = Journal()

    audit_logger = None
    if audit:
        from backend.audit.logger import AuditLogger
        audit_logger = AuditLogger()

    # Guardian: validate input
    journal.phase_start("guardian")
    guard = validate_input(data, config)
    if guard.dropped_ops:
        journal.log("guardian", "warn", f"Dropped {len(guard.dropped_ops)} ops: {', '.join(guard.dropped_ops[:5])}")
    journal.phase_end("guardian", f"{len(guard.issues)} issues, {len(guard.dropped_ops)} dropped", n_issues=len(guard.issues))
    data = guard.cleaned

    # Phase 1: EOps → Lots
    journal.phase_start("lot_sizing")
    lots = create_lots(data, config=config)
    journal.phase_end("lot_sizing", f"{len(lots)} lots from {len(data.ops)} ops", n_lots=len(lots), n_ops=len(data.ops))
    logger.info("Phase 1: %d lots from %d ops", len(lots), len(data.ops))

    if not lots:
        return ScheduleResult(
            segments=[], lots=[], score={},
            time_ms=0.0, warnings=journal.to_warnings(), operator_alerts=[],
            journal=journal.to_dicts(),
        )

    # Phase 2: Lots → ToolRuns
    journal.phase_start("tool_grouping")
    runs = create_tool_runs(lots, audit_logger=audit_logger, params=params, config=config)
    journal.phase_end("tool_grouping", f"{len(runs)} runs from {len(lots)} lots", n_runs=len(runs))
    logger.info("Phase 2: %d tool runs (vs %d lots)", len(runs), len(lots))

    # Auto buffer: if any run with edd=0 needs more than 1 day, shift everything +1
    buffer_days = _detect_buffer_need(runs, config=config)
    if buffer_days > 0:
        logger.info("Auto buffer: +%d day(s) for infeasible day-0 runs", buffer_days)
        _apply_buffer(runs, buffer_days)
        data = _shift_engine_data(data, buffer_days)

    # Phase 3: Assign + Sequence + Allocate
    journal.phase_start("dispatch")
    machine_runs = assign_machines(runs, data, audit_logger=audit_logger, params=params, config=config)
    machine_runs = sequence_per_machine(machine_runs, audit_logger=audit_logger, params=params, config=config)
    baseline_segments, baseline_lots, warnings = per_machine_dispatch(machine_runs, data, config=config)
    journal.phase_end("dispatch", f"{len(baseline_segments)} segments", n_segments=len(baseline_segments))
    logger.info("Phase 3: %d segments, %d warnings", len(baseline_segments), len(warnings))

    # Baseline score
    baseline_score = compute_score(baseline_segments, baseline_lots, data, config=config)
    logger.info(
        "Baseline: OTD=%.1f%%, OTD-D=%.1f%%, setups=%d, tardy=%d/%d",
        baseline_score["otd"], baseline_score["otd_d"], baseline_score["setups"],
        baseline_score["tardy_count"], baseline_score["total_lots"],
    )

    # Phase 4: JIT (LST-gated re-dispatch)
    journal.phase_start("jit")
    jit_thresh = getattr(params, 'jit_threshold', config.jit_threshold)
    if config.jit_enabled and baseline_score["otd"] >= jit_thresh:
        final_segments, final_lots, jit_warnings = jit_dispatch(
            runs, data,
            baseline_segments, baseline_lots, baseline_score,
            audit_logger=audit_logger, params=params, config=config,
        )
        warnings.extend(jit_warnings)
        journal.phase_end("jit", f"JIT applied, {len(final_segments)} segments")
    else:
        final_segments = baseline_segments
        final_lots = baseline_lots
        warnings.append("JIT disabled: baseline OTD < 95%")
        journal.log("jit", "warn", "JIT disabled: baseline OTD < 95%")
        journal.phase_end("jit", "JIT skipped")

    # Un-shift buffer if applied
    if buffer_days > 0:
        final_segments = _unshift_segments(final_segments, buffer_days)
        final_lots = _unshift_lots(final_lots, buffer_days)
        # Restore original n_days for scoring
        data = _shift_engine_data(data, -buffer_days)

    # Phase 5: Final scoring
    journal.phase_start("scoring")
    score = compute_score(final_segments, final_lots, data, config=config)
    journal.phase_end("scoring", f"OTD={score['otd']:.1f}%, tardy={score['tardy_count']}", **{k: v for k, v in score.items() if isinstance(v, (int, float))})
    logger.info(
        "Final: OTD=%.1f%%, OTD-D=%.1f%%, setups=%d, tardy=%d/%d, earliness=%.1fd",
        score["otd"], score["otd_d"], score["setups"],
        score["tardy_count"], score["total_lots"], score["earliness_avg_days"],
    )

    # Guardian: validate output
    out_issues = validate_output(final_segments, data)
    for issue in out_issues:
        journal.log("guardian_output", "warn", issue.message, op_id=issue.op_id, field=issue.field)

    # Operator alerts
    alerts = compute_operator_alerts(final_segments, data, config=config)
    if alerts:
        logger.info("Operator alerts: %d", len(alerts))

    elapsed = (time.perf_counter() - t0) * 1000

    trail = audit_logger.get_trail() if audit_logger else None

    # Merge journal warnings into warnings list
    warnings.extend(journal.to_warnings())

    return ScheduleResult(
        segments=final_segments,
        lots=final_lots,
        score=score,
        time_ms=round(elapsed, 1),
        warnings=warnings,
        operator_alerts=alerts,
        audit_trail=trail,
        journal=journal.to_dicts(),
    )
