"""Moldit MPP Parser — Read MS Project files via MPXJ/JPype."""
from __future__ import annotations

import logging
import re
from collections import defaultdict

from backend.types import (
    Dependencia,
    Maquina,
    Molde,
    MolditEngineData,
    Operacao,
)

logger = logging.getLogger(__name__)

# ── Code inference from task name ──────────────────────────────────────
_CODE_PATTERNS: list[tuple[str, str]] = [
    (r"!([A-Z]{2}\d{3})", ""),          # explicit code like !FE010
    (r"\bDesbaste\b", "FE010"),
    (r"\bAcabamento\b", "FE020"),
    (r"\bRetifica", "RE001"),
    (r"\bFura[cç]", "FU001"),
    (r"\bEros[aã]o\b", "EE005"),
    (r"\bPolimento\b", "BA045"),
    (r"\bFecho[\s_]circuitos\b", "FU015"),
    (r"\bGalgamento\b", "FE001"),
    (r"\bAjuste\b", "BA020"),
    (r"\bMontagem\b", "BA035"),
    (r"\b[Ee]l[eé]ctrodo", "EL001"),
    (r"\b[Ee]letrodo", "EL001"),
    (r"\bTextura\b", "TX001"),
    (r"\bTapagem\b", "TP001"),
    (r"\bControlo\b", "QC001"),
]


def _infer_code(name: str) -> str:
    """Infer operation code from task name."""
    for pattern, code in _CODE_PATTERNS:
        m = re.search(pattern, name, re.IGNORECASE)
        if m:
            if not code:
                # Captured group is the code
                return m.group(1)
            return code
    return "GEN000"


def _duration_to_hours(dur) -> float:
    """Convert an MPXJ Duration object to hours."""
    if dur is None:
        return 0.0
    from org.mpxj import TimeUnit  # type: ignore[import-untyped]
    val = dur.getDuration()
    unit = dur.getUnits()
    if unit == TimeUnit.HOURS:
        return float(val)
    if unit == TimeUnit.MINUTES:
        return float(val) / 60.0
    if unit == TimeUnit.DAYS:
        return float(val) * 8.0
    if unit == TimeUnit.WEEKS:
        return float(val) * 40.0
    if unit == TimeUnit.MONTHS:
        return float(val) * 160.0
    # Elapsed variants
    if unit == TimeUnit.ELAPSED_HOURS:
        return float(val)
    if unit == TimeUnit.ELAPSED_MINUTES:
        return float(val) / 60.0
    if unit == TimeUnit.ELAPSED_DAYS:
        return float(val) * 24.0
    return float(val)


def _date_to_str(d) -> str | None:
    """Convert a Java LocalDateTime or Date to ISO string."""
    if d is None:
        return None
    try:
        return str(d)[:10]  # "YYYY-MM-DD"
    except Exception:
        return None


def _ensure_jvm() -> None:
    """Start JVM with MPXJ jars if not already running.

    Uses the mpxj Python package which registers jars via jpype.addClassPath()
    at import time. We just need to import mpxj before starting the JVM.
    """
    import jpype

    if jpype.isJVMStarted():
        return

    # Import mpxj to register its JAR files on the classpath
    try:
        import mpxj  # noqa: F401 — side effect: registers jars
    except ImportError as e:
        raise RuntimeError(
            "mpxj not installed. Run: pip install mpxj"
        ) from e

    jpype.startJVM("-Xmx8g", convertStrings=True)


