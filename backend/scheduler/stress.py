"""Stress map — fragility score per scheduled segment.

Identifies which parts of the schedule are most vulnerable to disruption.
Read-only analysis: does not modify any scheduling data.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.scheduler.types import Lot, Segment


@dataclass(slots=True)
class SegmentStress:
    """Stress info for a single segment."""

    lot_id: str
    machine_id: str
    day_idx: int
    stress: float          # numeric score
    level: str             # "critical" | "warning" | "ok"
    slack_days: float      # days of slack until EDD
    utilisation: float     # machine utilisation ratio


def compute_stress_map(
    segments: list[Segment],
    lots: list[Lot],
    n_days: int,
    n_holidays: int = 0,
    day_capacity: int = 1020,
) -> list[SegmentStress]:
    """Compute stress for each productive segment.

    Formula: stress = urgency × load_factor × (1 / max(slack, 0.5))

    Classification:
        >= 2.0  critical (red)    — any disruption causes tardy
        1.0-2.0 warning (yellow)  — 1-2 day disruption causes tardy
        < 1.0   ok (green)        — has slack
    """
    # 1. Completion day per lot
    lot_completion: dict[str, int] = {}
    for seg in segments:
        if seg.day_idx >= 0 and seg.prod_min > 0:
            prev = lot_completion.get(seg.lot_id, -1)
            if seg.day_idx > prev:
                lot_completion[seg.lot_id] = seg.day_idx

    # 2. EDD per lot
    lot_edd: dict[str, int] = {}
    for lot in lots:
        lot_edd[lot.id] = lot.edd

    # 3. Utilisation per machine
    machine_used: dict[str, float] = defaultdict(float)
    for seg in segments:
        if seg.day_idx >= 0:
            machine_used[seg.machine_id] += seg.prod_min + seg.setup_min

    n_work_days = max(n_days - n_holidays, 1)
    total_available = float(n_work_days * day_capacity)

    machine_util: dict[str, float] = {}
    for m_id, used in machine_used.items():
        machine_util[m_id] = min(used / total_available, 1.0) if total_available > 0 else 0.5

    # 4. Compute stress per segment
    results: list[SegmentStress] = []
    for seg in segments:
        if seg.day_idx < 0 or seg.prod_min <= 0:
            continue  # skip buffer days and setup-only segments

        edd = lot_edd.get(seg.lot_id, n_days)
        completion = lot_completion.get(seg.lot_id, seg.day_idx)
        slack = max(edd - completion, 0)

        util = machine_util.get(seg.machine_id, 0.5)

        # Urgency: 0 (very early) to 1 (at EDD)
        urgency = max(0.0, 1.0 - slack / max(edd, 1)) if edd > 0 else 1.0

        # Stress score
        stress = urgency * util * (1.0 / max(slack, 0.5))

        # Classification
        if stress >= 2.0:
            level = "critical"
        elif stress >= 1.0:
            level = "warning"
        else:
            level = "ok"

        results.append(SegmentStress(
            lot_id=seg.lot_id,
            machine_id=seg.machine_id,
            day_idx=seg.day_idx,
            stress=round(stress, 2),
            level=level,
            slack_days=float(slack),
            utilisation=round(util, 3),
        ))

    return results


def stress_summary(stress_map: list[SegmentStress]) -> dict:
    """Summary for dashboard display."""
    if not stress_map:
        return {
            "total_segments": 0,
            "critical": 0,
            "warning": 0,
            "ok": 0,
            "fragility_pct": 0.0,
            "worst_machine": None,
            "worst_machine_stress": 0.0,
            "top_fragile": [],
        }

    critical = sum(1 for s in stress_map if s.level == "critical")
    warning = sum(1 for s in stress_map if s.level == "warning")
    ok = sum(1 for s in stress_map if s.level == "ok")

    # Top 5 most fragile segments
    top_fragile = sorted(stress_map, key=lambda s: s.stress, reverse=True)[:5]

    # Most fragile machine (average stress)
    machine_stress: dict[str, list[float]] = defaultdict(list)
    for s in stress_map:
        machine_stress[s.machine_id].append(s.stress)
    machine_avg = {
        m: sum(v) / len(v) for m, v in machine_stress.items()
    }
    worst_machine = max(machine_avg, key=machine_avg.get) if machine_avg else None  # type: ignore[arg-type]

    return {
        "total_segments": len(stress_map),
        "critical": critical,
        "warning": warning,
        "ok": ok,
        "fragility_pct": round(critical / max(len(stress_map), 1) * 100, 1),
        "worst_machine": worst_machine,
        "worst_machine_stress": round(machine_avg.get(worst_machine, 0), 2) if worst_machine else 0.0,
        "top_fragile": [
            {
                "lot": s.lot_id,
                "machine": s.machine_id,
                "day": s.day_idx,
                "stress": s.stress,
                "slack": s.slack_days,
            }
            for s in top_fragile
        ],
    }
