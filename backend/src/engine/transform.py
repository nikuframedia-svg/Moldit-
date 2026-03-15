"""Transform layer: ISOP → SolverInput → GanttResponse.

Bridges the parser output to the solver input and the solver result to render-ready JSON.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from src.engine.models import ISOPData
from src.engine.solver import (
    DAY_MINUTES,
    SHIFT_A_END,
    SHIFT_A_START,
    SHIFT_B_END,
    SHIFT_B_START,
    MachineConfig,
    ScheduleResult,
    SolverInput,
)

# ─── ISOP → SolverInput ────────────────────────────────────────────────────


def isop_to_solver_input(
    isop: ISOPData,
    *,
    config: dict | None = None,
    today: date | None = None,
) -> SolverInput:
    """Convert parsed ISOP data into a SolverInput for the CP-SAT solver.

    Args:
        isop: Parsed ISOP data from the parser.
        config: Optional factory config dict (from incompol.yaml).
        today: Reference date (defaults to first date in ISOP range).
    """
    cfg = config or {}
    scheduling = cfg.get("scheduling", {})
    ref_date = today or isop.date_range[0]

    # Build machine configs from ISOP or factory config
    machines_cfg = cfg.get("machines", {})
    machines = []
    for m_id in isop.machines:
        m_data = machines_cfg.get(m_id, {})
        machines.append(MachineConfig(
            id=m_id,
            type=m_data.get("type", "grande"),
            alternatives=m_data.get("alternative", []),
        ))

    # Convert orders to solver order dicts
    solver_orders = []
    for order in isop.orders:
        # Deadline in factory-minutes from ref_date
        days_delta = (order.deadline - ref_date).days
        if days_delta < 0:
            days_delta = 0
        deadline_min = days_delta * DAY_MINUTES + SHIFT_B_END  # end of day

        # Lookup setup time from config
        tools_cfg = cfg.get("tools", {})
        tool_data = tools_cfg.get(order.tool, {})
        setup_hours = tool_data.get("setup_hours", 1.0)

        solver_orders.append({
            "sku": order.sku,
            "qty": order.qty,
            "deadline": order.deadline.isoformat(),
            "deadline_min": deadline_min,
            "tool": order.tool,
            "machine": order.machine,
            "pieces_per_hour": order.pieces_per_hour,
            "operators": order.operators,
            "economic_lot": order.economic_lot,
            "twin_ref": order.twin_ref,
            "client_code": order.client_code,
            "client_name": order.client_name,
            "setup_min": int(setup_hours * 60),
        })

    return SolverInput(
        orders=solver_orders,
        machines=machines,
        twin_pairs=list(isop.twin_pairs),
        today=ref_date,
        horizon_days=scheduling.get("horizon_days", (isop.date_range[1] - ref_date).days + 5),
        max_solve_seconds=scheduling.get("max_solve_seconds", 60),
        seed=scheduling.get("seed", 42),
        buffer_days=scheduling.get("buffer_days", 2),
        weights=scheduling.get("weights", {"tardiness": 100, "earliness": 10, "setups": 1}),
    )


# ─── SolverResult → GanttResponse ──────────────────────────────────────────


def _minutes_to_datetime(minutes: int, ref_date: date) -> datetime:
    """Convert absolute minutes from ref_date midnight to datetime."""
    days = minutes // DAY_MINUTES
    mins_in_day = minutes % DAY_MINUTES
    hours = mins_in_day // 60
    mins = mins_in_day % 60
    d = ref_date + timedelta(days=days)
    return datetime(d.year, d.month, d.day, hours, mins)


def _shift_for_minutes(minutes_in_day: int) -> str:
    """Determine shift label for a given minute within a day."""
    if SHIFT_A_START <= minutes_in_day < SHIFT_A_END:
        return "A"
    if SHIFT_B_START <= minutes_in_day < SHIFT_B_END:
        return "B"
    return "Z"  # emergency night shift


def _priority_color(priority: int) -> str:
    """Map priority level to hex color."""
    return {
        0: "#22c55e",   # green — normal
        1: "#eab308",   # yellow
        2: "#dc2626",   # red
        3: "#7c2d12",   # dark red — atraso
    }.get(priority, "#6b7280")


def _priority_label(priority: int) -> str:
    """Map priority level to Portuguese label."""
    return {
        0: "Normal",
        1: "Atenção",
        2: "Urgente",
        3: "ATRASO",
    }.get(priority, "Desconhecido")


def solver_result_to_gantt(
    result: ScheduleResult,
    isop: ISOPData,
    ref_date: date | None = None,
) -> dict:
    """Convert a ScheduleResult into render-ready Gantt JSON.

    Returns a dict with:
    - jobs: list of Gantt blocks with colors, positions, labels
    - machines: list of machine IDs
    - kpis: schedule KPIs
    - time_range: {start, end} dates
    """
    rdate = ref_date or isop.date_range[0]
    horizon_start = datetime.combine(rdate, time(7, 0))
    horizon_end = datetime.combine(
        isop.date_range[1] + timedelta(days=5), time(0, 0)
    )
    total_minutes = (horizon_end - horizon_start).total_seconds() / 60

    gantt_jobs = []
    for job in result.jobs:
        # Compute bar position as percentage of timeline
        job_start_min = (job.start - horizon_start).total_seconds() / 60
        job_duration_min = (job.end - job.start).total_seconds() / 60

        bar_left_pct = max(0, (job_start_min / total_minutes) * 100) if total_minutes > 0 else 0
        bar_width_pct = max(0.1, (job_duration_min / total_minutes) * 100) if total_minutes > 0 else 0

        # Lookup designation from ISOP
        sku_data = isop.skus.get(job.sku)
        designation = sku_data.designation if sku_data else job.sku

        gantt_jobs.append({
            "job_id": job.job_id,
            "sku": job.sku,
            "designation": designation,
            "machine": job.machine,
            "tool": job.tool,
            "qty": job.qty,
            "start_iso": job.start.isoformat(),
            "end_iso": job.end.isoformat(),
            "shift": job.shift,
            "duration_hours": round(job_duration_min / 60, 1),
            "setup_minutes": job.setup_minutes,
            "production_minutes": job.production_minutes,
            "clients": job.clients,
            "priority": job.priority,
            "priority_label": _priority_label(job.priority),
            "color": _priority_color(job.priority),
            "bar_left_pct": round(bar_left_pct, 2),
            "bar_width_pct": round(bar_width_pct, 2),
            "is_twin": job.is_twin,
            "twin_outputs": job.twin_outputs,
        })

    return {
        "jobs": gantt_jobs,
        "machines": isop.machines,
        "kpis": result.kpis.model_dump(),
        "time_range": {
            "start": rdate.isoformat(),
            "end": isop.date_range[1].isoformat(),
        },
        "solver_status": result.solver_status,
        "solve_time_seconds": result.solve_time_seconds,
        "infeasible_count": len(result.infeasible_orders),
    }


# ─── Full Pipeline ──────────────────────────────────────────────────────────


def run_pipeline(
    isop: ISOPData,
    *,
    config: dict | None = None,
    today: date | None = None,
) -> dict:
    """Run the full pipeline: ISOP → SolverInput → solve → GanttResponse."""
    from src.engine.solver import solve_schedule

    solver_input = isop_to_solver_input(isop, config=config, today=today)
    result = solve_schedule(solver_input)
    return solver_result_to_gantt(result, isop, ref_date=today or isop.date_range[0])