def parse_mpp(filepath: str) -> MolditEngineData:
    """Parse an MPP file and return MolditEngineData.

    Pipeline:
    1. Read all tasks from MPP
    2. Build mold inheritance map (outline levels)
    3. Extract operations (skip summaries/milestones)
    4. Extract resource assignments
    5. Extract dependencies
    6. Build compatibility matrix
    7. Build DAG + reverse DAG
    8. Compute critical path
    """
    _ensure_jvm()

    from org.mpxj.reader import UniversalProjectReader  # type: ignore[import-untyped]

    reader = UniversalProjectReader()
    project = reader.read(filepath)

    if project is None:
        raise ValueError(f"Could not read MPP file: {filepath}")

    tasks = list(project.getTasks())
    logger.info("MPP: %d total tasks", len(tasks))

    # ── Phase 1: Build mold inheritance map ──────────────────────────
    # Structure:
    #   Level 0 = project root
    #   Level 1 = top-level group (ignored)
    #   Level 2 = mold header: "2954 >> Producao - AIS" or "2947 - Molde ASG"
    #   Level 3 = operations (with mold in name) or component headers (ASG molds)
    #   Level 4+ = operations under component headers (ASG molds)
    #
    # Mold ID is extracted from:
    #   a) First 4 digits in task name, OR
    #   b) Inherited from nearest level 2 ancestor
    mold_map: dict[int, str] = {}       # task_id -> molde
    component_map: dict[int, str] = {}  # task_id -> componente
    mold_headers: dict[str, dict] = {}  # molde_id -> {cliente, deadline, ...}
    current_mold: str = ""
    current_component: str = ""

    _MOLD_RE = re.compile(r"^(\d{4})")

    for t in tasks:
        tid = t.getID()
        if tid is None:
            continue
        tid = int(tid)
        outline = int(t.getOutlineLevel()) if t.getOutlineLevel() is not None else 0
        name = str(t.getName() or "")

        if outline == 2:
            # Mold header — extract mold ID from name
            m = _MOLD_RE.match(name)
            if m:
                current_mold = m.group(1)
                current_component = ""
                mold_headers.setdefault(current_mold, {
                    "cliente": "",
                    "deadline": "",
                    "componentes": set(),
                })
            else:
                current_mold = ""
                current_component = ""
        elif outline == 3:
            # Either an operation (name has mold#) or component header
            m = _MOLD_RE.match(name)
            if m:
                # Operation with mold in name — extract component
                parts = name.split("\u00bb")  # split on >>
                if len(parts) >= 2:
                    current_component = parts[1].strip().split("-")[0].strip()
                else:
                    current_component = ""
                if current_mold and current_mold in mold_headers:
                    mold_headers[current_mold]["componentes"].add(
                        current_component,
                    )
            else:
                # Component header for ASG-style molds (e.g., "MACHO >> 2000")
                current_component = name.strip()
                if current_mold and current_mold in mold_headers:
                    mold_headers[current_mold]["componentes"].add(
                        current_component,
                    )
        elif outline >= 4:
            # Inherit mold+component from parent levels (already set)
            pass

        mold_map[tid] = current_mold
        component_map[tid] = current_component

    # ── Phase 2: Extract operations ──────────────────────────────────
    operacoes: list[Operacao] = []
    task_by_id: dict[int, object] = {}

    for t in tasks:
        tid = t.getID()
        if tid is None:
            continue
        tid = int(tid)
        task_by_id[tid] = t

        # Skip summary tasks and milestones
        is_summary = bool(t.getSummary()) if t.getSummary() is not None else False
        is_milestone = bool(t.getMilestone()) if t.getMilestone() is not None else False
        if is_summary or is_milestone:
            continue

        name = str(t.getName() or "")
        if not name.strip():
            continue

        molde = mold_map.get(tid, "")
        if not molde:
            continue  # orphan task outside mold hierarchy

        componente = component_map.get(tid, "")
        duracao = t.getDuration()
        work = t.getWork()
        pct = t.getPercentageComplete()
        progress = float(pct) if pct is not None else 0.0

        duracao_h = _duration_to_hours(duracao)
        work_h = _duration_to_hours(work)
        work_restante_h = work_h * (1.0 - progress / 100.0)

        codigo = _infer_code(name)

        # Build full name: "molde > componente > nome"
        parts = [p for p in [molde, componente, name] if p]
        nome_completo = " > ".join(parts)

        start_date = _date_to_str(t.getStart())
        finish_date = _date_to_str(t.getFinish())

        op = Operacao(
            id=tid,
            molde=molde,
            componente=componente,
            nome=name,
            codigo=codigo,
            nome_completo=nome_completo,
            duracao_h=duracao_h,
            work_h=work_h,
            progresso=progress,
            work_restante_h=work_restante_h,
            data_inicio=start_date,
            data_fim=finish_date,
        )
        operacoes.append(op)

    logger.info("MPP: %d operations extracted", len(operacoes))

    # ── Phase 3: Extract resource assignments ────────────────────────
    op_ids = {op.id for op in operacoes}
    compatibilidade: dict[str, list[str]] = defaultdict(list)

    for ra in project.getResourceAssignments():
        task = ra.getTask()
        resource = ra.getResource()
        if task is None or resource is None:
            continue
        tid = int(task.getID()) if task.getID() is not None else -1
        if tid not in op_ids:
            continue

        res_name = str(resource.getName() or "").strip()
        if not res_name:
            continue

        # Find the matching operation
        op = next((o for o in operacoes if o.id == tid), None)
        if op is None:
            continue

        # 2a placa detection: resource starts with "//"
        if res_name.startswith("//"):
            op.e_2a_placa = True
            res_name = res_name[2:].strip()

        # Conditional detection: resource is "?"
        if res_name == "?":
            op.e_condicional = True
            op.recurso = "?"
            continue

        if op.recurso is None:
            op.recurso = res_name

        # Build compatibility: codigo -> list of machine resources
        compat_key = op.codigo
        if res_name not in compatibilidade[compat_key]:
            compatibilidade[compat_key].append(res_name)

    # ── Phase 4: Extract dependencies ────────────────────────────────
    dependencias: list[Dependencia] = []
    for t in tasks:
        tid = t.getID()
        if tid is None:
            continue
        tid = int(tid)
        if tid not in op_ids:
            continue

        preds = t.getPredecessors()
        if preds is None:
            continue
        for rel in preds:
            pred_task = rel.getPredecessorTask()
            if pred_task is None:
                continue
            pred_id = (
                int(pred_task.getID())
                if pred_task.getID() is not None else -1
            )
            if pred_id not in op_ids:
                continue

            rel_type = (
                str(rel.getType()) if rel.getType() is not None else "FS"
            )
            lag_dur = rel.getLag()
            lag_val = 0
            if lag_dur is not None:
                lag_val = int(_duration_to_hours(lag_dur))

            dependencias.append(Dependencia(
                predecessor_id=pred_id,
                sucessor_id=tid,
                tipo=rel_type,
                lag=lag_val,
            ))

    logger.info("MPP: %d dependencies extracted", len(dependencias))

    # ── Phase 5: Build mold objects ──────────────────────────────────
    moldes_dict: dict[str, Molde] = {}
    for op in operacoes:
        if op.molde not in moldes_dict:
            hdr = mold_headers.get(op.molde, {})
            moldes_dict[op.molde] = Molde(
                id=op.molde,
                cliente=hdr.get("cliente", ""),
                deadline="",
                componentes=(
                    sorted(hdr.get("componentes", set()))
                    if isinstance(hdr.get("componentes"), set)
                    else list(hdr.get("componentes", []))
                ),
            )
        m = moldes_dict[op.molde]
        m.total_ops += 1
        m.total_work_h += op.work_h
        if op.progresso >= 100.0:
            m.ops_concluidas += 1

    for m in moldes_dict.values():
        if m.total_ops > 0:
            m.progresso = (m.ops_concluidas / m.total_ops) * 100.0

    moldes = list(moldes_dict.values())

    # ── Phase 6: Build machines from resource names ──────────────────
    # Collect unique resource names that appear in assignments
    resource_names: set[str] = set()
    for op in operacoes:
        if op.recurso and op.recurso != "?":
            resource_names.add(op.recurso)

    maquinas = [
        Maquina(id=rn, grupo=_infer_machine_group(rn))
        for rn in sorted(resource_names)
    ]

    # ── Phase 7: Build DAG ───────────────────────────────────────────
    dag: dict[int, list[int]] = defaultdict(list)
    dag_reverso: dict[int, list[int]] = defaultdict(list)
    for dep in dependencias:
        dag[dep.predecessor_id].append(dep.sucessor_id)
        dag_reverso[dep.sucessor_id].append(dep.predecessor_id)

    # ── Phase 8: Compute critical path ───────────────────────────────
    caminho_critico = _compute_critical_path(operacoes, dag, dag_reverso)

    return MolditEngineData(
        operacoes=operacoes,
        maquinas=maquinas,
        moldes=moldes,
        dependencias=dependencias,
        compatibilidade=dict(compatibilidade),
        dag=dict(dag),
        dag_reverso=dict(dag_reverso),
        caminho_critico=caminho_critico,
    )


