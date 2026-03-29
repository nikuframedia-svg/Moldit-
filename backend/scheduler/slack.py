"""Slack computation via Critical Path Method."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData


@dataclass
class SlackInfo:
    op_id: int
    earliest_start_h: float  # earliest possible start (hours from day 0)
    latest_start_h: float    # latest possible start without delaying project
    slack_h: float            # latest - earliest
    no_caminho_critico: bool  # True if slack == 0


def _op_duration_from_segments(segmentos: list[SegmentoMoldit]) -> dict[int, float]:
    """Sum total duration per op_id from segments."""
    dur: dict[int, float] = defaultdict(float)
    for s in segmentos:
        dur[s.op_id] += s.duracao_h + s.setup_h
    return dict(dur)


def _op_absolute_start(segmentos: list[SegmentoMoldit]) -> dict[int, float]:
    """Get absolute start (dia * 24 + inicio_h) per op from segments."""
    starts: dict[int, float] = {}
    for s in segmentos:
        abs_h = s.dia * 24.0 + s.inicio_h
        if s.op_id not in starts or abs_h < starts[s.op_id]:
            starts[s.op_id] = abs_h
    return starts


def compute_slack(
    data: MolditEngineData,
    segmentos: list[SegmentoMoldit],
) -> dict[int, SlackInfo]:
    """Compute slack for each operation using CPM forward+backward pass."""
    if not segmentos:
        return {}

    # 1. Build op_duration map from segmentos
    op_dur = _op_duration_from_segments(segmentos)
    scheduled_ops = set(op_dur.keys())

    # DAG: only consider scheduled ops
    dag = data.dag
    dag_rev = data.dag_reverso

    # 2. Forward pass: earliest_start, earliest_finish
    earliest_start: dict[int, float] = {}
    earliest_finish: dict[int, float] = {}

    # Topological order via Kahn's
    in_degree: dict[int, int] = {oid: 0 for oid in scheduled_ops}
    for oid in scheduled_ops:
        for pred in dag_rev.get(oid, []):
            if pred in scheduled_ops:
                in_degree[oid] += 1

    queue: list[int] = [oid for oid, deg in in_degree.items() if deg == 0]
    topo_order: list[int] = []

    while queue:
        queue.sort()  # deterministic
        oid = queue.pop(0)
        topo_order.append(oid)
        for succ in dag.get(oid, []):
            if succ not in in_degree:
                continue
            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                queue.append(succ)

    # Add any remaining (cyclic/orphan) ops
    for oid in scheduled_ops:
        if oid not in topo_order:
            topo_order.append(oid)

    # Forward pass
    for oid in topo_order:
        preds = [p for p in dag_rev.get(oid, []) if p in scheduled_ops]
        if preds:
            es = max(earliest_finish.get(p, 0.0) for p in preds)
        else:
            es = 0.0
        earliest_start[oid] = es
        earliest_finish[oid] = es + op_dur.get(oid, 0.0)

    # 3. Project end
    if not earliest_finish:
        return {}
    project_end = max(earliest_finish.values())

    # 4. Backward pass: latest_finish, latest_start
    latest_finish: dict[int, float] = {}
    latest_start: dict[int, float] = {}

    for oid in reversed(topo_order):
        succs = [s for s in dag.get(oid, []) if s in scheduled_ops]
        if succs:
            lf = min(latest_start.get(s, project_end) for s in succs)
        else:
            lf = project_end
        latest_finish[oid] = lf
        latest_start[oid] = lf - op_dur.get(oid, 0.0)

    # 5. Compute slack
    result: dict[int, SlackInfo] = {}
    eps = 0.01  # tolerance for floating point
    for oid in scheduled_ops:
        es = earliest_start.get(oid, 0.0)
        ls = latest_start.get(oid, 0.0)
        slack = max(0.0, ls - es)
        on_critical = slack < eps
        result[oid] = SlackInfo(
            op_id=oid,
            earliest_start_h=round(es, 2),
            latest_start_h=round(ls, 2),
            slack_h=round(slack, 2),
            no_caminho_critico=on_critical,
        )

    return result
