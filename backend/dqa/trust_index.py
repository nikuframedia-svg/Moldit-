"""DQA / TrustIndex — Spec 12 S3.

Data quality scoring with automation gate recommendation.
4 dimensions: completeness, validity, consistency, richness.
Uses Moldit Operacao fields (no Incompol references).
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.config.types import FactoryConfig
from backend.types import MolditEngineData as EngineData


@dataclass(slots=True)
class DQADimension:
    name: str       # "completeness" | "validity" | "consistency" | "richness"
    score: float    # 0-100
    details: list[str]


@dataclass(slots=True)
class TrustResult:
    score: int           # 0-100
    gate: str            # "full_auto" | "monitoring" | "suggestion" | "manual"
    dimensions: list[DQADimension]
    n_ops: int
    n_issues: int


def _score_completeness(data: EngineData) -> DQADimension:
    """% of ops with essential fields filled."""
    details: list[str] = []
    if not data.operacoes:
        return DQADimension("completeness", 0.0, ["Sem operacoes"])

    checks = 0
    passed = 0
    for op in data.operacoes:
        # work_h present and > 0
        checks += 1
        if op.work_h > 0:
            passed += 1
        else:
            details.append(f"{op.id}: work_h vazio/zero")

        # nome non-empty
        checks += 1
        if op.nome:
            passed += 1

        # molde non-empty
        checks += 1
        if op.molde:
            passed += 1

        # duracao_h > 0
        checks += 1
        if op.duracao_h > 0:
            passed += 1
        else:
            details.append(f"{op.id}: duracao_h vazio/zero")

    score = (passed / max(checks, 1)) * 100
    return DQADimension("completeness", round(score, 1), details[:5])


def _score_validity(data: EngineData) -> DQADimension:
    """Fields within valid ranges."""
    details: list[str] = []
    machine_ids = {m.id for m in data.maquinas}

    if not data.operacoes:
        return DQADimension("validity", 0.0, ["Sem operacoes"])

    checks = 0
    passed = 0
    for op in data.operacoes:
        # work_h >= 0
        checks += 1
        if op.work_h >= 0:
            passed += 1

        # progresso in 0-100
        checks += 1
        if 0 <= op.progresso <= 100:
            passed += 1
        else:
            details.append(f"{op.id}: progresso={op.progresso}")

        # duracao_h >= 0
        checks += 1
        if op.duracao_h >= 0:
            passed += 1

        # work_restante_h >= 0
        checks += 1
        if op.work_restante_h >= 0:
            passed += 1
        else:
            details.append(f"{op.id}: work_restante_h={op.work_restante_h}")

        # Recurso (machine) exists if defined
        if op.recurso:
            checks += 1
            if op.recurso in machine_ids:
                passed += 1
            else:
                details.append(f"{op.id}: recurso {op.recurso!r} invalido")

    score = (passed / max(checks, 1)) * 100
    return DQADimension("validity", round(score, 1), details[:5])


def _score_consistency(data: EngineData) -> DQADimension:
    """Internal data consistency."""
    details: list[str] = []
    checks = 0
    passed = 0

    op_ids = {op.id for op in data.operacoes}

    # Dependencies reference valid ops
    for dep in data.dependencias:
        checks += 1
        if dep.predecessor_id in op_ids and dep.sucessor_id in op_ids:
            passed += 1
        else:
            details.append(f"Dep {dep.predecessor_id}->{dep.sucessor_id}: ops invalidos")

    # No duplicate op.id
    checks += 1
    if len(op_ids) == len(data.operacoes):
        passed += 1
    else:
        details.append(f"{len(data.operacoes) - len(op_ids)} op.id duplicados")

    # Moldes referenced by ops exist
    molde_ids = {m.id for m in data.moldes}
    op_moldes = {op.molde for op in data.operacoes}
    checks += 1
    orphan = op_moldes - molde_ids
    if not orphan:
        passed += 1
    else:
        details.append(f"Moldes sem definicao: {', '.join(sorted(orphan)[:3])}")

    if checks == 0:
        return DQADimension("consistency", 100.0, [])

    score = (passed / checks) * 100
    return DQADimension("consistency", round(score, 1), details[:5])


def _score_richness(data: EngineData) -> DQADimension:
    """Optional but valuable data presence."""
    details: list[str] = []
    if not data.operacoes:
        return DQADimension("richness", 0.0, ["Sem operacoes"])

    checks = 0
    passed = 0

    # % ops with recurso (machine assignment)
    with_recurso = sum(1 for op in data.operacoes if op.recurso)
    checks += 1
    if with_recurso / len(data.operacoes) > 0.3:
        passed += 1
    else:
        details.append(f"So {with_recurso}/{len(data.operacoes)} ops com recurso")

    # % ops with deadline_semana
    with_deadline = sum(1 for op in data.operacoes if op.deadline_semana)
    checks += 1
    if with_deadline / len(data.operacoes) > 0.3:
        passed += 1
    else:
        details.append(f"So {with_deadline}/{len(data.operacoes)} ops com deadline_semana")

    # Holidays defined
    checks += 1
    if data.feriados:
        passed += 1
    else:
        details.append("Sem feriados definidos")

    # DAG populated
    checks += 1
    if data.dag:
        passed += 1
    else:
        details.append("Sem DAG (grafo de dependencias)")

    score = (passed / max(checks, 1)) * 100
    return DQADimension("richness", round(score, 1), details[:5])


def compute_trust_index(
    data: EngineData, config: FactoryConfig | None = None,
) -> TrustResult:
    """Score data quality. Returns 0-100 score + gate recommendation."""
    completeness = _score_completeness(data)
    validity = _score_validity(data)
    consistency = _score_consistency(data)
    richness = _score_richness(data)

    # Weighted score
    weighted = (
        completeness.score * 0.25
        + validity.score * 0.30
        + consistency.score * 0.25
        + richness.score * 0.20
    )
    score = round(weighted)

    # Gate thresholds
    if score >= 90:
        gate = "full_auto"
    elif score >= 70:
        gate = "monitoring"
    elif score >= 50:
        gate = "suggestion"
    else:
        gate = "manual"

    dims = [completeness, validity, consistency, richness]
    n_issues = sum(len(d.details) for d in dims)

    return TrustResult(
        score=score,
        gate=gate,
        dimensions=dims,
        n_ops=len(data.operacoes),
        n_issues=n_issues,
    )
