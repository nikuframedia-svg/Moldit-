"""Guardian — Moldit Planner.

Input validation (pre-schedule) and output validation (post-schedule).
Never crashes — returns issues list. Drops or fixes bad data.
"""

from __future__ import annotations

import copy
from collections import defaultdict
from dataclasses import dataclass

from backend.config.types import FactoryConfig
from backend.scheduler.types import SegmentoMoldit
from backend.types import MolditEngineData


@dataclass(slots=True)
class GuardianIssue:
    op_id: str | int
    field: str
    severity: str  # "drop" | "warn" | "fix"
    message: str


@dataclass(slots=True)
class GuardianResult:
    cleaned: MolditEngineData
    dropped_ops: list[int]
    issues: list[GuardianIssue]
    is_clean: bool


def validate_input(
    data: MolditEngineData,
    config: FactoryConfig | None = None,
) -> GuardianResult:
    """Validate MolditEngineData before scheduling. Returns cleaned copy + issues."""
    issues: list[GuardianIssue] = []
    drop_ids: set[int] = set()

    # Load config for machine checks and electrode defaults
    if config is None:
        from backend.config.loader import load_config
        config = load_config()

    config_machine_ids = set(config.machines.keys()) if config.machines else set()
    electrodos_default_h = config.electrodos_default_h if config else 4.0

    # ── Check DAG is acyclic (DFS cycle detection) ───────────────────
    has_cycle, cycle_node = _detect_cycle(data.dag)
    if has_cycle:
        issues.append(GuardianIssue(
            cycle_node or 0, "dag", "warn",
            f"DAG contains a cycle near op {cycle_node}",
        ))

    # ── Validate operations ──────────────────────────────────────────
    seen_ids: set[int] = set()
    compat = data.compatibilidade

    for op in data.operacoes:
        # Duplicate ID
        if op.id in seen_ids:
            issues.append(GuardianIssue(
                op.id, "id", "drop", f"op.id duplicado: {op.id}",
            ))
            drop_ids.add(op.id)
            continue
        seen_ids.add(op.id)

        # Op with no compatible machine -> drop
        machines_for_code = compat.get(op.codigo, [])
        if not machines_for_code and op.recurso is None and not op.e_condicional:
            issues.append(GuardianIssue(
                op.id, "compatibilidade", "drop",
                f"Sem maquina compativel para codigo {op.codigo!r}",
            ))
            drop_ids.add(op.id)
            continue

        # Fix electrodes with 0 duration
        if op.codigo in ("EL001", "EL005") and op.work_h <= 0.0:
            issues.append(GuardianIssue(
                op.id, "work_h", "fix",
                f"Electrodo com 0h -> {electrodos_default_h}h",
            ))

        # Warn on duration <= 0 (except electrodes which are fixed above)
        if op.work_h <= 0.0 and op.codigo not in ("EL001", "EL005"):
            issues.append(GuardianIssue(
                op.id, "work_h", "warn",
                f"Duracao work_h={op.work_h} <= 0",
            ))

        # Inconsistency: has duration but no work
        if op.duracao_h > 0 and op.work_h <= 0 and op.codigo not in ("EL001", "EL005"):
            issues.append(GuardianIssue(
                op.id, "duracao_work", "warn",
                f"duracao_h={op.duracao_h} mas work_h={op.work_h} — inconsistente",
            ))

        # Clamp progress > 100
        if op.progresso > 100.0:
            issues.append(GuardianIssue(
                op.id, "progresso", "fix",
                f"Progresso {op.progresso} > 100 -> 100",
            ))

        # Warn on conditional ops without flag
        if op.recurso == "?" and not op.e_condicional:
            issues.append(GuardianIssue(
                op.id, "e_condicional", "warn",
                "Recurso='?' mas e_condicional=False",
            ))

        # Warn on unknown machines
        if (op.recurso and op.recurso != "?"
                and config_machine_ids
                and op.recurso not in config_machine_ids):
            issues.append(GuardianIssue(
                op.id, "recurso", "warn",
                f"Recurso {op.recurso!r} nao existe na config",
            ))

    # ── Drop deps referencing non-existent ops ───────────────────────
    valid_ids = seen_ids - drop_ids
    bad_dep_count = 0
    for dep in data.dependencias:
        if dep.predecessor_id not in valid_ids or dep.sucessor_id not in valid_ids:
            bad_dep_count += 1

    if bad_dep_count:
        issues.append(GuardianIssue(
            0, "dependencias", "fix",
            f"Removidas {bad_dep_count} dependencias com ops inexistentes",
        ))

    # ── Build cleaned data ───────────────────────────────────────────
    if not issues:
        return GuardianResult(
            cleaned=data, dropped_ops=[], issues=[], is_clean=True,
        )

    cleaned = copy.copy(data)
    cleaned.operacoes = []

    for op in data.operacoes:
        if op.id in drop_ids:
            continue
        cop = copy.copy(op)

        # Apply fixes
        if cop.codigo in ("EL001", "EL005") and cop.work_h <= 0.0:
            cop.work_h = electrodos_default_h
            cop.duracao_h = electrodos_default_h
            cop.work_restante_h = electrodos_default_h * (1.0 - cop.progresso / 100.0)

        if cop.progresso > 100.0:
            cop.progresso = 100.0
            cop.work_restante_h = 0.0

        cleaned.operacoes.append(cop)

    # Filter deps
    cleaned.dependencias = [
        dep for dep in data.dependencias
        if dep.predecessor_id in valid_ids and dep.sucessor_id in valid_ids
    ]

    # Rebuild DAG
    new_dag: dict[int, list[int]] = defaultdict(list)
    new_dag_rev: dict[int, list[int]] = defaultdict(list)
    for dep in cleaned.dependencias:
        new_dag[dep.predecessor_id].append(dep.sucessor_id)
        new_dag_rev[dep.sucessor_id].append(dep.predecessor_id)
    cleaned.dag = dict(new_dag)
    cleaned.dag_reverso = dict(new_dag_rev)

    return GuardianResult(
        cleaned=cleaned,
        dropped_ops=sorted(drop_ids),
        issues=issues,
        is_clean=False,
    )


