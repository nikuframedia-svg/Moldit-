"""Transform orchestrator — Moldit Planner.

Parses MPP file, enriches with factory config, validates DAG, applies progress.
"""

from __future__ import annotations

import logging
from collections import deque

from backend.config.types import FactoryConfig
from backend.types import MolditEngineData

logger = logging.getLogger(__name__)


def transform(
    filepath: str,
    config: FactoryConfig | None = None,
) -> MolditEngineData:
    """Parse MPP file and return enriched MolditEngineData."""
    from backend.parser.mpp_reader import parse_mpp

    if config is None:
        from backend.config.loader import load_config
        config = load_config()

    data = parse_mpp(filepath)
    data = _enrich_from_config(data, config)
    _validate_dag(data.dag)
    data = _apply_progress(data)
    data = _fix_electrodes(data, config)
    data.feriados = _resolve_holidays(config)
    return data


def _enrich_from_config(
    data: MolditEngineData, config: FactoryConfig,
) -> MolditEngineData:
    """Apply regime_h, setup_h from factory config to machines.

    Also merge compatibility from config if present.
    """
    machine_configs = config.machines
    for maq in data.maquinas:
        if maq.id in machine_configs:
            mc = machine_configs[maq.id]
            maq.regime_h = mc.regime_h
            maq.setup_h = mc.setup_h
            maq.e_externo = mc.e_externo
            maq.grupo = mc.group

    # Merge compatibility from config (additive)
    if config.compatibilidade:
        for code, machines in config.compatibilidade.items():
            existing = data.compatibilidade.get(code, [])
            for m in machines:
                if m not in existing:
                    existing.append(m)
            data.compatibilidade[code] = existing

    return data


def _validate_dag(dag: dict[int, list[int]]) -> None:
    """Validate DAG is acyclic using topological sort (Kahn's algorithm).

    Raises ValueError on cycle detection.
    """
    # Collect all nodes
    all_nodes: set[int] = set()
    in_degree: dict[int, int] = {}
    for node, succs in dag.items():
        all_nodes.add(node)
        for s in succs:
            all_nodes.add(s)

    for node in all_nodes:
        in_degree[node] = 0
    for node, succs in dag.items():
        for s in succs:
            in_degree[s] = in_degree.get(s, 0) + 1

    queue = deque(n for n, deg in in_degree.items() if deg == 0)
    count = 0
    while queue:
        node = queue.popleft()
        count += 1
        for succ in dag.get(node, []):
            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                queue.append(succ)

    if count != len(all_nodes):
        raise ValueError(
            f"DAG contains a cycle: processed {count}/{len(all_nodes)} nodes"
        )


def _apply_progress(data: MolditEngineData) -> MolditEngineData:
    """Recalculate work_restante_h based on progress percentage."""
    for op in data.operacoes:
        if op.progresso >= 100.0:
            op.work_restante_h = 0.0
        else:
            op.work_restante_h = op.work_h * (1.0 - op.progresso / 100.0)
    return data


def _fix_electrodes(
    data: MolditEngineData, config: FactoryConfig,
) -> MolditEngineData:
    """Fix electrode operations with 0h work — apply default duration.

    Electrode codes: EL001, EL005 (fabricacao e acabamento de electrodos).
    """
    default_h = config.electrodos_default_h
    fixed = 0
    for op in data.operacoes:
        if op.codigo in ("EL001", "EL005") and op.work_h <= 0.0:
            op.work_h = default_h
            op.duracao_h = default_h
            op.work_restante_h = default_h * (1.0 - op.progresso / 100.0)
            fixed += 1

    if fixed:
        logger.info("Fixed %d electrode ops with default %gh", fixed, default_h)

    return data


def _resolve_holidays(config: FactoryConfig) -> list[str]:
    """Return holiday date strings from config."""
    return list(config.holidays)
