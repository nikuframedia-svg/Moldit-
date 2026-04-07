"""Transform orchestrator — Moldit Planner.

Parses MPP file, enriches with factory config, validates DAG, applies progress.
"""

from __future__ import annotations

import logging
from collections import deque

from collections import defaultdict

from backend.config.types import FactoryConfig
from backend.types import Dependencia, Maquina, MolditEngineData

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
    data = _resolve_subcontracted(data)
    _validate_dag(data.dag)
    _relax_alternative_phases(data)
    data = _apply_progress(data)
    data = _fix_electrodes(data, config)
    data = _link_electrodes_to_erosion(data)
    _infer_compatibility(data)  # learn compat from existing assignments
    _add_missing_machines(data, config)  # after all compat changes
    data.feriados = _resolve_holidays(config)
    return data


def _enrich_from_config(
    data: MolditEngineData, config: FactoryConfig,
) -> MolditEngineData:
    """Apply regime_h, setup_h from factory config to machines.

    Also merges compatibility from config.
    """
    machine_configs = config.machines

    # Update existing machines from config
    for maq in data.maquinas:
        if maq.id in machine_configs:
            mc = machine_configs[maq.id]
            maq.regime_h = mc.regime_h
            maq.regime_pico_h = getattr(mc, "regime_pico_h", 0)
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


def _infer_compatibility(data: MolditEngineData) -> None:
    """Infer compatibility map from ops that already have a machine assigned.

    If op code FE010 is assigned to FE18-Rambaudi, then FE010 can run on
    FE18-Rambaudi. This lets the scheduler assign unassigned ops of the
    same code to known-compatible machines.
    """
    machine_ids = {m.id for m in data.maquinas}
    inferred = 0

    for op in data.operacoes:
        if not op.recurso or op.recurso not in machine_ids:
            continue
        code = op.codigo
        existing = data.compatibilidade.get(code, [])
        if op.recurso not in existing:
            existing.append(op.recurso)
            data.compatibilidade[code] = existing
            inferred += 1

    if inferred:
        logger.info(
            "Inferred %d compatibility entries from %d operation codes",
            inferred, len(data.compatibilidade),
        )


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


_ALTERNATIVE_GROUPS: list[set[str]] = [
    {"FE023", "FE024", "FE031", "FE032"},  # TD Trás/Lateral/Frente/Inclinado
    {"FE040", "FE050", "FE060"},            # Maq. Balancés/Postiços/Barras
]


def _relax_alternative_phases(data: MolditEngineData) -> None:
    """Remove sequential deps between ops that are actually alternatives.

    The MPP file sequences these ops (A→B→C→D) but the real process allows
    any order within the same mold. Removing these deps enables parallelism.
    Only removes deps where BOTH codes belong to the same alternative group.
    """
    ops_map = {o.id: o for o in data.operacoes}

    to_remove: set[tuple[int, int]] = set()
    for dep in data.dependencias:
        pred = ops_map.get(dep.predecessor_id)
        succ = ops_map.get(dep.sucessor_id)
        if not pred or not succ or pred.molde != succ.molde:
            continue
        for group in _ALTERNATIVE_GROUPS:
            if pred.codigo in group and succ.codigo in group:
                to_remove.add((dep.predecessor_id, dep.sucessor_id))
                break

    if not to_remove:
        return

    data.dependencias = [
        d for d in data.dependencias
        if (d.predecessor_id, d.sucessor_id) not in to_remove
    ]

    # Rebuild DAG from cleaned dependencies
    data.dag = defaultdict(list)
    data.dag_reverso = defaultdict(list)
    for d in data.dependencias:
        data.dag[d.predecessor_id].append(d.sucessor_id)
        data.dag_reverso[d.sucessor_id].append(d.predecessor_id)
    data.dag = dict(data.dag)
    data.dag_reverso = dict(data.dag_reverso)

    logger.info("Relaxed %d alternative-phase dependencies", len(to_remove))


def _apply_progress(data: MolditEngineData) -> MolditEngineData:
    """Recalculate work_restante_h based on progress percentage.

    If work_h is 0 but duracao_h > 0, use duracao_h as fallback.
    This happens when the .mpp has duration but no work (effort).
    """
    for op in data.operacoes:
        if op.progresso >= 100.0:
            op.work_restante_h = 0.0
        else:
            effective_h = op.work_h if op.work_h > 0 else op.duracao_h
            if effective_h > 0 and op.work_h <= 0:
                op.work_h = effective_h  # fix the source too
            op.work_restante_h = effective_h * (1.0 - op.progresso / 100.0)
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

    # Add electrode compatibility if missing
    if "EL001" not in data.compatibilidade:
        data.compatibilidade["EL001"] = ["FE29 - GT"]
    if "EL005" not in data.compatibilidade:
        data.compatibilidade["EL005"] = ["FE29 - GT"]

    return data


