"""Operation flexibility classification."""
from __future__ import annotations

from backend.scheduler.slack import SlackInfo
from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData, Operacao


def count_compatible_machines(op: Operacao, data: MolditEngineData) -> int:
    """Count how many machines are compatible with this operation's codigo."""
    candidates = data.compatibilidade.get(op.codigo, [])
    machine_ids = {m.id for m in data.maquinas}
    return sum(1 for c in candidates if c in machine_ids)


def has_valid_swap(
    op_id: int,
    segmentos: list[SegmentoMoldit],
    data: MolditEngineData,
) -> bool:
    """Check if this op can be swapped with another op on the same machine without violating DAG."""
    # Find machine for this op
    op_machine = None
    for s in segmentos:
        if s.op_id == op_id:
            op_machine = s.maquina_id
            break
    if op_machine is None:
        return False

    # Find other ops on the same machine
    other_ops = {s.op_id for s in segmentos if s.maquina_id == op_machine and s.op_id != op_id}
    if not other_ops:
        return False

    # Check if any swap is valid (no DAG violation)
    # Get all ancestors and descendants of op_id
    ancestors = _get_all_ancestors(op_id, data.dag_reverso)
    descendants = _get_all_descendants(op_id, data.dag)

    for other_id in other_ops:
        # Can't swap if the other op is an ancestor or descendant
        if other_id in ancestors or other_id in descendants:
            continue
        return True

    return False


def _get_all_ancestors(op_id: int, dag_rev: dict[int, list[int]]) -> set[int]:
    """Get all transitive ancestors of an op."""
    visited: set[int] = set()
    stack = list(dag_rev.get(op_id, []))
    while stack:
        curr = stack.pop()
        if curr in visited:
            continue
        visited.add(curr)
        stack.extend(dag_rev.get(curr, []))
    return visited


def _get_all_descendants(op_id: int, dag: dict[int, list[int]]) -> set[int]:
    """Get all transitive descendants of an op."""
    visited: set[int] = set()
    stack = list(dag.get(op_id, []))
    while stack:
        curr = stack.pop()
        if curr in visited:
            continue
        visited.add(curr)
        stack.extend(dag.get(curr, []))
    return visited


def classify_operations(
    data: MolditEngineData,
    segmentos: list[SegmentoMoldit],
    slacks: dict[int, SlackInfo],
) -> dict[int, str]:
    """Classify each operation: 'verde', 'azul', 'laranja', 'vermelho', 'cinzento'."""
    ops_by_id = {op.id: op for op in data.operacoes}
    scheduled_ops = {s.op_id for s in segmentos}

    result: dict[int, str] = {}

    for op_id in scheduled_ops:
        op = ops_by_id.get(op_id)
        if op is None:
            continue

        # cinzento: completed
        if op.progresso >= 100.0:
            result[op_id] = "cinzento"
            continue

        slack_info = slacks.get(op_id)
        on_critical = slack_info.no_caminho_critico if slack_info else False
        slack_h = slack_info.slack_h if slack_info else 0.0
        n_machines = count_compatible_machines(op, data)

        if on_critical and n_machines <= 1 and slack_h == 0.0:
            # vermelho: critical path, no alternatives, no slack
            result[op_id] = "vermelho"
        elif on_critical and n_machines >= 2:
            # laranja: critical path but has machine alternatives
            result[op_id] = "laranja"
        elif slack_h > 0.0 or n_machines >= 2 or has_valid_swap(op_id, segmentos, data):
            # verde: has slack OR has alternatives OR has valid swap
            result[op_id] = "verde"
        else:
            # azul: fixed, optimized
            result[op_id] = "azul"

    return result
