"""Schedule API endpoints — render-ready JSON for frontend."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, UploadFile

from src.api.state import app_state

router = APIRouter(prefix="/api", tags=["schedule"])


@router.post("/load-isop")
async def load_isop(file: UploadFile) -> dict:
    """Parse ISOP Excel, run solver, return summary."""
    import tempfile
    from pathlib import Path

    from src.engine.transform import run_pipeline
    from src.parser.isop import parse_isop

    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "File must be .xlsx")

    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)

    try:
        isop = parse_isop(tmp_path)
    except Exception as e:
        raise HTTPException(400, f"Failed to parse ISOP: {e}") from e
    finally:
        tmp_path.unlink(missing_ok=True)

    config = app_state.get_config()
    today = date.today()
    gantt = run_pipeline(isop, config=config, today=today)

    from src.engine.alerts import compute_alerts

    alerts = compute_alerts(isop, today)

    app_state.isop_data = isop
    app_state.schedule = gantt
    app_state.alerts = [a.model_dump() for a in alerts]

    return {
        "status": "ok",
        "summary": {
            "skus": len(isop.skus),
            "orders": len(isop.orders),
            "machines": isop.machines,
            "tools_count": len(isop.tools),
            "solver_status": gantt["solver_status"],
            "solve_time_s": gantt["solve_time_seconds"],
            "jobs_count": len(gantt["jobs"]),
            "alerts_count": len(alerts),
        },
    }


@router.get("/dashboard")
def dashboard() -> dict:
    """KPIs + top alerts + machine load."""
    _require_loaded()
    return {
        "kpis": app_state.schedule["kpis"],
        "top_alerts": (app_state.alerts or [])[:5],
        "machines": app_state.schedule["machines"],
    }


@router.get("/schedule")
def get_schedule() -> dict:
    """Full schedule — Gantt-ready JSON."""
    _require_loaded()
    return app_state.schedule


@router.get("/schedule/{machine_id}")
def get_machine_schedule(machine_id: str) -> dict:
    """Schedule filtered for one machine."""
    _require_loaded()
    gantt = app_state.schedule
    jobs = [j for j in gantt["jobs"] if j["machine"] == machine_id]
    if not jobs and machine_id not in gantt["machines"]:
        raise HTTPException(404, f"Machine {machine_id} not found")
    return {"machine": machine_id, "jobs": jobs}


@router.get("/machines")
def get_machines() -> dict:
    """Machine load summary."""
    _require_loaded()
    gantt = app_state.schedule
    machines = {}
    for m_id in gantt["machines"]:
        m_jobs = [j for j in gantt["jobs"] if j["machine"] == m_id]
        machines[m_id] = {
            "jobs_count": len(m_jobs),
            "total_production_minutes": sum(j.get("production_minutes", 0) for j in m_jobs),
            "total_qty": sum(j["qty"] for j in m_jobs),
        }
    return {"machines": machines}


@router.post("/recalculate")
def recalculate() -> dict:
    """Re-run solver with current config."""
    _require_loaded()
    from src.engine.alerts import compute_alerts
    from src.engine.transform import run_pipeline

    gantt = run_pipeline(app_state.isop_data, config=app_state.get_config(), today=date.today())
    alerts = compute_alerts(app_state.isop_data, date.today())
    app_state.schedule = gantt
    app_state.alerts = [a.model_dump() for a in alerts]
    return {"status": "recalculated", "jobs_count": len(gantt["jobs"]), "alerts_count": len(alerts)}


def _require_loaded():
    if app_state.schedule is None:
        raise HTTPException(400, "No ISOP loaded. POST /api/load-isop first.")