def _infer_machine_group(resource_name: str) -> str:
    """Infer machine group from resource name pattern."""
    rn = resource_name.upper()
    if rn.startswith("FE16") or rn.startswith("FE22") or rn.startswith("FE18"):
        return "Desbaste"
    if rn.startswith("FE19"):
        return "Desbaste_PD"
    if rn.startswith("FE26"):
        return "Maq_3D_GD"
    if rn.startswith("FE31") or rn.startswith("FE35"):
        return "Maq_3D_2D_GD"
    if rn.startswith("FE32"):
        return "Maq_3D_MD"
    if rn.startswith("FE25"):
        return "Maq_3D_PD"
    if rn.startswith("FE30") or rn.startswith("FE36") or rn.startswith("FE37"):
        return "Acab_5ax"
    if rn.startswith("FE28") or rn.startswith("FE38"):
        return "Maq_estruturas"
    if rn.startswith("FE23"):
        return "FACESS"
    if rn.startswith("FE29") or rn.startswith("FE33"):
        return "Maq_Eletrodos"
    if rn.startswith("EE11"):
        return "Erosao_Fio"
    if rn.startswith("EE"):
        return "EROSAO"
    if rn.startswith("MA"):
        return "FURACAO"
    if rn.startswith("TO"):
        return "TORNO"
    if rn.startswith("BA"):
        return "Bancada"
    if "POLIMENTO" in rn:
        return "Polimento"
    if "TAPAGEM" in rn or rn.startswith("TP"):
        return "Tapagem"
    if "CONTROLO" in rn:
        return "Qualidade"
    if "PRENSA" in rn:
        return "Bancada"
    if "EXTERNO" in rn or "TEXTURA" in rn:
        return "Externo"
    if rn.startswith("FE11") or rn.startswith("FE34"):
        return "Maq_Acessorios"
    return "Outros"


