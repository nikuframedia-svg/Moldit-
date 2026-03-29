"""Coverage Audit — Moldit Planner.

Per-mold coverage summary: ops scheduled vs total, ops without machine, DAG gaps.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.scheduler.types import SegmentoMoldit as Segment
from backend.types import MolditEngineData as EngineData


@dataclass(slots=True)
class MoldCoverage:
    molde_id: str
    total_ops: int
    ops_agendadas: int
    cobertura_pct: float
    ops_sem_maquina: int
    dag_gaps: int  # ops in DAG with no predecessor scheduled


@dataclass(slots=True)
class CoverageAudit:
    overall_coverage_pct: float
    molds: list[MoldCoverage]
    uncovered_ops: list[int]  # op IDs with no segment
    summary: str


def compute_coverage_audit(
    segments: list[Segment],
    engine_data: EngineData,
) -> CoverageAudit:
    """Per-mold coverage: ops_agendadas / total, ops without machine, DAG gaps."""

    # Set of op_ids that have at least one segment
    scheduled_op_ids = {s.op_id for s in segments}

    # Group ops by molde
    ops_by_molde: dict[str, list] = defaultdict(list)
    for op in engine_data.operacoes:
        ops_by_molde[op.molde].append(op)

    mold_coverages: list[MoldCoverage] = []
    all_uncovered: list[int] = []
    total_ops = 0
    total_scheduled = 0

    for molde in engine_data.moldes:
        ops = ops_by_molde.get(molde.id, [])
        n_total = len(ops)
        n_scheduled = sum(1 for op in ops if op.id in scheduled_op_ids)
        n_sem_maquina = sum(1 for op in ops if not op.recurso)

        # DAG gaps: ops whose predecessors are not scheduled
        dag_gaps = 0
        for op in ops:
            predecessors = engine_data.dag_reverso.get(op.id, [])
            for pred_id in predecessors:
                if pred_id not in scheduled_op_ids and any(
                    o.id == pred_id and o.work_restante_h > 0 for o in engine_data.operacoes
                ):
                    dag_gaps += 1
                    break

        cov_pct = (n_scheduled / n_total * 100) if n_total > 0 else 100.0

        mold_coverages.append(MoldCoverage(
            molde_id=molde.id,
            total_ops=n_total,
            ops_agendadas=n_scheduled,
            cobertura_pct=round(cov_pct, 1),
            ops_sem_maquina=n_sem_maquina,
            dag_gaps=dag_gaps,
        ))

        uncovered = [
            op.id for op in ops
            if op.id not in scheduled_op_ids and op.work_restante_h > 0
        ]
        all_uncovered.extend(uncovered)

        total_ops += n_total
        total_scheduled += n_scheduled

    overall_pct = (total_scheduled / total_ops * 100) if total_ops > 0 else 100.0

    summary = (
        f"{total_scheduled}/{total_ops} operacoes agendadas ({overall_pct:.0f}%). "
        f"{len(all_uncovered)} operacoes sem cobertura."
    )

    return CoverageAudit(
        overall_coverage_pct=round(overall_pct, 1),
        molds=mold_coverages,
        uncovered_ops=all_uncovered,
        summary=summary,
    )
