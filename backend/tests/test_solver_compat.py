"""Tests for solver compat endpoint — Fase 3A integration.

Validates that POST /v1/solver/schedule accepts the frontend's
SolverRequest format and returns the SolverResult format.
"""

from __future__ import annotations

# ─── Helpers ─────────────────────────────────────────────────────────────────


def _make_request(
    n_jobs: int = 2,
    due_date_min: int = 2040,
    duration_min: int = 120,
    setup_min: int = 30,
    twin_pairs: list | None = None,
    time_limit_s: int = 10,
) -> dict:
    """Build a SolverCompatRequest dict."""
    jobs = []
    for i in range(n_jobs):
        jobs.append({
            "id": f"job_{i}",
            "sku": f"SKU_{i}",
            "due_date_min": due_date_min + i * 1020,
            "weight": 1.0,
            "operations": [
                {
                    "id": f"op_{i}",
                    "machine_id": "PRM019",
                    "tool_id": f"T{i % 3}",
                    "duration_min": duration_min,
                    "setup_min": setup_min,
                    "operators": 1,
                    "calco_code": None,
                },
            ],
        })
    return {
        "jobs": jobs,
        "machines": [{"id": "PRM019", "capacity_min": 1020}],
        "config": {
            "time_limit_s": time_limit_s,
            "objective": "weighted_tardiness",
            "num_workers": 2,
        },
        "twin_pairs": twin_pairs or [],
        "constraints": {
            "setup_crew": True,
            "tool_timeline": True,
            "calco_timeline": True,
            "operator_pool": False,
        },
    }


# ─── Tests ───────────────────────────────────────────────────────────────────


def test_compat_request_format(client):
    """POST with frontend's exact format returns 200."""
    r = client.post("/v1/solver/schedule", json=_make_request())
    assert r.status_code == 200


def test_compat_response_format(client):
    """Response has all fields that solverResultToBlocks() expects."""
    r = client.post("/v1/solver/schedule", json=_make_request())
    data = r.json()

    # Top-level fields
    for key in (
        "schedule", "makespan_min", "total_tardiness_min",
        "weighted_tardiness", "solver_used", "solve_time_s",
        "status", "objective_value", "n_ops",
    ):
        assert key in data, f"Missing key: {key}"

    assert data["status"] in ("optimal", "feasible")
    assert data["n_ops"] == 2


def test_compat_small_schedule(client):
    """2 jobs → valid schedule with correct start/end."""
    r = client.post("/v1/solver/schedule", json=_make_request())
    data = r.json()

    assert len(data["schedule"]) == 2
    for sop in data["schedule"]:
        # Each ScheduledOp has required fields
        for key in (
            "op_id", "job_id", "machine_id", "tool_id",
            "start_min", "end_min", "setup_min",
            "is_tardy", "tardiness_min",
        ):
            assert key in sop, f"Missing key in ScheduledOp: {key}"

        # end > start
        assert sop["end_min"] > sop["start_min"]
        # duration = end - start = duration_min + setup_min = 150
        assert sop["end_min"] - sop["start_min"] == 150


def test_compat_twin_pairs(client):
    """Twin pairs pass through correctly."""
    req = _make_request(
        n_jobs=2,
        twin_pairs=[{
            "op_id_a": "op_0",
            "op_id_b": "op_1",
            "machine_id": "PRM019",
            "tool_id": "T0",
        }],
    )
    r = client.post("/v1/solver/schedule", json=req)
    data = r.json()

    assert data["status"] in ("optimal", "feasible")
    # Check twin flags
    twins = [s for s in data["schedule"] if s.get("is_twin_production")]
    assert len(twins) == 2
    assert twins[0]["twin_partner_op_id"] == twins[1]["op_id"]


def test_compat_tardiness_detected(client):
    """Jobs with tight deadline → is_tardy=true for some."""
    # All 3 jobs share the same tight deadline: shift A start + 1 op
    # Only 1 fits before deadline, the other 2 must be tardy
    tight_deadline = 420 + 150  # 570 min
    jobs = []
    for i in range(3):
        jobs.append({
            "id": f"job_{i}",
            "sku": f"SKU_{i}",
            "due_date_min": tight_deadline,  # same deadline for all
            "weight": 1.0,
            "operations": [{
                "id": f"op_{i}",
                "machine_id": "PRM019",
                "tool_id": "T0",
                "duration_min": 120,
                "setup_min": 30,
                "operators": 1,
                "calco_code": None,
            }],
        })
    req = {
        "jobs": jobs,
        "machines": [{"id": "PRM019"}],
        "config": {"time_limit_s": 10, "objective": "weighted_tardiness", "num_workers": 2},
        "twin_pairs": [],
        "constraints": {"setup_crew": True, "tool_timeline": True, "calco_timeline": True, "operator_pool": False},
    }
    r = client.post("/v1/solver/schedule", json=req)
    data = r.json()

    assert data["status"] in ("optimal", "feasible")
    tardy = [s for s in data["schedule"] if s["is_tardy"]]
    assert len(tardy) >= 1
    assert data["total_tardiness_min"] > 0


def test_compat_fallback_heuristic(client):
    """>200 ops triggers heuristic fallback."""
    req = _make_request(n_jobs=250, time_limit_s=5)
    r = client.post("/v1/solver/schedule", json=req)
    data = r.json()

    assert data["solver_used"] == "heuristic"
    assert data["status"] == "feasible"
    assert data["n_ops"] == 250
    assert len(data["schedule"]) == 250