def _compute_critical_path(
    operacoes: list[Operacao],
    dag: dict[int, list[int]],
    dag_reverso: dict[int, list[int]],
) -> list[int]:
    """Compute critical path as longest path by work_restante_h.

    Uses topological sort + dynamic programming (longest path in DAG).
    """
    op_map = {op.id: op for op in operacoes}
    all_ids = set(op_map.keys())

    # Topological sort (Kahn's algorithm)
    in_degree: dict[int, int] = {oid: 0 for oid in all_ids}
    for oid in all_ids:
        for succ in dag.get(oid, []):
            if succ in in_degree:
                in_degree[succ] += 1

    queue = [oid for oid, deg in in_degree.items() if deg == 0]
    topo_order: list[int] = []
    while queue:
        # Pick from queue (stable sort not needed for correctness)
        node = queue.pop(0)
        topo_order.append(node)
        for succ in dag.get(node, []):
            if succ not in in_degree:
                continue
            in_degree[succ] -= 1
            if in_degree[succ] == 0:
                queue.append(succ)

    if len(topo_order) != len(all_ids):
        logger.warning("DAG has cycles — critical path may be incomplete")
        # Return empty rather than crash
        return []

    # Longest path DP
    dist: dict[int, float] = {oid: 0.0 for oid in all_ids}
    parent: dict[int, int | None] = {oid: None for oid in all_ids}

    for node in topo_order:
        w = op_map[node].work_restante_h if node in op_map else 0.0
        for succ in dag.get(node, []):
            if succ not in dist:
                continue
            new_dist = dist[node] + w
            if new_dist > dist[succ]:
                dist[succ] = new_dist
                parent[succ] = node

    # Find the endpoint with max distance
    if not dist:
        return []

    def _node_cost(n: int) -> float:
        return dist[n] + (op_map[n].work_restante_h if n in op_map else 0.0)

    end_node = max(dist, key=_node_cost)

    # Trace back
    path: list[int] = [end_node]
    current = end_node
    while parent.get(current) is not None:
        current = parent[current]  # type: ignore[assignment]
        path.append(current)

    path.reverse()
    return path
