"""Scheduler entry point — Moldit Planner.

Pipeline:
  1. Validate input (Guardian)
  2. Build priority queue (topological + urgency)
  3. Assign machines (least-loaded compatible)
  4. Dispatch timeline (greedy forward)
  5. Score schedule (KPIs)
  6. Validate output (Guardian)
"""

from __future__ import annotations

import logging
import time

from backend.config.loader import load_config
from backend.config.types import FactoryConfig
from backend.guardian.guardian import validate_input, validate_output
from backend.scheduler.dispatch import (
    assign_machines,
    build_priority_queue,
    compute_operator_alerts,
    dispatch_timeline,
)
from backend.scheduler.scoring import compute_score
from backend.scheduler.types import ScheduleResult
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)


def schedule_all(
    data: MolditEngineData,
    audit: bool = False,
    config: FactoryConfig | None = None,
) -> ScheduleResult:
    """Run the full scheduling pipeline."""
    t0 = time.perf_counter()

    if config is None:
        config = load_config()

    # 1. Validate & clean input
    guardian_result = validate_input(data, config)
    cleaned = guardian_result.cleaned

    if not cleaned.operacoes:
        return ScheduleResult(
            warnings=["Sem operacoes para agendar"],
            time_ms=round((time.perf_counter() - t0) * 1000, 1),
        )

    # 2. Build lookup structures
    ops_by_id = {op.id: op for op in cleaned.operacoes}
    machines = {m.id: m for m in cleaned.maquinas}

    # 3. Priority queue
    priority_queue = build_priority_queue(
        ops=cleaned.operacoes,
        dag=cleaned.dag,
        dag_rev=cleaned.dag_reverso,
        moldes=cleaned.moldes,
        caminho_critico=cleaned.caminho_critico,
    )

    # 4. Assign machines
    assignments = assign_machines(
        ops_by_id=ops_by_id,
        priority_queue=priority_queue,
        compat=cleaned.compatibilidade,
        machines=machines,
        config=config,
    )

    # 5. Dispatch timeline
    segmentos = dispatch_timeline(
        ops_by_id=ops_by_id,
        priority_queue=priority_queue,
        assignments=assignments,
        dag_rev=cleaned.dag_reverso,
        machines=machines,
        config=config,
        ref_date=cleaned.data_referencia,
        holidays=cleaned.feriados or config.holidays,
    )

    # 6. Score
    score = compute_score(segmentos, cleaned, config)

    # 7. Operator alerts
    alerts = compute_operator_alerts(segmentos, machines, config)

    # 7b. Deadline violation warnings
    for v in score.get("deadline_violations", []):
        logger.warning(
            "VIOLAÇÃO DEADLINE: Molde %s ultrapassa %s por %d dias",
            v["molde"], v["deadline"], v["delta_dias"],
        )

    # 8. Output validation
    output_issues = validate_output(segmentos, cleaned)
    warnings = [issue.message for issue in guardian_result.issues]
    # Add deadline violation warnings
    for v in score.get("deadline_violations", []):
        warnings.append(
            f"VIOLAÇÃO DEADLINE: Molde {v['molde']} ultrapassa "
            f"{v['deadline']} por {v['delta_dias']} dias"
        )
    warnings.extend(issue.message for issue in output_issues)

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 1)

    logger.info(
        "Schedule complete: %d segments, %d ops, %.0fms",
        len(segmentos), score.get("ops_agendadas", 0), elapsed_ms,
    )

    return ScheduleResult(
        segmentos=segmentos,
        score=score,
        time_ms=elapsed_ms,
        warnings=warnings,
        alerts=alerts,
        caminho_critico=cleaned.caminho_critico,
        makespan_por_molde=score.get("makespan_por_molde", {}),
    )
