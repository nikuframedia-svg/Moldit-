"""Tier 1 — Slack Analytics: Moldit Planner.

Risk assessment from schedule structure. No simulation. <50ms.
Uses Moldit types (SegmentoMoldit, Operacao, Maquina).
"""

from __future__ import annotations

from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit as Segment
from backend.types import MolditEngineData as EngineData

from .types import MachineRisk, OpRisk

# Risk thresholds (days of slack)
SLACK_CRITICAL = 0
SLACK_HIGH = 1
SLACK_MEDIUM = 3

# Statistical parameters for risk estimation
CV_PROCESSING = 0.10
CV_SETUP = 0.20
Z_95 = 1.645


def compute_op_risks(
    segments: list[Segment],
    engine_data: EngineData,
    config: FactoryConfig | None = None,
) -> list[OpRisk]:
    """Compute risk per operation from schedule slack.

    Risk score = max(0, 1 - slack_min / (sigma * Z_95))
    where sigma = CV_PROCESSING * work_min + CV_SETUP * setup_min.
    """
    ops_map = {o.id: o for o in engine_data.operacoes}

    # Parse molde deadlines: "S15" → 75 working days
    molde_deadline: dict[str, int] = {}
    for m in engine_data.moldes:
        dl = m.deadline.strip().upper() if m.deadline else ""
        if dl.startswith("S") and dl[1:].isdigit():
            molde_deadline[m.id] = int(dl[1:]) * 5

    # Completion day and machine per op (from segments)
    op_end: dict[int, int] = {}
    op_machine: dict[int, str] = {}
    for seg in segments:
        if seg.op_id not in op_end or seg.dia > op_end[seg.op_id]:
            op_end[seg.op_id] = seg.dia
            op_machine[seg.op_id] = seg.maquina_id

    day_cap_min = config.day_capacity_min if config else 960

    risks: list[OpRisk] = []
    for op_id, comp_day in op_end.items():
        op = ops_map.get(op_id)
        if not op:
            continue

        deadline_day = molde_deadline.get(op.molde, 9999)
        slack_days = deadline_day - comp_day
        slack_min = slack_days * day_cap_min

        # Estimated standard deviation of production time
        work_min = op.work_h * 60
        setup_min = 60.0  # default 1h
        sigma = work_min * CV_PROCESSING + setup_min * CV_SETUP
        threshold = sigma * Z_95

        if threshold > 0:
            risk_score = max(0.0, min(1.0, 1.0 - slack_min / threshold))
        else:
            risk_score = 0.0 if slack_days > 0 else 1.0

        if slack_days <= SLACK_CRITICAL:
            level = "critical"
        elif slack_days <= SLACK_HIGH:
            level = "high"
        elif slack_days <= SLACK_MEDIUM:
            level = "medium"
        else:
            level = "low"

        binding = (
            "capacity" if slack_days <= 0
            else ("crew" if slack_days <= 1 else "none")
        )

        risks.append(OpRisk(
            op_id=op_id,
            molde=op.molde,
            machine_id=op_machine.get(op_id, ""),
            edd=deadline_day,
            completion_day=comp_day,
            slack_days=slack_days,
            slack_min=slack_min,
            risk_score=round(risk_score, 3),
            risk_level=level,
            binding_constraint=binding,
        ))

    return risks


def compute_machine_risks(
    segments: list[Segment],
    op_risks: list[OpRisk],
    engine_data: EngineData,
    config: FactoryConfig | None = None,
) -> list[MachineRisk]:
    """Compute risk per machine from utilisation and operation slack."""
    n_days = max((s.dia for s in segments), default=0) + 1

    # Minutes used per (machine, day)
    used: dict[tuple[str, int], float] = defaultdict(float)
    for seg in segments:
        used[(seg.maquina_id, seg.dia)] += (seg.duracao_h + seg.setup_h) * 60

    results: list[MachineRisk] = []
    for m in engine_data.maquinas:
        if m.regime_h == 0:
            continue  # skip external
        machine_cap = m.regime_h * 60
        daily_util = [
            used.get((m.id, d), 0) / machine_cap
            for d in range(n_days)
        ]
        peak = max(daily_util) if daily_util else 0
        avg = sum(daily_util) / len(daily_util) if daily_util else 0
        critical = sum(
            1 for lr in op_risks
            if lr.machine_id == m.id and lr.risk_level in ("critical", "high")
        )

        results.append(MachineRisk(
            machine_id=m.id,
            peak_utilization=round(peak, 3),
            avg_utilization=round(avg, 3),
            critical_op_count=critical,
            bottleneck_score=0.0,
        ))

    return results


def compute_health_score(
    op_risks: list[OpRisk],
    machine_risks: list[MachineRisk],
) -> int:
    """Health score 0-100. 100 = safe.

    Weighted combination:
    1. % ops without risk (40%)
    2. 1 - max peak utilisation (20%)
    3. 1 - % critical ops (20%)
    4. Avg slack normalised (20%)
    """
    n = len(op_risks) or 1

    safe_pct = sum(1 for lr in op_risks if lr.risk_level == "low") / n
    critical_pct = sum(1 for lr in op_risks if lr.risk_level == "critical") / n
    max_peak = max((mr.peak_utilization for mr in machine_risks), default=0)
    avg_slack = sum(lr.slack_days for lr in op_risks) / n
    slack_norm = min(1.0, avg_slack / 10.0)

    score = (
        safe_pct * 40
        + (1 - max_peak) * 20
        + (1 - critical_pct) * 20
        + slack_norm * 20
    )
    return max(0, min(100, round(score)))