def _detect_cycle(dag: dict[int, list[int]]) -> tuple[bool, int | None]:
    """DFS-based cycle detection. Returns (has_cycle, offending_node)."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[int, int] = {}

    all_nodes: set[int] = set()
    for node, succs in dag.items():
        all_nodes.add(node)
        for s in succs:
            all_nodes.add(s)

    for node in all_nodes:
        color[node] = WHITE

    def dfs(u: int) -> int | None:
        color[u] = GRAY
        for v in dag.get(u, []):
            if color.get(v, WHITE) == GRAY:
                return v  # cycle found
            if color.get(v, WHITE) == WHITE:
                result = dfs(v)
                if result is not None:
                    return result
        color[u] = BLACK
        return None

    for node in all_nodes:
        if color[node] == WHITE:
            result = dfs(node)
            if result is not None:
                return True, result

    return False, None


def validate_output(
    segmentos: list[SegmentoMoldit],
    data: MolditEngineData,
) -> list[GuardianIssue]:
    """Post-schedule sanity checks on segments."""
    issues: list[GuardianIssue] = []
    machine_ids = {m.id for m in data.maquinas}
    op_map = {op.id: op for op in data.operacoes}

    # ── Check dependency violations ──────────────────────────────────
    # Build: op_id -> latest segment end (dia, fim_h)
    op_end: dict[int, tuple[int, float]] = {}
    for seg in segmentos:
        key = (seg.dia, seg.fim_h)
        if seg.op_id not in op_end or key > op_end[seg.op_id]:
            op_end[seg.op_id] = key

    op_start: dict[int, tuple[int, float]] = {}
    for seg in segmentos:
        key = (seg.dia, seg.inicio_h)
        if seg.op_id not in op_start or key < op_start[seg.op_id]:
            op_start[seg.op_id] = key

    for dep in data.dependencias:
        # Skip violations where predecessor is conditional
        pred_op = op_map.get(dep.predecessor_id)
        if pred_op is not None and pred_op.e_condicional:
            continue
        pred_end = op_end.get(dep.predecessor_id)
        succ_start = op_start.get(dep.sucessor_id)
        if pred_end is not None and succ_start is not None:
            if succ_start < pred_end:
                issues.append(GuardianIssue(
                    dep.sucessor_id, "dependencia", "warn",
                    f"Op {dep.sucessor_id} comeca antes do predecessor "
                    f"{dep.predecessor_id} terminar",
                ))

    # ── Check machine overlaps (except 2a placa) ────────────────────
    by_machine_day: dict[tuple[str, int], list[SegmentoMoldit]] = defaultdict(list)
    for seg in segmentos:
        if not seg.e_2a_placa:
            by_machine_day[(seg.maquina_id, seg.dia)].append(seg)

    for (machine, day), segs in by_machine_day.items():
        sorted_segs = sorted(segs, key=lambda s: s.inicio_h)
        for i in range(len(sorted_segs) - 1):
            if sorted_segs[i].fim_h > sorted_segs[i + 1].inicio_h:
                issues.append(GuardianIssue(
                    sorted_segs[i].op_id, "overlap", "warn",
                    f"Sobreposicao {machine} dia {day}: "
                    f"{sorted_segs[i].fim_h} > {sorted_segs[i + 1].inicio_h}",
                ))

    # ── Check machine compatibility ──────────────────────────────────
    for seg in segmentos:
        op = op_map.get(seg.op_id)
        if op is None:
            continue
        compat_machines = data.compatibilidade.get(op.codigo, [])
        if compat_machines and seg.maquina_id not in compat_machines:
            issues.append(GuardianIssue(
                seg.op_id, "compatibilidade", "warn",
                f"Maquina {seg.maquina_id} nao e compativel com "
                f"codigo {op.codigo}",
            ))

    # ── Check daily regime limits ────────────────────────────────────
    machine_regime = {m.id: m.regime_h for m in data.maquinas}
    hours_by_machine_day: dict[tuple[str, int], float] = defaultdict(float)
    for seg in segmentos:
        hours_by_machine_day[(seg.maquina_id, seg.dia)] += seg.duracao_h

    for (machine, day), total_h in hours_by_machine_day.items():
        regime = machine_regime.get(machine, 16)
        if regime > 0 and total_h > regime + 0.5:  # 0.5h tolerance
            issues.append(GuardianIssue(
                0, "regime", "warn",
                f"Maquina {machine} dia {day}: {total_h:.1f}h > regime {regime}h",
            ))

    # ── Orphan machine check ─────────────────────────────────────────
    for seg in segmentos:
        if seg.maquina_id not in machine_ids:
            issues.append(GuardianIssue(
                seg.op_id, "maquina_id", "warn",
                f"Maquina {seg.maquina_id!r} nao existe",
            ))

    # ── Deadline validation ─────────────────────────────────────────
    from backend.scheduler.scoring import _deadline_to_working_days

    mold_last_day: dict[str, int] = defaultdict(int)
    for seg in segmentos:
        if seg.dia > mold_last_day[seg.molde]:
            mold_last_day[seg.molde] = seg.dia

    ref_date = data.data_referencia if hasattr(data, "data_referencia") else ""
    for molde in data.moldes:
        if not molde.deadline:
            continue
        deadline_day = _deadline_to_working_days(molde.deadline, ref_date)
        if deadline_day is None:
            continue
        last_day = mold_last_day.get(molde.id, 0)
        if last_day > deadline_day:
            issues.append(GuardianIssue(
                molde.id, "deadline", "critical",
                f"Molde {molde.id} ultrapassa deadline {molde.deadline} "
                f"(dia {deadline_day}) — termina dia {last_day} "
                f"(+{last_day - deadline_day} dias)",
            ))

    return issues
