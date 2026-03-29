"""ISOP context extraction — Spec 08 S2.

Uses Moldit Operacao fields (no Incompol references).
"""

from __future__ import annotations

from backend.config.types import FactoryConfig
from backend.types import MolditEngineData as EngineData

from .types import ISContext


def extract_context(data: EngineData, config: FactoryConfig | None = None) -> ISContext:
    """Extract feature vector from an ISOP for transfer learning."""
    oee_default = config.oee_default if config else 0.66

    n_ops = len(data.operacoes)
    n_machines = len(data.maquinas)
    n_days = 30  # default planning horizon

    # Total work hours
    total_work_h = sum(op.work_h for op in data.operacoes)

    # Average completion ratio (inverse of remaining/total)
    ratios = []
    for op in data.operacoes:
        if op.work_h > 0:
            ratios.append(op.work_restante_h / op.work_h)
        else:
            ratios.append(0.0)
    avg_remaining_ratio = sum(ratios) / len(ratios) if ratios else 1.0

    # Compute effective OEE-like metric from work_restante / work ratio
    avg_efficiency = 1.0 - avg_remaining_ratio if avg_remaining_ratio < 1.0 else oee_default

    # Alt machine fraction (ops with recurso assigned)
    recurso_count = sum(1 for op in data.operacoes if op.recurso)
    recurso_pct = recurso_count / max(n_ops, 1)

    # Demand density: total work hours / total capacity
    total_capacity_h = sum(m.regime_h for m in data.maquinas) * n_days
    demand_density = total_work_h / total_capacity_h if total_capacity_h > 0 else 0.0

    return ISContext(
        n_ops=n_ops,
        n_machines=n_machines,
        n_days=n_days,
        total_demand=round(total_work_h),
        avg_oee=round(avg_efficiency, 3),
        twin_pct=0.0,  # No twin concept in Moldit
        alt_pct=round(recurso_pct, 3),
        avg_edd=0.0,
        demand_density=round(demand_density, 4),
    )