def _resolve_subcontracted(data: MolditEngineData) -> MolditEngineData:
    """Convert conditional 'Fora?' operations to external subcontracted work.

    Operations with recurso='?' are pending make/buy decisions.
    In Moldit these are subcontracted — route them to external machines.
    """
    _CODE_TO_EXTERNAL: dict[str, str] = {
        "FU001": "Externo/Furação",
    }
    _DEFAULT_EXTERNAL = "Externo/Geral"

    resolved = 0
    external_ids: set[str] = set()

    for op in data.operacoes:
        if not (op.e_condicional and op.recurso == "?"):
            continue

        ext_machine = _CODE_TO_EXTERNAL.get(op.codigo, _DEFAULT_EXTERNAL)
        op.recurso = ext_machine
        op.e_condicional = False
        external_ids.add(ext_machine)

        # Add to compatibility
        compat = data.compatibilidade.get(op.codigo, [])
        if ext_machine not in compat:
            compat.append(ext_machine)
            data.compatibilidade[op.codigo] = compat

        resolved += 1

    # Ensure external machines exist in data.maquinas
    existing_ids = {m.id for m in data.maquinas}
    for ext_id in external_ids:
        if ext_id not in existing_ids:
            data.maquinas.append(
                Maquina(id=ext_id, grupo="Externo", regime_h=0,
                        e_externo=True, setup_h=0.0),
            )

    if resolved:
        logger.info("Resolved %d subcontracted ops → external machines", resolved)

    return data


def _link_electrodes_to_erosion(data: MolditEngineData) -> MolditEngineData:
    """Auto-create FS dependencies: electrodes (EL001/EL005) → erosion (EE005).

    Within the same molde, electrode ops must finish before erosion can start.
    To avoid overconstraining (N electrodes × M erosions = too many edges),
    we link minimally: for each erosion op that has no electrode ancestor,
    add ONE dependency from the last electrode (highest ID) to that erosion.
    """
    electrodes_by_molde: dict[str, list[int]] = defaultdict(list)
    erosions_by_molde: dict[str, list[int]] = defaultdict(list)

    for op in data.operacoes:
        if op.codigo in ("EL001", "EL005"):
            electrodes_by_molde[op.molde].append(op.id)
        elif op.codigo == "EE005":
            erosions_by_molde[op.molde].append(op.id)

    el_id_set = {
        oid for ids in electrodes_by_molde.values() for oid in ids
    }

    existing_edges: set[tuple[int, int]] = {
        (d.predecessor_id, d.sucessor_id) for d in data.dependencias
    }

    added = 0
    for molde_id, el_ids in electrodes_by_molde.items():
        ee_ids = erosions_by_molde.get(molde_id, [])
        if not ee_ids:
            continue

        # Use the last electrode (highest ID) as the barrier predecessor
        barrier_el = max(el_ids)

        for ee_id in ee_ids:
            if _has_ancestor_in(ee_id, el_id_set, data.dag_reverso):
                continue
            if (barrier_el, ee_id) in existing_edges:
                continue

            dep = Dependencia(
                predecessor_id=barrier_el,
                sucessor_id=ee_id,
                tipo="FS",
            )
            data.dependencias.append(dep)
            data.dag.setdefault(barrier_el, []).append(ee_id)
            data.dag_reverso.setdefault(ee_id, []).append(barrier_el)
            existing_edges.add((barrier_el, ee_id))
            added += 1

    if added:
        logger.info(
            "Auto-linked %d electrode → erosion dependencies", added,
        )

    return data


def _has_ancestor_in(
    node: int,
    target_set: set[int],
    dag_rev: dict[int, list[int]],
) -> bool:
    """BFS backward from node to check if any ancestor is in target_set."""
    visited: set[int] = set()
    queue = deque([node])
    while queue:
        current = queue.popleft()
        for pred in dag_rev.get(current, []):
            if pred in target_set:
                return True
            if pred not in visited:
                visited.add(pred)
                queue.append(pred)
    return False


def _add_missing_machines(
    data: MolditEngineData, config: FactoryConfig,
) -> None:
    """Add config machines referenced in compatibility but missing from data.

    Runs AFTER all compatibility modifications (_fix_electrodes,
    _resolve_subcontracted) so it catches every machine that was added
    to compatibilidade but not to data.maquinas.
    """
    existing_ids = {m.id for m in data.maquinas}
    machine_configs = config.machines

    compat_machines: set[str] = set()
    for machines_list in data.compatibilidade.values():
        compat_machines.update(machines_list)

    added = 0
    for mid in sorted(compat_machines - existing_ids):
        if mid in machine_configs:
            mc = machine_configs[mid]
            data.maquinas.append(
                Maquina(id=mid, grupo=mc.group, regime_h=mc.regime_h,
                        regime_pico_h=getattr(mc, "regime_pico_h", 0),
                        e_externo=mc.e_externo, setup_h=mc.setup_h),
            )
            added += 1

    if added:
        logger.info("Added %d config machines missing from MPP data", added)


def _resolve_holidays(config: FactoryConfig) -> list[str]:
    """Return holiday date strings from config."""
    return list(config.holidays)
