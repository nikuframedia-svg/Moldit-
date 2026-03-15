# Late Report (S-04)
# Generates a structured report of late orders with reasons and options.
# Priority hierarchy: ATRASO(hard) > RED(hard) > YELLOW(soft w=100) > Normal(w=10) > Lote(w=1)

from __future__ import annotations

from .schemas import SolverRequest, SolverResult


def build_late_report(
    result: SolverResult,
    request: SolverRequest,
) -> dict | None:
    """Build late order report from solver result.

    Returns None if OTD is 100% (no late orders).
    Otherwise returns a dict with:
      - otd_pct: overall OTD percentage
      - late_orders: list of late order details
      - bottleneck_machine: machine with most tardiness
      - total_late_min: total tardiness in minutes
    """
    if result.status not in ("optimal", "feasible"):
        return None

    # Build job metadata
    job_meta = {}
    for job in request.jobs:
        job_meta[job.id] = {
            "sku": job.sku,
            "due_date_min": job.due_date_min,
            "weight": job.weight,
        }

    # Find late ops (last op per job with tardiness > 0)
    late_orders = []
    machine_tardiness: dict[str, int] = {}

    for sop in result.schedule:
        if sop.tardiness_min > 0 and sop.is_tardy:
            meta = job_meta.get(sop.job_id, {})
            priority = _classify_priority(meta.get("weight", 1.0))

            late_orders.append(
                {
                    "job_id": sop.job_id,
                    "op_id": sop.op_id,
                    "sku": meta.get("sku", ""),
                    "machine_id": sop.machine_id,
                    "due_date_min": meta.get("due_date_min", 0),
                    "planned_end_min": sop.end_min,
                    "delay_min": sop.tardiness_min,
                    "priority": priority,
                    "weight": meta.get("weight", 1.0),
                }
            )

            machine_tardiness[sop.machine_id] = (
                machine_tardiness.get(sop.machine_id, 0) + sop.tardiness_min
            )

    if not late_orders:
        return None

    # Sort by priority (highest first), then by delay
    priority_order = {"ATRASO": 0, "RED": 1, "YELLOW": 2, "NORMAL": 3, "LOTE": 4}
    late_orders.sort(key=lambda x: (priority_order.get(x["priority"], 5), -x["delay_min"]))

    # OTD calculation
    total_jobs = len(request.jobs)
    late_job_ids = {lo["job_id"] for lo in late_orders}
    on_time_jobs = total_jobs - len(late_job_ids)
    otd_pct = round(on_time_jobs / total_jobs * 100, 1) if total_jobs > 0 else 100.0

    # Bottleneck machine
    bottleneck = max(machine_tardiness, key=machine_tardiness.get) if machine_tardiness else None

    return {
        "otd_pct": otd_pct,
        "late_orders": late_orders,
        "bottleneck_machine": bottleneck,
        "total_late_min": sum(lo["delay_min"] for lo in late_orders),
        "n_late": len(late_job_ids),
        "n_total": total_jobs,
    }


def _classify_priority(weight: float) -> str:
    """Classify job priority from weight.

    Priority hierarchy from CLAUDE.md:
    ATRASO (hard, w>=1000) > RED (hard, w>=100) > YELLOW (soft, w>=10)
    > NORMAL (w>=1) > LOTE (w<1)
    """
    if weight >= 1000:
        return "ATRASO"
    elif weight >= 100:
        return "RED"
    elif weight >= 10:
        return "YELLOW"
    elif weight >= 1:
        return "NORMAL"
    else:
        return "LOTE"
